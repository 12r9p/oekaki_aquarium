import type { Context } from "hono";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import sharp from "sharp";
import { addToPending } from "../fish-manager";
import { broadcastToAll } from "../ws-handler";
import { writeFishMeta, readFishMeta, DEFAULT_FISH_META, type FishMeta } from "../png-metadata";

// POST /api/scan
// スキャナーノード(Python) またはフロントエンドから画像を受け取り pendingQueue に追加する。
// JSON ボディの `meta` フィールドに FishMeta が含まれていれば PNG tEXt チャンクに埋め込む。
export async function scanRoute(c: Context): Promise<Response> {
  const PUBLIC_DIR = join(import.meta.dir, "..", "public", "images");

  const contentType = c.req.header("content-type") || "";
  let imageUrl: string | null = null;
  let filename = `fish_${Date.now()}.png`;
  let embeddedMeta: FishMeta | undefined;

  if (contentType.includes("application/json")) {
    const body = await c.req.json();

    // imageUrl直指定モード: ギャラリー・ライブラリからの追加で使う（外部URLはそのまま）
    if (body.imageUrl) {
      imageUrl = body.imageUrl as string;
      // 外部URLの場合はメタ埋め込みをスキップ（ローカルファイルでないため）
    } else if (body.image) {
      // base64 画像データモード: ファイルに保存してメタを埋め込む
      const base64Data = (body.image as string).replace(/^data:image\/\w+;base64,/, "");
      let fileData = Buffer.from(base64Data, "base64") as Buffer;
      if (!isPng(fileData)) fileData = await sharp(fileData).png().toBuffer();

      // meta フィールドがあれば PNG tEXt チャンクに埋め込む
      if (body.meta) {
        try {
          const meta: FishMeta = { ...DEFAULT_FISH_META, ...body.meta };
          fileData = writeFishMeta(fileData, meta);
          embeddedMeta = meta;
        } catch (e) {
          console.warn("[Scan] Failed to write meta to PNG:", e);
        }
      }

      const filePath = join(PUBLIC_DIR, filename);
      await Bun.write(filePath, fileData);
      imageUrl = `/images/${filename}`;
    } else {
      return c.json({ error: "No image provided" }, 400);
    }
  } else {
    // multipart/form-data モード（Python スキャナーからの送信など）
    const formData = await c.req.formData();
    const file = formData.get("image") as File | null;
    if (!file) {
      return c.json({ error: "No image file provided" }, 400);
    }
    let fileData = Buffer.from(await file.arrayBuffer()) as Buffer;
    embeddedMeta = readFishMeta(fileData) ?? undefined;
    const autoProcess = formData.get("autoProcess") === "true";
    fileData = autoProcess
      ? await normalizeControllerPhoto(fileData)
      : (!isPng(fileData) ? await sharp(fileData).rotate().png().toBuffer() : fileData);

    // form data に meta フィールドがあれば埋め込む
    const metaRaw = formData.get("meta");
    if (metaRaw && typeof metaRaw === "string") {
      try {
        const meta: FishMeta = { ...DEFAULT_FISH_META, ...JSON.parse(metaRaw) };
        fileData = writeFishMeta(fileData, meta);
        embeddedMeta = meta;
      } catch (e) {
        console.warn("[Scan] Failed to write meta to PNG (formdata):", e);
      }
    }

    const filePath = join(PUBLIC_DIR, filename);
    await Bun.write(filePath, fileData);
    imageUrl = `/images/${filename}`;
  }

  if (!imageUrl) return c.json({ error: "Failed to process image" }, 500);

  const pendingFish = addToPending(imageUrl, embeddedMeta);

  // コントローラー・管理画面へリアルタイム通知
  broadcastToAll({ event: "fish_added", fish: pendingFish });

  console.log(`[Scan] New fish added: ${pendingFish.id} → ${imageUrl}`);
  return c.json({ success: true, fish: pendingFish });
}

function isPng(data: Buffer): boolean {
  return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

/**
 * Controller のカメラ画像向け前処理。
 * 明るく低彩度な用紙背景だけを透過し、透明余白を切り抜いて長辺を揃える。
 */
async function normalizeControllerPhoto(data: Buffer): Promise<Buffer> {
  const { data: pixels, info } = await sharp(data)
    .rotate()
    .ensureAlpha()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i]!;
    const g = pixels[i + 1]!;
    const b = pixels[i + 2]!;
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    if (brightness > 238 && saturation < 24) {
      pixels[i + 3] = 0;
    }
  }

  return sharp(pixels, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
}
