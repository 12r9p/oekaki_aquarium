import type { Context } from "hono";
import { setPinned } from "../fish-manager";

// POST /api/fish/:id/pin — 魚のピン留め/解除
export async function pinRoute(c: Context): Promise<Response> {
  const fishId = c.req.param("id");
  const { pinned, layerId = 0 } = await c.req.json<{ pinned: boolean; layerId?: number }>();

  const success = setPinned(fishId, pinned, layerId);
  if (!success) {
    return c.json({ error: "Fish not found in active pool" }, 404);
  }

  return c.json({ success: true, fishId, pinned, layerId });
}
