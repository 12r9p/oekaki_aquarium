import "../styles/global.css";
import { Application, Sprite, Texture, Graphics, Assets } from "pixi.js";
import type { UdpPacket, UdpFishData, WsServerMessage, TestPattern, ClientConfig } from "@aquarium/shared";
import { createWsClient } from "../shared/useWs";

// ============================================================
// display/main.ts
//
// Display IDで管理する方式に変更：
//   - URL例: /display?id=left-monitor
//   - IDを指定しない場合は localStorage から自動生成・保存
//   - Viewport はサーバーから config イベントで受け取る（URLパラメータ不要）
//   - URLパラメータ方式も後方互換として残す（?vx/vy/vw/vhが指定された場合）
// ============================================================

// ---- Display ID の決定 ----
const params = new URLSearchParams(location.search);

// ID取得優先度: ?id=明示 > localStorage > 新規生成してlocalStorageに保存
function getDisplayId(): string {
  const fromUrl = params.get("id");
  if (fromUrl) {
    // URLで指定されたIDをlocalStorageに保存（以降のリロードで使い回せる）
    localStorage.setItem("display-id", fromUrl);
    return fromUrl;
  }
  const saved = localStorage.getItem("display-id");
  if (saved) return saved;
  // 新規生成: ランダムな短いID
  const newId = `disp-${Math.random().toString(36).slice(2, 8)}`;
  localStorage.setItem("display-id", newId);
  return newId;
}

const DISPLAY_ID = getDisplayId();

// ---- 初期Viewport（後方互換: URL パラメータがあれば使う、なければサーバーから受け取る） ----
let VP: NonNullable<ClientConfig["viewport"]> = {
  x:      parseInt(params.get("vx") ?? "0"),
  y:      parseInt(params.get("vy") ?? "0"),
  width:  parseInt(params.get("vw") ?? String(window.screen.width)),
  height: parseInt(params.get("vh") ?? String(window.screen.height)),
  scale:  parseFloat(params.get("scale") ?? "1"),
};

const textureUrlCache = new Map<string, string>();
let currentPattern: TestPattern = (params.get("test") === "1") ? "grid" : "off";

// URLからワールドサイズを読む（worldmapパターンのミニマップ用）
// /display?id=xxx&worldW=3840&worldH=1080 のように設定できる
const WORLD_W = parseInt(params.get("worldW") ?? "4000");
const WORLD_H = parseInt(params.get("worldH") ?? "2000");

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

interface FishEntry {
  sprite: Sprite;
  targetX: number; targetY: number;
  targetRotation: number; targetScale: number;
  targetAlpha: number; targetZIndex: number;
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({
    width: VP.width, height: VP.height,
    backgroundColor: 0x000819,
    antialias: true,
    resolution: window.devicePixelRatio ?? 1,
    autoDensity: true,
  });
  app.stage.sortableChildren = true;
  document.body.appendChild(app.canvas);

  // Display IDをタイトルバーに表示（デバッグ用）
  document.title = `Display: ${DISPLAY_ID}`;

  const fishMap = new Map<string, FishEntry>();
  let testGraphics: Graphics | null = null;

