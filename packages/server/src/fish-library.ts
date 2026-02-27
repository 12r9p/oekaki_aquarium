// ============================================================
// fish-library.ts — /data/fish/ ディレクトリから魚ライブラリをスキャン
//
// PNG tEXtチャンクからメタデータを読み出し、管理画面に一覧を提供する。
// 静的ファイルとして /lib-images/:filename で公開される。
// ============================================================

import { join } from "node:path";
import { readdirSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { readFishMeta, DEFAULT_FISH_META, type FishMeta } from "./png-metadata";
import { Buffer } from "node:buffer";

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

/** ライブラリファイルを配信する URL プレフィックス */
export const LIB_URL_PREFIX = "/lib-images";

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
  const filePath = join(DATA_FISH_DIR, filename);
  try {
    return readFileSync(filePath) as Buffer;
  } catch {
    return null;
  }
}
