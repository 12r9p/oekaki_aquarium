import { v4 as uuidv4 } from "uuid";
import type { ActiveFish, FishConfig, PendingFish, Vector2, FishType } from "@aquarium/shared";

// ============================================================
// FishManager: 待機魚・活動魚の状態管理
// ============================================================

import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync, readdirSync } from "node:fs";
import { Buffer } from "node:buffer";
import { writeFishMeta, readFishMeta, DEFAULT_FISH_META, type FishMeta } from "./png-metadata";
import { getWorld } from "./world";
import { resetTunaState } from "./physics/tuna";
import { removeWanderState } from "./physics/wander";
import { updateFishLayers } from "./layer-manager";

/** /data/fish/ ディレクトリ（プロジェクトルート基準） */
export const DATA_FISH_DIR = join(import.meta.dir, "..", "..", "..", "data", "fish");
/** public/images ディレクトリ */
export const PUBLIC_IMAGES_DIR = join(import.meta.dir, "..", "public", "images");

/** URLからローカルパスを解決する */
function getLocalPathFromUrl(url: string): string | null {
  if (url.startsWith("/images/")) return join(PUBLIC_IMAGES_DIR, url.replace("/images/", ""));
  if (url.startsWith("/lib-images/")) return join(DATA_FISH_DIR, url.replace("/lib-images/", ""));
  return null;
}

/** ActiveFishを永続化（PNG作成＋メタ書き込み） */
function saveActiveFishToDisk(fish: ActiveFish) {
  if (!existsSync(DATA_FISH_DIR)) mkdirSync(DATA_FISH_DIR, { recursive: true });
  const srcPath = getLocalPathFromUrl(fish.textureUrl);
  if (!srcPath || !existsSync(srcPath)) return;

  const destPath = join(DATA_FISH_DIR, `${fish.id}.png`);
  try {
    let buf = readFileSync(srcPath) as Buffer;
    const meta: FishMeta = {
      version: 1,
      author: fish.author || "anonymous",
      type: fish.type,
      speed: fish.userParams.speed,
      scale: fish.userParams.scale,
      pinnedLayerId: fish.isPinned ? (fish.pinnedLayerId ?? 0) : null,
      tags: fish.fishMeta?.tags || [],
      isArchived: fish.isArchived ?? false,
    };
    buf = writeFishMeta(buf, meta);
    // URLを公開する前に書き込みを完了させ、初回リクエストの404を防ぐ。
    writeFileSync(destPath, buf);
    // 永続化されたファイルのURLに差し替え
    fish.textureUrl = `/lib-images/${fish.id}.png`;
  } catch (e) {
    console.error(`[FishManager] Failed to save fish ${fish.id} to disk:`, e);
  }
}

/** 永続化されたメタデータ（PNG tEXt）のプロパティを更新 */
function updateActiveFishOnDisk(fish: ActiveFish) {
  const destPath = join(DATA_FISH_DIR, `${fish.id}.png`);
  if (!existsSync(destPath)) return;
  try {
    let buf = readFileSync(destPath) as Buffer;
    const meta: FishMeta = {
      version: 1,
      author: fish.author || "anonymous",
      type: fish.type,
      speed: fish.userParams.speed,
      scale: fish.userParams.scale,
      pinnedLayerId: fish.isPinned ? (fish.pinnedLayerId ?? 0) : null,
      tags: fish.fishMeta?.tags || [],
      isArchived: fish.isArchived ?? false,
    };
    buf = writeFishMeta(buf, meta);
    writeFileSync(destPath, buf);
  } catch (e) {
    console.error(`[FishManager] Failed to update fish ${fish.id} on disk:`, e);
  }
}

