import { GAME_LOOP_MS, LAYER_CONFIG } from "@aquarium/shared";
import type { UdpPacket } from "@aquarium/shared";
import { getAllActiveFish } from "./fish-manager";
import { updateFishLayers } from "./layer-manager";
import { cleanExpiredFood } from "./physics/boundaries";
import { updateAquariumMotion } from "./physics/aquarium-motion";
import { broadcastToRenderClients } from "./ws-handler";
import { getDisplayClientInfoList } from "./ws-handler";
import { recordSystemMetric } from "./system-metrics";

// ============================================================
// game-loop.ts
// 60fps でサーバー側全演算を回し、結果をWSでdisplayクライアントに配信
// ============================================================

let loopInterval: ReturnType<typeof setInterval> | null = null;
let frameCount = 0;
const fishFacing = new Map<string, 1 | -1>();

export function startGameLoop(): void {
  loopInterval = setInterval(tick, GAME_LOOP_MS);
  console.log("[GameLoop] Started at ~60fps (WS broadcast mode)");
}

export function stopGameLoop(): void {
  if (loopInterval) clearInterval(loopInterval);
}

function tick(): void {
  const calculationStartedAt = performance.now();
  frameCount++;
  const allFish = getAllActiveFish();
  // レイヤー更新は10フレームに1回（重い処理なので間引く）
  if (frameCount % 10 === 0) {
    updateFishLayers(allFish);
    cleanExpiredFood();
  }

  // 各魚の物理演算（プリセット別ディスパッチ）
  for (const fish of allFish) {
    if (fish.isArchived) continue; // アーカイブ中の魚はスキップ

    updateAquariumMotion(fish, allFish);
  }
  const fishCalculationMs = performance.now() - calculationStartedAt;
  if (frameCount % 6 === 0) {
    const monitorCommunicationMs = Math.max(0, ...getDisplayClientInfoList().map(display => display.ping ?? 0));
    recordSystemMetric(allFish.filter(fish => !fish.isArchived).length, fishCalculationMs, monitorCommunicationMs);
  }

  // フレームパケットを組み立てて display クライアントにのみ送信
  const packet: UdpPacket = {
    t: Date.now(),
    f: allFish.filter(fish => !fish.isArchived).map((fish) => {
      const vx = fish.physics.vel.x;
      const vy = fish.physics.vel.y;
      const previousFacing = fishFacing.get(fish.id) ?? (vx < 0 ? -1 : 1);
      const preferredDirection = fish.userParams.direction;
      const facing = preferredDirection === "left" ? -1
        : preferredDirection === "right" ? 1
        : Math.abs(vx) > 0.15 ? (vx < 0 ? -1 : 1) : previousFacing;
      fishFacing.set(fish.id, facing);
      // 左右は反転、回転は上下の傾きだけに分け、二重反転を防ぐ。
      const r = Math.atan2(vy * 0.55, Math.max(Math.abs(vx), 0.1));
      return {
        i: fish.id.slice(0, 8),
        x: Math.round(fish.physics.pos.x),
        y: Math.round(fish.physics.pos.y),
        r,
        s: fish.targetScale,
        o: fish.targetOpacity,
        z: LAYER_CONFIG[fish.layerIndex]?.zIndex ?? 50,
        l: fish.layerIndex,
        u: fish.textureUrl,
        d: facing,
        vx,
      };
    }),
    e: [],
  };

  // display と管理画面プレビューへフレームを送信
  broadcastToRenderClients({ event: "frame", ...packet } as Parameters<typeof broadcastToRenderClients>[0]);
}
