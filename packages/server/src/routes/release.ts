import type { Context } from "hono";
import type { FishConfig } from "@aquarium/shared";
import { releaseFish } from "../fish-manager";
import { getWorld } from "../world";
import { broadcastToAll } from "../ws-handler";

// POST /api/release — 魚を本番環境（activePool）へ放流する
export async function releaseRoute(c: Context): Promise<Response> {
  const config = await c.req.json<FishConfig>();

  if (!config.id || !config.type || !config.textureUrl) {
    return c.json({ error: "Invalid fish config" }, 400);
  }

  // 放流時のスポーン位置: 最初の ValidZone の左端中央付近
  const world = getWorld();
  const zone = world.validZones[0];
  const spawnPos = zone
    ? { x: zone.x + 100, y: zone.y + zone.height * 0.5 }
    : { x: 200, y: 400 };

  const activeFish = releaseFish(config, spawnPos);

  // 全クライアントに魚放流を通知（着水エフェクトトリガー用）
  broadcastToAll({ event: "fish_released", fish: activeFish });

  console.log(`[Release] Fish released: ${activeFish.id} (type: ${activeFish.type})`);
  return c.json({ success: true, fish: activeFish });
}
