// ============================================================
// shared/cutout/browser.ts
// 写真ファイルを読み込んで切り抜き、アップロード用の PNG にする（ブラウザー専用）
// ============================================================

import { cutOutDrawing } from "./cutout";
import type { RgbaImage } from "./raster";

/** 切り抜きの判定に使う画像の長辺。大きいほど細部が残るが処理が遅くなる。 */
const ANALYSIS_MAX_SIDE = 1600;
/** アップロードする絵の長辺の上限（サーバーの取り込み処理と揃える） */
const OUTPUT_MAX_SIDE = 1024;

export interface PreparedFishUpload {
  file: Blob;
  filename: string;
  /** サーバー側の白背景除去（autoProcess）に任せるか */
  serverAutoProcess: boolean;
}

/**
 * 写真から絵を切り抜いた PNG を返す。
 * 切り抜き済みの PNG はそのまま返す。紙や絵が見つからない写真と、読み込めない形式は、
 * 従来どおりサーバーの白背景除去に任せる。
 */
export async function prepareFishUpload(file: File): Promise<PreparedFishUpload> {
  let source: RgbaImage;
  try {
    source = await decodeImage(file, ANALYSIS_MAX_SIDE);
  } catch (error) {
    console.warn("[Cutout] Could not decode image; falling back to server processing:", error);
    return { file, filename: file.name, serverAutoProcess: true };
  }

  const result = cutOutDrawing(source);
  if (result.kind === "skipped") {
    console.info(`[Cutout] Skipped (${result.reason}): ${file.name}`);
    return { file, filename: file.name, serverAutoProcess: result.reason !== "transparent" };
  }

  const png = await encodePng(result.image, OUTPUT_MAX_SIDE);
  return { file: png, filename: `${file.name.replace(/\.[^.]+$/, "")}.png`, serverAutoProcess: false };
}

/** 画像を長辺 maxSide 以下に縮小して画素を取り出す。写真の向き（EXIF）はブラウザーが反映する。 */
async function decodeImage(file: Blob, maxSide: number): Promise<RgbaImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = createContext(width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return { width, height, data: ctx.getImageData(0, 0, width, height).data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 画素を PNG にする。長辺が maxSide を超える場合は縮小する。 */
async function encodePng(image: RgbaImage, maxSide: number): Promise<Blob> {
  const source = createContext(image.width, image.height);
  const pixels = source.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  source.putImageData(pixels, 0, 0);

  let canvas = source.canvas;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (scale < 1) {
    const resized = createContext(Math.round(image.width * scale), Math.round(image.height * scale));
    resized.imageSmoothingQuality = "high";
    resized.drawImage(source.canvas, 0, 0, resized.canvas.width, resized.canvas.height);
    canvas = resized.canvas;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encoding failed"))), "image/png");
  });
}

function createContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  return ctx;
}
