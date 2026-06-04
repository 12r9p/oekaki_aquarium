import { PHYSICS } from "@aquarium/shared";
import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";

/** UI設定と遠近レイヤーを合わせた移動倍率。極端な値は水槽らしさを保つ範囲に抑える。 */
export function movementScale(fish: ActiveFish): number {
  const userSpeed = Math.max(0, Math.min(fish.userParams.speed, 5));
  return fish.physics.speedMultiplier * userSpeed * getWorld().fishSpeedMultiplier;
}

/** 境界処理で使う魚種別の最大速度。 */
export function maxSpeedForFish(fish: ActiveFish): number {
  const scale = movementScale(fish);
  switch (fish.type) {
    case "tuna":
      return PHYSICS.TUNA_SPEED * scale * 1.15;
    case "squid":
      return PHYSICS.SQUID_PULSE_SPEED * scale;
    case "jellyfish":
      return Math.max(0.8, PHYSICS.JELLYFISH_FLOAT_SPEED * scale * 3);
    case "shark":
      return PHYSICS.SHARK_SPEED * scale * 1.2;
    case "looper":
      return PHYSICS.BOIDS_MAX_SPEED * scale;
    case "anchor":
      return 0;
    case "school":
    case "swimmer":
    default:
      return PHYSICS.BOIDS_MAX_SPEED * scale;
  }
}