  // ---- テストパターン描画 ----
  function drawTestPattern(pattern: TestPattern): void {
    testGraphics?.destroy();
    testGraphics = null;
    // worldmapオーバーレイキャンバスもクリアンアップ
    document.getElementById("worldmap-overlay")?.remove();
    if (pattern === "off") return;

    const g = new Graphics();
    g.zIndex = 10000;

    switch (pattern) {
      case "white": g.rect(0, 0, VP.width, VP.height).fill({ color: 0xffffff }); break;
      case "black": g.rect(0, 0, VP.width, VP.height).fill({ color: 0x000000 }); break;

      case "colorbars": {
        const bars = [0xc0c0c0, 0xc0c000, 0x00c0c0, 0x00c000, 0xc000c0, 0xc00000, 0x0000c0];
        const barW = VP.width / bars.length;
        bars.forEach((color, i) => g.rect(i * barW, 0, barW, VP.height * 0.75).fill({ color }));
        const bottom = [0x0000c0, 0x131313, 0xc000c0, 0x131313, 0x0d0d0d, 0x131313, 0xc0c0c0];
        bottom.forEach((color, i) => g.rect(i * barW, VP.height * 0.75, barW, VP.height * 0.25).fill({ color }));
        g.rect(VP.width * 0.3, VP.height * 0.75, VP.width * 0.4, VP.height * 0.25).fill({ color: 0xffffff });
        break;
      }

      case "crosshair": {
        g.rect(0, 0, VP.width, VP.height).fill({ color: 0x000000 });
        g.setStrokeStyle({ width: 2, color: 0x00ff44 });
        g.moveTo(0, VP.height / 2).lineTo(VP.width, VP.height / 2);
        g.moveTo(VP.width / 2, 0).lineTo(VP.width / 2, VP.height);
        const L = 60, T = 10;
        [[0,0],[VP.width,0],[0,VP.height],[VP.width,VP.height]].forEach(([cx, cy]) => {
          const dx = cx === 0 ? 1 : -1;
          const dy = cy === 0 ? 1 : -1;
          g.moveTo(cx + dx * T, cy).lineTo(cx + dx * L, cy);
          g.moveTo(cx, cy + dy * T).lineTo(cx, cy + dy * L);
        });
        for (let r = 50; r <= 300; r += 50) g.circle(VP.width/2, VP.height/2, r);
        g.stroke();
        break;
      }

      case "grid": {
        g.rect(0, 0, VP.width, VP.height).fill({ color: 0x0a0a1a });
        g.setStrokeStyle({ width: 1, color: 0x00ff44, alpha: 0.5 });
        for (let x = 0; x <= VP.width; x += 100) g.moveTo(x, 0).lineTo(x, VP.height);
        for (let y = 0; y <= VP.height; y += 100) g.moveTo(0, y).lineTo(VP.width, y);
        g.stroke();
        g.setStrokeStyle({ width: 0.5, color: 0x00ff44, alpha: 0.2 });
        for (let x = 50; x <= VP.width; x += 100) g.moveTo(x, 0).lineTo(x, VP.height);
        for (let y = 50; y <= VP.height; y += 100) g.moveTo(0, y).lineTo(VP.width, y);
        g.stroke();
        g.setStrokeStyle({ width: 3, color: 0xff4444 });
        const C = 80;
        [[0,0],[VP.width,0],[0,VP.height],[VP.width,VP.height]].forEach(([cx, cy]) => {
          const dx = cx === 0 ? 1 : -1;
          const dy = cy === 0 ? 1 : -1;
          g.moveTo(cx + dx * 10, cy).lineTo(cx + dx * C, cy);
          g.moveTo(cx, cy + dy * 10).lineTo(cx, cy + dy * C);
        });
        g.stroke();
        break;
      }

      case "worldmap": {
        // ワールド座標履歴グリッド（スクリーン座標に変換して描画）
        g.rect(0, 0, VP.width, VP.height).fill({ color: 0x000820 });

        // 100px小グリッド（ワールド座標）
        const wStep = 100;
        const wx0 = Math.floor(VP.x / wStep) * wStep;
        const wy0 = Math.floor(VP.y / wStep) * wStep;
        const wRight  = VP.x + VP.width  / VP.scale;
        const wBottom = VP.y + VP.height / VP.scale;
        g.setStrokeStyle({ width: 0.5, color: 0x1a4a7a, alpha: 0.9 });
        for (let wx = wx0; wx <= wRight;  wx += wStep) g.moveTo((wx - VP.x) * VP.scale, 0).lineTo((wx - VP.x) * VP.scale, VP.height);
        for (let wy = wy0; wy <= wBottom; wy += wStep) g.moveTo(0, (wy - VP.y) * VP.scale).lineTo(VP.width, (wy - VP.y) * VP.scale);
        g.stroke();

        // 500pxメジャグリッド（ワールド座標）
        const mStep = 500;
        const mx0 = Math.floor(VP.x / mStep) * mStep;
        const my0 = Math.floor(VP.y / mStep) * mStep;
        g.setStrokeStyle({ width: 1.5, color: 0x2a7acc, alpha: 0.9 });
        for (let wx = mx0; wx <= wRight;  wx += mStep) g.moveTo((wx - VP.x) * VP.scale, 0).lineTo((wx - VP.x) * VP.scale, VP.height);
        for (let wy = my0; wy <= wBottom; wy += mStep) g.moveTo(0, (wy - VP.y) * VP.scale).lineTo(VP.width, (wy - VP.y) * VP.scale);
        g.stroke();

        // ワールド原点マーカー (0,0) がビューポート内にあれば描画
        if (VP.x <= 0 && VP.y <= 0 && wRight >= 0 && wBottom >= 0) {
          const ox = -VP.x * VP.scale;
          const oy = -VP.y * VP.scale;
          g.setStrokeStyle({ width: 3, color: 0xff4444 });
          g.moveTo(ox - 24, oy).lineTo(ox + 24, oy);
          g.moveTo(ox, oy - 24).lineTo(ox, oy + 24);
          g.stroke();
        }

        // 座標ラベル＆ミニマップはHTML canvas overlayで描画
        drawWorldmapOverlay();
        break;
      }
    }

    app.stage.addChild(g);
    testGraphics = g;

    if (pattern === "grid" || pattern === "crosshair") drawViewportInfo();
  }

