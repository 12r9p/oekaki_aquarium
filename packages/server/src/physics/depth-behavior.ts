import { PHYSICS } from "@aquarium/shared";
import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale, verticalSpreadForFish } from "./motion-profile";

export interface DepthBehaviorState {
  depthTargetY: number;
  depthFrames: number;
  depthCooldown: number;
}

export function initDepthBehavior(fish: ActiveFish): DepthBehaviorState {
  return {
    depthTargetY: fish.physics.pos.y,
    depthFrames: 0,
    depthCooldown: 120 + Math.floor(Math.random() * 420),
  };
}

export function updateDepthBehavior(fish: ActiveFish, state: DepthBehaviorState, chance = 0.006): number {
  const world = getWorld();
  const spread = verticalSpreadForFish(fish);
  const margin = Math.min(world.height * 0.32, Math.max(PHYSICS.WALL_MARGIN * 1.45, world.height * 0.07 / Math.max(0.5, spread)));
  const minY = margin;
  const maxY = Math.max(minY + 1, world.height - margin);

  state.depthCooldown--;
  if (state.depthFrames > 0) state.depthFrames--;

  if (state.depthFrames <= 0 && state.depthCooldown <= 0 && Math.random() < chance * Math.max(0.5, spread)) {
    const direction = Math.random() < 0.5 ? -1 : 1;
    const excursion = (world.height * (0.18 + Math.random() * 0.28)) * Math.min(1.8, Math.max(0.5, spread));
    state.depthTargetY = clamp(fish.physics.pos.y + direction * excursion, minY, maxY);
    state.depthFrames = 180 + Math.floor(Math.random() * 520);
    state.depthCooldown = 360 + Math.floor(Math.random() * 900);
  }

  if (fish.physics.pos.y < minY + 25) {
    state.depthTargetY = minY + world.height * 0.16;
    state.depthFrames = Math.max(state.depthFrames, 120);
  } else if (fish.physics.pos.y > maxY - 25) {
    state.depthTargetY = maxY - world.height * 0.16;
    state.depthFrames = Math.max(state.depthFrames, 120);
  }

  if (state.depthFrames <= 0) return 0;
  const dy = state.depthTargetY - fish.physics.pos.y;
  const speedScale = Math.max(0, movementScale(fish));
  return clamp(dy * 0.0009 * Math.max(0.5, spread) * Math.min(speedScale, 1.5), -0.08, 0.08);
}

export function resetDepthBehavior(state: DepthBehaviorState, y: number): void {
  state.depthTargetY = y;
  state.depthFrames = 0;
  state.depthCooldown = 120 + Math.floor(Math.random() * 360);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
