import { spawn } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../../..");
const DATA_ROOT = join(PROJECT_ROOT, "data");
const PUBLIC_IMAGES_ROOT = join(PROJECT_ROOT, "packages/server/public/images");
const DEFAULT_R2_BUCKET_NAME = "oekaki-aquarium-data";
const R2_USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const PERSISTED_ROOTS = [
  { prefix: "data/", path: DATA_ROOT },
  { prefix: "public/images/", path: PUBLIC_IMAGES_ROOT },
] as const;

interface R2Config { origin: string }

let watchers: FSWatcher[] = [];
const pendingFiles = new Set<string>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlightWrites = new Set<Promise<void>>();
const fileWriteQueues = new Map<string, Promise<void>>();
const fileVersions = new Map<string, number>();

function readConfig(): R2Config | null {
  const origin = process.env.R2_BRIDGE_ORIGIN?.replace(/\/+$/, "");
  return origin ? { origin } : null;
}

function getR2(): R2Config | null {
  return readConfig();
}

function objectUrl(r2: R2Config, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${r2.origin}/object/${encodedKey}`;
}

async function requestR2(r2: R2Config, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", R2_USER_AGENT);
  const response = await fetch(`${r2.origin}${path}`, { ...init, headers });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error(`R2 bridge request failed (${response.status}): ${detail}`);
  }
  return response;
}

async function listR2Objects(r2: R2Config, prefix: string, cursor?: string): Promise<{ keys: string[]; cursor?: string }> {
  const query = new URLSearchParams({ prefix });
  if (cursor) query.set("cursor", cursor);
  const response = await requestR2(r2, `/__list?${query.toString()}`);
  const page = await response.json() as { keys: string[]; cursor: string | null };
  return { keys: page.keys, cursor: page.cursor ?? undefined };
}

async function readR2Object(r2: R2Config, key: string): Promise<Uint8Array | null> {
  const response = await fetch(objectUrl(r2, key), { headers: { "User-Agent": R2_USER_AGENT } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 bridge request failed (${response.status}) for an object read.`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function readPersistedR2Object(key: string): Promise<Uint8Array | null> {
  const r2 = getR2();
  return r2 ? readR2Object(r2, key) : null;
}

export async function writePersistedR2Object(key: string, body: Uint8Array): Promise<void> {
  const r2 = getR2();
  if (r2) await writeR2Object(r2, key, body);
}

async function writeR2Object(r2: R2Config, key: string, body: Uint8Array): Promise<void> {
  await requestR2(r2, `/object/${key.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
}

async function deleteR2Object(r2: R2Config, key: string): Promise<void> {
  await requestR2(r2, `/object/${key.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
}

async function uploadWithWrangler(bucket: string, key: string, filePath: string): Promise<void> {
  await new Promise<void>((resolveUpload, rejectUpload) => {
    const child = spawn(process.execPath, [
      "x",
      "wrangler", "r2", "object", "put", `${bucket}/${key}`,
      "--file", filePath, "--remote", "--force",
    ], { cwd: PROJECT_ROOT, env: process.env, stdio: "ignore" });
    child.once("error", () => rejectUpload(new Error("Could not start Wrangler for an R2 object upload.")));
    child.once("close", (code) => code === 0
      ? resolveUpload()
      : rejectUpload(new Error(`Wrangler failed to upload an R2 object (exit ${code ?? "unknown"}).`)));
  });
}

function pathForObjectKey(key: string): string | null {
  const root = PERSISTED_ROOTS.find((entry) => key.startsWith(entry.prefix));
  if (!root) return null;
  const suffix = key.slice(root.prefix.length);
  if (!suffix || suffix.split("/").some((part) => part === ".." || part === ".")) return null;
  return join(root.path, suffix);
}

function objectKeyForPath(path: string): string | null {
  const absolutePath = resolve(path);
  for (const root of PERSISTED_ROOTS) {
    const suffix = relative(root.path, absolutePath);
    if (suffix && suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)) {
      return `${root.prefix}${suffix.split("\\").join("/")}`;
    }
  }
  return null;
}

/** Restore durable objects before the server imports its settings and fish managers. */
export async function restoreR2Files(): Promise<void> {
  const r2 = getR2();
  if (!r2) return;
  for (const root of PERSISTED_ROOTS) await mkdir(root.path, { recursive: true });

  for (const { prefix } of PERSISTED_ROOTS) {
    let cursor: string | undefined;
    do {
      const page = await listR2Objects(r2, prefix, cursor);
      await forEachWithConcurrency(page.keys, 32, async (key) => {
        if (key.endsWith("/")) return;
        // Fish images and sidecar JSON are served through the Worker or the
        // compact index. Restoring every fish object would delay container readiness.
        if (key.startsWith("data/fish/") && key !== "data/fish/library-index.json") return;
        const localPath = pathForObjectKey(key);
        if (!localPath) return;
        const body = await readR2Object(r2, key);
        if (!body) return;
        await mkdir(resolve(localPath, ".."), { recursive: true });
        await writeFile(localPath, body);
      });
      cursor = page.cursor;
    } while (cursor);
  }
}

/** Explicit one-time migration command; it is never run automatically during deploy. */
export async function seedR2FromLocalFiles(options: { dryRun?: boolean } = {}): Promise<number> {
  const files: string[] = [];
  for (const root of PERSISTED_ROOTS) await walkFiles(root.path, async (filePath) => { files.push(filePath); });
  const seedableFiles = files.filter((filePath) =>
    objectKeyForPath(filePath) && !filePath.endsWith(".tmp") && !filePath.endsWith("/.DS_Store"),
  );
  if (options.dryRun) return seedableFiles.length;

  const r2 = getR2();
  let uploaded = 0;
  let uploadError: unknown;
  const bucket = process.env.R2_BUCKET_NAME ?? DEFAULT_R2_BUCKET_NAME;
  await forEachWithConcurrency(seedableFiles, r2 ? 16 : 8, async (filePath) => {
    if (uploadError) return;
    const key = objectKeyForPath(filePath);
    if (!key) return;
    try {
      if (r2) await writeR2Object(r2, key, await readFile(filePath));
      else await uploadWithWrangler(bucket, key, filePath);
      uploaded += 1;
      if (uploaded % 100 === 0 || uploaded === seedableFiles.length) {
        console.log(`[R2] Uploaded ${uploaded}/${seedableFiles.length} objects.`);
      }
    } catch (error) {
      uploadError ??= error;
    }
  });
  if (uploadError) throw uploadError;
  return uploaded;
}

async function forEachWithConcurrency<T>(items: T[], concurrency: number, visit: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await visit(item);
    }
  }));
}

