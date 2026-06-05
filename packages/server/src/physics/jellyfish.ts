import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// jellyfish.ts — クラゲ型: 緩やかな上下浮遊 + 横流れ
//
// 動作原理:
//   - X方向はゆっくり一定方向に流されるだけ（壁でUターン）
//   - Y方向はsin波で大きくゆっくり上下する
//   - 動き全体が非常にゆったりしている
// ============================================================

const jellyfishState = new Map<string, {
  dir: 1 | -1;
  frame: number;
  driftTargetX: number;
  baseY: number;
  driftTargetY: number;
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
      driftTargetX: fish.physics.pos.x,
      baseY: fish.physics.pos.y,
      driftTargetY: fish.physics.pos.y,
      framesUntilDriftChange: 120 + Math.floor(Math.random() * 420),
      turnCooldown: 0,
      depth: initDepthBehavior(fish),
    });
  }
  const state = jellyfishState.get(fish.id)!;
  const profile = motionProfileFor(fish);
  state.frame++;
  state.turnCooldown = Math.max(0, state.turnCooldown - 1);
  state.framesUntilDriftChange--;
  if (state.framesUntilDriftChange <= 0) {
    const marginY = Math.min(world.height * 0.30, Math.max(PHYSICS.WALL_MARGIN * 1.6, world.height * 0.08 / verticalSpreadForFish(fish)));
    const marginX = Math.min(world.width * 0.28, Math.max(PHYSICS.WALL_MARGIN * 1.6, world.width * 0.08));
    state.driftTargetX = marginX + Math.random() * Math.max(1, world.width - marginX * 2);
    state.driftTargetY = marginY + Math.random() * Math.max(1, world.height - marginY * 2);
    state.framesUntilDriftChange = 360 + Math.floor(Math.random() * 900);
  }
  const margin = PHYSICS.WALL_MARGIN * 1.5;
  if (world.horizontalBoundaryMode === "bounce" && state.turnCooldown === 0) {
    if (fish.physics.pos.x > world.width - margin && state.dir === 1) {
      state.dir = -1;
      state.turnCooldown = 100;
    }
    if (fish.physics.pos.x < margin && state.dir === -1) {
      state.dir = 1;
      state.turnCooldown = 100;
    }
  }
  if (state.baseY < margin || state.baseY > world.height - margin) {
    state.baseY = Math.max(margin, Math.min(world.height - margin, state.baseY));
  }
  state.baseY += (state.driftTargetY - state.baseY) * 0.0012 * turnStrengthForFish(fish);

  const targetDir = state.driftTargetX > fish.physics.pos.x ? 1 : -1;
  if (Math.abs(state.driftTargetX - fish.physics.pos.x) > world.width * 0.08) state.dir = targetDir;

  // X: 水流に流されながら、個体ごとの漂流先へゆっくり向かう
  const currentDrift = -0.18 * movementScale(fish);
  const targetPull = Math.max(-0.42, Math.min(0.42, (state.driftTargetX - fish.physics.pos.x) * 0.0012)) * movementScale(fish);
  const vx = (PHYSICS.JELLYFISH_FLOAT_SPEED * 0.35 * state.dir + currentDrift + targetPull) * (0.85 + Math.sin(state.frame * 0.019) * 0.15);
  const turning = fish.physics.vel.x * state.dir < 0;
  fish.physics.vel.x += (vx - fish.physics.vel.x) * ((turning ? 0.018 : 0.03) / Math.max(0.45, profile.glide));
  fish.physics.pos.x += fish.physics.vel.x;

  // Y: sin波で大きくゆったり上下（周期が長い）
  const phase = (state.frame / PHYSICS.JELLYFISH_PULSE_PERIOD) * Math.PI * 2 * Math.max(0.45, profile.tailBeat);
  const targetY = state.baseY + Math.sin(phase) * PHYSICS.JELLYFISH_PULSE_AMP * verticalSpreadForFish(fish);
  const dy = (targetY - fish.physics.pos.y) * (0.01 + 0.015 * turnStrengthForFish(fish))
    + updateDepthBehavior(fish, state.depth, 0.0055) * 5;
  fish.physics.vel.y = dy;
  fish.physics.pos.y += dy;
}

export function resetJellyfishState(fishId: string, newY: number): void {
  const state = jellyfishState.get(fishId);
  if (state) {
    state.baseY = newY;
    state.driftTargetY = newY;
    resetDepthBehavior(state.depth, newY);
  }
}