  /**
   * worldmapパターン用HTML canvasオーバーレイ
   * - 世界座標ラベル（500px毎に数値表示）
   * - 右下にミニマップ（このディスプレイの位置がワールド内のどこにあるか）
   */
  function drawWorldmapOverlay(): void {
    document.getElementById("worldmap-overlay")?.remove();

    const cvs = document.createElement("canvas");
    cvs.id = "worldmap-overlay";
    // 物理解像度に合わせる（VP.scale倍されたスクリーン解像度）
    cvs.width  = VP.width;
    cvs.height = VP.height;
    Object.assign(cvs.style, {
      position: "fixed", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "99998",
    });
    document.body.appendChild(cvs);

    const ctx = cvs.getContext("2d")!;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // ---- ワールド座標ラベル（500px間隔の交点） ----
    ctx.fillStyle = "#4a9aff";
    ctx.font = `bold ${Math.round(13 * VP.scale)}px monospace`;
    ctx.textBaseline = "top";
    const mStep = 500;
    const mx0 = Math.ceil(VP.x / mStep) * mStep;
    const my0 = Math.ceil(VP.y / mStep) * mStep;
    const wRight  = VP.x + VP.width  / VP.scale;
    const wBottom = VP.y + VP.height / VP.scale;

    // X軸ラベル（上端）
    for (let wx = mx0; wx < wRight; wx += mStep) {
      const sx = (wx - VP.x) * VP.scale + 3;
      ctx.fillText(String(wx), sx, 3 * VP.scale);
    }
    // Y軸ラベル（左端）
    for (let wy = my0; wy < wBottom; wy += mStep) {
      const sy = (wy - VP.y) * VP.scale;
      ctx.fillText(String(wy), 3, sy + 2 * VP.scale);
    }
    // ID表示（左上）
    ctx.fillStyle = "rgba(0,8,32,0.8)";
    ctx.fillRect(0, 0, ctx.measureText(`ID: ${DISPLAY_ID}`).width + 12 * VP.scale, 24 * VP.scale);
    ctx.fillStyle = "#7ec8e3";
    ctx.font = `${Math.round(11 * VP.scale)}px monospace`;
    ctx.fillText(`ID: ${DISPLAY_ID}  [${VP.x},${VP.y} / ${Math.round(VP.width / VP.scale)}×${Math.round(VP.height / VP.scale)}]`, 6, 6);

    // ---- ミニマップ（右下） ----
    const MINI_W = Math.round(200 * VP.scale);
    const MINI_H = Math.round(MINI_W * WORLD_H / WORLD_W);
    const MINI_X = VP.width  - MINI_W - Math.round(20 * VP.scale);
    const MINI_Y = VP.height - MINI_H - Math.round(20 * VP.scale);

    // 背景
    ctx.fillStyle = "rgba(0,8,32,0.85)";
    ctx.fillRect(MINI_X - 1, MINI_Y - 1, MINI_W + 2, MINI_H + 2);
    ctx.strokeStyle = "#2a6aaa";
    ctx.lineWidth = VP.scale;
    ctx.strokeRect(MINI_X, MINI_Y, MINI_W, MINI_H);

    // ワールド領域を示す薄い格子
    ctx.strokeStyle = "rgba(42,106,170,0.4)";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(MINI_X + MINI_W * i / 4, MINI_Y);
      ctx.lineTo(MINI_X + MINI_W * i / 4, MINI_Y + MINI_H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(MINI_X, MINI_Y + MINI_H * i / 4);
      ctx.lineTo(MINI_X + MINI_W, MINI_Y + MINI_H * i / 4);
      ctx.stroke();
    }

    // このディスプレイのViewport範囲を緑でハイライト
    const vpMiniX = MINI_X + (VP.x / WORLD_W) * MINI_W;
    const vpMiniY = MINI_Y + (VP.y / WORLD_H) * MINI_H;
    const vpMiniW = ((VP.width / VP.scale) / WORLD_W) * MINI_W;
    const vpMiniH = ((VP.height / VP.scale) / WORLD_H) * MINI_H;
    ctx.fillStyle = "rgba(0,200,100,0.25)";
    ctx.fillRect(vpMiniX, vpMiniY, vpMiniW, vpMiniH);
    ctx.strokeStyle = "#00c864";
    ctx.lineWidth = 1.5 * VP.scale;
    ctx.strokeRect(vpMiniX, vpMiniY, vpMiniW, vpMiniH);

    // ラベル
    ctx.fillStyle = "#7ec8e3";
    ctx.font = `bold ${Math.round(9 * VP.scale)}px monospace`;
    ctx.textBaseline = "bottom";
    ctx.fillText(`World: ${WORLD_W}×${WORLD_H}`, MINI_X + 3, MINI_Y - 2);
  }

