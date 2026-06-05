import { Hono } from "hono";
import { serve } from "bun";
import { cors } from "hono/cors";
import { join } from "node:path";
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { Buffer } from "node:buffer";
import { LAYER_CONFIG, PORTS } from "@aquarium/shared";
import type { FishConfig, FishType, LayerConfig } from "@aquarium/shared";
import sharp from "sharp";
import { unzipSync, zipSync } from "fflate";
import { startGameLoop } from "./game-loop";
import { resetAquariumMotionPosition } from "./physics/aquarium-motion";
import {
  wsHandlers,
  startHeartbeatWatcher,
  broadcastToAll,
  getDisplayClientInfoList,
  updateDisplayViewport,
  sendTestPattern,
  pushClientListToManagers,
  getScene,
  addSceneObject,
  updateSceneObject,
  deleteSceneObject,
} from "./ws-handler";

import { scanRoute } from "./routes/scan";
import { pendingRoute, lockRoute, unlockRoute } from "./routes/pending";
import { releaseRoute } from "./routes/release";
import { pinRoute } from "./routes/pin";
import {
  addToPending,
  getAllActiveFish,
  getActiveFish,
  getPendingQueue,
  releaseFish,
  restoreActiveFishFromDisk,
  removeFish,
  updateFishParams,
  removePendingFish,
  duplicateFish,
  redistributeFish,
} from "./fish-manager";
import { getWorld, updateFishLayerConfig, updateWorldMotionSettings } from "./world";
import { loadFishLibrary, getLibraryFileBuffer, DATA_FISH_DIR } from "./fish-library";
import { readFishMeta, writeFishMeta, DEFAULT_FISH_META } from "./png-metadata";
import { updatePersistedSettings } from "./settings-store";
import { updateFishLayers } from "./layer-manager";
import { getSystemMetrics } from "./system-metrics";

// ============================================================
// サーバーエントリーポイント（Bun 単一ポート統合版）
//
// ポート 3000 で以下を全て提供:
//   GET  /display, /controller, /guest, /manage → Vite MPA の HTML
//   GET  /api/*       → REST API
//   GET  /images/*    → 魚の画像ファイル
//   WS   /ws          → Bun ネイティブ WebSocket
// ============================================================

const PUBLIC_IMAGES_DIR = join(import.meta.dir, "public", "images");
const SCENE_IMAGES_DIR = join(PUBLIC_IMAGES_DIR, "scene");
const APP_DIR = join(import.meta.dir, "..", "public", "app");
mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true });
mkdirSync(SCENE_IMAGES_DIR, { recursive: true });
mkdirSync(DATA_FISH_DIR, { recursive: true }); // /data/fish/ を初期化

const app = new Hono();
app.use("*", cors({ origin: "*" }));

// ---- REST API -----------------------------------------------
app.post("/api/scan",           scanRoute);
app.get("/api/pending",         pendingRoute);
app.post("/api/pending/lock",   lockRoute);
app.post("/api/pending/unlock", unlockRoute);
app.post("/api/release",        releaseRoute);
app.post("/api/fish/:id/pin",   pinRoute);

// 魚削除（管理画面用）
app.delete("/api/fish/all", (c) => {
  const all = getAllActiveFish();
  for (const f of all) removeFish(f.id);
  broadcastToAll({ event: "reload" });
  return c.json({ success: true, removed: all.length });
});
app.delete("/api/fish/:id", (c) => {
  const ok = removeFish(c.req.param("id"));
  pushClientListToManagers(); // 管理画面へ通知
  return c.json({ success: ok });
});

// 魚のプロパティ更新 (スケール, 速度, アーカイブ等)
app.put("/api/fish/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json();
  const ok = updateFishParams(id, updates);
  if (ok) {
    pushClientListToManagers();
    broadcastToAll({ event: "reload" }); // 表示・非表示が切り替わるためリロード（またはWSパケットで除外）
  }
  return c.json({ success: ok });
});

app.put("/api/fish-scale-multiplier", async (c) => {
  const body = await c.req.json<{ value?: number }>();
  updateWorldMotionSettings(undefined, undefined, Number.isFinite(body.value) ? body.value : undefined);
  updateFishLayers(getAllActiveFish());
  const w = getWorld();
  updatePersistedSettings({
    world: {
      width: w.width,
      height: w.height,
      forbiddenZones: w.forbiddenZones,
      spawnPoints: w.spawnPoints,
      layers: w.layers,
      horizontalBoundaryMode: w.horizontalBoundaryMode,
      fishSpeedMultiplier: w.fishSpeedMultiplier,
      fishScaleMultiplier: w.fishScaleMultiplier,
      motionSettings: w.motionSettings,
    },
  });
  pushClientListToManagers();
  return c.json({ success: true, fishScaleMultiplier: w.fishScaleMultiplier });
});

