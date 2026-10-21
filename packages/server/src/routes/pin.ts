import type { Context } from "hono";
import { setPinned } from "../fish-manager";
import { fingerprintCommand, readCommandId, runIdempotentCommand } from "./command-idempotency";

// POST /api/fish/:id/pin — 魚のピン留め/解除
export async function pinRoute(c: Context): Promise<Response> {
  const fishId = c.req.param("id");
  const { pinned, layerId = 0, commandId: bodyCommandId } = await c.req.json<{ pinned: boolean; layerId?: number; commandId?: string }>();
  const parsedCommandId = readCommandId(c, bodyCommandId);
  if ("error" in parsedCommandId) return parsedCommandId.error;
  const fingerprint = await fingerprintCommand({ route: "pin", fishId, pinned, layerId });

  return runIdempotentCommand(c, parsedCommandId.commandId, fingerprint, () => {
    const success = setPinned(fishId, pinned, layerId);
    if (!success) {
      return c.json({ error: "Fish not found in active pool" }, 404);
    }

    return c.json({ success: true, fishId, pinned, layerId });
  });
}
