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
import { loadFishMetadataIndex, upsertFishMetadataIndex, removeFishMetadataIndex } from "./fish-library";

function normalizeFishType(type: unknown): FishType {
  if (type === "swimmer") return "school";
  if (type === "looper") return "custom";
  if (type === "tuna" || type === "school" || type === "squid" || type === "jellyfish" || type === "shark" || type === "anchor" || type === "custom") {
    return type;
  }
  return "school";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSnapshotAssetReference(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 4096
    && !/^data:/i.test(value)
    && !/^blob:/i.test(value);
}

function parseSnapshotFishType(value: unknown): FishType | undefined {
  if (value === "swimmer" || value === "looper") return normalizeFishType(value);
  if (value === "tuna" || value === "school" || value === "squid" || value === "jellyfish" || value === "shark" || value === "anchor" || value === "custom") {
    return value;
  }
  return undefined;
}

function isVector2(value: unknown): value is Vector2 {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function parseSnapshotCustomMotion(value: unknown): { name: string; code: string } | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value.name !== "string" || typeof value.code !== "string") return null;
  return { name: value.name.slice(0, 80), code: value.code.slice(0, 20_000) };
}

function parseSnapshotFishMeta(value: unknown): FishMeta | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;
  const type = parseSnapshotFishType(value.type);
  if (
    !isFiniteNumber(value.version)
    || typeof value.author !== "string"
    || !type
    || !isFiniteNumber(value.speed)
    || !isFiniteNumber(value.scale)
    || !(value.pinnedLayerId === null || (isFiniteNumber(value.pinnedLayerId) && Number.isInteger(value.pinnedLayerId)))
    || !Array.isArray(value.tags)
    || value.tags.length > 1000
    || !value.tags.every((tag) => typeof tag === "string")
  ) return null;

  const optionalStringFields = ["senderId"] as const;
  if (optionalStringFields.some((key) => value[key] !== undefined && typeof value[key] !== "string")) return null;
  const optionalNumberFields = ["createdAt", "releasedAt", "archivedAt", "logoScale", "logoX", "logoY"] as const;
  if (optionalNumberFields.some((key) => value[key] !== undefined && !isFiniteNumber(value[key]))) return null;
  if (value.isArchived !== undefined && typeof value.isArchived !== "boolean") return null;
  if (value.direction !== undefined && value.direction !== "auto" && value.direction !== "left" && value.direction !== "right") return null;
  if (value.flipX !== undefined && typeof value.flipX !== "boolean") return null;
  if (value.opacity !== undefined && (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1)) return null;
  const customMotion = parseSnapshotCustomMotion(value.customMotion);
  if (customMotion === null) return null;

  return {
    version: value.version,
    author: value.author,
    type,
    speed: value.speed,
    scale: value.scale,
    pinnedLayerId: value.pinnedLayerId,
    tags: [...value.tags] as string[],
    ...(value.isArchived === undefined ? {} : { isArchived: value.isArchived }),
    ...(value.direction === undefined ? {} : { direction: value.direction }),
    ...(value.flipX === undefined ? {} : { flipX: value.flipX }),
    ...(value.opacity === undefined ? {} : { opacity: value.opacity }),
    ...(customMotion === undefined ? {} : { customMotion }),
    ...(value.createdAt === undefined ? {} : { createdAt: value.createdAt as number }),
    ...(value.releasedAt === undefined ? {} : { releasedAt: value.releasedAt as number }),
    ...(value.archivedAt === undefined ? {} : { archivedAt: value.archivedAt as number }),
    ...(value.senderId === undefined ? {} : { senderId: value.senderId as string }),
    ...(value.logoScale === undefined ? {} : { logoScale: value.logoScale as number }),
    ...(value.logoX === undefined ? {} : { logoX: value.logoX as number }),
    ...(value.logoY === undefined ? {} : { logoY: value.logoY as number }),
  };
}