app.put("/api/fish-global-multipliers", async (c) => {
  const body = await c.req.json<{ scale?: number; speed?: number }>();
  updateWorldMotionSettings(
    undefined,
    Number.isFinite(body.speed) ? body.speed : undefined,
    Number.isFinite(body.scale) ? body.scale : undefined,
  );
  updateFishLayers(getAllActiveFish());
  const w = getWorld();
  updatePersistedSettings({
    world: {
      width: w.width,
      height: w.height,
      forbiddenZones: w.forbiddenZones,
      spawnPoints: w.spawnPoints,
      layers: w.layers,
      horizontalBoundaryMode: w.horizontalBoundaryMode,
      fishSpeedMultiplier: w.fishSpeedMultiplier,
      fishScaleMultiplier: w.fishScaleMultiplier,
      motionSettings: w.motionSettings,
    },
  });
  pushClientListToManagers();
  return c.json({ success: true, fishScaleMultiplier: w.fishScaleMultiplier, fishSpeedMultiplier: w.fishSpeedMultiplier });
});

// 魚の複製
app.post("/api/fish/:id/duplicate", (c) => {
  const id = c.req.param("id");
  const newFish = duplicateFish(id);
  if (newFish) {
    pushClientListToManagers();
    broadcastToAll({ event: "reload" });
  }
  return c.json({ success: !!newFish, fish: newFish });
});

// 魚をworld全体に均等再散布（worldサイズ変更後の偏り解消用）
app.post("/api/fish/redistribute", (c) => {
  const count = redistributeFish();
  return c.json({ success: true, redistributed: count });
});

app.put("/api/fish-layers", async (c) => {
  const { layers } = await c.req.json<{ layers: LayerConfig[] }>();
  updateFishLayerConfig(layers);
  updateFishLayers(getAllActiveFish());
  updatePersistedSettings({ fishLayers: LAYER_CONFIG });
  pushClientListToManagers();
  return c.json({ success: true, layers: LAYER_CONFIG });
});

app.post("/api/fish/import", async (c) => {
  const form = await c.req.formData();
  const uploads = form.getAll("files").filter((value): value is File => value instanceof File);
  const imageFiles: Array<{ name: string; data: Uint8Array }> = [];
  for (const upload of uploads) {
    const data = new Uint8Array(await upload.arrayBuffer());
    if (upload.name.toLowerCase().endsWith(".zip")) {
      for (const [name, contents] of Object.entries(unzipSync(data))) {
        if (/\.(png|jpe?g|webp)$/i.test(name)) imageFiles.push({ name, data: contents });
      }
    } else if (/\.(png|jpe?g|webp)$/i.test(upload.name)) {
      imageFiles.push({ name: upload.name, data });
    }
  }

  const imported: string[] = [];
  for (const image of imageFiles) {
    const png = await sharp(image.data).png().toBuffer();
    const meta = image.name.toLowerCase().endsWith(".png") ? readFishMeta(Buffer.from(image.data)) : undefined;
    const tempName = `import_${crypto.randomUUID()}.png`;
    const tempPath = join(PUBLIC_IMAGES_DIR, tempName);
    await Bun.write(tempPath, png);
    const pending = addToPending(`/images/${tempName}`, meta ?? undefined);
    const world = getWorld();
    const spawn = world.spawnPoints[0] ?? { x: world.width / 2, y: world.height / 2 };
    const config: FishConfig = {
      id: pending.id,
      type: meta?.type ?? "school",
      textureUrl: pending.imageUrl,
      author: meta?.author ?? image.name.replace(/\.[^.]+$/, ""),
      fishMeta: meta ?? undefined,
      userParams: {
        scale: meta?.scale ?? 1,
        speed: meta?.speed ?? 1,
        rotationOffset: 0,
        direction: meta?.direction ?? "auto",
        flipX: meta?.flipX ?? false,
        opacity: meta?.opacity ?? 1,
      },
      customMotion: meta?.customMotion,
      isPinned: meta?.pinnedLayerId !== null && meta?.pinnedLayerId !== undefined,
      pinnedLayerId: meta?.pinnedLayerId ?? undefined,
    };
    const fish = releaseFish(config, spawn);
    imported.push(fish.id);
    if (await Bun.file(tempPath).exists()) unlinkSync(tempPath);
  }
  pushClientListToManagers();
  broadcastToAll({ event: "reload" });
  return c.json({ success: true, imported: imported.length });
});

