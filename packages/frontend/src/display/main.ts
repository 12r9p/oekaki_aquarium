import "../styles/global.css";
import { Application, Sprite, Texture, Graphics, Assets, Container } from "pixi.js";
import type { UdpPacket, UdpFishData, WsServerMessage, TestPattern, ClientConfig, WorldObject } from "@aquarium/shared";
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
    localStorage.setItem("display-id", fromUrl);
    return fromUrl;
  }
  const saved = localStorage.getItem("display-id");
  if (saved) return saved;
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
    width: window.innerWidth, height: window.innerHeight,
    backgroundColor: 0x000819,
    antialias: true,
    resolution: window.devicePixelRatio ?? 1,
    autoDensity: true,
  });
  app.stage.sortableChildren = true;
  
  // HTML側でcanvasが画面全体に広がるようにStyleを当てる
  Object.assign(app.canvas.style, {
    position: "absolute",
    top: "0", left: "0",
    width: "100%", height: "100%",
    objectFit: "fill"
  });
  document.body.appendChild(app.canvas);

  let scaleX = window.innerWidth / VP.width;
  let scaleY = window.innerHeight / VP.height;

  window.addEventListener("resize", () => {
    app.renderer.resize(window.innerWidth, window.innerHeight);
    applyViewport(VP);
  });

  document.title = `Display: ${DISPLAY_ID}`;

  const fishMap = new Map<string, FishEntry>();
  let testGraphics: Graphics | null = null;

  // ---- シーンオブジェクトの表示用コンテナ ----
  let sceneContainer: Container | null = null;
  let currentScene: WorldObject[] = [];

  /** WorldObject配列をPixiで描画 */
  function renderSceneObjects(objects: WorldObject[]): void {
    sceneContainer?.destroy({ children: true });
    sceneContainer = new Container();
    sceneContainer.zIndex = 50;  // 魚の下、テストパターンの上
    app.stage.addChild(sceneContainer);

    const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
    for (const obj of sorted) {
      // ワールド座標 → ディスプレイ相対座標 → スケール後スクリーン座標
      const sx = (obj.x - VP.x) * scaleX;
      const sy = (obj.y - VP.y) * scaleY;
      const sw = obj.width  * scaleX;
      const sh = obj.height * scaleY;

      if (obj.type === "image" && obj.imageUrl) {
        void Assets.load<Texture>(obj.imageUrl).then(tex => {
          if (!sceneContainer) return;
          const sprite = new Sprite(tex);
          sprite.x = sx; sprite.y = sy;
          sprite.width = sw; sprite.height = sh;
          sprite.alpha = obj.opacity;
          sprite.angle = obj.rotation;
          sceneContainer.addChild(sprite);
        });
      } else if (obj.type === "rect" || obj.type === "ellipse") {
        const g = new Graphics();
        const fillHex = obj.fillColor && obj.fillColor !== "transparent"
          ? parseInt(obj.fillColor.replace("#", ""), 16) : null;
        const strokeHex = obj.strokeColor
          ? parseInt(obj.strokeColor.replace("#", ""), 16) : null;
        const sW = (obj.strokeWidth ?? 1) * Math.min(scaleX, scaleY);
        
        if (obj.type === "rect") {
          if (fillHex !== null) g.rect(sx, sy, sw, sh).fill({ color: fillHex, alpha: obj.opacity });
          if (strokeHex !== null) g.rect(sx, sy, sw, sh).stroke({ width: sW, color: strokeHex });
        } else {
          if (fillHex !== null) g.ellipse(sx + sw/2, sy + sh/2, sw/2, sh/2).fill({ color: fillHex, alpha: obj.opacity });
          if (strokeHex !== null) g.ellipse(sx + sw/2, sy + sh/2, sw/2, sh/2).stroke({ width: sW, color: strokeHex });
        }
        sceneContainer.addChild(g);
      }
    }
    currentScene = objects;
  }

  // ---- テストパターン描画 ----
  function drawTestPattern(pattern: TestPattern): void {
    testGraphics?.destroy();
    testGraphics = null;
    document.getElementById("worldmap-overlay")?.remove();
    document.getElementById("calibration-overlay")?.remove();
    if (pattern === "off") return;

    const g = new Graphics();
    g.zIndex = 10000;

    const ww = window.innerWidth;
    const wh = window.innerHeight;

    switch (pattern) {
      case "white": g.rect(0, 0, ww, wh).fill({ color: 0xffffff }); break;
      case "black": g.rect(0, 0, ww, wh).fill({ color: 0x000000 }); break;

      case "colorbars": {
        const bars = [0xc0c0c0, 0xc0c000, 0x00c0c0, 0x00c000, 0xc000c0, 0xc00000, 0x0000c0];
        const barW = ww / bars.length;
        bars.forEach((color, i) => g.rect(i * barW, 0, barW, wh * 0.75).fill({ color }));
        const bottom = [0x0000c0, 0x131313, 0xc000c0, 0x131313, 0x0d0d0d, 0x131313, 0xc0c0c0];
        bottom.forEach((color, i) => g.rect(i * barW, wh * 0.75, barW, wh * 0.25).fill({ color }));
        g.rect(ww * 0.3, wh * 0.75, ww * 0.4, wh * 0.25).fill({ color: 0xffffff });
        break;
      }

      case "crosshair": {
        g.rect(0, 0, ww, wh).fill({ color: 0x000000 });
        g.setStrokeStyle({ width: 1, color: 0xffffff });
        g.moveTo(ww/2, 0).lineTo(ww/2, wh);
        g.moveTo(0, wh/2).lineTo(ww, wh/2);
        g.stroke();
        g.setStrokeStyle({ width: 3, color: 0xff4444 });
        const T = 30; const L = 80;
        [[0,0],[ww,0],[0,wh],[ww,wh]].forEach(([cx, cy]) => {
          const dx = cx === 0 ? 1 : -1;
          const dy = cy === 0 ? 1 : -1;
          g.moveTo(cx! + dx * T, cy!).lineTo(cx! + dx * L, cy!);
          g.moveTo(cx!, cy! + dy * T).lineTo(cx!, cy! + dy * L);
        });
        g.stroke();
        break;
      }

      case "grid": {
        g.rect(0, 0, ww, wh).fill({ color: 0x0a0a1a });
        g.setStrokeStyle({ width: 1, color: 0x00ff44, alpha: 0.5 });
        for (let x = 0; x <= ww; x += 100) g.moveTo(x, 0).lineTo(x, wh);
        for (let y = 0; y <= wh; y += 100) g.moveTo(0, y).lineTo(ww, y);
        g.stroke();
        g.setStrokeStyle({ width: 0.5, color: 0x00ff44, alpha: 0.2 });
        for (let x = 50; x <= ww; x += 100) g.moveTo(x, 0).lineTo(x, wh);
        for (let y = 50; y <= wh; y += 100) g.moveTo(0, y).lineTo(ww, y);
        g.stroke();
        g.setStrokeStyle({ width: 3, color: 0xff4444 });
        const C = 80;
        [[0,0],[ww,0],[0,wh],[ww,wh]].forEach(([cx, cy]) => {
          const dx = cx === 0 ? 1 : -1;
          const dy = cy === 0 ? 1 : -1;
          g.moveTo(cx! + dx * 10, cy!).lineTo(cx! + dx * C, cy!);
          g.moveTo(cx!, cy! + dy * 10).lineTo(cx!, cy! + dy * C);
        });
        g.stroke();
        break;
      }

      // calibration — ディスプレイIDと座標情報を大きく表示して物理位置を特定する
      case "calibration": {
        g.rect(0, 0, ww, wh).fill({ color: 0x0a0820 });
        g.setStrokeStyle({ width: 6, color: 0x00aaff });
        g.rect(6, 6, ww - 12, wh - 12).stroke();
        const cx2 = ww / 2, cy2 = wh / 2;
        g.setStrokeStyle({ width: 3, color: 0xffffff, alpha: 0.4 });
        g.moveTo(cx2, 0).lineTo(cx2, wh);
        g.moveTo(0, cy2).lineTo(ww, cy2);
        g.stroke();
        // HTMLオーバーレイでIDテキストを大きく表示
        let calDiv = document.getElementById("calibration-overlay");
        if (!calDiv) {
          calDiv = document.createElement("div");
          calDiv.id = "calibration-overlay";
          Object.assign(calDiv.style, {
            position: "fixed", inset: "0",
            display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: "10001",
          });
          document.body.appendChild(calDiv);
        }
        calDiv.innerHTML = `
          <div style="font-family:monospace;color:#00aaff;font-size:9vw;font-weight:bold;text-shadow:0 0 20px #00aaff">${DISPLAY_ID}</div>
          <div style="font-family:monospace;color:#ffffff;font-size:3vw;margin-top:1em;opacity:0.7">
            ${VP.width}&times;${VP.height} &nbsp;|&nbsp; scale: ${VP.scale} &nbsp;|&nbsp; pos: (${VP.x}, ${VP.y})
          </div>
        `;
        break;
      }

      case "worldmap": {
        g.rect(0, 0, ww, wh).fill({ color: 0x000820 });

        const wStep = 100;
        const wx0 = Math.floor(VP.x / wStep) * wStep;
        const wy0 = Math.floor(VP.y / wStep) * wStep;
        const wRight  = VP.x + VP.width;
        const wBottom = VP.y + VP.height;
        g.setStrokeStyle({ width: 0.5, color: 0x1a4a7a, alpha: 0.9 });
        for (let wx = wx0; wx <= wRight;  wx += wStep) g.moveTo((wx - VP.x) * scaleX, 0).lineTo((wx - VP.x) * scaleX, wh);
        for (let wy = wy0; wy <= wBottom; wy += wStep) g.moveTo(0, (wy - VP.y) * scaleY).lineTo(ww, (wy - VP.y) * scaleY);
        g.stroke();

        const mStep = 500;
        const mx0 = Math.floor(VP.x / mStep) * mStep;
        const my0 = Math.floor(VP.y / mStep) * mStep;
        g.setStrokeStyle({ width: 1.5, color: 0x2a7acc, alpha: 0.9 });
        for (let wx = mx0; wx <= wRight;  wx += mStep) g.moveTo((wx - VP.x) * scaleX, 0).lineTo((wx - VP.x) * scaleX, wh);
        for (let wy = my0; wy <= wBottom; wy += mStep) g.moveTo(0, (wy - VP.y) * scaleY).lineTo(ww, (wy - VP.y) * scaleY);
        g.stroke();

        if (VP.x <= 0 && VP.y <= 0 && wRight >= 0 && wBottom >= 0) {
          const ox = -VP.x * scaleX;
          const oy = -VP.y * scaleY;
          g.setStrokeStyle({ width: 3, color: 0xff4444 });
          g.moveTo(ox - 24, oy).lineTo(ox + 24, oy);
          g.moveTo(ox, oy - 24).lineTo(ox, oy + 24);
          g.stroke();
        }

        drawWorldmapOverlay();
        break;
      }
    }

    app.stage.addChild(g);
    testGraphics = g;

    if (pattern === "grid" || pattern === "crosshair") drawViewportInfo();
  }

  /**
   * worldmapパターン用 HTML canvas オーバーレイ
   * - 世界座標ラベル（500px毎）
   * - 右下にミニマップ（200CSS px固定サイズ）
   */
  function drawWorldmapOverlay(): void {
    document.getElementById("worldmap-overlay")?.remove();

    const cvs = document.createElement("canvas");
    cvs.id = "worldmap-overlay";
    cvs.width  = window.innerWidth;
    cvs.height = window.innerHeight;
    Object.assign(cvs.style, {
      position: "fixed", inset: "0", width: "100%", height: "100%",
      pointerEvents: "none", zIndex: "99998",
    });
    document.body.appendChild(cvs);

    const ctx = cvs.getContext("2d")!;
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    // ---- ワールド座標ラベル（500px間隔） ----
    ctx.fillStyle = "#4a9aff";
    ctx.font = `bold ${Math.round(13 * scaleY)}px monospace`;
    ctx.textBaseline = "top";
    const mStep = 500;
    const mx0 = Math.ceil(VP.x / mStep) * mStep;
    const my0 = Math.ceil(VP.y / mStep) * mStep;
    const wRight  = VP.x + VP.width;
    const wBottom = VP.y + VP.height;

    for (let wx = mx0; wx < wRight; wx += mStep) {
      ctx.fillText(String(wx), (wx - VP.x) * scaleX + 3, 3 * scaleY);
    }
    for (let wy = my0; wy < wBottom; wy += mStep) {
      ctx.fillText(String(wy), 3, (wy - VP.y) * scaleY + 2 * scaleY);
    }

    // ID表示（左上）
    ctx.fillStyle = "rgba(0,8,32,0.8)";
    ctx.fillRect(0, 0, ctx.measureText(`ID: ${DISPLAY_ID}`).width + 12 * scaleX, 24 * scaleY);
    ctx.fillStyle = "#7ec8e3";
    ctx.font = `${Math.round(11 * scaleY)}px monospace`;
    ctx.fillText(`ID: ${DISPLAY_ID}  [${VP.x},${VP.y} / ${VP.width}×${VP.height}]`, 6, 6);

    // ---- ミニマップ（右下・常に200CSS px固定） ----
    const MINI_W_CSS = 200;
    const MINI_H_CSS = Math.round(MINI_W_CSS * WORLD_H / WORLD_W);
    // スケール込みでのCanvasピクセルに変換する必要があるが、ここはそのままCSSのピクセル倍率でよい
    const pR = window.devicePixelRatio || 1; 
    const MINI_W = MINI_W_CSS * pR;
    const MINI_H = MINI_H_CSS * pR;
    const MARGIN  = 16 * pR;
    const MINI_X = cvs.width  - MINI_W - MARGIN;
    const MINI_Y = cvs.height - MINI_H - MARGIN;

    ctx.fillStyle = "rgba(0,8,32,0.9)";
    ctx.fillRect(MINI_X - 1, MINI_Y - 1, MINI_W + 2, MINI_H + 2);
    ctx.strokeStyle = "#2a6aaa";
    ctx.lineWidth = 1;
    ctx.strokeRect(MINI_X, MINI_Y, MINI_W, MINI_H);

    ctx.strokeStyle = "rgba(42,106,170,0.4)";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(MINI_X + MINI_W * i / 4, MINI_Y); ctx.lineTo(MINI_X + MINI_W * i / 4, MINI_Y + MINI_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(MINI_X, MINI_Y + MINI_H * i / 4); ctx.lineTo(MINI_X + MINI_W, MINI_Y + MINI_H * i / 4); ctx.stroke();
    }

    const vpMiniX = MINI_X + (VP.x / WORLD_W) * MINI_W;
    const vpMiniY = MINI_Y + (VP.y / WORLD_H) * MINI_H;
    const vpMiniW = (VP.width / WORLD_W) * MINI_W;
    const vpMiniH = (VP.height / WORLD_H) * MINI_H;
    ctx.fillStyle = "rgba(0,200,100,0.25)";
    ctx.fillRect(vpMiniX, vpMiniY, vpMiniW, vpMiniH);
    ctx.strokeStyle = "#00c864";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpMiniX, vpMiniY, vpMiniW, vpMiniH);

    ctx.fillStyle = "#7ec8e3";
    ctx.font = `bold ${Math.max(10, 9 * pR)}px monospace`;
    ctx.textBaseline = "bottom";
    ctx.fillText(`World: ${WORLD_W}×${WORLD_H}`, MINI_X + 3, MINI_Y - 2);
  }

  // Viewport情報オーバーレイ（grid/crosshairパターン用）
  function drawViewportInfo(): void {
    document.getElementById("vp-overlay")?.remove();

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

  /**
   * Viewportを適用して関連UIを更新する。
   * config・update_viewport・viewport_preview 全てで呼ばれる。
   */
  function applyViewport(newVp: NonNullable<ClientConfig["viewport"]>): void {
    document.getElementById("worldmap-overlay")?.remove();
    document.getElementById("calibration-overlay")?.remove();
    VP = { ...newVp };
    scaleX = window.innerWidth / VP.width;
    scaleY = window.innerHeight / VP.height;
    app.renderer.resize(window.innerWidth, window.innerHeight);
    if (currentPattern !== "off") drawTestPattern(currentPattern);
    else document.getElementById("vp-overlay")?.remove();
    // VP変更後にシーンを再描画（スケール・オフセット変更で座標がズレるため）
    if (currentScene.length > 0) renderSceneObjects(currentScene);
  }

  if (currentPattern !== "off") drawTestPattern(currentPattern);

  // ---- WebSocket ----
  const ws = createWsClient(`display:${DISPLAY_ID}`);

  ws.onMessage((msg: WsServerMessage) => {
    // Viewport設定・更新（config: 初回接続時, update_viewport: 管理画面からの永続更新）
    if (msg.event === "config" || msg.event === "update_viewport") {
      applyViewport(msg.viewport);
      return;
    }

    // リアルタイムプレビュー（管理画面でドラッグ中に送られる； 画面上端に緑フラッシュで受信確認）
    if (msg.event === "viewport_preview") {
      applyViewport(msg.viewport);
      let flash = document.getElementById("vp-preview-flash");
      if (!flash) {
        flash = document.createElement("div");
        flash.id = "vp-preview-flash";
        Object.assign(flash.style, {
          position: "fixed", top: "0", left: "0", right: "0", height: "4px",
          background: "#00ff88", zIndex: "99999", pointerEvents: "none",
          opacity: "0", transition: "opacity 0.15s",
        });
        document.body.appendChild(flash);
      }
      flash.style.opacity = "1";
      clearTimeout(Number(flash.dataset.timer));
      flash.dataset.timer = String(setTimeout(() => { flash && (flash.style.opacity = "0"); }, 400));
      return;
    }

    // シーンオブジェクト更新
    if (msg.event === "scene_update") {
      renderSceneObjects(msg.objects);
      return;
    }

    // マウスポインター（レーザーポインター）: 管理画面でホバーした際に表示
    if (msg.event === "pointer_move") {
      let pointer = document.getElementById("laser-pointer");
      if (!pointer) {
        pointer = document.createElement("div");
        pointer.id = "laser-pointer";
        Object.assign(pointer.style, {
          position: "fixed", width: "20px", height: "20px",
          borderRadius: "50%", background: "radial-gradient(circle, rgba(255,100,100,1) 0%, rgba(255,0,0,0.4) 100%)",
          boxShadow: "0 0 15px 5px rgba(255, 0, 0, 0.6)",
          pointerEvents: "none", zIndex: "100000",
          transform: "translate(-50%, -50%)",
          transition: "opacity 0.2s, top 0.05s linear, left 0.05s linear",
          opacity: "0"
        });
        document.body.appendChild(pointer);
      }
      
      // ワールド座標 → ディスプレイのScreen Canvas座標 → CSS(window)座標
      const viewX = (msg.x - VP.x) * scaleX;
      const viewY = (msg.y - VP.y) * scaleY;

      // 表示範囲内なら表示、範囲外なら隠す
      const inView = msg.x >= VP.x && msg.x <= VP.x + VP.width &&
                     msg.y >= VP.y && msg.y <= VP.y + VP.height;
      
      pointer.style.left = `${viewX}px`;
      pointer.style.top = `${viewY}px`;
      pointer.style.opacity = inView ? "1" : "0";
      
      // 1秒間更新がなければ消す
      clearTimeout(Number(pointer.dataset.timer));
      pointer.dataset.timer = String(setTimeout(() => { pointer && (pointer.style.opacity = "0"); }, 1000));
      return;
    }

    if (msg.event === "frame") {
      if (currentPattern !== "off") return;
      const packet = msg as unknown as { event: "frame" } & UdpPacket;
      const receivedIds = new Set<string>();

      for (const fd of packet.f) {
        receivedIds.add(fd.i);
        const screenX = (fd.x - VP.x) * scaleX;
        const screenY = (fd.y - VP.y) * scaleY;
        const inView = fd.x >= VP.x - 200 && fd.x <= VP.x + VP.width + 200 &&
                       fd.y >= VP.y - 200 && fd.y <= VP.y + VP.height + 200;
        if (!inView) { destroyFish(fishMap, fd.i); continue; }
        
        const fishScale = fd.s * Math.min(scaleX, scaleY);

        if (!fishMap.has(fd.i)) spawnFish(app, fishMap, fd, screenX, screenY, fishScale);
        else {
          const e = fishMap.get(fd.i)!;
          e.targetX = screenX; e.targetY = screenY;
          e.targetRotation = fd.r; e.targetScale = fishScale;
          e.targetAlpha = fd.o; e.targetZIndex = fd.z;
        }
      }
      for (const id of fishMap.keys()) if (!receivedIds.has(id)) destroyFish(fishMap, id);
      return;
    }

    if (msg.event === "test_pattern") {
      currentPattern = msg.pattern;
      drawTestPattern(currentPattern);
      if (currentPattern === "off") document.getElementById("vp-overlay")?.remove();
      return;
    }

    if (msg.event === "fish_released") {
      const shortId = msg.fish.id.slice(0, 8);
      textureUrlCache.set(shortId, msg.fish.textureUrl);
      const entry = fishMap.get(shortId);
      if (entry) {
        void Assets.load<Texture>(msg.fish.textureUrl).then((tex) => { entry.sprite.texture = tex; });
      }
      return;
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

function spawnFish(app: Application, fishMap: Map<string, FishEntry>, fd: UdpFishData, sx: number, sy: number, appliedScale: number): void {
  const cachedUrl = textureUrlCache.get(fd.i);
  const texture = cachedUrl ? (Assets.cache.get<Texture>(cachedUrl) ?? buildPlaceholder(app)) : buildPlaceholder(app);
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = sx; sprite.y = sy;
  sprite.rotation = fd.r;
  sprite.scale.set(appliedScale);
  sprite.alpha = fd.o;
  sprite.zIndex = fd.z;
  app.stage.addChild(sprite);
  fishMap.set(fd.i, { sprite, targetX:sx, targetY:sy, targetRotation:fd.r, targetScale:appliedScale, targetAlpha:fd.o, targetZIndex:fd.z });
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