/** 永続化ファイルを削除 */
function removeActiveFishFromDisk(fishId: string) {
  const destPath = join(DATA_FISH_DIR, `${fishId}.png`);
  if (existsSync(destPath)) {
    try {
      unlinkSync(destPath);
    } catch (e) {
      console.error(`[FishManager] Failed to remove fish ${fishId} from disk:`, e);
    }
  }
}

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
// プリセット別 初期速度（放流直後の発散）
// -------------------------------------------------------
function initialVelForType(type: FishType): { x: number; y: number } {
  const rnd = () => Math.random() - 0.5;
  switch (type) {
    case "tuna":
      // 高速・ほぼ水平・左右どちらかにランダム
      return { x: (Math.random() < 0.5 ? 1 : -1) * (4 + Math.random() * 2), y: rnd() * 0.3 };
    case "school":
    case "swimmer":
      // Boids が引き継ぐので小さな水平乱数でよい
      return { x: (Math.random() < 0.5 ? 1 : -1) * (1 + Math.random()), y: rnd() * 0.5 };
    case "squid":
      // 方向・速度ともにばらける
      return { x: (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random()), y: rnd() * 0.3 };
    case "jellyfish":
      // X はごくゆっくり、Y は位相ずれ
      return { x: (Math.random() < 0.5 ? 1 : -1) * 0.5, y: rnd() * 1.5 };
    case "shark":
      // 弧が重ならないよう方向を十分ばらける
      return { x: (Math.random() < 0.5 ? 1 : -1) * (1.5 + Math.random()), y: rnd() * 0.4 };
    case "looper":
      return { x: 0.4 + Math.random() * 0.4, y: rnd() * 0.4 };
    case "anchor":
    default:
      return { x: 0, y: 0 };
  }
}

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
      vel: initialVelForType(config.type),
      speedMultiplier: 1.0, // レイヤーマネージャが後から上書きする
    },
    layerIndex: 0,
    targetScale: config.userParams.scale,
    targetOpacity: 1.0,
  };

  activePool.set(fish.id, fish);
  updateFishLayers(getAllActiveFish());
  
  // 永続化処理（/data/fish に保存し魚のtextureUrlを差し替える）
  saveActiveFishToDisk(fish);
  
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
  updateActiveFishOnDisk(fish);
  return true;
}

/** 魚のプロパティを更新する */
export function updateFishParams(
  fishId: string,
  updates: Partial<{ scale: number; speed: number; isPinned: boolean; pinnedLayerId: number; type: FishType; isArchived: boolean }>
): boolean {
  const fish = activePool.get(fishId);
  if (!fish) return false;
  if (updates.scale !== undefined) fish.userParams.scale = updates.scale;
  if (updates.speed !== undefined) fish.userParams.speed = updates.speed;
  if (updates.isPinned !== undefined) fish.isPinned = updates.isPinned;
  if (updates.isPinned === false) fish.pinnedLayerId = undefined;
  if (updates.pinnedLayerId !== undefined) fish.pinnedLayerId = updates.pinnedLayerId;
  if (updates.type !== undefined) fish.type = updates.type;
  if (updates.isArchived !== undefined) fish.isArchived = updates.isArchived;
  updateFishLayers(getAllActiveFish());
  
  updateActiveFishOnDisk(fish);
  return true;
}

export function multiplyAllFishParams(scaleMultiplier: number, speedMultiplier: number): number {
  const safeScaleMultiplier = Math.max(0.1, Math.min(scaleMultiplier, 3));
  const safeSpeedMultiplier = Math.max(0.1, Math.min(speedMultiplier, 3));

  for (const fish of activePool.values()) {
    fish.userParams.scale = Math.max(0.1, Math.min(fish.userParams.scale * safeScaleMultiplier, 3));
    fish.userParams.speed = Math.max(0, Math.min(fish.userParams.speed * safeSpeedMultiplier, 5));
    updateActiveFishOnDisk(fish);
  }
  updateFishLayers(getAllActiveFish());
  return activePool.size;
}

/** 魚を複製する */
export function duplicateFish(fishId: string): ActiveFish | undefined {
  const src = activePool.get(fishId);
  if (!src) return undefined;

  const newFish: ActiveFish = {
    ...src,
    id: uuidv4(), // 新しいIDを発行
    timestamp: Date.now(), // 現在時刻で末尾（最前面）に追加
    physics: {
      pos: { x: src.physics.pos.x + 50, y: src.physics.pos.y + 50 }, // 少しずらして配置
      vel: { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 0.5 },
      speedMultiplier: 1.0,
    },
    // アーカイブ状態は引き継がない（複製したら即座に出現させる）
    isArchived: false,
  };

  activePool.set(newFish.id, newFish);
  updateFishLayers(getAllActiveFish());
  saveActiveFishToDisk(newFish);
  return newFish;
}

/** 魚を削除 */
export function removeFish(fishId: string): boolean {
  removeActiveFishFromDisk(fishId);
  const removed = activePool.delete(fishId);
  if (removed) updateFishLayers(getAllActiveFish());
  return removed;
}

/**
 * アクティブな全魚をworld全体にグリッド均等配置で再散布する。
 * worldサイズ変更後に偏りを解消するためのボタン操作で呼び出す。
 */
