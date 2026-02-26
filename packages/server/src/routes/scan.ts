import type { Context } from "hono";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { addToPending } from "../fish-manager";
import { broadcastToAll } from "../ws-handler";

// POST /api/scan
// スキャナーノード(Python)から画像を受け取り、pendingQueueに追加する
export async function scanRoute(c: Context): Promise<Response> {
  const PUBLIC_DIR = join(import.meta.dir, "..", "public", "images");

  const contentType = c.req.header("content-type") || "";
  let fileData: ArrayBuffer | Uint8Array;
  let filename = `fish_${Date.now()}.png`;

  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    if (!body.image) return c.json({ error: "No image provided" }, 400);
    const base64Data = body.image.replace(/^data:image\/\w+;base64,/, "");
    fileData = Buffer.from(base64Data, "base64");
  } else {
    const formData = await c.req.formData();
    const file = formData.get("image") as File | null;
    if (!file) {
      return c.json({ error: "No image file provided" }, 400);
    }
    fileData = await file.arrayBuffer();
  }

  const filePath = join(PUBLIC_DIR, filename);

  // 保存
  await Bun.write(filePath, fileData);

  const imageUrl = `/images/${filename}`;
  const pendingFish = addToPending(imageUrl);

  // iPad コントローラーへリアルタイム通知
  broadcastToAll({ event: "fish_added", fish: pendingFish });

  console.log(`[Scan] New fish added: ${pendingFish.id} → ${imageUrl}`);
  return c.json({ success: true, fish: pendingFish });
}
