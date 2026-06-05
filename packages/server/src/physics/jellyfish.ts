import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

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
  baseY: number;
}>();

export function applyJellyfish(fish: ActiveFish): void {
  const world = getWorld();
  if (!jellyfishState.has(fish.id)) {
    jellyfishState.set(fish.id, {
      dir: Math.random() < 0.5 ? 1 : -1,
      frame: Math.floor(Math.random() * PHYSICS.JELLYFISH_PULSE_PERIOD),
      baseY: fish.physics.pos.y,
    });
  }
  const state = jellyfishState.get(fish.id)!;
  state.frame++;
  const margin = PHYSICS.WALL_MARGIN * 1.5;
  if (world.horizontalBoundaryMode === "bounce") {
    if (fish.physics.pos.x > world.width - margin && state.dir === 1) state.dir = -1;
    if (fish.physics.pos.x < margin && state.dir === -1) state.dir = 1;
  }
  if (state.baseY < margin || state.baseY > world.height - margin) {
    state.baseY = Math.max(margin, Math.min(world.height - margin, state.baseY));
  }

  // X: ゆっくり横流れ
  const vx = PHYSICS.JELLYFISH_FLOAT_SPEED * state.dir * movementScale(fish);
  fish.physics.vel.x = vx;
  fish.physics.pos.x += vx;

  // Y: sin波で大きくゆったり上下（周期が長い）
  const phase = (state.frame / PHYSICS.JELLYFISH_PULSE_PERIOD) * Math.PI * 2;
  const targetY = state.baseY + Math.sin(phase) * PHYSICS.JELLYFISH_PULSE_AMP * verticalSpreadForFish(fish);
  const dy = (targetY - fish.physics.pos.y) * 0.025;
  fish.physics.vel.y = dy;
  fish.physics.pos.y += dy;
}

export function resetJellyfishState(fishId: string, newY: number): void {
  const state = jellyfishState.get(fishId);
  if (state) state.baseY = newY;
}
