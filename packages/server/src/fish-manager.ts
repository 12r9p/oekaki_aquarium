import { v4 as uuidv4 } from "uuid";
import type { ActiveFish, FishConfig, PendingFish, Vector2 } from "@aquarium/shared";

// ============================================================
// FishManager: 待機魚・活動魚の状態管理
// ============================================================

/** 待機キュー（スキャン済み・未放流） */
const pendingQueue: PendingFish[] = [];

/** アクティブプール（ゲームループで演算対象） */
const activePool: Map<string, ActiveFish> = new Map();

// -------------------------------------------------------
// PendingQueue 操作
// -------------------------------------------------------

/** スキャンノードから画像を受け取り待機リストに追加する */
export function addToPending(imageUrl: string): PendingFish {
  const fish: PendingFish = {
    id: uuidv4(),
    imageUrl,
    timestamp: Date.now(),
  };
  pendingQueue.push(fish);
  return fish;
}

/** 待機リスト全件取得 */
export function getPendingQueue(): PendingFish[] {
  return [...pendingQueue];
}

/** 排他ロック取得（iPad が編集を開始するときに呼ぶ） */
export function lockPending(fishId: string, editorUuid: string): PendingFish | null {
  const fish = pendingQueue.find((f) => f.id === fishId);
  if (!fish) return null;
  // 既に別の人がロック中ならnullを返す
  if (fish.lockedBy && fish.lockedBy !== editorUuid) return null;
  fish.lockedBy = editorUuid;
  return fish;
}

/** ロック解除（キャンセル時） */
export function unlockPending(fishId: string): void {
  const fish = pendingQueue.find((f) => f.id === fishId);
  if (fish) fish.lockedBy = undefined;
}

/** 待機リストからの削除（拒否用） */
export function removePendingFish(fishId: string): boolean {
  const idx = pendingQueue.findIndex(f => f.id === fishId);
  if (idx < 0) return false;
  pendingQueue.splice(idx, 1);
  return true;
}

// -------------------------------------------------------
// ActivePool 操作
// -------------------------------------------------------

/**
 * 待機リストから放流してアクティブプールへ移動する。
 * iPad から送られてきた FishConfig を元に ActiveFish を初期化する。
 */
export function releaseFish(
  config: FishConfig,
  spawnPos: Vector2
): ActiveFish {
  // 待機リストから除去
  const pendingIdx = pendingQueue.findIndex((f) => f.id === config.id);
  if (pendingIdx >= 0) pendingQueue.splice(pendingIdx, 1);

  const fish: ActiveFish = {
    ...config,
    timestamp: Date.now(),
    physics: {
      pos: { ...spawnPos },
      vel: { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 0.5 },
      speedMultiplier: 1.0, // レイヤーマネージャが後から上書きする
    },
    layerIndex: 0,
    targetScale: config.userParams.scale,
    targetOpacity: 1.0,
  };

  activePool.set(fish.id, fish);
  return fish;
}

/** アクティブな全魚を配列で取得 */
export function getAllActiveFish(): ActiveFish[] {
  return Array.from(activePool.values());
}

/** IDで1匹取得 */
export function getActiveFish(id: string): ActiveFish | undefined {
  return activePool.get(id);
}

/** ピン留め状態を切り替える */
export function setPinned(
  fishId: string,
  isPinned: boolean,
  layerId = 0
): boolean {
  const fish = activePool.get(fishId);
  if (!fish) return false;
  fish.isPinned = isPinned;
  fish.pinnedLayerId = layerId;
  return true;
}

/** 魚のプロパティを更新する */
export function updateFishParams(
  fishId: string,
  updates: Partial<{ scale: number; speed: number; isPinned: boolean; pinnedLayerId: number }>
): boolean {
  const fish = activePool.get(fishId);
  if (!fish) return false;
  if (updates.scale !== undefined) fish.userParams.scale = updates.scale;
  if (updates.speed !== undefined) fish.userParams.speed = updates.speed;
  if (updates.isPinned !== undefined) fish.isPinned = updates.isPinned;
  if (updates.pinnedLayerId !== undefined) fish.pinnedLayerId = updates.pinnedLayerId;
  return true;
}

/** 魚を削除 */
export function removeFish(fishId: string): boolean {
  return activePool.delete(fishId);
}