app.get("/api/fish/export", (c) => {
  const files: Record<string, Uint8Array> = {};
  for (const fish of getAllActiveFish().filter(item => !item.isArchived)) {
    const path = join(DATA_FISH_DIR, `${fish.id}.png`);
    try {
      files[`${fish.id}.png`] = new Uint8Array(readFileSync(path));
    } catch {
      // Skip fish whose persisted image is unavailable.
    }
  }
  return new Response(zipSync(files, { level: 6 }), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="aquarium-fish.zip"',
    },
  });
});

app.post("/api/clients/reload-images", (c) => {
  broadcastToAll({ event: "reload_images" });
  return c.json({ success: true });
});

// 待機中（Pending）魚の削除
app.delete("/api/pending/:id", (c) => {
  const ok = removePendingFish(c.req.param("id"));
  if (ok) pushClientListToManagers();
  return c.json({ success: ok });
});

// Viewport 設定（display クライアントのViewportをサーバー側に保持しつつ更新）
app.put("/api/clients/:uuid/viewport", async (c) => {
  // クライアント側で encodeURIComponent されているため、ここでデコードして元のUUIDに戻す
  const uuid = decodeURIComponent(c.req.param("uuid"));
  const vp = await c.req.json();
  const ok = updateDisplayViewport(uuid, vp);
  return c.json({ success: ok });
});

// テストパターン送信（管理画面から）
app.post("/api/clients/test-pattern", async (c) => {
  const { pattern, targetUuid } = await c.req.json() as { pattern: string; targetUuid?: string };
  sendTestPattern(pattern as Parameters<typeof sendTestPattern>[0], targetUuid);
  return c.json({ success: true });
});

// ---- シーンオブジェクト CRUD ----
app.get("/api/scene", (c) => c.json(getScene()));

app.post("/api/scene", async (c) => {
  const obj = await c.req.json();
  addSceneObject(obj);
  return c.json({ success: true });
});

app.put("/api/scene/:id", async (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const patch = await c.req.json();
  const ok = updateSceneObject(id, patch);
  return c.json({ success: ok });
});

app.delete("/api/scene/:id", (c) => {
  const id = decodeURIComponent(c.req.param("id"));
  const ok = deleteSceneObject(id);
  return c.json({ success: ok });
});

// ---- 画像アップロード（シーン用） ----
app.post("/api/upload-image", async (c) => {
  const contentType = c.req.header("content-type") || "";
  let fileData: ArrayBuffer | Uint8Array;
  let ext = "png";

  if (contentType.includes("application/json")) {
    const body = await c.req.json();
    if (!body.data) return c.json({ error: "no file data" }, 400);
    const base64Data = body.data.replace(/^data:image\/\w+;base64,/, "");
    fileData = Buffer.from(base64Data, "base64");
    if (body.filename) ext = body.filename.split(".").pop()?.toLowerCase() ?? "png";
  } else {
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") return c.json({ error: "no file" }, 400);
    ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    fileData = await file.arrayBuffer();
  }

  const allowedExts = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
  if (!allowedExts.includes(ext)) return c.json({ error: "unsupported type" }, 400);
  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  const path = join(SCENE_IMAGES_DIR, filename);
  await Bun.write(path, fileData);
  const url = `/images/scene/${filename}`;
  return c.json({ success: true, url, id });
});

// ---- ギャラリー画像一覧取得 (public/images フォルダ内限定) ----
app.get("/api/gallery", async (c) => {
  const glob = new Bun.Glob("*.{png,jpg,jpeg,gif,webp}");
  const files: Array<{ url: string; meta?: import("./png-metadata").FishMeta }> = [];
  for await (const file of glob.scan(PUBLIC_IMAGES_DIR)) {
    const url = `/images/${file}`;
    let meta = undefined;
    if (file.toLowerCase().endsWith(".png")) {
      try {
         const buf = readFileSync(join(PUBLIC_IMAGES_DIR, file)) as Buffer;
         const parsedMeta = readFishMeta(buf);
         if (parsedMeta) meta = parsedMeta;
      } catch (e) {
         // 無視
      }
    }
    files.push({ url, meta });
  }
  return c.json({ images: files });
});

