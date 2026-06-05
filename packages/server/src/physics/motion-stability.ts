import { PHYSICS } from "@aquarium/shared";
import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";
import { motionProfileFor } from "./motion-profile";

const headingState = new Map<string, { dir: 1 | -1; cooldown: number }>();

export function stabilizeForwardMotion(fish: ActiveFish): void {
  if (fish.type === "anchor" || fish.type === "jellyfish") return;
  const world = getWorld();
  const edgeMargin = PHYSICS.WALL_MARGIN * 1.55;
  const nearLeft = fish.physics.pos.x <= edgeMargin;
  const nearRight = fish.physics.pos.x >= world.width - edgeMargin;
  let state = headingState.get(fish.id);
  if (!state) {
    state = { dir: fish.physics.vel.x < 0 ? -1 : 1, cooldown: 0 };
    headingState.set(fish.id, state);
  }
  state.cooldown = Math.max(0, state.cooldown - 1);

  const currentSign: 1 | -1 = fish.physics.vel.x < 0 ? -1 : 1;
  const edgeNeedsFlip = (nearLeft && state.dir < 0) || (nearRight && state.dir > 0);
  if (edgeNeedsFlip) {
    state.dir = nearLeft ? 1 : -1;
    state.cooldown = 80;
  } else if (currentSign !== state.dir && Math.abs(fish.physics.vel.x) > 0.75 && state.cooldown === 0) {
    state.dir = currentSign;
    state.cooldown = 110;
  }

  const profile = motionProfileFor(fish);
  if (!edgeNeedsFlip && currentSign !== state.dir && state.cooldown > 0) {
    fish.physics.vel.x += (state.dir * Math.abs(fish.physics.vel.x) - fish.physics.vel.x) * Math.min(0.18, 0.06 + profile.glide * 0.02);
  }
}

export function resetForwardStability(fishId: string): void {
  headingState.delete(fishId);
}
