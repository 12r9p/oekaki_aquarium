import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { applyAquaticEnvironment, resetAquaticEnvironment } from "./aquatic-environment";
import { applyAnchor, resetAnchorState } from "./anchor";
import { applyBoundaries } from "./boundaries";
import { applyCustomMotion } from "./custom-motion";
import { applyJellyfish, resetJellyfishState } from "./jellyfish";
import { resetForwardStability, stabilizeForwardMotion } from "./motion-stability";
import { applySchool, resetSchoolState } from "./school";
import { applyShark } from "./shark";
import { applyFishSwimmingDynamics, resetSwimDynamics } from "./swim-dynamics";
import { applySquid, resetSquidState } from "./squid";
import { applyTuna, resetTunaState } from "./tuna";

/**
 * 魚種ごとの固有モーションを適用する。
 * 固有の遊泳モデルを持つ魚へ共通wanderを重ねないことで、不自然な加速や壁張り付きを防ぐ。
 */
export function updateAquariumMotion(fish: ActiveFish, allFish: ActiveFish[]): void {
  const previousX = fish.physics.pos.x;
  switch (fish.type) {
    case "tuna":
      applyTuna(fish);
      break;
    case "school":
      applySchool(fish, allFish);
      break;
    case "squid":
      applySquid(fish);
      break;
    case "jellyfish":
      applyJellyfish(fish);
      break;
    case "shark":
      applyShark(fish);
      break;
    case "custom":
      applyCustomMotion(fish);
      break;
    case "anchor":
      applyAnchor(fish);
      return;
  }

  const preferredDirection = fish.userParams.direction;
  if (preferredDirection && preferredDirection !== "auto") {
    const sign = preferredDirection === "right" ? 1 : -1;
    const world = getWorld();
    const edgeMargin = PHYSICS.WALL_MARGIN * 1.35;
    const isPushingIntoLeftWall = sign < 0 && fish.physics.pos.x <= edgeMargin;
    const isPushingIntoRightWall = sign > 0 && fish.physics.pos.x >= world.width - edgeMargin;
    if (isPushingIntoLeftWall) {
      fish.physics.vel.x = Math.max(Math.abs(fish.physics.vel.x), 0.8);
    } else if (isPushingIntoRightWall) {
      fish.physics.vel.x = -Math.max(Math.abs(fish.physics.vel.x), 0.8);
    } else {
      const movedX = fish.physics.pos.x - previousX;
      if (movedX * sign < 0) fish.physics.pos.x = previousX - movedX;
      fish.physics.vel.x = Math.abs(fish.physics.vel.x) * sign;
    }
  }
  applyAquaticEnvironment(fish, allFish);
  stabilizeForwardMotion(fish);
  applyFishSwimmingDynamics(fish);
  applyBoundaries(fish);
}

/** 管理画面で魚を移動した際、魚種固有の基準位置も新しい座標へ合わせる。 */
export function resetAquariumMotionPosition(fish: ActiveFish): void {
  resetAnchorState(fish.id, fish.physics.pos.x, fish.physics.pos.y);
  resetSchoolState(fish.id, fish.physics.pos.x, fish.physics.pos.y);
  resetTunaState(fish.id, fish.physics.pos.y);
  resetSquidState(fish.id, fish.physics.pos.y);
  resetJellyfishState(fish.id, fish.physics.pos.y);
  resetAquaticEnvironment(fish.id);
  resetForwardStability(fish.id);
  resetSwimDynamics(fish.id);
}
