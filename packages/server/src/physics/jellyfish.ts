import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// jellyfish.ts — クラゲ型: 非対称パルス推進 (Jet-and-Sink) モデル
//
// 改善点:
//   - パルス周期 (JELLYFISH_PULSE_PERIOD: 120f) を推進期 (25%) と弛緩期 (75%) に分離。
//   - **推進期:** 上向きに急激な推進力を与えて飛び上がらせる。
//   - **弛緩期:** 推進力をゼロにし、水流抵抗で減速しながら自重でゆっくり沈む (Sink) 挙動を実装。
//   - 目標位置への追従係数 (スプリング力) を推進期・弛緩期で動的に変化させ、リアルな浮遊感を実現。
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

  const period = PHYSICS.JELLYFISH_PULSE_PERIOD;
  const pulseFrames = 30; // 推進期 (全体の25%)
  const frameInCycle = state.frame % period;
  const isPushing = frameInCycle < pulseFrames;

  // --- 1. baseY の相対的な緩やかドリフト ---
  state.baseY += (Math.random() - 0.5) * 0.18 * verticalSpreadForFish(fish);

  // 2. 壁からの反発で baseY を補正
  const WALL_REPULSE = 80;
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
    if (Math.random() < 0.25) state.dir = (state.dir === 1 ? -1 : 1);
    state.framesUntilDriftChange = 360 + Math.floor(Math.random() * 600);
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

  // 推進期のみ横方向へ進む力をわずかに加算
  const currentDrift = -0.05 * movementScale(fish);
  const xPush = isPushing ? PHYSICS.JELLYFISH_FLOAT_SPEED * 0.42 * state.dir * movementScale(fish) : 0;
  const wanderForceX = Math.sin(state.frame * 0.008) * 0.04 * movementScale(fish);
  const targetVX = xPush + currentDrift + wanderForceX;

  const turning = fish.physics.vel.x * state.dir < 0;
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * ((turning ? 0.015 : 0.025) / Math.max(0.45, profile.glide));
  fish.physics.pos.x += fish.physics.vel.x;

  // --- Y方向: 非対称パルス推進 (Jet-and-Sink) ---
  let ay = 0;
  let targetY = state.baseY;
  let springK = 0.003;

  if (isPushing) {
    // 推進期: 上方向へ Sin 半周期パルスの推進力を与える
    const tPulse = (frameInCycle / pulseFrames) * Math.PI;
    const pulseForce = Math.sin(tPulse) * 0.38 * verticalSpreadForFish(fish);
    ay -= pulseForce; // 上向き

    targetY = state.baseY - PHYSICS.JELLYFISH_PULSE_AMP * 1.1 * verticalSpreadForFish(fish);
    springK = 0.018 * (1 + turnStrengthForFish(fish) * 0.5); // 上昇に強く追従
  } else {
    // 弛緩期: 自重による沈降
    const progress = (frameInCycle - pulseFrames) / (period - pulseFrames);
    const sinkRate = 0.026 * verticalSpreadForFish(fish) * (1.0 - Math.min(1.0, progress * 1.2));
    ay += sinkRate; // 下向きの沈降

    targetY = state.baseY + PHYSICS.JELLYFISH_PULSE_AMP * 0.45 * verticalSpreadForFish(fish);
    springK = 0.004 * (1 + turnStrengthForFish(fish) * 0.3); // 非常に緩く戻ることで慣性沈降を邪魔しない
  }

  const depthForce = updateDepthBehavior(fish, state.depth, 0.0055) * 5;
  const springForce = (targetY - fish.physics.pos.y) * springK;

  fish.physics.vel.y = (fish.physics.vel.y + ay + springForce + depthForce) * 0.91;

  const maxVY = PHYSICS.JELLYFISH_FLOAT_SPEED * 2.8 * verticalSpreadForFish(fish);
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