export function redistributeFish(): number {
  const world = getWorld();
  const fish = [...activePool.values()].filter(f => !f.isArchived);
  const n = fish.length;
  if (n === 0) return 0;

  const ww = world.width;
  const wh = world.height;
  const margin = 120;
  const cols = Math.ceil(Math.sqrt(n * (ww / wh))); // アスペクト比に合わせたグリッド
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = (ww - margin * 2) / cols;
  const cellH = (wh - margin * 2) / rows;

  fish.forEach((f, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const jitterX = (Math.random() - 0.5) * cellW * 0.5;
    const jitterY = (Math.random() - 0.5) * cellH * 0.5;
    f.physics.pos.x = Math.max(margin, Math.min(ww - margin, margin + (col + 0.5) * cellW + jitterX));
    f.physics.pos.y = Math.max(margin, Math.min(wh - margin, margin + (row + 0.5) * cellH + jitterY));
    // 速度もランダムリセット（固まらないように）
    f.physics.vel.x = (Math.random() - 0.5) * 4;
    f.physics.vel.y = (Math.random() - 0.5) * 2;

    // 各物理モデルの内部stateをリセット（tunaの上戻り防止など）
    resetTunaState(f.id, f.physics.pos.y);
    removeWanderState(f.id);
  });
  return n;
}

/**
 * /data/fish/ にあるファイルを全て読み込み、
 * 既存の activePool に存在しない魚のみ追加する。
 * @param spawnPoints 世界の放流ポイント一覧（空の場合はフォールバック位置を使用）
 */
export function restoreActiveFishFromDisk(spawnPoints: Array<{ x: number; y: number }> = []) {
  if (!existsSync(DATA_FISH_DIR)) return;
  try {
    const files = readdirSync(DATA_FISH_DIR).filter(f => f.toLowerCase().endsWith(".png"));
    let restoredCount = 0;
    for (const file of files) {
      const filePath = join(DATA_FISH_DIR, file);
      const fishId = file.replace(".png", "");

      // 既に泳いでいる魚はスキップ（再読み込み時の重複防止）
      if (activePool.has(fishId)) continue;

      try {
        const buf = readFileSync(filePath) as Buffer;
        const meta = readFishMeta(buf) ?? { ...DEFAULT_FISH_META };

        // 初期位置: world全体にランダム散布（グリッド均等配置 + ジッター）
        const totalFiles = files.length;
        const cols = Math.ceil(Math.sqrt(totalFiles * 2));
        const rows = Math.max(1, Math.ceil(totalFiles / cols));
        const fileIdx = restoredCount;
        const col = fileIdx % cols;
        const row = Math.floor(fileIdx / cols);
        const wld = getWorld();
        const ww = wld.width;
        const wh = wld.height;
        const margin = 120;
        const cellW = (ww - margin * 2) / cols;
        const cellH = (wh - margin * 2) / rows;
        const jitterX = (Math.random() - 0.5) * cellW * 0.6;
        const jitterY = (Math.random() - 0.5) * cellH * 0.6;
        const spawnX = margin + (col + 0.5) * cellW + jitterX;
        const spawnY = margin + (row + 0.5) * cellH + jitterY;
        const sp = {
          x: Math.max(margin, Math.min(ww - margin, spawnX)),
          y: Math.max(margin, Math.min(wh - margin, spawnY))
        };

        const fish: ActiveFish = {
          id: fishId,
          textureUrl: `/lib-images/${file}`,
          timestamp: Date.now() + restoredCount,
          type: meta.type,
          author: meta.author,
          fishMeta: meta,
          userParams: {
            scale: meta.scale,
            speed: meta.speed,
            rotationOffset: 0
          },
          physics: {
            pos: { x: sp.x, y: sp.y },
            vel: initialVelForType(meta.type),
            speedMultiplier: 1.0,
          },
          layerIndex: 0,
          targetScale: meta.scale,
          targetOpacity: 1.0,
          isPinned: meta.pinnedLayerId !== null && meta.pinnedLayerId !== undefined,
          pinnedLayerId: meta.pinnedLayerId ?? undefined,
          isArchived: meta.isArchived ?? false,
        };
        activePool.set(fish.id, fish);
        restoredCount++;
      } catch (e) {
        console.error(`[FishManager] Failed to restore fish from ${file}:`, e);
      }
    }
    updateFishLayers(getAllActiveFish());
    console.log(`[FishManager] Restored ${restoredCount} fish from ${DATA_FISH_DIR}`);
  } catch (err) {
    console.error(`[FishManager] Failed to read ${DATA_FISH_DIR}:`, err);
  }
}