function parseSnapshotActiveFish(value: unknown): ActiveFish | undefined {
  if (!isRecord(value)) return undefined;
  const type = parseSnapshotFishType(value.type);
  const fishMeta = parseSnapshotFishMeta(value.fishMeta);
  const customMotion = parseSnapshotCustomMotion(value.customMotion);
  if (fishMeta === null || customMotion === null) return undefined;
  const userParams = value.userParams;
  const physics = value.physics;
  if (
    typeof value.id !== "string" || value.id.length === 0 || value.id.length > 200
    || !isSnapshotAssetReference(value.textureUrl)
    || !type
    || !isRecord(userParams)
    || !isFiniteNumber(userParams.scale) || userParams.scale < 0
    || !isFiniteNumber(userParams.speed) || userParams.speed < 0
    || !isFiniteNumber(userParams.rotationOffset)
    || (userParams.direction !== undefined && userParams.direction !== "auto" && userParams.direction !== "left" && userParams.direction !== "right")
    || (userParams.flipX !== undefined && typeof userParams.flipX !== "boolean")
    || (userParams.opacity !== undefined && (!isFiniteNumber(userParams.opacity) || userParams.opacity < 0 || userParams.opacity > 1))
    || !isRecord(physics)
    || !isVector2(physics.pos) || !isVector2(physics.vel)
    || !isFiniteNumber(physics.speedMultiplier)
    || !isFiniteNumber(value.timestamp)
    || !isFiniteNumber(value.createdAt)
    || !isFiniteNumber(value.releasedAt)
    || !Number.isInteger(value.layerIndex) || !isFiniteNumber(value.layerIndex) || value.layerIndex < 0
    || !isFiniteNumber(value.targetScale) || value.targetScale < 0
    || !isFiniteNumber(value.targetOpacity) || value.targetOpacity < 0 || value.targetOpacity > 1
    || (value.author !== undefined && typeof value.author !== "string")
    || (value.archivedAt !== undefined && !isFiniteNumber(value.archivedAt))
    || (value.isPinned !== undefined && typeof value.isPinned !== "boolean")
    || (value.pinnedLayerId !== undefined && (!isFiniteNumber(value.pinnedLayerId) || !Number.isInteger(value.pinnedLayerId)))
    || (value.isArchived !== undefined && typeof value.isArchived !== "boolean")
    || (value.isAutoHidden !== undefined && typeof value.isAutoHidden !== "boolean")
    || (value.motionPath !== undefined && (!Array.isArray(value.motionPath) || value.motionPath.length > 10_000 || !value.motionPath.every(isVector2)))
  ) return undefined;

  return {
    id: value.id,
    textureUrl: value.textureUrl,
    type,
    ...(value.author === undefined ? {} : { author: value.author as string }),
    ...(fishMeta === undefined ? {} : { fishMeta }),
    userParams: {
      scale: userParams.scale,
      speed: userParams.speed,
      rotationOffset: userParams.rotationOffset,
      ...(userParams.direction === undefined ? {} : { direction: userParams.direction }),
      ...(userParams.flipX === undefined ? {} : { flipX: userParams.flipX }),
      ...(userParams.opacity === undefined ? {} : { opacity: userParams.opacity }),
    },
    ...(customMotion === undefined ? {} : { customMotion }),
    ...(value.motionPath === undefined ? {} : { motionPath: value.motionPath.map((point) => ({ x: point.x, y: point.y })) }),
    ...(value.isPinned === undefined ? {} : { isPinned: value.isPinned }),
    ...(value.pinnedLayerId === undefined ? {} : { pinnedLayerId: value.pinnedLayerId }),
    timestamp: value.timestamp,
    createdAt: value.createdAt,
    releasedAt: value.releasedAt,
    ...(value.archivedAt === undefined ? {} : { archivedAt: value.archivedAt }),
    physics: {
      pos: { x: physics.pos.x, y: physics.pos.y },
      vel: { x: physics.vel.x, y: physics.vel.y },
      speedMultiplier: physics.speedMultiplier,
    },
    layerIndex: value.layerIndex,
    targetScale: value.targetScale,
    targetOpacity: value.targetOpacity,
    ...(value.isArchived === undefined ? {} : { isArchived: value.isArchived }),
    ...(value.isAutoHidden === undefined ? {} : { isAutoHidden: value.isAutoHidden }),
  };
}

