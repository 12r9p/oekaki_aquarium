import type { ActiveFish } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";

// ============================================================
// LayerManager: ところてん方式のレイヤー割り当て
//
// ルール:
//   1. isPinned=true の魚はロジックから除外し、pinnedLayerId に固定
//   2. 残りを timestamp 降順（新しい順）でソート
//   3. 先頭から LAYER_CONFIG の maxCount の枠に割り当て
//   4. 枠が溢れたら最後のレイヤーに詰め込む
// ============================================================

export function updateFishLayers(allFish: ActiveFish[]): void {
  // ピン留め済みと一般に分離
  const pinnedFish = allFish.filter((f) => f.isPinned);
  const normalFish = allFish
    .filter((f) => !f.isPinned)
    .sort((a, b) => b.timestamp - a.timestamp); // 新しい順

  // --- 一般魚へのレイヤー割り当て ---
  let layerIdx = 0;
  let countInLayer = 0;

  for (const fish of normalFish) {
    // 現レイヤーが満員なら次のレイヤーへ
    if (countInLayer >= LAYER_CONFIG[layerIdx].maxCount) {
      layerIdx = Math.min(layerIdx + 1, LAYER_CONFIG.length - 1);
      countInLayer = 0;
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
    if (!fish.isArchived && counts[fish.layerIndex] !== undefined) counts[fish.layerIndex]++;
  }
  return counts;
}

/** レイヤー設定値を魚オブジェクトに反映する */
function applyLayerProps(fish: ActiveFish, layerIdx: number): void {
  const config = LAYER_CONFIG[layerIdx];
  fish.layerIndex = layerIdx;
  // これらの目標値に向かってクライアントが Lerp で補間する
  fish.targetScale = fish.userParams.scale * config.scale;
  fish.targetOpacity = config.opacity;
  // 遠くの魚は遅く動かす（パララックス効果）
  fish.physics.speedMultiplier = config.speedFactor;
}
