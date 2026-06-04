import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale } from "./motion-profile";

// ============================================================
// tuna.ts — マグロ型: 高速直線往復
//
// 動作原理:
//   - 一定の高速で横方向に移動し続ける
//   - ワールド境界に近づいたら向きを反転する（スムーズなUターン）
//   - Y方向はごく小さなサイン波ドリフトのみ
// ============================================================

const tunaState = new Map<string, {
  dir: 1 | -1;     // 現在の進行方向（+1=右, -1=左）
  frame: number;   // 全体フレームカウント
  baseY: number;   // Y基準座標
  laneTargetY: number;
  framesUntilLaneChange: number;
  speedFactor: number;
}>();

export function applyTuna(fish: ActiveFish): void {
  const world = getWorld();
  const speed = PHYSICS.TUNA_SPEED * movementScale(fish);
  const margin = PHYSICS.WALL_MARGIN + 50;

  if (!tunaState.has(fish.id)) {
    // 初回: 初期方向をランダムに決定
    tunaState.set(fish.id, {
      dir: Math.random() < 0.5 ? 1 : -1,
      frame: Math.floor(Math.random() * 360), // フレームオフセット（全員一斉動作防止）
      baseY: fish.physics.pos.y,
      laneTargetY: fish.physics.pos.y,
      framesUntilLaneChange: 120 + Math.floor(Math.random() * 500),
      speedFactor: 0.82 + Math.random() * 0.36,
    });
  }
  const state = tunaState.get(fish.id)!;
  state.frame++;
  state.framesUntilLaneChange--;
  if (state.framesUntilLaneChange <= 0) {
    state.laneTargetY = world.height * (0.18 + Math.random() * 0.64);
    state.framesUntilLaneChange = 360 + Math.floor(Math.random() * 720);
  }
  state.baseY += (state.laneTargetY - state.baseY) * 0.0015;

  // 壁および禁止エリアに近づいたら向きを反転
  let shouldTurnLeft = false;
  let shouldTurnRight = false;

  // 1. ワールド境界の判定
  if (fish.physics.pos.x >= world.width - margin) shouldTurnLeft = true;
  if (fish.physics.pos.x <= margin) shouldTurnRight = true;

  // 2. 進入禁止エリアの判定
  if (!shouldTurnLeft && !shouldTurnRight) {
    for (const fz of world.forbiddenZones) {
      // 魚の予想進行先に禁止エリアがあるかチェック
      if (
        fish.physics.pos.y > fz.y - margin &&
        fish.physics.pos.y < fz.y + fz.height + margin
      ) {
        if (state.dir === 1 && fish.physics.pos.x >= fz.x - margin && fish.physics.pos.x < fz.x) {
          shouldTurnLeft = true;
        }
        if (state.dir === -1 && fish.physics.pos.x <= fz.x + fz.width + margin && fish.physics.pos.x > fz.x + fz.width) {
          shouldTurnRight = true;
        }
      }
    }
  }

  if (shouldTurnLeft && state.dir === 1) {
    state.dir = -1;
    state.baseY = fish.physics.pos.y; // Uターン時にY基準を更新
  }
  if (shouldTurnRight && state.dir === -1) {
    state.dir = 1;
    state.baseY = fish.physics.pos.y;
  }

  // X: 一定速度
  fish.physics.vel.x = speed * state.speedFactor * state.dir;
  fish.physics.pos.x += fish.physics.vel.x;

  // Y: sin波でごくわずかにドリフト（ほぼ水平）
  const driftY = Math.sin(state.frame * PHYSICS.TUNA_VERTICAL_DRIFT) * 20;
  const targetY = state.baseY + driftY;
  const dy = (targetY - fish.physics.pos.y) * 0.05;
  fish.physics.vel.y = dy;
  fish.physics.pos.y += dy;
}

/**
 * 魚の再配置後にbaseYを新位置に合わせてリセットする。
 * これを呼ばないと再配置後も古いbaseYに向かって引き戻される。
 */
export function resetTunaState(fishId: string, newY: number): void {
  const state = tunaState.get(fishId);
  if (state) {
    state.baseY = newY;
    state.laneTargetY = newY;
    state.frame = Math.floor(Math.random() * 360); // フレームも乱数リセット
  } else {
    // stateがない場合は次のフレームで初期化されるが、baseYはpos.yから自然に取得される
    // noop: applyTunaの初回初期化で新pos.yが使われる
  }
}