function parseSnapshotPendingFish(value: unknown): PendingFish | undefined {
  if (!isRecord(value)) return undefined;
  const fishMeta = parseSnapshotFishMeta(value.fishMeta);
  if (fishMeta === null) return undefined;
  if (
    typeof value.id !== "string" || value.id.length === 0 || value.id.length > 200
    || !isSnapshotAssetReference(value.imageUrl)
    || !isFiniteNumber(value.timestamp)
    || (value.lockedBy !== undefined && typeof value.lockedBy !== "string")
  ) return undefined;

  return {
    id: value.id,
    imageUrl: value.imageUrl,
    timestamp: value.timestamp,
    ...(value.lockedBy === undefined ? {} : { lockedBy: value.lockedBy as string }),
    ...(fishMeta === undefined ? {} : { fishMeta }),
  };
}

/** /data/fish/ ディレクトリ（プロジェクトルート基準） */
export const DATA_FISH_DIR = join(import.meta.dir, "..", "..", "..", "data", "fish");
/** public/images ディレクトリ */
export const PUBLIC_IMAGES_DIR = join(import.meta.dir, "public", "images");

/** URLからローカルパスを解決する */
function getLocalPathFromUrl(url: string): string | null {
  if (url.startsWith("/images/")) return join(PUBLIC_IMAGES_DIR, url.replace("/images/", ""));
  if (url.startsWith("/lib-images/")) return join(DATA_FISH_DIR, url.replace("/lib-images/", ""));
  return null;
}

