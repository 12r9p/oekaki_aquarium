import { Hono } from "hono";
import { cors } from "hono/cors";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { PORTS } from "@aquarium/shared";
import { startGameLoop } from "./game-loop";
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
import { getAllActiveFish, removeFish, updateFishParams, removePendingFish } from "./fish-manager";
import { getPendingQueue } from "./fish-manager";
import { getWorld } from "./world";

// ============================================================
// サーバーエントリーポイント（Bun 単一ポート統合版）
//
// ポート 3000 で以下を全て提供:
//   GET  /display, /controller, /guest, /manage → Vite MPA の HTML
//   GET  /api/*       → REST API
//   GET  /images/*    → 魚の画像ファイル
//   WS   /ws          → Bun ネイティブ WebSocket
// ============================================================

const PUBLIC_IMAGES_DIR = join(import.meta.dir, "..", "public", "images");
const SCENE_IMAGES_DIR = join(PUBLIC_IMAGES_DIR, "scene");
const APP_DIR = join(import.meta.dir, "..", "public", "app");
mkdirSync(PUBLIC_IMAGES_DIR, { recursive: true });
mkdirSync(SCENE_IMAGES_DIR, { recursive: true });

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

// 魚のプロパティ更新
app.put("/api/fish/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json();
  const ok = updateFishParams(id, updates);
  if (ok) pushClientListToManagers();
  return c.json({ success: ok });
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
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") return c.json({ error: "no file" }, 400);
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const allowedExts = ["jpg", "jpeg", "png", "gif", "webp", "svg"];
  if (!allowedExts.includes(ext)) return c.json({ error: "unsupported type" }, 400);
  const id = crypto.randomUUID();
  const filename = `${id}.${ext}`;
  const path = join(SCENE_IMAGES_DIR, filename);
  await Bun.write(path, await file.arrayBuffer());
  const url = `/images/scene/${filename}`;
  return c.json({ success: true, url, id });
});

// 管理画面用: 状態スナップショット
app.get("/api/state", (c) => {
  const w = getWorld();
  return c.json({
    clients:     getDisplayClientInfoList(),
    activeFish:  getAllActiveFish(),
    pendingFish: getPendingQueue(),
    worldW:      w.width,
    worldH:      w.height,
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
          testPattern: "off"
        }
      });
      return ok ? undefined : new Response("WS upgrade failed", { status: 500 });
    }

    // 静的画像ファイル
    if (url.pathname.startsWith("/images/")) {
      const filename = url.pathname.slice("/images/".length);
      const file = Bun.file(join(PUBLIC_IMAGES_DIR, filename));
      if (await file.exists()) {
        return new Response(file, { headers: { "Access-Control-Allow-Origin": "*" } });
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

console.log(`[Server] Listening on http://0.0.0.0:${PORTS.HTTP}`);
console.log(`[Server] WebSocket on ws://0.0.0.0:${PORTS.HTTP}/ws`);
console.log(`[Server] Pages:`);
console.log(`    /display    → Pixi.js レンダラー`);
console.log(`    /controller → iPad コントローラー`);
console.log(`    /guest      → 餌やり`);
console.log(`    /manage     → 管理画面`);
