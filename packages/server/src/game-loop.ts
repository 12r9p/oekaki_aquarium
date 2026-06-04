import { GAME_LOOP_MS, LAYER_CONFIG } from "@aquarium/shared";
import type { UdpPacket } from "@aquarium/shared";
import { getAllActiveFish } from "./fish-manager";
import { updateFishLayers } from "./layer-manager";
import { applyBoids } from "./physics/boids";
import { applySchool } from "./physics/school";
import { applyTuna } from "./physics/tuna";
import { applySquid } from "./physics/squid";
import { applyJellyfish } from "./physics/jellyfish";
import { applyShark } from "./physics/shark";
import { applyLooper } from "./physics/looper";
import { applyAnchor } from "./physics/anchor";
import { applyBoundaries, cleanExpiredFood } from "./physics/boundaries";
import { applyWander } from "./physics/wander";
import { getWorld } from "./world";
import { broadcastToRenderClients } from "./ws-handler";

// ============================================================
// game-loop.ts
// 60fps でサーバー側全演算を回し、結果をWSでdisplayクライアントに配信
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

  // 各魚の物理演算（プリセット別ディスパッチ）
  for (const fish of allFish) {
    if (fish.isArchived) continue; // アーカイブ中の魚はスキップ

    switch (fish.type) {
      // --- 新プリセット ---
      case "tuna":
        applyTuna(fish);
        applyWander(fish);
        applyBoundaries(fish);
        break;
      case "school":
        applySchool(fish, allFish);
        applyWander(fish);
        applyBoundaries(fish);
        break;
      case "squid":
        applySquid(fish);
        applyWander(fish);
        applyBoundaries(fish);
        break;
      case "jellyfish":
        applyJellyfish(fish);
        applyWander(fish);
        applyBoundaries(fish);
        break;
      case "shark":
        applyShark(fish);
        applyWander(fish);
        applyBoundaries(fish);
        break;

      // --- 旧プリセット（互换維持） ---
      case "swimmer": // swimmer → school と同じ挙動
        applySchool(fish, allFish);
        applyWander(fish);
        applyBoundaries(fish);
        break;
      case "looper":  // looper → 旧ループ挙動を維持
        applyLooper(fish, world.width);
        applyWander(fish);
        applyBoundaries(fish);
        break;
      case "anchor":
        // anchorは固定なので探索ドリフトは不要
        applyAnchor(fish);
        break;
    }
  }

  // フレームパケットを組み立てて display クライアントにのみ送信
  const packet: UdpPacket = {
    t: Date.now(),
    f: allFish.filter(fish => !fish.isArchived).map((fish) => {
      const vx = fish.physics.vel.x;
      const vy = fish.physics.vel.y;
      // Y成分を 0.55 倍に絞りすぎず縦移動もある程度向きに反映させる
      const r = Math.atan2(vy * 0.55, vx);
      return {
        i: fish.id.slice(0, 8),
        x: Math.round(fish.physics.pos.x),
        y: Math.round(fish.physics.pos.y),
        r,
        s: fish.targetScale,
        o: fish.targetOpacity,
        z: LAYER_CONFIG[fish.layerIndex]?.zIndex ?? 50,
        u: fish.textureUrl,
        vx,  // フロント側の左右反転判定用
      };
    }),
    e: [],
  };

  // display と管理画面プレビューへフレームを送信
  broadcastToRenderClients({ event: "frame", ...packet } as Parameters<typeof broadcastToRenderClients>[0]);
}
