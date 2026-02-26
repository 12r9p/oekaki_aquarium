import type { Context } from "hono";
import { getPendingQueue, lockPending, unlockPending } from "../fish-manager";

// GET /api/pending — 待機魚一覧を返す
export async function pendingRoute(c: Context): Promise<Response> {
  return c.json(getPendingQueue());
}

// POST /api/pending/lock — 排他ロック取得
export async function lockRoute(c: Context): Promise<Response> {
  const { fishId, editorUuid } = await c.req.json<{ fishId: string; editorUuid: string }>();
  const fish = lockPending(fishId, editorUuid);
  if (!fish) {
    return c.json({ error: "Fish not found or already locked" }, 409);
  }
  return c.json({ success: true, fish });
}

// POST /api/pending/unlock — ロック解除
export async function unlockRoute(c: Context): Promise<Response> {
  const { fishId } = await c.req.json<{ fishId: string }>();
  unlockPending(fishId);
  return c.json({ success: true });
}