export async function saveFishPositionCheckpoint(checkpoint: {
  savedAt: number;
  fish: Record<string, { x: number; y: number; vx: number; vy: number }>;
}): Promise<void> {
  const path = join(DATA_ROOT, "fish-positions.json");
  await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(path, JSON.stringify(checkpoint));
  if (getR2()) scheduleFileSync(path);
}

async function walkFiles(directory: string, visit: (path: string) => Promise<void>): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) await walkFiles(filePath, visit);
    else if (entry.isFile()) await visit(filePath);
  }
}

/** Mirror file changes as objects; animation positions never go through this path. */
export function startR2FilesystemMirror(): void {
  if (!getR2() || watchers.length > 0) return;

  const directories = [
    DATA_ROOT,
    join(DATA_ROOT, "fish"),
    PUBLIC_IMAGES_ROOT,
    join(PUBLIC_IMAGES_ROOT, "scene"),
  ];

  for (const directory of directories) {
    try {
      watchers.push(watch(directory, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (name.endsWith(".tmp") || name === ".DS_Store") return;
        scheduleFileSync(join(directory, name));
      }));
    } catch (error) {
      console.error(`[R2] Could not watch ${directory}:`, error);
    }
  }
}

function scheduleFileSync(filePath: string): void {
  if (!objectKeyForPath(filePath)) return;
  fileVersions.set(filePath, (fileVersions.get(filePath) ?? 0) + 1);
  pendingFiles.add(filePath);
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);
  debounceTimers.set(filePath, setTimeout(() => {
    debounceTimers.delete(filePath);
    enqueueFileSync(filePath);
  }, 500));
}

function enqueueFileSync(filePath: string): Promise<void> {
  const previous = fileWriteQueues.get(filePath) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(() => persistChangedFile(filePath));
  fileWriteQueues.set(filePath, task);
  inFlightWrites.add(task);

  const finish = () => {
    inFlightWrites.delete(task);
    if (fileWriteQueues.get(filePath) === task) fileWriteQueues.delete(filePath);
  };
  void task.then(finish, (error) => {
    console.error(`[R2] Failed to persist ${filePath}:`, error);
    finish();
  });
  return task;
}

async function persistChangedFile(filePath: string): Promise<void> {
  const r2 = getR2();
  const key = objectKeyForPath(filePath);
  const version = fileVersions.get(filePath) ?? 0;
  if (!r2 || !key) {
    if (fileVersions.get(filePath) === version) pendingFiles.delete(filePath);
    return;
  }
  try {
    const info = await lstat(filePath);
    if (!info.isFile()) {
      if (fileVersions.get(filePath) === version) pendingFiles.delete(filePath);
      return;
    }
    const body = await readFile(filePath);
    await retryR2(() => writeR2Object(r2, key, body));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      await retryR2(() => deleteR2Object(r2, key));
    } else {
      throw error;
    }
  }
  if (fileVersions.get(filePath) === version) pendingFiles.delete(filePath);
}

async function retryR2<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
    }
  }
  throw lastError;
}

export async function flushR2FilesystemMirror(): Promise<void> {
  while (true) {
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();

    for (const filePath of pendingFiles) enqueueFileSync(filePath);
    const writes = [...inFlightWrites];
    const results = await Promise.allSettled(writes);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;

    if (debounceTimers.size === 0 && pendingFiles.size === 0 && inFlightWrites.size === 0) return;
  }
}

export function closeR2FilesystemMirror(): void {
  for (const watcher of watchers) watcher.close();
  watchers = [];
}