/** ActiveFishを永続化（PNG作成＋メタ書き込み） */
function saveActiveFishToDisk(fish: ActiveFish, sourceBuffer?: Buffer) {
  if (!existsSync(DATA_FISH_DIR)) mkdirSync(DATA_FISH_DIR, { recursive: true });
  const srcPath = getLocalPathFromUrl(fish.textureUrl);
  if (!sourceBuffer && (!srcPath || !existsSync(srcPath))) return;

  const destPath = join(DATA_FISH_DIR, `${fish.id}.png`);
  try {
    let buf = sourceBuffer ?? readFileSync(srcPath!) as Buffer;
    const meta: FishMeta = {
      version: 1,
      author: fish.author || "anonymous",
      type: fish.type,
      speed: fish.userParams.speed,
      scale: fish.userParams.scale,
      pinnedLayerId: fish.isPinned ? (fish.pinnedLayerId ?? 0) : null,
      tags: fish.fishMeta?.tags || [],
      isArchived: fish.isArchived ?? false,
      direction: fish.userParams.direction ?? "auto",
      flipX: fish.userParams.flipX ?? false,
      opacity: fish.userParams.opacity ?? 1,
      customMotion: fish.customMotion,
      createdAt: fish.createdAt,
      releasedAt: fish.releasedAt,
      archivedAt: fish.archivedAt,
      senderId: fish.fishMeta?.senderId,
      logoScale: fish.fishMeta?.logoScale,
      logoX: fish.fishMeta?.logoX,
      logoY: fish.fishMeta?.logoY,
    };
    buf = writeFishMeta(buf, meta);
    // URLを公開する前に書き込みを完了させ、初回リクエストの404を防ぐ。
    writeFileSync(destPath, buf);
    // キャッシュ用JSONの書き出し（起動・管理を高速化しメモリ使用量を削減するため）
    const jsonPath = join(DATA_FISH_DIR, `${fish.id}.json`);
    writeFileSync(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
    upsertFishMetadataIndex(`${fish.id}.png`, meta);
    // 永続化されたファイルのURLに差し替え
    fish.textureUrl = `/lib-images/${fish.id}.png`;
  } catch (e) {
    console.error(`[FishManager] Failed to save fish ${fish.id} to disk:`, e);
  }
}

/** 永続化されたメタデータ（PNG tEXt）のプロパティを更新 */
function updateActiveFishOnDisk(fish: ActiveFish) {
  const destPath = join(DATA_FISH_DIR, `${fish.id}.png`);
  try {
    const meta: FishMeta = {
      version: 1,
      author: fish.author || "anonymous",
      type: fish.type,
      speed: fish.userParams.speed,
      scale: fish.userParams.scale,
      pinnedLayerId: fish.isPinned ? (fish.pinnedLayerId ?? 0) : null,
      tags: fish.fishMeta?.tags || [],
      isArchived: fish.isArchived ?? false,
      direction: fish.userParams.direction ?? "auto",
      flipX: fish.userParams.flipX ?? false,
      opacity: fish.userParams.opacity ?? 1,
      customMotion: fish.customMotion,
      createdAt: fish.createdAt,
      releasedAt: fish.releasedAt,
      archivedAt: fish.archivedAt,
      senderId: fish.fishMeta?.senderId,
      logoScale: fish.fishMeta?.logoScale,
      logoX: fish.fishMeta?.logoX,
      logoY: fish.fishMeta?.logoY,
    };
    if (existsSync(destPath)) {
      const buf = writeFishMeta(readFileSync(destPath) as Buffer, meta);
      writeFileSync(destPath, buf);
      // キャッシュ用JSONの更新
      const jsonPath = join(DATA_FISH_DIR, `${fish.id}.json`);
      writeFileSync(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
    }
    upsertFishMetadataIndex(`${fish.id}.png`, meta);
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
  const jsonPath = join(DATA_FISH_DIR, `${fishId}.json`);
  if (existsSync(jsonPath)) {
    try {
      unlinkSync(jsonPath);
    } catch (e) {
      console.error(`[FishManager] Failed to remove fish json ${fishId} from disk:`, e);
    }
  }
  removeFishMetadataIndex(`${fishId}.png`);
}

/** 待機キュー（スキャン済み・未放流） */
const pendingQueue: PendingFish[] = [];

/** アクティブプール（ゲームループで演算対象） */
const activePool: Map<string, ActiveFish> = new Map();

// -------------------------------------------------------
// PendingQueue 操作
// -------------------------------------------------------

/** スキャンノードから画像を受け取り待機リストに追加する */
export function addToPending(imageUrl: string, fishMeta?: FishMeta): PendingFish {
  const fish: PendingFish = {
    id: uuidv4(),
    imageUrl,
    timestamp: Date.now(),
    fishMeta,
  };
  pendingQueue.push(fish);
  return fish;
}

/** 待機リスト全件取得 */
export function getPendingQueue(): PendingFish[] {
  return [...pendingQueue];
}

/** Return only validated JSON-safe fish state, preserving existing asset URLs. */
export function getFishStateSnapshot(): { activeFish: ActiveFish[]; pendingFish: PendingFish[] } {
  const prepared = prepareFishStateSnapshot({
    activeFish: getAllActiveFish(),
    pendingFish: getPendingQueue(),
  });
  if (prepared.rejectedActiveFish > 0 || prepared.rejectedPendingFish > 0) {
    throw new TypeError("Live fish state contains values that cannot be persisted in a snapshot");
  }
  return { activeFish: prepared.activeFish, pendingFish: prepared.pendingFish };
}

export interface RestoreFishStateResult {
  restoredActiveFish: number;
  restoredPendingFish: number;
  rejectedActiveFish: number;
  rejectedPendingFish: number;
}

export interface RestorePendingFishResult {
  preservedActiveFish: number;
  restoredPendingFish: number;
  rejectedActiveFish: number;
  rejectedPendingFish: number;
}

interface PreparedFishState {
  activeFish: ActiveFish[];
  pendingFish: PendingFish[];
  rejectedActiveFish: number;
  rejectedPendingFish: number;
}

function prepareFishStateSnapshot(snapshot: unknown): PreparedFishState {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.activeFish) || !Array.isArray(snapshot.pendingFish)) {
    throw new TypeError("Invalid aquarium fish snapshot: activeFish and pendingFish arrays are required");
  }
  if (snapshot.activeFish.length > 50_000 || snapshot.pendingFish.length > 50_000) {
    throw new TypeError("Invalid aquarium fish snapshot: too many fish entries");
  }

  const activeFish: ActiveFish[] = [];
  const pendingFish: PendingFish[] = [];
  const seenIds = new Set<string>();
  let rejectedActiveFish = 0;
  let rejectedPendingFish = 0;

  for (const item of snapshot.activeFish) {
    const fish = parseSnapshotActiveFish(item);
    if (!fish || seenIds.has(fish.id)) {
      rejectedActiveFish++;
      continue;
    }
    seenIds.add(fish.id);
    activeFish.push(fish);
  }

  for (const item of snapshot.pendingFish) {
    const fish = parseSnapshotPendingFish(item);
    if (!fish || seenIds.has(fish.id)) {
      rejectedPendingFish++;
      continue;
    }
    seenIds.add(fish.id);
    pendingFish.push(fish);
  }

  return { activeFish, pendingFish, rejectedActiveFish, rejectedPendingFish };
}

/** Validate and count snapshot fish entries without changing live fish or queue state. */
export function validateFishStateSnapshot(snapshot: unknown): RestoreFishStateResult {
  const prepared = prepareFishStateSnapshot(snapshot);
  return {
    restoredActiveFish: prepared.activeFish.length,
    restoredPendingFish: prepared.pendingFish.length,
    rejectedActiveFish: prepared.rejectedActiveFish,
    rejectedPendingFish: prepared.rejectedPendingFish,
  };
}

/** Restore the transient queue while keeping R2-loaded active fish and their latest positions intact. */
export function restorePendingFishFromSnapshot(snapshot: unknown): RestorePendingFishResult {
  const prepared = preparePendingFishSnapshot(snapshot);

  pendingQueue.length = 0;
  for (const fish of prepared.pendingFish) {
    // Editor locks belong to a running browser session, not to durable queue state.
    delete fish.lockedBy;
    pendingQueue.push(fish);
  }

  return {
    preservedActiveFish: activePool.size,
    restoredPendingFish: prepared.pendingFish.length,
    rejectedActiveFish: 0,
    rejectedPendingFish: prepared.rejectedPendingFish,
  };
}

/** Validate only the pending queue that the recovery endpoint actually restores. */
export function validatePendingFishSnapshot(snapshot: unknown): { rejectedPendingFish: number } | null {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.pendingFish) || snapshot.pendingFish.length > 50_000) return null;
  return { rejectedPendingFish: preparePendingFishSnapshot(snapshot).rejectedPendingFish };
}

