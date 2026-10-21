/** Durable command receipts and the authoritative aquarium snapshot backed by a SQLite DO. */
export interface SqlCursorLike {
  toArray(): unknown[];
}

export interface SqlStorageLike {
  exec(query: string, ...bindings: unknown[]): SqlCursorLike;
  transactionSync?<T>(callback: () => T): T;
}

export interface AquariumCommandInput {
  commandId: string;
  method: string;
  path: string;
  requestHash: string;
  actorId: string;
  actorRoles: string[];
}

export interface PublicRateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export type ClaimResult =
  | { kind: "accepted" }
  | { kind: "capacity_exceeded"; revision: number }
  | { kind: "replay"; status: number; body: string | null; contentType: string | null; revision: number }
  | { kind: "result_unavailable"; revision: number }
  | { kind: "in_progress"; revision: number }
  | { kind: "conflict"; revision: number };

const RESPONSE_BODY_LIMIT = 16 * 1024;
const SNAPSHOT_CHUNK_LIMIT = 16 * 1024;
const SNAPSHOT_SIZE_LIMIT = 8 * 1024 * 1024;
export const AQUARIUM_COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_COMMAND_RECEIPTS = 50_000;
const MAX_PUBLIC_RATE_LIMIT_BUCKETS = 50_000;
const PUBLIC_RATE_LIMIT_RETENTION_MS = 15 * 60 * 1000;
const PENDING_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstRow<T extends Record<string, unknown>>(cursor: SqlCursorLike): T | undefined {
  return cursor.toArray()[0] as T | undefined;
}

function runTransaction<T>(sql: SqlStorageLike, callback: () => T): T {
  return sql.transactionSync ? sql.transactionSync(callback) : callback();
}

function splitSnapshot(value: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const codePoint of value) {
    if (chunk.length + codePoint.length > SNAPSHOT_CHUNK_LIMIT) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += codePoint;
  }
  if (chunk || chunks.length === 0) chunks.push(chunk);
  return chunks;
}

