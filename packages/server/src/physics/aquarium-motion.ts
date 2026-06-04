import type { ActiveFish } from "@aquarium/shared";
import { applyAnchor } from "./anchor";
import { applyBoundaries } from "./boundaries";
import { applyJellyfish, resetJellyfishState } from "./jellyfish";
import { applyLooper } from "./looper";
import { applySchool } from "./school";
import { applyShark } from "./shark";
import { applySquid, resetSquidState } from "./squid";
import { applyTuna, resetTunaState } from "./tuna";
import { applyWander } from "./wander";
import { getWorld } from "../world";

/**
 * 魚種ごとの固有モーションを適用する。
 * 固有の遊泳モデルを持つ魚へ共通wanderを重ねないことで、不自然な加速や壁張り付きを防ぐ。
 */
export function updateAquariumMotion(fish: ActiveFish, allFish: ActiveFish[]): void {
  switch (fish.type) {
    case "tuna":
      applyTuna(fish);
      break;
    case "school":
    case "swimmer":
      applySchool(fish, allFish);
      applyWander(fish);
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
    case "looper":
      applyLooper(fish, getWorld().width);
      applyWander(fish);
      break;
    case "anchor":
      applyAnchor(fish);
      return;
  }

  applyBoundaries(fish);
}

/** 管理画面で魚を移動した際、魚種固有の基準位置も新しい座標へ合わせる。 */
export function resetAquariumMotionPosition(fish: ActiveFish): void {
  resetTunaState(fish.id, fish.physics.pos.y);
  resetSquidState(fish.id, fish.physics.pos.y);
  resetJellyfishState(fish.id, fish.physics.pos.y);
}
