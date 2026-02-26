import type { Context } from "hono";
import { join } from "node:path";
import { addToPending } from "../fish-manager";
import { broadcastToAll } from "../ws-handler";

// POST /api/scan
// スキャナーノード(Python)から画像を受け取り、pendingQueueに追加する
export async function scanRoute(c: Context): Promise<Response> {
  const PUBLIC_DIR = join(import.meta.dir, "..", "public", "images");

  const formData = await c.req.formData();
  const file = formData.get("image") as File | null;

  if (!file) {
    return c.json({ error: "No image file provided" }, 400);
  }

  // ファイル名として現在時刻を使用
  const filename = `fish_${Date.now()}.png`;
  const filePath = join(PUBLIC_DIR, filename);

  // 保存
  const arrayBuffer = await file.arrayBuffer();
  await Bun.write(filePath, arrayBuffer);

  const imageUrl = `/images/${filename}`;
  const pendingFish = addToPending(imageUrl);

  // iPad コントローラーへリアルタイム通知
  broadcastToAll({ event: "fish_added", fish: pendingFish });

  console.log(`[Scan] New fish added: ${pendingFish.id} → ${imageUrl}`);
  return c.json({ success: true, fish: pendingFish });
}
