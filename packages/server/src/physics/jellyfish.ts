import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// jellyfish.ts — クラゲ型: 緩やかな上下浮遊 + 横流れ (相対座標・力学)
//
// 動作原理:
//   - X方向は絶対目標位置を廃止し、ゆっくりとしたランダム水流と壁反発で漂う
//   - Y方向はSin波で大きくゆっくり上下する (ベース位置は相対的にランダムドリフト)
//   - 縦の速度も直接代入ではなく、スプリング力学で滑らかに更新
// ============================================================

const jellyfishState = new Map<string, {
  dir: 1 | -1;
  frame: number;
  baseY: number;
  framesUntilDriftChange: number;
  turnCooldown: number;
  depth: DepthBehaviorState;
}>();

export function applyJellyfish(fish: ActiveFish): void {
  const world = getWorld();

  if (!jellyfishState.has(fish.id)) {
    jellyfishState.set(fish.id, {
      dir: Math.random() < 0.5 ? 1 : -1,
      frame: Math.floor(Math.random() * PHYSICS.JELLYFISH_PULSE_PERIOD),
      baseY: fish.physics.pos.y,
      framesUntilDriftChange: 120 + Math.floor(Math.random() * 420),
      turnCooldown: 0,
      depth: initDepthBehavior(fish),
    });
  }
  const state = jellyfishState.get(fish.id)!;
  const profile = motionProfileFor(fish);
  state.frame++;
  state.turnCooldown = Math.max(0, state.turnCooldown - 1);

  // --- 1. baseY の相対的な緩やかドリフト ---
  state.baseY += (Math.random() - 0.5) * 0.25 * verticalSpreadForFish(fish);

  // 2. 壁からの反発で baseY を補正
  const WALL_REPULSE = 180;
  const WALL_FORCE_BASE = 0.8;
  if (state.baseY < WALL_REPULSE) {
    state.baseY += WALL_FORCE_BASE * (1 - state.baseY / WALL_REPULSE);
  }
  if (state.baseY > world.height - WALL_REPULSE) {
    state.baseY -= WALL_FORCE_BASE * (1 - (world.height - state.baseY) / WALL_REPULSE);
  }
  for (const fz of world.forbiddenZones) {
    const cy = fz.y + fz.height / 2;
    const halfH = fz.height / 2 + WALL_REPULSE;
    const dyBase = state.baseY - cy;
    if (Math.abs(fish.physics.pos.x - (fz.x + fz.width / 2)) < fz.width / 2 + WALL_REPULSE) {
      if (Math.abs(dyBase) < halfH) {
        state.baseY += Math.sign(dyBase) * WALL_FORCE_BASE * ((halfH - Math.abs(dyBase)) / WALL_REPULSE);
      }
    }
  }

  // --- X方向: ゆったりとした漂流と壁反転 ---
  state.framesUntilDriftChange--;
  if (state.framesUntilDriftChange <= 0) {
    if (Math.random() < 0.3) state.dir = (state.dir === 1 ? -1 : 1);
    state.framesUntilDriftChange = 300 + Math.floor(Math.random() * 600);
  }

  const margin = PHYSICS.WALL_MARGIN * 1.5;
  if (world.horizontalBoundaryMode === "bounce" && state.turnCooldown === 0) {
    if (fish.physics.pos.x > world.width - margin && state.dir === 1) {
      state.dir = -1;
      state.turnCooldown = 120;
    }
    if (fish.physics.pos.x < margin && state.dir === -1) {
      state.dir = 1;
      state.turnCooldown = 120;
    }
  }

  const currentDrift = -0.06 * movementScale(fish);
  const wanderForceX = Math.sin(state.frame * 0.008) * 0.05 * movementScale(fish);
  const targetVX = (PHYSICS.JELLYFISH_FLOAT_SPEED * state.dir * movementScale(fish) + currentDrift + wanderForceX)
    * (0.85 + Math.sin(state.frame * 0.019) * 0.15);

  const turning = fish.physics.vel.x * state.dir < 0;
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * ((turning ? 0.012 : 0.025) / Math.max(0.45, profile.glide));
  fish.physics.pos.x += fish.physics.vel.x;

  // --- Y方向: 大きくゆったり上下浮遊 (Sin波) ---
  const phase = (state.frame / PHYSICS.JELLYFISH_PULSE_PERIOD) * Math.PI * 2 * Math.max(0.45, profile.tailBeat);
  const targetY = state.baseY + Math.sin(phase) * PHYSICS.JELLYFISH_PULSE_AMP * verticalSpreadForFish(fish);

  const depthForce = updateDepthBehavior(fish, state.depth, 0.0055) * 5;
  const springForce = (targetY - fish.physics.pos.y) * 0.012 * (1 + turnStrengthForFish(fish) * 0.4);

  fish.physics.vel.y = (fish.physics.vel.y + springForce + depthForce) * 0.90;

  const maxVY = PHYSICS.JELLYFISH_FLOAT_SPEED * 1.5 * verticalSpreadForFish(fish);
  fish.physics.vel.y = Math.max(-maxVY, Math.min(maxVY, fish.physics.vel.y));

  fish.physics.pos.y += fish.physics.vel.y;
}

export function resetJellyfishState(fishId: string, newY: number): void {
  const state = jellyfishState.get(fishId);
  if (state) {
    state.baseY = newY;
    resetDepthBehavior(state.depth, newY);
  }
}