// PNGへ魚パラメーターを埋め込み、ダウンロード用ファイルとして返す。
app.post("/api/png/configure", async (c) => {
  const { imageUrl, meta } = await c.req.json<{ imageUrl: string; meta: Partial<import("./png-metadata").FishMeta> }>();
  let sourcePath: string | null = null;
  if (imageUrl?.startsWith("/images/")) sourcePath = join(PUBLIC_IMAGES_DIR, imageUrl.slice("/images/".length));
  if (imageUrl?.startsWith("/lib-images/")) sourcePath = join(DATA_FISH_DIR, decodeURIComponent(imageUrl.slice("/lib-images/".length)));
  if (!sourcePath) return c.json({ error: "Unsupported image URL" }, 400);
  try {
    const configured = writeFishMeta(readFileSync(sourcePath) as Buffer, { ...DEFAULT_FISH_META, ...meta });
    return new Response(configured, {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": 'attachment; filename="aquarium-fish.png"',
      },
    });
  } catch {
    return c.json({ error: "Could not configure PNG" }, 400);
  }
});

// ---- 魚ライブラリ: /data/fish/ から一覧取得 ----
app.get("/api/library", (c) => {
  const entries = loadFishLibrary();
  return c.json({ library: entries });
});

// ---- 魚ライブラリ: /data/fish/ から再読み込み・再復元 ----
app.post("/api/library/reload", (c) => {
  const { spawnPoints } = getWorld();
  restoreActiveFishFromDisk(spawnPoints);
  const fish = getAllActiveFish();
  broadcastToAll({
    event: "state_push",
    clients: getDisplayClientInfoList(),
    activeFish: fish,
    pendingFish: getPendingQueue(),
  });
  pushClientListToManagers();
  console.log(`[Library] Reloaded: ${fish.length} fish now active`);
  return c.json({ success: true, count: fish.length });
});

// ---- 魚ライブラリ: ファイルから直接放流 ----
app.post("/api/library/:filename/release", async (c) => {
  const filename = decodeURIComponent(c.req.param("filename"));
  const buf = getLibraryFileBuffer(filename);
  if (!buf) return c.json({ error: "File not found" }, 404);

  const meta = readFishMeta(buf);
  const imageUrl = `/lib-images/${encodeURIComponent(filename)}`;

  // scan API と同様に pendingQueue に追加してから放流する
  const pending = addToPending(imageUrl);

  const w = getWorld();
  const sp = w.spawnPoints.length > 0
    ? w.spawnPoints[Math.floor(Math.random() * w.spawnPoints.length)]!
    : (w.validZones[0] ? { x: w.validZones[0].x + 100, y: w.validZones[0].y + w.validZones[0].height * 0.5 } : { x: 200, y: 400 });

  const config: FishConfig = {
    id: pending.id,
    type: (meta?.type ?? "school") as FishType,
    textureUrl: imageUrl,
    author: meta?.author,
    fishMeta: meta ?? undefined,
    userParams: {
      scale: meta?.scale ?? 1.0,
      speed: meta?.speed ?? 1.0,
      rotationOffset: 0,
      direction: meta?.direction ?? "auto",
      flipX: meta?.flipX ?? false,
      opacity: meta?.opacity ?? 1,
    },
    customMotion: meta?.customMotion,
    isPinned: meta?.pinnedLayerId !== null && meta?.pinnedLayerId !== undefined,
    pinnedLayerId: meta?.pinnedLayerId ?? undefined,
  };

  const activeFish = releaseFish(config, sp);
  broadcastToAll({ event: "fish_released", fish: activeFish });
  pushClientListToManagers();

  console.log(`[Library] Released ${filename} as ${pending.id} (type: ${config.type})`);
  return c.json({ success: true, fish: activeFish });
});

// ---- 魚の位置を強制移動する (D&Dによる管理画面からの操作) ----
app.put("/api/fish/:id/position", async (c) => {
  const id = c.req.param("id");
  const { x, y } = await c.req.json<{ x: number; y: number }>();
  const fish = getActiveFish(id);
  if (!fish) return c.json({ error: "Fish not found" }, 404);
  fish.physics.pos.x = x;
  fish.physics.pos.y = y;
  fish.physics.vel.x = 0;
  fish.physics.vel.y = 0;
  resetAquariumMotionPosition(fish);
  return c.json({ success: true });
});

