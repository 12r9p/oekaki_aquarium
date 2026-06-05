// ============================================================
// png-metadata.ts — PNG tEXt チャンクのread/write ユーティリティ
//
// PNG仕様に基づく純粋なBuffer操作（追加ライブラリ不要）。
// キー名 "AquariumFish" に JSON シリアライズした FishMeta を保存する。
// ============================================================

import { Buffer } from "node:buffer";
import type { FishDirection, FishType } from "@aquarium/shared";

// PNG ファイルシグネチャ (8バイト)
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// メタデータキー名 (PNG tEXt の Keyword)
export const FISH_META_KEY = "AquariumFish";

// ============================================================
// FishMeta 型定義 (shared/types.ts にも mirror する)
// ============================================================
export interface FishMeta {
  /** フォーマットバージョン (将来の互換性のため) */
  version: number;
  /** 作成者名 */
  author: string;
  /** 泳ぎ方タイプ */
  type: FishType;
  /** 速度倍率 (1.0 = 標準) */
  speed: number;
  /** 表示スケール (1.0 = 標準) */
  scale: number;
  /** レイヤー固定 ID (null = 固定なし) */
  pinnedLayerId: number | null;
  /** タグ */
  tags: string[];
  /** アーカイブ状態 */
  isArchived?: boolean;
  direction?: FishDirection;
  createdAt?: number;
  releasedAt?: number;
  archivedAt?: number;
}

export const DEFAULT_FISH_META: FishMeta = {
  version: 1,
  author: "anonymous",
  type: "school",
  speed: 1.0,
  scale: 1.0,
  pinnedLayerId: null,
  tags: [],
  isArchived: false,
  direction: "auto",
};

// ============================================================
// CRC32 実装 (PNG チャンク検証に必要)
// ============================================================
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array, start = 0, end = buf.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]!) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================
// PNG チャンク解析ユーティリティ
// ============================================================
interface PngChunk {
  type: string;
  data: Buffer;
  offset: number; // ファイル内の位置（4バイトlength+4バイトtype後の dataオフセット）
}

function parseChunks(buf: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let pos = 8; // PNG シグネチャの後から

  while (pos < buf.length - 12) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const dataStart = pos + 8;
    const data = buf.slice(dataStart, dataStart + length);
    chunks.push({ type, data, offset: pos });
    pos += 12 + length; // 4(len) + 4(type) + length(data) + 4(crc)
    if (type === "IEND") break;
  }

  return chunks;
}

// ============================================================
// tEXt チャンクの作成
// ============================================================
function buildTextChunk(key: string, value: string): Buffer {
  const keyBuf = Buffer.from(key, "latin1");
  const valBuf = Buffer.from(value, "utf8");

  // data = key + 0x00 + value
  const data = Buffer.concat([keyBuf, Buffer.from([0]), valBuf]);

  const typeBuf = Buffer.from("tEXt", "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcInput);

  const lenBuf = Buffer.allocUnsafe(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// ============================================================
// 公開API
// ============================================================

/**
 * PNG Buffer から FishMeta を読み出す。
 * tEXt チャンク（キー = FISH_META_KEY）が存在しない場合は null を返す。
 */
export function readFishMeta(pngBuffer: Buffer): FishMeta | null {
  if (!pngBuffer.slice(0, 8).equals(PNG_SIG)) return null; // PNG でなければスキップ

  try {
    const chunks = parseChunks(pngBuffer);
    for (const chunk of chunks) {
      if (chunk.type !== "tEXt") continue;

      // tEXt data = keyword\0text
      const nullIdx = chunk.data.indexOf(0);
      if (nullIdx < 0) continue;

      const key = chunk.data.slice(0, nullIdx).toString("ascii");
      if (key !== FISH_META_KEY) continue;

      const json = chunk.data.slice(nullIdx + 1).toString("utf8");
      return { ...DEFAULT_FISH_META, ...JSON.parse(json) } as FishMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * PNG Buffer に FishMeta を書き込んで新しい Buffer を返す。
 * 既存の FISH_META_KEY の tEXt チャンクを置換、なければ IHDR 直後に挿入する。
 */
export function writeFishMeta(pngBuffer: Buffer, meta: FishMeta): Buffer {
  if (!pngBuffer.slice(0, 8).equals(PNG_SIG)) {
    throw new Error("Not a valid PNG file");
  }

  const textChunk = buildTextChunk(FISH_META_KEY, JSON.stringify(meta));
  const newParts: Buffer[] = [PNG_SIG];
  let metaInserted = false;
  let existingMetaRemoved = false;

  let pos = 8;
  while (pos < pngBuffer.length - 12) {
    const length = pngBuffer.readUInt32BE(pos);
    const type = pngBuffer.toString("ascii", pos + 4, pos + 8);
    const chunkTotal = 12 + length;
    const chunkBuf = pngBuffer.slice(pos, pos + chunkTotal);

    if (type === "tEXt") {
      // 既存の FISH_META_KEY チャンクは削除
      const nullIdx = chunkBuf.indexOf(0, 8);
      if (nullIdx >= 0) {
        const key = chunkBuf.slice(8, nullIdx).toString("ascii");
        if (key === FISH_META_KEY) {
          existingMetaRemoved = true;
          pos += chunkTotal;
          continue;
        }
      }
    }

    newParts.push(chunkBuf);

    // IHDR の直後にメタを挿入（まだ挿入していなければ）
    if (type === "IHDR" && !metaInserted) {
      newParts.push(textChunk);
      metaInserted = true;
    }

    pos += chunkTotal;
    if (type === "IEND") break;
  }

  if (!metaInserted) newParts.push(textChunk); // IHDRが見つからなかった場合のフォールバック

  return Buffer.concat(newParts);
}
