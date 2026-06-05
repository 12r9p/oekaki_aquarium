import type { ActiveFish } from "@aquarium/shared";
import { motionProfileFor } from "./motion-profile";

const swimState = new Map<string, { phase: number; lastBeat: number }>();

export function applyFishSwimmingDynamics(fish: ActiveFish): void {
  if (fish.type === "anchor") return;

  let state = swimState.get(fish.id);
  if (!state) {
    state = { phase: Math.random() * Math.PI * 2, lastBeat: 0 };
    swimState.set(fish.id, state);
  }

  if (fish.type === "jellyfish") {
    // 上向き推進時(vy < -0.2)は収縮(-0.85)、沈降時(vy > 0.05)は弛緩・広がり(0.35)
    const vy = fish.physics.vel.y;
    const targetBeat = vy < -0.25 ? -0.85 : (vy > 0.05 ? 0.35 : 0.0);
    state.lastBeat += (targetBeat - state.lastBeat) * 0.15;
    return;
  }

  const speed = Math.hypot(fish.physics.vel.x, fish.physics.vel.y);
  if (speed < 0.01) return;

  const profile = motionProfileFor(fish);
  const glide = profile.glide;
  const beatRate = (0.09 + Math.min(speed, 8) * 0.018) * profile.tailBeat / glide;
  state.phase += beatRate;
  const beat = Math.sin(state.phase);
  state.lastBeat += (beat - state.lastBeat) * 0.18;
}

export function tailBeatForFish(fishId: string): number {
  return swimState.get(fishId)?.lastBeat ?? 0;
}

export function resetSwimDynamics(fishId: string): void {
  swimState.delete(fishId);
}