function preparePendingFishSnapshot(snapshot: unknown): { pendingFish: PendingFish[]; rejectedPendingFish: number } {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.pendingFish) || snapshot.pendingFish.length > 50_000) {
    throw new TypeError("Invalid aquarium pending-fish snapshot");
  }

  const pendingFish: PendingFish[] = [];
  const seenIds = new Set<string>();
  let rejectedPendingFish = 0;
  for (const item of snapshot.pendingFish) {
    const fish = parseSnapshotPendingFish(item);
    if (!fish || seenIds.has(fish.id)) {
      rejectedPendingFish++;
      continue;
    }
    seenIds.add(fish.id);
    pendingFish.push(fish);
  }
  return { pendingFish, rejectedPendingFish };
}

/** Update the image and embedded metadata for a fish that is still being edited. */
export function updatePendingArtwork(fishId: string, imageUrl: string, fishMeta?: FishMeta): PendingFish | null {
  const fish = pendingQueue.find((item) => item.id === fishId);
  if (!fish) return null;
  fish.imageUrl = imageUrl;
  if (fishMeta) fish.fishMeta = fishMeta;
  return fish;
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
    case "custom":
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
  spawnPos: Vector2,
  sourceBuffer?: Buffer,
): ActiveFish {
  // 待機リストから除去
  const pendingIdx = pendingQueue.findIndex((f) => f.id === config.id);
  const createdAt = pendingIdx >= 0 ? pendingQueue[pendingIdx]!.timestamp : config.fishMeta?.createdAt ?? Date.now();
  if (pendingIdx >= 0) pendingQueue.splice(pendingIdx, 1);

  const normalizedType = normalizeFishType(config.type);
  const world = getWorld();
  const releaseSpread = normalizedType === "anchor" ? 0 : Math.min(180, Math.max(60, Math.min(world.width, world.height) * 0.08));
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * releaseSpread;
  const initialPos = {
    x: Math.max(0, Math.min(world.width, spawnPos.x + Math.cos(angle) * radius)),
    y: Math.max(0, Math.min(world.height, spawnPos.y + Math.sin(angle) * radius)),
  };

  const fish: ActiveFish = {
    ...config,
    type: normalizedType,
    timestamp: Date.now(),
    createdAt,
    releasedAt: Date.now(),
    physics: {
      pos: initialPos,
      vel: initialVelForType(normalizedType),
      speedMultiplier: 1.0, // レイヤーマネージャが後から上書きする
    },
    layerIndex: 0,
    targetScale: config.userParams.scale,
    targetOpacity: Math.max(0, Math.min(config.userParams.opacity ?? 1, 1)),
  };

  activePool.set(fish.id, fish);
  updateFishLayers(getAllActiveFish());
  
  // 永続化処理（/data/fish に保存し魚のtextureUrlを差し替える）
  saveActiveFishToDisk(fish, sourceBuffer);
  
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
  updates: Partial<{ scale: number; speed: number; direction: "auto" | "left" | "right"; flipX: boolean; opacity: number; customMotion: ActiveFish["customMotion"]; isPinned: boolean; pinnedLayerId: number; type: FishType; isArchived: boolean }>
): boolean {
  const fish = activePool.get(fishId);
  if (!fish) return false;
  if (updates.scale !== undefined) fish.userParams.scale = updates.scale;
  if (updates.speed !== undefined) fish.userParams.speed = updates.speed;
  if (updates.direction !== undefined) fish.userParams.direction = updates.direction;
  if (updates.flipX !== undefined) fish.userParams.flipX = updates.flipX;
  if (updates.opacity !== undefined) fish.userParams.opacity = Math.max(0, Math.min(updates.opacity, 1));
  if (updates.customMotion !== undefined) {
    const name = typeof updates.customMotion?.name === "string" ? updates.customMotion.name.slice(0, 80) : "";
    const code = typeof updates.customMotion?.code === "string" ? updates.customMotion.code.slice(0, 20_000) : "";
    fish.customMotion = name && code ? { name, code } : undefined;
  }
  if (updates.isPinned !== undefined) fish.isPinned = updates.isPinned;
  if (updates.isPinned === false) fish.pinnedLayerId = undefined;
  if (updates.pinnedLayerId !== undefined) fish.pinnedLayerId = updates.pinnedLayerId;
  if (updates.type !== undefined) fish.type = normalizeFishType(updates.type);
  if (updates.isArchived !== undefined) {
    fish.isArchived = updates.isArchived;
    fish.archivedAt = updates.isArchived ? Date.now() : undefined;
  }
  updateFishLayers(getAllActiveFish());
  
  updateActiveFishOnDisk(fish);
  return true;
}

