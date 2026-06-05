import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// tuna.ts — マグロ型: 高速直線往復 (相対座標・滑らかな縦移動)
//
// 動作原理:
//   - 一定の高速で横方向に移動し続ける
//   - ワールド境界や進入禁止エリアに近づいたら向きを反転する (Uターン)
//   - Y方向の絶対目標位置への引き寄せを廃止し、相対的な力学ドリフトと壁反発で動く
// ============================================================

const tunaState = new Map<string, {
  dir: 1 | -1;     // 現在の進行方向（+1=右, -1=左）
  frame: number;   // 全体フレームカウント
  speedFactor: number;
  burstPhase: number;
  turnCooldown: number;
  depth: DepthBehaviorState;
}>();

export function applyTuna(fish: ActiveFish): void {
  const world = getWorld();
  const speed = PHYSICS.TUNA_SPEED * movementScale(fish);
  const margin = 42; // 壁ギリギリで反転するように縮小

  if (!tunaState.has(fish.id)) {
    // 初回: 初期方向をランダムに決定
    tunaState.set(fish.id, {
      dir: Math.random() < 0.5 ? 1 : -1,
      frame: Math.floor(Math.random() * 360),
      speedFactor: 0.82 + Math.random() * 0.36,
      burstPhase: Math.random() * Math.PI * 2,
      turnCooldown: 0,
      depth: initDepthBehavior(fish),
    });
  }
  const state = tunaState.get(fish.id)!;
  const profile = motionProfileFor(fish);
  state.frame++;
  state.turnCooldown = Math.max(0, state.turnCooldown - 1);
  state.burstPhase += 0.018 * Math.max(0.5, profile.tailBeat);

  // 壁および禁止エリアに近づいたら向きを反転
  let shouldTurnLeft = false;
  let shouldTurnRight = false;

  // 1. ワールド境界の判定
  if (world.horizontalBoundaryMode === "bounce") {
    if (fish.physics.pos.x >= world.width - margin) shouldTurnLeft = true;
    if (fish.physics.pos.x <= margin) shouldTurnRight = true;
  }

  // 2. 進入禁止エリアの判定
  if (!shouldTurnLeft && !shouldTurnRight) {
    for (const fz of world.forbiddenZones) {
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

  if (state.turnCooldown === 0 && shouldTurnLeft && state.dir === 1) {
    state.dir = -1;
    state.turnCooldown = 90;
  }
  if (state.turnCooldown === 0 && shouldTurnRight && state.dir === -1) {
    state.dir = 1;
    state.turnCooldown = 90;
  }

  // --- X方向: Kick-and-Glide 推進 (尾鰭の振りに同期したパルス加減速) ---
  const cosPhase = Math.cos(state.burstPhase);
  const kickPulse = cosPhase * cosPhase; // ゼロクロス付近で 1.0、端で 0.0
  const kickFactor = 0.91 + kickPulse * 0.18 * Math.max(0.4, profile.tailBeat);
  const targetVX = speed * state.speedFactor * kickFactor * state.dir;
  const turning = fish.physics.vel.x * state.dir < 0;
  const accel = turning
    ? Math.max(0.018, Math.min(0.08, 0.045 / Math.max(0.45, profile.glide)))
    : Math.max(0.03, Math.min(0.18, 0.10 / Math.max(0.45, profile.glide)));
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * accel;
  fish.physics.pos.x += fish.physics.vel.x;

  // --- Y方向: 加速度・力学的なランダムドリフトと相対壁反発 ---
  // 1. 微小なランダム加速度
  let ay = (Math.random() - 0.5) * 0.03 * verticalSpreadForFish(fish);
  // 2. 緩やかなSin波のうねり
  ay += Math.sin(state.frame * PHYSICS.TUNA_VERTICAL_DRIFT) * 0.015 * verticalSpreadForFish(fish);

  // 3. 上下の壁からの反発（相対）
  const WALL_REPULSE = 80;
  const WALL_FORCE = 0.25;
  if (fish.physics.pos.y < WALL_REPULSE) {
    ay += WALL_FORCE * (1 - fish.physics.pos.y / WALL_REPULSE);
  }
  if (fish.physics.pos.y > world.height - WALL_REPULSE) {
    ay -= WALL_FORCE * (1 - (world.height - fish.physics.pos.y) / WALL_REPULSE);
  }

  // 4. 禁止エリアからの反発（相対）
  for (const fz of world.forbiddenZones) {
    const cy = fz.y + fz.height / 2;
    const halfH = fz.height / 2 + WALL_REPULSE;
    const dy = fish.physics.pos.y - cy;
    if (Math.abs(fish.physics.pos.x - (fz.x + fz.width / 2)) < fz.width / 2 + WALL_REPULSE) {
      if (Math.abs(dy) < halfH) {
        ay += Math.sign(dy) * WALL_FORCE * ((halfH - Math.abs(dy)) / WALL_REPULSE);
      }
    }
  }

  const depthForce = updateDepthBehavior(fish, state.depth, 0.0045) * 0.5;
  ay += depthForce;

  // Y速度の更新
  fish.physics.vel.y = (fish.physics.vel.y + ay) * 0.94;
  
  // マグロは基本水平を維持するため、縦の最大速度を厳しく制限
  const maxVY = speed * 0.22 * verticalSpreadForFish(fish);
  fish.physics.vel.y = Math.max(-maxVY, Math.min(maxVY, fish.physics.vel.y));

  fish.physics.pos.y += fish.physics.vel.y;
}

export function resetTunaState(fishId: string, newY: number): void {
  const state = tunaState.get(fishId);
  if (state) {
    resetDepthBehavior(state.depth, newY);
    state.frame = Math.floor(Math.random() * 360);
  }
}
