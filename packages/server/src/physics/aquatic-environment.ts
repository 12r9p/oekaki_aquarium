import { PHYSICS } from "@aquarium/shared";
import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale, verticalSpreadForFish } from "./motion-profile";

const envPhase = new Map<string, number>();

export function applyAquaticEnvironment(fish: ActiveFish, allFish: ActiveFish[]): void {
  if (fish.type === "anchor") return;
  const world = getWorld();
  const scale = movementScale(fish);
  if (scale <= 0) return;
  const spread = verticalSpreadForFish(fish);
  const phase = envPhase.get(fish.id) ?? Math.random() * Math.PI * 2;
  const nextPhase = phase + 0.006 + scale * 0.0015;
  envPhase.set(fish.id, nextPhase);

  const personalCurrent = Math.sin(nextPhase + fish.id.length * 0.37);
  const currentX = (-0.012 + personalCurrent * 0.0025) * scale;
  const currentY = Math.sin(nextPhase * 0.53) * 0.004 * spread;
  fish.physics.vel.x += currentX;
  fish.physics.vel.y += currentY;

  const surfaceDistance = fish.physics.pos.y;
  const bottomDistance = world.height - fish.physics.pos.y;
  const verticalComfort = Math.max(PHYSICS.WALL_MARGIN * 1.25, world.height * 0.09);
  if (surfaceDistance < verticalComfort) {
    fish.physics.vel.y += (1 - surfaceDistance / verticalComfort) * 0.045 * Math.min(scale, 1.5);
  }
  if (bottomDistance < verticalComfort) {
    fish.physics.vel.y -= (1 - bottomDistance / verticalComfort) * 0.045 * Math.min(scale, 1.5);
  }

  for (const other of allFish) {
    if (other.type !== "anchor" || other.isArchived || other.isAutoHidden) continue;
    const dx = fish.physics.pos.x - other.physics.pos.x;
    const dy = fish.physics.pos.y - other.physics.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0 || dist > 220) continue;
    const force = (1 - dist / 220) * 0.035;
    fish.physics.vel.x += (dx / dist) * force * Math.min(scale, 1.5);
    fish.physics.vel.y += (dy / dist) * force * 0.6 * Math.min(scale, 1.5);
  }
}

export function resetAquaticEnvironment(fishId: string): void {
  envPhase.delete(fishId);
}
