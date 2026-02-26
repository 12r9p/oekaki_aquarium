import { GAME_LOOP_MS, LAYER_CONFIG } from "@aquarium/shared";
import type { UdpPacket } from "@aquarium/shared";
import { getAllActiveFish } from "./fish-manager";
import { updateFishLayers } from "./layer-manager";
import { applyBoids } from "./physics/boids";
import { applyLooper } from "./physics/looper";
import { applyAnchor } from "./physics/anchor";
import { applyBoundaries, cleanExpiredFood } from "./physics/boundaries";
import { getWorld } from "./world";
import { broadcastToDisplays } from "./ws-handler";

// ============================================================
// game-loop.ts
// 60fps でサーバー側全演算を回し、結果をWSでdisplayクライアントに配信
// UDP は廃止し WebSocket push に一本化
// ============================================================

let loopInterval: ReturnType<typeof setInterval> | null = null;
let frameCount = 0;

export function startGameLoop(): void {
  loopInterval = setInterval(tick, GAME_LOOP_MS);
  console.log("[GameLoop] Started at ~60fps (WS broadcast mode)");
}

export function stopGameLoop(): void {
  if (loopInterval) clearInterval(loopInterval);
}

function tick(): void {
  frameCount++;
  const allFish = getAllActiveFish();
  const world = getWorld();

  // レイヤー更新は10フレームに1回（重い処理なので間引く）
  if (frameCount % 10 === 0) {
    updateFishLayers(allFish);
    cleanExpiredFood();
  }

  // 各魚の物理演算
  for (const fish of allFish) {
    switch (fish.type) {
      case "swimmer":
        applyBoids(fish, allFish);
        applyBoundaries(fish);
        break;
      case "looper":
        applyLooper(fish, world.width);
        applyBoundaries(fish);
        break;
      case "anchor":
        applyAnchor(fish);
        break;
    }
  }

  // UdpPacket 互換のフレームペイロードを組み立てて WS で配信
  const packet: UdpPacket = {
    t: Date.now(),
    f: allFish.map((fish) => ({
      i: fish.id.slice(0, 8),
      x: Math.round(fish.physics.pos.x),
      y: Math.round(fish.physics.pos.y),
      r: Math.atan2(fish.physics.vel.y, fish.physics.vel.x),
      s: fish.targetScale,
      o: fish.targetOpacity,
      z: LAYER_CONFIG[fish.layerIndex]?.zIndex ?? 50,
    })),
    e: [],
  };

  // "frame" イベントとして displayクライアントにのみ送信
  broadcastToDisplays({ event: "frame", ...packet } as Parameters<typeof broadcastToDisplays>[0]);
}
