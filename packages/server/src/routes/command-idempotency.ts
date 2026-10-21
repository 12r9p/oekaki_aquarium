import type { Context } from "hono";
import { createHash } from "node:crypto";
import {
  COMMAND_DURABILITY_HEADER,
  COMMAND_ID_HEADER,
  COMMAND_REPLAY_HEADER,
} from "@aquarium/shared";

const MAX_COMMAND_ID_LENGTH = 128;
const MAX_LEDGER_ENTRIES = 2_000;
const COMMAND_TTL_MS = 6 * 60 * 60 * 1_000;
const MAX_CACHED_RESPONSE_BYTES = 256 * 1024;

interface CachedResponse {
  body: Uint8Array;
  headers: Array<[string, string]>;
  status: number;
  statusText: string;
}

interface CommandRecord {
  fingerprint: string;
  state: "in-flight" | "completed" | "unknown";
  expiresAt: number;
  response?: CachedResponse;
  settled: Promise<void>;
  settle: () => void;
}

const commandRecords = new Map<string, CommandRecord>();

export type CommandIdResult =
  | { commandId: string | null }
  | { error: Response };

/** Read a command ID from the standard header, falling back to a body field. */
export function readCommandId(c: Context, bodyValue?: unknown): CommandIdResult {
  const headerValue = c.req.header(COMMAND_ID_HEADER);
  const value = headerValue ?? bodyValue;
  if (value === undefined || value === null || value === "") return { commandId: null };
  if (
    typeof value !== "string"
    || value.length > MAX_COMMAND_ID_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  ) {
    return { error: c.json({ error: "Invalid command ID" }, 400) };
  }
  return { commandId: value };
}

/**
 * Hash a canonical JSON representation. Callers pass only operation metadata
 * and content digests, never image bytes, so uploads are not retained here.
 */
export async function fingerprintCommand(payload: unknown): Promise<string> {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

/** Hash bytes already being processed by an upload route without retaining them. */
export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Suppress duplicate execution and replay its small JSON response while this
 * process remains alive. This is deliberately process-local: the Container's
 * current filesystem/R2 mirror is not atomic with these route side effects.
 */
export async function runIdempotentCommand(
  c: Context,
  commandId: string | null,
  fingerprint: string,
  operation: () => Promise<Response> | Response,
): Promise<Response> {
  if (!commandId) return operation();

  const key = `${c.req.method}:${new URL(c.req.url).pathname}:${commandId}`;
  pruneExpiredRecords();
  const current = commandRecords.get(key);

  if (current) {
    if (current.fingerprint !== fingerprint) {
      return commandError(c, commandId, 409, "Command ID was already used with a different payload", "conflict");
    }
    if (current.state === "unknown") {
      return commandError(c, commandId, 409, "Command outcome is unknown; inspect aquarium state before retrying", "unknown");
    }
    if (current.state === "in-flight") await current.settled;
    const settledState = getRecordState(current);
    if (settledState === "unknown" || !current.response) {
      return commandError(c, commandId, 409, "Command outcome is unknown; inspect aquarium state before retrying", "unknown");
    }
    return restoreResponse(current.response, commandId, true);
  }

  const record = createRecord(fingerprint);
  commandRecords.set(key, record);
  enforceRecordLimit();

  try {
    const response = await operation();
    if (response.status >= 500) {
      record.state = "unknown";
      return addCommandHeaders(response, commandId, false);
    }

    const cached = await cacheResponse(response);
    if (!cached) {
      record.state = "unknown";
      return addCommandHeaders(response, commandId, false);
    }

    record.response = cached;
    record.state = "completed";
    return addCommandHeaders(response, commandId, false);
  } catch (error) {
    record.state = "unknown";
    throw error;
  } finally {
    record.settle();
  }
}

function createRecord(fingerprint: string): CommandRecord {
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => { settle = resolve; });
  return {
    fingerprint,
    state: "in-flight",
    expiresAt: Date.now() + COMMAND_TTL_MS,
    settled,
    settle,
  };
}

async function cacheResponse(response: Response): Promise<CachedResponse | null> {
  const body = new Uint8Array(await response.clone().arrayBuffer());
  if (body.byteLength > MAX_CACHED_RESPONSE_BYTES) return null;
  const headers = [...response.headers.entries()]
    .filter(([name]) => name.toLowerCase() !== COMMAND_REPLAY_HEADER.toLowerCase()
      && name.toLowerCase() !== COMMAND_DURABILITY_HEADER.toLowerCase());
  return { body, headers, status: response.status, statusText: response.statusText };
}

function restoreResponse(response: CachedResponse, commandId: string, replayed: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set(COMMAND_ID_HEADER, commandId);
  headers.set(COMMAND_REPLAY_HEADER, String(replayed));
  headers.set(COMMAND_DURABILITY_HEADER, "process-memory");
  return new Response(response.body.slice(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function addCommandHeaders(response: Response, commandId: string, replayed: boolean): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set(COMMAND_ID_HEADER, commandId);
  headers.set(COMMAND_REPLAY_HEADER, String(replayed));
  headers.set(COMMAND_DURABILITY_HEADER, "process-memory");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function commandError(
  c: Context,
  commandId: string,
  status: 409,
  message: string,
  outcome: "conflict" | "unknown",
): Response {
  const response = c.json({ error: message, commandId, outcome }, status);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  headers.set(COMMAND_ID_HEADER, commandId);
  headers.set(COMMAND_REPLAY_HEADER, "false");
  headers.set(COMMAND_DURABILITY_HEADER, "process-memory");
  return new Response(response.body, { status: response.status, headers });
}

function pruneExpiredRecords(): void {
  const now = Date.now();
  for (const [key, record] of commandRecords) {
    if (record.state !== "in-flight" && record.expiresAt <= now) commandRecords.delete(key);
  }
}

function enforceRecordLimit(): void {
  while (commandRecords.size > MAX_LEDGER_ENTRIES) {
    const oldestCompleted = [...commandRecords].find(([, record]) => record.state !== "in-flight");
    if (oldestCompleted) {
      commandRecords.delete(oldestCompleted[0]);
      continue;
    }
    // An in-flight command is never evicted; temporary growth is safer than
    // permitting a concurrent retry to execute the same side effect twice.
    return;
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  const fields = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
  return `{${fields.join(",")}}`;
}

function getRecordState(record: CommandRecord): CommandRecord["state"] {
  return record.state;
}
