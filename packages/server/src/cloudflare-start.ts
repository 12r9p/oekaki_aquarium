import { restoreR2Files, writePersistedR2Object } from "./r2-persistence";

const STARTUP_STATUS_KEY = "data/.container-startup-status.json";

async function recordStartupStatus(status: string, error?: unknown): Promise<void> {
  const detail = error instanceof Error ? error.message.slice(0, 500) : error ? String(error).slice(0, 500) : undefined;
  const body = new TextEncoder().encode(JSON.stringify({ status, updatedAt: Date.now(), detail }));
  try {
    await writePersistedR2Object(STARTUP_STATUS_KEY, body);
  } catch (writeError) {
    console.error("[Startup] Could not persist container startup status:", writeError);
  }
}

try {
  await restoreR2Files();
  await recordStartupStatus("r2-restored");
  await import("./index");
  await recordStartupStatus("ready");
} catch (error) {
  await recordStartupStatus("failed", error);
  console.error("[Startup] Container bootstrap failed:", error);
  throw error;
}