  // Viewport情報オーバーレイ
  function drawViewportInfo(): void {
    const existing = document.getElementById("vp-overlay");
    if (existing) existing.remove();

    const div = document.createElement("div");
    div.id = "vp-overlay";
    Object.assign(div.style, {
      position: "fixed", top: "20px", left: "20px",
      background: "rgba(0,0,0,0.7)", color: "#00ff44",
      fontFamily: "monospace", fontSize: "16px",
      padding: "12px 16px", borderRadius: "8px",
      border: "1px solid #00ff44", lineHeight: "1.6",
      zIndex: "99999", pointerEvents: "none",
    });
    div.innerHTML = `
      <strong>🖥 Display Info</strong><br>
      ID: ${DISPLAY_ID}<br>
      Viewport: x=${VP.x}, y=${VP.y}<br>
      Size: ${VP.width} × ${VP.height}<br>
      Scale: ${VP.scale}<br>
      Screen: ${window.screen.width} × ${window.screen.height}
    `.trim();
    document.body.appendChild(div);
  }

  if (currentPattern !== "off") drawTestPattern(currentPattern);

  // ---- WebSocket ----
  // Display IDを使って接続（固定IDで管理）
  const ws = createWsClient(`display:${DISPLAY_ID}`);

  ws.onMessage((msg: WsServerMessage) => {
    if (msg.event === "config" || msg.event === "update_viewport") {
      // サーバーからViewportを受け取って適用
      const newVp = msg.event === "config" ? msg.viewport : msg.viewport;
      if (newVp) {
        VP = { ...newVp };
        app.renderer.resize(VP.width, VP.height);
        if (currentPattern !== "off") drawTestPattern(currentPattern);
        else document.getElementById("vp-overlay")?.remove();
      }
    }

    if (msg.event === "frame") {
      if (currentPattern !== "off") return;
      const packet = msg as unknown as { event: "frame" } & UdpPacket;
      const receivedIds = new Set<string>();

      for (const fd of packet.f) {
        receivedIds.add(fd.i);
        const screenX = (fd.x - VP.x) * VP.scale;
        const screenY = (fd.y - VP.y) * VP.scale;
        const inView = fd.x >= VP.x - 200 && fd.x <= VP.x + VP.width + 200 &&
                       fd.y >= VP.y - 200 && fd.y <= VP.y + VP.height + 200;
        if (!inView) { destroyFish(fishMap, fd.i); continue; }
        if (!fishMap.has(fd.i)) spawnFish(app, fishMap, fd, screenX, screenY);
        else {
          const e = fishMap.get(fd.i)!;
          e.targetX = screenX; e.targetY = screenY;
          e.targetRotation = fd.r; e.targetScale = fd.s * VP.scale;
          e.targetAlpha = fd.o; e.targetZIndex = fd.z;
        }
      }
      for (const id of fishMap.keys()) if (!receivedIds.has(id)) destroyFish(fishMap, id);
    }

    if (msg.event === "test_pattern") {
      currentPattern = msg.pattern;
      drawTestPattern(currentPattern);
      if (currentPattern === "off") document.getElementById("vp-overlay")?.remove();
    }

    if (msg.event === "fish_released") {
      const shortId = msg.fish.id.slice(0, 8);
      textureUrlCache.set(shortId, msg.fish.textureUrl);
      const entry = fishMap.get(shortId);
      if (entry) {
        void Assets.load<Texture>(msg.fish.textureUrl).then((tex) => { entry.sprite.texture = tex; });
      }
    }
  });

