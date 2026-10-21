import type { Context } from "hono";
import type { CommandEnvelope, FishConfig } from "@aquarium/shared";
import { releaseFish } from "../fish-manager";
import { getWorld } from "../world";
import { broadcastToAll } from "../ws-handler";
import { fingerprintCommand, readCommandId, runIdempotentCommand } from "./command-idempotency";

// POST /api/release — 魚を本番環境（activePool）へ放流する
export async function releaseRoute(c: Context): Promise<Response> {
  const input = await c.req.json<FishConfig & CommandEnvelope>();
  const { commandId: bodyCommandId, ...config } = input;
  const parsedCommandId = readCommandId(c, bodyCommandId);
  if ("error" in parsedCommandId) return parsedCommandId.error;

  if (!config.id || !config.type || !config.textureUrl) {
    return c.json({ error: "Invalid fish config" }, 400);
  }

  const fingerprint = await fingerprintCommand({ route: "release", config });
  return runIdempotentCommand(c, parsedCommandId.commandId, fingerprint, () => {
    // 放流時のスポーン位置: 設定された放流ポイントがあればそこを採用、無ければValidZoneの左端中央付近
    const world = getWorld();
    let spawnPos = { x: 200, y: 400 };

    if (world.spawnPoints && world.spawnPoints.length > 0) {
      const sp = world.spawnPoints[Math.floor(Math.random() * world.spawnPoints.length)];
      spawnPos = { x: sp.x, y: sp.y };
    } else if (world.validZones.length > 0) {
      const zone = world.validZones[0];
      spawnPos = { x: zone.x + 100, y: zone.y + zone.height * 0.5 };
    }

    const activeFish = releaseFish(config, spawnPos);

    // 全クライアントに魚放流を通知（着水エフェクトトリガー用）
    broadcastToAll({ event: "fish_released", fish: activeFish });

    console.log(`[Release] Fish released: ${activeFish.id} (type: ${activeFish.type})`);
    return c.json({ success: true, fish: activeFish });
  });
}