export class AquariumCommandStore {
  constructor(private readonly sql: SqlStorageLike) {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS aquarium_meta (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS aquarium_commands (
        command_id TEXT PRIMARY KEY,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_roles TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
        response_status INTEGER,
        response_body TEXT,
        response_content_type TEXT,
        revision INTEGER,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);
    sql.exec("INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('revision', 0)");
    sql.exec("INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('snapshot_saved_at', 0)");
    sql.exec("INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('snapshot_revision', 0)");
    sql.exec("INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('state_uncertain', 0)");
    sql.exec("INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('state_initialized', 0)");
    sql.exec("INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('projection_version', 0)");
    const commandCount = firstRow<{ value: number }>(sql.exec("SELECT value FROM aquarium_meta WHERE key = 'command_count'"));
    if (!commandCount) {
      const existingCount = firstRow<{ count: number }>(sql.exec("SELECT COUNT(*) AS count FROM aquarium_commands"));
      sql.exec(
        "INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('command_count', ?)",
        Number(existingCount?.count ?? 0),
      );
    }
    sql.exec("CREATE INDEX IF NOT EXISTS aquarium_commands_created_at ON aquarium_commands(created_at)");
    sql.exec(`
      CREATE TABLE IF NOT EXISTS aquarium_snapshot_chunks (
        chunk_index INTEGER PRIMARY KEY,
        data TEXT NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS aquarium_config (
        config_key TEXT PRIMARY KEY,
        json_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS aquarium_fish_metadata (
        collection TEXT NOT NULL CHECK (collection IN ('active', 'pending')),
        fish_id TEXT NOT NULL,
        json_value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, fish_id)
      )
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS aquarium_public_rate_limits (
        route TEXT NOT NULL CHECK (route IN ('scan', 'release', 'state')),
        ip_hash TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        request_count INTEGER NOT NULL,
        PRIMARY KEY (route, ip_hash, window_start)
      )
    `);
    sql.exec("CREATE INDEX IF NOT EXISTS aquarium_public_rate_limits_window ON aquarium_public_rate_limits(window_start)");
    const rateLimitCount = firstRow<{ value: number }>(sql.exec("SELECT value FROM aquarium_meta WHERE key = 'public_rate_limit_count'"));
    if (!rateLimitCount) {
      const existingCount = firstRow<{ count: number }>(sql.exec("SELECT COUNT(*) AS count FROM aquarium_public_rate_limits"));
      sql.exec(
        "INSERT OR IGNORE INTO aquarium_meta (key, value) VALUES ('public_rate_limit_count', ?)",
        Number(existingCount?.count ?? 0),
      );
    }
    // Older deployments already have canonical snapshots. Preserve their authority on migration.
    sql.exec("UPDATE aquarium_meta SET value = 1 WHERE key = 'state_initialized' AND EXISTS (SELECT 1 FROM aquarium_meta WHERE key = 'snapshot_saved_at' AND value > 0)");
    const projectionVersion = firstRow<{ value: number }>(sql.exec("SELECT value FROM aquarium_meta WHERE key = 'projection_version'"));
    if (Number(projectionVersion?.value ?? 0) < 1) {
      const previousSnapshot = this.getSnapshot();
      if (previousSnapshot) this.writeProjections(previousSnapshot.json, previousSnapshot.savedAt);
      sql.exec("UPDATE aquarium_meta SET value = 1 WHERE key = 'projection_version'");
    }
  }

  isInitialized(): boolean {
    const row = firstRow<{ value: number }>(this.sql.exec("SELECT value FROM aquarium_meta WHERE key = 'state_initialized'"));
    return Number(row?.value ?? 0) === 1;
  }

  getRevision(): number {
    const row = firstRow<{ value: number }>(this.sql.exec("SELECT value FROM aquarium_meta WHERE key = 'revision'"));
    return Number(row?.value ?? 0);
  }

  /** Any other pending mutation makes the older recovery snapshot unsafe to apply. */
  isStateUncertain(exceptCommandId?: string): boolean {
    const marker = firstRow<{ value: number }>(this.sql.exec("SELECT value FROM aquarium_meta WHERE key = 'state_uncertain'"));
    if (Number(marker?.value ?? 0) !== 0) return true;
    const pending = exceptCommandId
      ? this.sql.exec(
        "SELECT command_id FROM aquarium_commands WHERE status = 'pending' AND command_id <> ? LIMIT 1",
        exceptCommandId,
      )
      : this.sql.exec("SELECT command_id FROM aquarium_commands WHERE status = 'pending' LIMIT 1");
    return Boolean(firstRow<{ command_id: string }>(pending));
  }

  markStateUncertain(): void {
    this.sql.exec("UPDATE aquarium_meta SET value = 1 WHERE key = 'state_uncertain'");
  }

  consumePublicRateLimit(
    route: "scan" | "release" | "state",
    ipHash: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): PublicRateLimitDecision {
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowMs) || windowMs < 1) {
      throw new RangeError("Invalid public API rate limit policy");
    }
    return runTransaction(this.sql, () => {
      this.pruneExpiredPublicRateLimits(now);
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const staleClientBuckets = Number(firstRow<{ count: number }>(this.sql.exec(
        "SELECT COUNT(*) AS count FROM aquarium_public_rate_limits WHERE route = ? AND ip_hash = ? AND window_start < ?",
        route,
        ipHash,
        windowStart,
      ))?.count ?? 0);
      if (staleClientBuckets > 0) {
        this.sql.exec(
          "DELETE FROM aquarium_public_rate_limits WHERE route = ? AND ip_hash = ? AND window_start < ?",
          route,
          ipHash,
          windowStart,
        );
        this.sql.exec(
          "UPDATE aquarium_meta SET value = MAX(0, value - ?) WHERE key = 'public_rate_limit_count'",
          staleClientBuckets,
        );
      }
      const existing = firstRow<{ request_count: number }>(this.sql.exec(
        "SELECT request_count FROM aquarium_public_rate_limits WHERE route = ? AND ip_hash = ? AND window_start = ?",
        route,
        ipHash,
        windowStart,
      ));
      if (existing) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
        if (Number(existing.request_count) >= limit) return { allowed: false, retryAfterSeconds };
        this.sql.exec(
          "UPDATE aquarium_public_rate_limits SET request_count = request_count + 1 WHERE route = ? AND ip_hash = ? AND window_start = ?",
          route,
          ipHash,
          windowStart,
        );
        return { allowed: true, retryAfterSeconds: 0 };
      }

      const bucketCount = Number(firstRow<{ value: number }>(this.sql.exec(
        "SELECT value FROM aquarium_meta WHERE key = 'public_rate_limit_count'",
      ))?.value ?? 0);
      if (bucketCount >= MAX_PUBLIC_RATE_LIMIT_BUCKETS) {
        const oldest = firstRow<{ value: number }>(this.sql.exec(
          "SELECT MIN(window_start) AS value FROM aquarium_public_rate_limits",
        ));
        const retryAt = Number(oldest?.value ?? now) + PUBLIC_RATE_LIMIT_RETENTION_MS;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((retryAt - now) / 1000)) };
      }
      this.sql.exec(
        "INSERT INTO aquarium_public_rate_limits (route, ip_hash, window_start, request_count) VALUES (?, ?, ?, 1)",
        route,
        ipHash,
        windowStart,
      );
      this.sql.exec("UPDATE aquarium_meta SET value = value + 1 WHERE key = 'public_rate_limit_count'");
      return { allowed: true, retryAfterSeconds: 0 };
    });
  }

  private pruneExpiredPublicRateLimits(now: number): void {
    const cutoff = now - PUBLIC_RATE_LIMIT_RETENTION_MS;
    const expiredCount = Number(firstRow<{ count: number }>(this.sql.exec(
      "SELECT COUNT(*) AS count FROM aquarium_public_rate_limits WHERE window_start < ?",
      cutoff,
    ))?.count ?? 0);
    if (expiredCount === 0) return;
    this.sql.exec("DELETE FROM aquarium_public_rate_limits WHERE window_start < ?", cutoff);
    this.sql.exec(
      "UPDATE aquarium_meta SET value = MAX(0, value - ?) WHERE key = 'public_rate_limit_count'",
      expiredCount,
    );
  }

  getSnapshot(): { json: string; savedAt: number; revision: number } | null {
    const savedAt = firstRow<{ value: number }>(this.sql.exec("SELECT value FROM aquarium_meta WHERE key = 'snapshot_saved_at'"));
    if (!savedAt?.value) return null;
    const revision = firstRow<{ value: number }>(this.sql.exec("SELECT value FROM aquarium_meta WHERE key = 'snapshot_revision'"));
    const chunks = this.sql.exec("SELECT data FROM aquarium_snapshot_chunks ORDER BY chunk_index").toArray() as Array<{ data: string }>;
    return {
      json: chunks.map((chunk) => chunk.data).join(""),
      savedAt: Number(savedAt.value),
      revision: Number(revision?.value ?? 0),
    };
  }

  saveSnapshot(json: string, now = Date.now()): number {
    const snapshotSize = new TextEncoder().encode(json).byteLength;
    if (snapshotSize > SNAPSHOT_SIZE_LIMIT) throw new Error(`Aquarium snapshot exceeds ${SNAPSHOT_SIZE_LIMIT} bytes`);
    return runTransaction(this.sql, () => {
      const revision = this.getRevision();
      this.writeSnapshot(json, now, revision);
      this.writeProjections(json, now);
      return revision;
    });
  }

  /** Seed the canonical DO state exactly once from the Container's legacy R2 restore. */
  seedSnapshot(json: string, now = Date.now()): boolean {
    const snapshotSize = new TextEncoder().encode(json).byteLength;
    if (snapshotSize > SNAPSHOT_SIZE_LIMIT) throw new Error(`Aquarium snapshot exceeds ${SNAPSHOT_SIZE_LIMIT} bytes`);
    return runTransaction(this.sql, () => {
      if (this.isInitialized()) return false;
      const revision = this.getRevision();
      this.writeSnapshot(json, now, revision);
      this.writeProjections(json, now);
      this.sql.exec("UPDATE aquarium_meta SET value = 1 WHERE key = 'state_initialized'");
      return true;
    });
  }

  private writeSnapshot(json: string, now: number, revision: number): void {
    this.sql.exec("DELETE FROM aquarium_snapshot_chunks");
    const chunks = splitSnapshot(json);
    for (let index = 0; index < chunks.length; index++) {
      this.sql.exec("INSERT INTO aquarium_snapshot_chunks (chunk_index, data) VALUES (?, ?)", index, chunks[index]);
    }
    this.sql.exec("UPDATE aquarium_meta SET value = ? WHERE key = 'snapshot_saved_at'", now);
    this.sql.exec("UPDATE aquarium_meta SET value = ? WHERE key = 'snapshot_revision'", revision);
    this.sql.exec("UPDATE aquarium_meta SET value = 1 WHERE key = 'state_initialized'");
  }

  /** Queryable projections contain configuration and fish metadata, not image bytes or physics. */
  private writeProjections(json: string, now: number): void {
    const snapshot = JSON.parse(json) as unknown;
    if (!isRecord(snapshot)) throw new Error("Aquarium snapshot projections require an object envelope");

    this.sql.exec("DELETE FROM aquarium_config");
    for (const [key, value] of Object.entries(snapshot)) {
      if (key === "schemaVersion" || key === "savedAt" || key === "activeFish" || key === "pendingFish") continue;
      this.sql.exec(
        "INSERT INTO aquarium_config (config_key, json_value, updated_at) VALUES (?, ?, ?)",
        key,
        JSON.stringify(value),
        now,
      );
    }

    this.sql.exec("DELETE FROM aquarium_fish_metadata");
    for (const collection of ["activeFish", "pendingFish"] as const) {
      const fish = snapshot[collection];
      if (!Array.isArray(fish)) continue;
      for (let index = 0; index < fish.length; index++) {
        const item = fish[index];
        if (!isRecord(item)) continue;
        const id = item.id;
        const fishId = typeof id === "string" || typeof id === "number" ? String(id) : `${collection}-${index}`;
        const metadata = { ...item };
        // Position/velocity checkpoints remain compatible with the existing R2 checkpoint path.
        delete metadata.physics;
        this.sql.exec(
          "INSERT INTO aquarium_fish_metadata (collection, fish_id, json_value, updated_at) VALUES (?, ?, ?, ?)",
          collection === "activeFish" ? "active" : "pending",
          fishId,
          JSON.stringify(metadata),
          now,
        );
      }
    }
    this.sql.exec("UPDATE aquarium_meta SET value = 1 WHERE key = 'projection_version'");
  }

  claim(input: AquariumCommandInput, now = Date.now()): ClaimResult {
    return runTransaction(this.sql, () => {
      this.pruneExpiredCommands(now);
      const existing = firstRow<{
        request_hash: string;
        actor_id: string;
        status: string;
        response_status: number | null;
        response_body: string | null;
        response_content_type: string | null;
        revision: number | null;
        created_at: number;
      }>(this.sql.exec(
        "SELECT request_hash, actor_id, status, response_status, response_body, response_content_type, revision, created_at FROM aquarium_commands WHERE command_id = ?",
        input.commandId,
      ));

      const revision = this.getRevision();
      if (existing) {
        if (existing.request_hash !== input.requestHash || existing.actor_id !== input.actorId) return { kind: "conflict", revision };
        if (existing.status === "completed" && existing.response_status !== null) {
          if (existing.response_body === null) return { kind: "result_unavailable", revision };
          return {
            kind: "replay",
            status: Number(existing.response_status),
            body: existing.response_body,
            contentType: existing.response_content_type,
            revision: Number(existing.revision ?? revision),
          };
        }
        if (now - Number(existing.created_at) >= PENDING_COMMAND_TIMEOUT_MS) {
          this.sql.exec(
            `UPDATE aquarium_commands
             SET status = 'completed', response_status = 409, response_body = NULL,
                 response_content_type = NULL, revision = ?, completed_at = ?
             WHERE command_id = ? AND status = 'pending'`,
            revision,
            now,
            input.commandId,
          );
          this.markStateUncertain();
          return { kind: "result_unavailable", revision };
        }
        return { kind: "in_progress", revision };
      }

      const commandCount = firstRow<{ value: number }>(
        this.sql.exec("SELECT value FROM aquarium_meta WHERE key = 'command_count'"),
      );
      if (Number(commandCount?.value ?? 0) >= MAX_COMMAND_RECEIPTS) {
        return { kind: "capacity_exceeded", revision };
      }
      this.sql.exec(
        `INSERT INTO aquarium_commands
          (command_id, method, path, request_hash, actor_id, actor_roles, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        input.commandId,
        input.method,
        input.path,
        input.requestHash,
        input.actorId,
        JSON.stringify(input.actorRoles),
        now,
      );
      this.sql.exec("UPDATE aquarium_meta SET value = value + 1 WHERE key = 'command_count'");
      return { kind: "accepted" };
    });
  }

  private pruneExpiredCommands(now: number): void {
    const cutoff = now - AQUARIUM_COMMAND_RETENTION_MS;
    const expiredPending = firstRow<{ command_id: string }>(this.sql.exec(
      "SELECT command_id FROM aquarium_commands WHERE status = 'pending' AND created_at < ? LIMIT 1",
      cutoff,
    ));
    if (expiredPending) this.markStateUncertain();

    const expiredCount = Number(firstRow<{ count: number }>(this.sql.exec(
      "SELECT COUNT(*) AS count FROM aquarium_commands WHERE created_at < ?",
      cutoff,
    ))?.count ?? 0);
    if (expiredCount === 0) return;

    this.sql.exec("DELETE FROM aquarium_commands WHERE created_at < ?", cutoff);
    this.sql.exec(
      "UPDATE aquarium_meta SET value = MAX(0, value - ?) WHERE key = 'command_count'",
      expiredCount,
    );
  }

  complete(
    commandId: string,
    status: number,
    body: string | null,
    contentType: string | null,
    snapshotJson?: string,
    now = Date.now(),
  ): number {
    const successful = status >= 200 && status < 300;
    if (successful && snapshotJson === undefined) {
      throw new Error("Successful aquarium commands require a durable state snapshot");
    }
    if (successful && new TextEncoder().encode(snapshotJson!).byteLength > SNAPSHOT_SIZE_LIMIT) {
      throw new Error(`Aquarium snapshot exceeds ${SNAPSHOT_SIZE_LIMIT} bytes`);
    }

    return runTransaction(this.sql, () => {
      const pending = firstRow<{ command_id: string }>(this.sql.exec(
        "SELECT command_id FROM aquarium_commands WHERE command_id = ? AND status = 'pending'",
        commandId,
      ));
      if (!pending) return this.getRevision();

      if (successful) {
        this.sql.exec("UPDATE aquarium_meta SET value = value + 1 WHERE key = 'revision'");
        this.sql.exec("UPDATE aquarium_meta SET value = 0 WHERE key = 'state_uncertain'");
      }
      const revision = this.getRevision();
      if (successful) {
        this.writeSnapshot(snapshotJson!, now, revision);
        this.writeProjections(snapshotJson!, now);
      }
      const replayBody = body !== null && new TextEncoder().encode(body).byteLength <= RESPONSE_BODY_LIMIT ? body : null;
      this.sql.exec(
        `UPDATE aquarium_commands
         SET status = 'completed', response_status = ?, response_body = ?, response_content_type = ?, revision = ?, completed_at = ?
         WHERE command_id = ? AND status = 'pending'`,
        status,
        replayBody,
        contentType,
        revision,
        now,
        commandId,
      );
      return revision;
    });
  }
}