  app.ticker.add(() => {
    for (const [, e] of fishMap) {
      const s = e.sprite;
      s.x        = lerp(s.x, e.targetX, 0.12);
      s.y        = lerp(s.y, e.targetY, 0.12);
      s.rotation = lerpAngle(s.rotation, e.targetRotation, 0.08);
      s.scale.set(lerp(s.scale.x, e.targetScale, 0.05));
      s.alpha    = lerp(s.alpha, e.targetAlpha, 0.05);
      if (s.zIndex !== e.targetZIndex) s.zIndex = e.targetZIndex;
    }
  });
}

function spawnFish(app: Application, fishMap: Map<string, FishEntry>, fd: UdpFishData, sx: number, sy: number): void {
  const cachedUrl = textureUrlCache.get(fd.i);
  const texture = cachedUrl ? (Assets.cache.get<Texture>(cachedUrl) ?? buildPlaceholder(app)) : buildPlaceholder(app);
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = sx; sprite.y = sy;
  sprite.rotation = fd.r;
  sprite.scale.set(fd.s * VP.scale);
  sprite.alpha = fd.o;
  sprite.zIndex = fd.z;
  app.stage.addChild(sprite);
  fishMap.set(fd.i, { sprite, targetX:sx, targetY:sy, targetRotation:fd.r, targetScale:fd.s*VP.scale, targetAlpha:fd.o, targetZIndex:fd.z });
}

function destroyFish(fishMap: Map<string, FishEntry>, id: string): void {
  fishMap.get(id)?.sprite.destroy(); fishMap.delete(id);
}

function buildPlaceholder(app: Application): Texture {
  const g = new Graphics();
  g.circle(0, 0, 30).fill({ color: 0x7ec8e3, alpha: 0.6 });
  return app.renderer.generateTexture(g);
}

void main();
