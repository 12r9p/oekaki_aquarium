import type { ActiveFish } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";
import { FISH_SCALE_BASE_MULTIPLIER, getWorld } from "./world";

// ============================================================
// LayerManager: ところてん方式のレイヤー割り当て
//
// ルール:
//   1. isPinned=true の魚はロジックから除外し、pinnedLayerId に固定
//   2. 残りを releasedAt 降順（新しい順）でソート
//   3. 先頭から LAYER_CONFIG の maxCount の枠に割り当て
//   4. 枠が溢れたら自動非表示レイヤー扱いにする
// ============================================================

export function updateFishLayers(allFish: ActiveFish[]): void {
  if (LAYER_CONFIG.length === 0) return;
  // ピン留め済みと一般に分離
  const pinnedFish = allFish.filter((f) => f.isPinned && !f.isArchived);
  const normalFish = allFish
    .filter((f) => !f.isPinned && !f.isArchived)
    .sort((a, b) => (b.releasedAt ?? b.timestamp) - (a.releasedAt ?? a.timestamp)); // 放流が新しい順

  for (const fish of allFish) fish.isAutoHidden = false;

  // --- 一般魚へのレイヤー割り当て ---
  let layerIdx = 0;
  let countInLayer = 0;

  for (const fish of normalFish) {
    while (layerIdx < LAYER_CONFIG.length && countInLayer >= LAYER_CONFIG[layerIdx]!.maxCount) {
      layerIdx++;
      countInLayer = 0;
    }
    if (layerIdx >= LAYER_CONFIG.length) {
      fish.isAutoHidden = true;
      fish.targetOpacity = 0;
      continue;
    }
    applyLayerProps(fish, layerIdx);
    countInLayer++;
  }

  // --- ピン留め魚: 指定レイヤーに強制配置（定員無視） ---
  for (const fish of pinnedFish) {
    const targetLayer = Math.max(0, Math.min(fish.pinnedLayerId ?? 0, LAYER_CONFIG.length - 1));
    applyLayerProps(fish, targetLayer);
  }
}

export function getFishLayerCounts(allFish: ActiveFish[]): number[] {
  const counts = LAYER_CONFIG.map(() => 0);
  for (const fish of allFish) {
    if (!fish.isArchived && !fish.isAutoHidden && counts[fish.layerIndex] !== undefined) counts[fish.layerIndex]++;
  }
  return counts;
}

/** レイヤー設定値を魚オブジェクトに反映する */
function applyLayerProps(fish: ActiveFish, layerIdx: number): void {
  const config = LAYER_CONFIG[layerIdx] ?? LAYER_CONFIG[0];
  if (!config) return;
  const globalScale = getWorld().fishScaleMultiplier * FISH_SCALE_BASE_MULTIPLIER;
  fish.layerIndex = layerIdx;
  // これらの目標値に向かってクライアントが Lerp で補間する
  fish.targetScale = fish.userParams.scale * config.scale * globalScale;
  fish.targetOpacity = Math.max(0, Math.min(fish.userParams.opacity ?? 1, 1));
  // 遠くの魚は遅く動かす（パララックス効果）
  fish.physics.speedMultiplier = config.speedFactor;
}
