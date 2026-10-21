// ============================================================
// fish-library.ts — /data/fish/ ディレクトリから魚ライブラリをスキャン
//
// PNG tEXtチャンクからメタデータを読み出し、管理画面に一覧を提供する。
// 静的ファイルとして /lib-images/:filename で公開される。
// ============================================================

import { join } from "node:path";
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { readFishMeta, DEFAULT_FISH_META, type FishMeta } from "./png-metadata";
import { Buffer } from "node:buffer";
import { readPersistedR2Object } from "./r2-persistence";

/** ライブラリエントリ: 管理画面への公開データ */
export interface LibraryEntry {
  /** ファイル名 (例: "nemo.png") */
  filename: string;
  /** フロントエンドからアクセスできるURL */
  imageUrl: string;
  /** PNGに埋め込まれたメタデータ (なければデフォルト値) */
  meta: FishMeta;
}

/** /data/fish/ ディレクトリのパス（プロジェクトルート基準） */
// import.meta.dir = packages/server/src → ../../.. でプロジェクトルート
export const DATA_FISH_DIR = join(import.meta.dir, "..", "..", "..", "data", "fish");
export const FISH_METADATA_INDEX_PATH = join(DATA_FISH_DIR, "library-index.json");

/** ライブラリファイルを配信する URL プレフィックス */
export const LIB_URL_PREFIX = "/lib-images";

/** Read the compact metadata index restored from R2 at container startup. */
export function loadFishMetadataIndex(): Record<string, FishMeta> | null {
  try {
    const parsed = JSON.parse(readFileSync(FISH_METADATA_INDEX_PATH, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed).filter(([filename, meta]) =>
      /^[\w.-]+\.png$/i.test(filename) && !!meta && typeof meta === "object" && !Array.isArray(meta),
    ) as Array<[string, FishMeta]>;
    return Object.fromEntries(entries);
  } catch {
    return null;
  }
}

function writeFishMetadataIndex(index: Record<string, FishMeta>): void {
  mkdirSync(DATA_FISH_DIR, { recursive: true });
  const temporaryPath = `${FISH_METADATA_INDEX_PATH}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(index));
  renameSync(temporaryPath, FISH_METADATA_INDEX_PATH);
}

export function upsertFishMetadataIndex(filename: string, meta: FishMeta): void {
  if (!/^[\w.-]+\.png$/i.test(filename)) return;
  const index = loadFishMetadataIndex() ?? {};
  index[filename] = meta;
  writeFishMetadataIndex(index);
}

export function removeFishMetadataIndex(filename: string): void {
  const index = loadFishMetadataIndex();
  if (!index || !Object.hasOwn(index, filename)) return;
  delete index[filename];
  writeFishMetadataIndex(index);
}

/** Build the R2 startup index from local sidecar metadata before one-time seeding. */
export function rebuildFishMetadataIndexFromDisk(): number {
  mkdirSync(DATA_FISH_DIR, { recursive: true });
  const index: Record<string, FishMeta> = {};
  for (const filename of readdirSync(DATA_FISH_DIR)) {
    if (!filename.toLowerCase().endsWith(".json") || filename === "library-index.json") continue;
    try {
      const meta = JSON.parse(readFileSync(join(DATA_FISH_DIR, filename), "utf-8")) as FishMeta;
      if (meta && typeof meta === "object" && !Array.isArray(meta)) {
        index[`${filename.slice(0, -5)}.png`] = meta;
      }
    } catch (error) {
      console.error(`[Library] Could not read fish metadata sidecar ${filename}:`, error);
    }
  }
  for (const filename of readdirSync(DATA_FISH_DIR).filter((name) => name.toLowerCase().endsWith(".png"))) {
    if (index[filename]) continue;
    try {
      const meta = readFishMeta(readFileSync(join(DATA_FISH_DIR, filename)) as Buffer);
      if (meta) index[filename] = meta;
    } catch (error) {
      console.error(`[Library] Could not read fish image metadata ${filename}:`, error);
    }
  }
  writeFishMetadataIndex(index);
  return Object.keys(index).length;
}

/**
 * DATA_FISH_DIR を作成して全 PNG ファイルを読み込む。
 * サーバー起動時またはリロード時に呼び出す。
 */
export function loadFishLibrary(): LibraryEntry[] {
  // /data/fish/ が存在しなければ作成
  if (!existsSync(DATA_FISH_DIR)) {
    mkdirSync(DATA_FISH_DIR, { recursive: true });
    console.log(`[Library] Created /data/fish/ directory: ${DATA_FISH_DIR}`);
  }

  const metadataIndex = loadFishMetadataIndex();
  if (metadataIndex) {
    const entries = Object.entries(metadataIndex).map(([filename, meta]) => ({
      filename,
      imageUrl: `${LIB_URL_PREFIX}/${encodeURIComponent(filename)}`,
      meta: { ...DEFAULT_FISH_META, ...meta },
    }));
    console.log(`[Library] Loaded ${entries.length} fish from the metadata index.`);
    return entries;
  }

  let files: string[];
  try {
    files = readdirSync(DATA_FISH_DIR).filter(f => f.toLowerCase().endsWith(".png"));
  } catch (e) {
    console.error("[Library] Failed to read /data/fish/:", e);
    return [];
  }

  const entries: LibraryEntry[] = [];
  for (const filename of files) {
    const filePath = join(DATA_FISH_DIR, filename);
    try {
      const buf = readFileSync(filePath);
      const meta = readFishMeta(buf as Buffer) ?? { ...DEFAULT_FISH_META };
      entries.push({
        filename,
        imageUrl: `${LIB_URL_PREFIX}/${encodeURIComponent(filename)}`,
        meta,
      });
    } catch (e) {
      console.error(`[Library] Failed to read ${filename}:`, e);
    }
  }

  console.log(`[Library] Loaded ${entries.length} fish from /data/fish/`);
  return entries;
}

/** 特定ファイルの Buffer を返す */
export function getLibraryFileBuffer(filename: string): Buffer | null {
  if (!/^[\w.-]+\.png$/i.test(filename)) return null;
  const filePath = join(DATA_FISH_DIR, filename);
  try {
    return readFileSync(filePath) as Buffer;
  } catch {
    return null;
  }
}

/** Read a library image locally first, then fetch it from the R2 bridge. */
export async function getLibraryFileBufferAsync(filename: string): Promise<Buffer | null> {
  if (!/^[\w.-]+\.png$/i.test(filename)) return null;
  const local = getLibraryFileBuffer(filename);
  if (local) return local;
  const remote = await readPersistedR2Object(`data/fish/${filename}`);
  return remote ? Buffer.from(remote) : null;
}