// ws-handler から bgUrl と layers を取得できるようエクスポートを追加
import { getCurrentBgUrl } from "./ws-handler";

// 管理画面用: 状態スナップショット
app.get("/api/state", (c) => {
  const w = getWorld();
  return c.json({
    clients:     getDisplayClientInfoList(),
    activeFish:  getAllActiveFish(),
    pendingFish: getPendingQueue(),
    worldW:      w.width,
    worldH:      w.height,
    bgUrl:       getCurrentBgUrl(),
    forbiddenZones: w.forbiddenZones,
    spawnPoints: w.spawnPoints,
    layers:      w.layers,
    fishLayers:  LAYER_CONFIG,
    horizontalBoundaryMode: w.horizontalBoundaryMode,
    fishSpeedMultiplier: w.fishSpeedMultiplier,
    fishScaleMultiplier: w.fishScaleMultiplier,
    motionSettings: w.motionSettings,
    systemMetrics: getSystemMetrics(),
  });
});

app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

// ---- ゲームループ起動 ----------------------------------------
startGameLoop();
startHeartbeatWatcher();

// ---- Bun サーバー（HTTP + WS 統合） ------------------------
const server = Bun.serve({
  port: PORTS.HTTP,
  hostname: "0.0.0.0",

  // WebSocket ハンドラー（Bun ネイティブ）
  websocket: wsHandlers,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WS アップグレード
    if (req.headers.get("upgrade") === "websocket" && url.pathname === "/ws") {
      const ok = server.upgrade(req, {
        data: {
          uuid: "",
          clientType: "",
          lastHeartbeat: Date.now(),
          screenW: 0,
          screenH: 0,
          viewport: null,
          testPattern: "off",
          ping: 0,
        }
      });
      return ok ? undefined : new Response("WS upgrade failed", { status: 500 });
    }

    // 静的画像ファイル (/public/images/)
    if (url.pathname.startsWith("/images/")) {
      const filename = url.pathname.slice("/images/".length);
      const file = Bun.file(join(PUBLIC_IMAGES_DIR, filename));
      if (await file.exists()) {
        return new Response(file, { headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=31536000, immutable",
        } });
      }
      return new Response("Not Found", { status: 404 });
    }

    // ライブラリ画像ファイル (/data/fish/)
    if (url.pathname.startsWith("/lib-images/")) {
      const filename = decodeURIComponent(url.pathname.slice("/lib-images/".length));
      const buf = getLibraryFileBuffer(filename);
      if (buf) {
        return new Response(buf, {
          headers: {
            "Content-Type": "image/png",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=31536000, immutable",
          }
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    // MPA ルーティング（ビルド済みの場合）
    // パス → HTML ファイルにマッピング
    const mpaRoutes: Record<string, string> = {
      "/":           "index.html",
      "/display":    "display.html",
      "/controller": "controller.html",
      "/guest":      "guest.html",
      "/manage":     "manage.html",
    };
    const htmlFile = mpaRoutes[url.pathname] ?? mpaRoutes[url.pathname.replace(/\/$/, "")];
    if (htmlFile) {
      const file = Bun.file(join(APP_DIR, htmlFile));
      if (await file.exists()) {
        return new Response(file, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
      // ビルド前（開発時）: Vite dev server への案内
      return new Response(
        `<html><body style="font-family:sans-serif;padding:32px;background:#0f1117;color:#7ec8e3">
          <h2>🐟 開発モード</h2>
          <p>フロントエンドは Vite dev server で配信されています:</p>
          <a href="http://localhost:5173/${url.pathname.slice(1)}.html" style="color:#7ec8e3">
            → http://localhost:5173/${htmlFile}
          </a>
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // ビルド済み assets（JS/CSS/images）の配信
    const assetFile = Bun.file(join(APP_DIR, url.pathname));
    if (await assetFile.exists()) return new Response(assetFile);

    return app.fetch(req);
  },
});

// サーバー起動時に /data/fish/ から泳いでいる魚を復元
restoreActiveFishFromDisk(getWorld().spawnPoints);

console.log(`[Server] Listening on http://0.0.0.0:${PORTS.HTTP}`);
console.log(`[Server] WebSocket on ws://0.0.0.0:${PORTS.HTTP}/ws`);
console.log(`[Server] Pages:`);
console.log(`    /display    → Pixi.js レンダラー`);
console.log(`    /controller → iPad コントローラー`);
console.log(`    /guest      → 餌やり`);
console.log(`    /manage     → 管理画面`);
