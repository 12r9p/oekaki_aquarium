import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";

// ============================================================
// Anchor (Type C): 床固定 + 手書き揺れモーション
//
// 動作原理:
//   - X座標: 初期配置から動かない（初回のみ最近 ValidZone の床へスナップ）
//   - Y座標: Floor Y に固定し、手書きパスで微細な揺れを加算する
// ============================================================

/** アンカーの揺れアニメーション状態 */
const anchorState = new Map<string, { pathIdx: number; frame: number; baseX: number; baseY: number }>();

const SWAY_STEP_SPEED = 3; // パス1ステップあたりのフレーム数

export function applyAnchor(fish: ActiveFish): void {
  const world = getWorld();

  // 初回: 最近 ValidZone の床に固定する
  if (!anchorState.has(fish.id)) {
    let floorY = world.height;
    for (const zone of world.validZones) {
      if (
        fish.physics.pos.x >= zone.x &&
        fish.physics.pos.x <= zone.x + zone.width
      ) {
        floorY = zone.floorY;
        break;
      }
    }
    anchorState.set(fish.id, {
      pathIdx: 0,
      frame: 0,
      baseX: fish.physics.pos.x,
      baseY: floorY,
    });
  }

  const state = anchorState.get(fish.id)!;

  // XY を床座標にロック（ここは固定なので毎フレーム強制代入）
  fish.physics.pos.x = state.baseX;
  fish.physics.pos.y = state.baseY;
  fish.physics.vel = { x: 0, y: 0 };

  // 手書きパスがない場合はサイン波でデフォルト揺れを加算
  if (!fish.motionPath || fish.motionPath.length < 2) {
    const t = (Date.now() / 500) % (Math.PI * 2);
    fish.physics.pos.x += Math.sin(t) * 5;
    return;
  }

  // 手書き揺れパスをループ再生
  state.frame++;
  if (state.frame >= SWAY_STEP_SPEED) {
    state.frame = 0;
    state.pathIdx = (state.pathIdx + 1) % fish.motionPath.length;
  }

  const cur = fish.motionPath[state.pathIdx];
  const next = fish.motionPath[(state.pathIdx + 1) % fish.motionPath.length];
  const t = state.frame / SWAY_STEP_SPEED;

  fish.physics.pos.x += cur.x + (next.x - cur.x) * t;
  fish.physics.pos.y += cur.y + (next.y - cur.y) * t;
}