export function multiplyAllFishParams(scaleMultiplier: number, speedMultiplier: number): number {
  // UIの絶対倍率を差分比率で受けるため、3→0.1 のような操作では 0.033... も許容する。
  const safeScaleMultiplier = Math.max(0.01, Math.min(scaleMultiplier, 100));
  const safeSpeedMultiplier = Math.max(0.01, Math.min(speedMultiplier, 100));

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
    createdAt: Date.now(),
    releasedAt: Date.now(),
    archivedAt: undefined,
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

  // 魚の配列順序をランダムにシャッフル（Fisher-Yatesシャッフル）
  // これにより、再配置の際に同系統の魚や同じ作者の魚が特定の場所に固まるのを防ぐ
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fish[i], fish[j]] = [fish[j], fish[i]];
  }

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
    const metadataIndex = loadFishMetadataIndex();
    const files = metadataIndex
      ? Object.keys(metadataIndex)
      : readdirSync(DATA_FISH_DIR).filter(f => f.toLowerCase().endsWith(".png"));
    const checkpointPath = join(DATA_FISH_DIR, "..", "fish-positions.json");
    let checkpointFish: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    try {
      const checkpoint = JSON.parse(readFileSync(checkpointPath, "utf-8")) as {
        savedAt?: number;
        fish?: Record<string, { x?: number; y?: number; vx?: number; vy?: number }>;
      };
      const isRecent = Number.isFinite(checkpoint.savedAt) && Date.now() - Number(checkpoint.savedAt) < 30 * 24 * 60 * 60 * 1000;
      if (isRecent && checkpoint.fish && typeof checkpoint.fish === "object") {
        checkpointFish = Object.fromEntries(Object.entries(checkpoint.fish).flatMap(([id, position]) => {
          if ([position.x, position.y, position.vx, position.vy].every(Number.isFinite)) {
            return [[id, { x: position.x!, y: position.y!, vx: position.vx!, vy: position.vy! }]];
          }
          return [];
        }));
      }
    } catch {
      // Position snapshots are optional; older installs and an empty R2 bucket spawn normally.
    }
    let restoredCount = 0;
    for (const file of files) {
      const filePath = join(DATA_FISH_DIR, file);
      const fishId = file.replace(/\.png$/i, "");

      // 既に泳いでいる魚はスキップ（再読み込み時の重複防止）
      if (activePool.has(fishId)) continue;

      try {
        let meta: FishMeta;
        const jsonPath = join(DATA_FISH_DIR, `${fishId}.json`);

        if (metadataIndex) {
          meta = { ...DEFAULT_FISH_META, ...metadataIndex[file] };
        // JSONキャッシュがあればそれを読み込み、PNG解析に伴う大量のBuffer確保を回避する
        } else if (existsSync(jsonPath)) {
          meta = JSON.parse(readFileSync(jsonPath, "utf-8"));
        } else {
          const buf = readFileSync(filePath) as Buffer;
          meta = readFishMeta(buf) ?? { ...DEFAULT_FISH_META };
          try {
            writeFileSync(jsonPath, JSON.stringify(meta, null, 2), "utf-8");
          } catch (err) {
            console.error(`[FishManager] Failed to create json cache for ${fishId}:`, err);
          }
        }

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
        const savedPosition = checkpointFish[fishId];
        const position = savedPosition
          ? {
            x: Math.max(0, Math.min(ww, savedPosition.x)),
            y: Math.max(0, Math.min(wh, savedPosition.y)),
          }
          : sp;
        const velocity = savedPosition
          ? { x: savedPosition.vx, y: savedPosition.vy }
          : initialVelForType(normalizeFishType(meta.type));

        const fish: ActiveFish = {
          id: fishId,
          textureUrl: `/lib-images/${file}`,
          timestamp: Date.now() + restoredCount,
          createdAt: meta.createdAt ?? Date.now(),
          releasedAt: meta.releasedAt ?? Date.now(),
          archivedAt: meta.archivedAt,
          type: normalizeFishType(meta.type),
          author: meta.author,
          fishMeta: meta,
          userParams: {
            scale: meta.scale,
            speed: meta.speed,
            rotationOffset: 0,
            direction: meta.direction ?? "auto",
            flipX: meta.flipX ?? false,
            opacity: meta.opacity ?? 1,
          },
          customMotion: meta.customMotion,
          physics: {
            pos: position,
            vel: velocity,
            speedMultiplier: 1.0,
          },
          layerIndex: 0,
          targetScale: meta.scale,
          targetOpacity: Math.max(0, Math.min(meta.opacity ?? 1, 1)),
          isPinned: meta.pinnedLayerId !== null && meta.pinnedLayerId !== undefined,
          pinnedLayerId: meta.pinnedLayerId ?? undefined,
          isArchived: meta.isArchived ?? false,
        };
        activePool.set(fish.id, fish);
        if (!meta.createdAt || !meta.releasedAt || (meta.isArchived && !meta.archivedAt)) {
          updateActiveFishOnDisk(fish);
        }
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
