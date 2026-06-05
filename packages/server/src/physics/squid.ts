import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// squid.ts — イカ型: ホバリング + Sin波パルス推進
//
// 動作原理:
//   - 「休止 → パルス推進 → 休止」サイクルを繰り返す
//   - Y方向は緩やかなSin波でふわふわホバリング
//   - 壁でUターン
// ============================================================

const squidState = new Map<string, {
  frame: number;    // サイクル内フレーム
  dir: 1 | -1;     // 現在の向き
  baseY: number;   // Y基準
  phase: number;
  laneTargetY: number;
  framesUntilLaneChange: number;
  turnCooldown: number;
  depth: DepthBehaviorState;
}>();

const CYCLE = PHYSICS.SQUID_PULSE_FRAMES + PHYSICS.SQUID_REST_FRAMES;

export function applySquid(fish: ActiveFish): void {
  const world = getWorld();

  if (!squidState.has(fish.id)) {
    squidState.set(fish.id, {
      frame: Math.floor(Math.random() * CYCLE),
      dir: Math.random() < 0.5 ? 1 : -1,
      baseY: fish.physics.pos.y,
      phase: Math.random() * Math.PI * 2,
      laneTargetY: fish.physics.pos.y,
      framesUntilLaneChange: 120 + Math.floor(Math.random() * 360),
      turnCooldown: 0,
      depth: initDepthBehavior(fish),
    });
  }
  const state = squidState.get(fish.id)!;
  const profile = motionProfileFor(fish);
  state.frame = (state.frame + 1) % CYCLE;
  state.turnCooldown = Math.max(0, state.turnCooldown - 1);
  state.framesUntilLaneChange--;
  if (state.framesUntilLaneChange <= 0) {
    const spread = verticalSpreadForFish(fish);
    const marginRatio = Math.max(0.05, 0.18 / spread);
    state.laneTargetY = world.height * (marginRatio + Math.random() * (1 - marginRatio * 2));
    state.framesUntilLaneChange = 180 + Math.floor(Math.random() * 420);
  }
  const margin = PHYSICS.WALL_MARGIN * 1.5;
  if (world.horizontalBoundaryMode === "bounce" && state.turnCooldown === 0) {
    if (fish.physics.pos.x > world.width - margin && state.dir === 1) {
      state.dir = -1;
      state.turnCooldown = 75;
    }
    if (fish.physics.pos.x < margin && state.dir === -1) {
      state.dir = 1;
      state.turnCooldown = 75;
    }
  }
  state.baseY += (state.laneTargetY - state.baseY) * 0.004 * turnStrengthForFish(fish);
  state.baseY = Math.max(margin, Math.min(world.height - margin, state.baseY));

  // X方向: パルスか巡航か
  const isJetting = state.frame < PHYSICS.SQUID_PULSE_FRAMES;
  const targetVX = isJetting
    ? PHYSICS.SQUID_PULSE_SPEED * state.dir * movementScale(fish) * Math.max(0.55, profile.tailBeat)
    : PHYSICS.SQUID_CRUISE_SPEED * state.dir * movementScale(fish);

  // 速度を滑らかに補間
  const turning = fish.physics.vel.x * state.dir < 0;
  const accel = turning ? 0.045 / Math.max(0.45, profile.glide) : (isJetting ? 0.2 : 0.065 / Math.max(0.45, profile.glide));
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * accel;
  fish.physics.pos.x += fish.physics.vel.x;

  // Y方向: sin波ホバリング
  const t = state.phase + (Date.now() / 1000) * (Math.PI * 2 / (PHYSICS.SQUID_HOVER_PERIOD / 60)) * Math.max(0.55, profile.tailBeat);
  const targetY = state.baseY + Math.sin(t) * PHYSICS.SQUID_HOVER_AMP * verticalSpreadForFish(fish);
  const dy = (targetY - fish.physics.pos.y) * (0.022 + 0.02 * turnStrengthForFish(fish))
    + updateDepthBehavior(fish, state.depth, 0.007) * 8;
  fish.physics.vel.y = dy;
  fish.physics.pos.y += dy;
}

export function resetSquidState(fishId: string, newY: number): void {
  const state = squidState.get(fishId);
  if (state) {
    state.baseY = newY;
    state.laneTargetY = newY;
    resetDepthBehavior(state.depth, newY);
  }
}
