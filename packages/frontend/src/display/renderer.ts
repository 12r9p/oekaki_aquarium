import { Application, Sprite, Texture, Graphics, Assets, Container } from "pixi.js";
import { STATE, DISPLAY_ID } from "./state";
import type { TestPattern, WorldObject, UdpFishData } from "@aquarium/shared";
import { getLoadedFishTexture, requestFishTexture } from "./fish-texture-loader";

// ============================================================
// display/renderer.ts
// PixiJS を用いた描画関連のロジック
// ============================================================

export interface FishEntry {
  sprite: Sprite;
  textureUrl?: string;
  textureReady: boolean;
  layerIndex: number;
  desiredScale: number;
  facing: 1 | -1;
  flipSign: 1 | -1;
  targetBeat: number;
  targetX: number; targetY: number;
  targetRotation: number; targetScale: number;
  targetAlpha: number; targetZIndex: number;
  targetTint: number;
}

export let currentPattern: TestPattern = "off";

let testGraphics: Graphics | null = null;
let sceneContainer: Container | null = null;
let currentScene: WorldObject[] = [];
let backgroundSprite: Sprite | null = null;
let backgroundUrl = "";
let displayNumber: number | undefined;

// レイヤー管理用
const fishLayerContainers = new Map<number, Container>();
const imageLayerSprites = new Map<string, Sprite>();
const FISH_BASE_SIZE = 48;
let rendererApp: Application | null = null;

// Lerp 関数
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function normalizedFishScale(texture: Texture, desiredScale: number): number {
  const sourceSize = Math.max(texture.width, texture.height, 1);
  return desiredScale * (FISH_BASE_SIZE / sourceSize);
}

export function updateFishTargets(
  entry: FishEntry,
  fd: UdpFishData,
  screenX: number,
  screenY: number,
  desiredScale: number,
): void {
  entry.desiredScale = desiredScale;
  const layerIndex = fd.l ?? 0;
  if (entry.layerIndex !== layerIndex) {
    entry.layerIndex = layerIndex;
    ensureFishLayerContainer(layerIndex)?.addChild(entry.sprite);
  }
  entry.facing = fd.d ?? entry.facing;
  entry.flipSign = fd.fx ? -1 : 1;
  entry.targetBeat = fd.b ?? 0;
  const wrapJumpThreshold = STATE.WORLD_W * STATE.scaleX * 0.5;
  if (Math.abs(screenX - entry.targetX) > wrapJumpThreshold) {
    entry.sprite.x = screenX;
  }
  entry.targetX = screenX;
  entry.targetY = screenY;
  entry.targetRotation = fd.r;
  entry.targetScale = normalizedFishScale(entry.sprite.texture, desiredScale) * entry.facing * entry.flipSign;
  entry.targetAlpha = fd.o;
  entry.targetZIndex = fd.z;
  entry.targetTint = brightnessTint(fd.br ?? 1);
}

export function initRenderer(app: Application) {
  rendererApp = app;
  for (let layerIndex = 0; layerIndex < 3; layerIndex++) {
    ensureFishLayerContainer(layerIndex);
  }
}

function ensureFishLayerContainer(layerIndex: number): Container | undefined {
  const existing = fishLayerContainers.get(layerIndex);
  if (existing) return existing;
  if (!rendererApp) return undefined;
    const container = new Container();
    container.sortableChildren = true;
    fishLayerContainers.set(layerIndex, container);
  rendererApp.stage.addChild(container);
  return container;
}

export function setDisplayNumber(value?: number): void {
  displayNumber = value;
}

export function updateBackground(app: Application, url: string): void {
  backgroundUrl = url;
  if (!url) {
    backgroundSprite?.destroy();
    backgroundSprite = null;
    return;
  }
  void Assets.load<Texture>(url).then(texture => {
    if (backgroundUrl !== url) return;
    if (!backgroundSprite) {
      backgroundSprite = new Sprite(texture);
      backgroundSprite.zIndex = -1000;
      app.stage.addChild(backgroundSprite);
    } else {
      backgroundSprite.texture = texture;
    }
    layoutBackground();
  });
}

function layoutBackground(): void {
  if (!backgroundSprite) return;
  backgroundSprite.x = -STATE.VP.x * STATE.scaleX;
  backgroundSprite.y = -STATE.VP.y * STATE.scaleY;
  backgroundSprite.width = STATE.WORLD_W * STATE.scaleX;
  backgroundSprite.height = STATE.WORLD_H * STATE.scaleY;
}

export function buildPlaceholder(app: Application): Texture {
  const g = new Graphics();
  g.circle(0, 0, 12).fill({ color: 0x4a90b8, alpha: 0.25 });
  return app.renderer.generateTexture(g);
}

export function renderSceneObjects(app: Application, objects: WorldObject[]): void {
  sceneContainer?.destroy({ children: true });
  sceneContainer = new Container();
  sceneContainer.zIndex = 50;  // 魚の下、テストパターンの上
  app.stage.addChild(sceneContainer);

  const sorted = [...objects].sort((a, b) => a.zIndex - b.zIndex);
  for (const obj of sorted) {
    const sx = (obj.x - STATE.VP.x) * STATE.scaleX;
    const sy = (obj.y - STATE.VP.y) * STATE.scaleY;
    const sw = obj.width  * STATE.scaleX;
    const sh = obj.height * STATE.scaleY;

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
      const sW = (obj.strokeWidth ?? 1) * Math.min(STATE.scaleX, STATE.scaleY);
      
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

export function updateLayersView(app: Application): void {
  const layers = STATE.layers || [];
  
  // 魚レイヤーごとに別コンテナを使い、画像レイヤーとの前後関係も反映する。
  for (const [layerIndex, container] of fishLayerContainers) {
    const fishLayer = layers.find(l => l.id === `layer_fish_${layerIndex}`);
    container.zIndex = fishLayer?.zIndex ?? [100, 50, 10][layerIndex] ?? 50;
    container.alpha = 1;
    container.visible = fishLayer?.visible ?? true;
  }

  // 画像レイヤーの更新・追加
  const currentImageLayerIds = new Set<string>();
  
  for (const layer of layers) {
    if (layer.type !== "image") continue;
    currentImageLayerIds.add(layer.id);

    let sprite = imageLayerSprites.get(layer.id);
    if (!sprite) {
      sprite = new Sprite();
      sprite.anchor.set(0);
      app.stage.addChild(sprite);
      imageLayerSprites.set(layer.id, sprite);
    }
    
    sprite.zIndex = layer.zIndex;
    sprite.alpha = layer.opacity;
    sprite.visible = layer.visible;
    // ワールド座標からViewport座標へ変換して指定範囲に描画
    const imgX = layer.x ?? 0;
    const imgY = layer.y ?? 0;
    const imgW = layer.width ?? STATE.WORLD_W;
    const imgH = layer.height ?? STATE.WORLD_H;

    const sx = (imgX - STATE.VP.x) * STATE.scaleX;
    const sy = (imgY - STATE.VP.y) * STATE.scaleY;
    sprite.x = sx;
    sprite.y = sy;
    sprite.width = imgW * STATE.scaleX;
    sprite.height = imgH * STATE.scaleY;

    // テクスチャロード（URLが変更・新規の場合）
    if (layer.url && sprite.texture.label !== layer.url) {
      void Assets.load<Texture>(layer.url).then(tex => {
        if (sprite && !sprite.destroyed) {
          sprite.texture = tex;
          sprite.texture.label = layer.url;
        }
      });
    }
  }

  // 削除された画像レイヤーのクリーンアップ
  for (const [id, sprite] of imageLayerSprites.entries()) {
    if (!currentImageLayerIds.has(id)) {
      sprite.destroy();
      imageLayerSprites.delete(id);
    }
  }
}

export function drawTestPattern(app: Application, pattern: TestPattern): void {
  currentPattern = pattern;
  testGraphics?.destroy();
  testGraphics = null;
  document.getElementById("worldmap-overlay")?.remove();
  document.getElementById("calibration-overlay")?.remove();
  document.getElementById("gradient-overlay")?.remove();
  if (pattern === "off") {
    document.getElementById("vp-overlay")?.remove();
    return;
  }

  const g = new Graphics();
  g.zIndex = 10000;

  const ww = window.innerWidth;
  const wh = window.innerHeight;

  switch (pattern) {
    case "white": g.rect(0, 0, ww, wh).fill({ color: 0xffffff }); break;
    case "black": g.rect(0, 0, ww, wh).fill({ color: 0x000000 }); break;

    case "colorbars": {
      const bars = [0xffffff, 0xffff00, 0x00ffff, 0x00ff00, 0xff00ff, 0xff0000, 0x0000ff, 0x000000];
      const barW = ww / bars.length;
      bars.forEach((color, i) => g.rect(i * barW, 0, barW + 1, wh * 0.72).fill({ color }));
      const gray = [0xffffff, 0xd9d9d9, 0xb6b6b6, 0x929292, 0x6d6d6d, 0x494949, 0x242424, 0x000000];
      gray.forEach((color, i) => g.rect(i * barW, wh * 0.72, barW + 1, wh * 0.28).fill({ color }));
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

    case "gradient": {
      const canvas = document.createElement("canvas");
      canvas.id = "gradient-overlay";
      canvas.width = ww;
      canvas.height = wh;
      Object.assign(canvas.style, { position: "fixed", inset: "0", width: "100%", height: "100%", zIndex: "10001", pointerEvents: "none" });
      const ctx = canvas.getContext("2d")!;
      const horizontal = ctx.createLinearGradient(0, 0, ww, 0);
      horizontal.addColorStop(0, "#000000");
      horizontal.addColorStop(0.25, "#ff0000");
      horizontal.addColorStop(0.5, "#00ff00");
      horizontal.addColorStop(0.75, "#0000ff");
      horizontal.addColorStop(1, "#ffffff");
      ctx.fillStyle = horizontal;
      ctx.fillRect(0, 0, ww, wh * 0.65);
      const vertical = ctx.createLinearGradient(0, wh * 0.65, 0, wh);
      vertical.addColorStop(0, "#ffffff");
      vertical.addColorStop(1, "#000000");
      ctx.fillStyle = vertical;
      ctx.fillRect(0, wh * 0.65, ww, wh * 0.35);
      document.body.appendChild(canvas);
      break;
    }

    case "identify": {
      // 水槽の位置関係を見ながら識別できるよう、背景は塗り潰さず番号だけを重ねる。
      let calDiv = document.getElementById("calibration-overlay");
      if (!calDiv) {
        calDiv = document.createElement("div");
        calDiv.id = "calibration-overlay";
        document.body.appendChild(calDiv);
      }
      Object.assign(calDiv.style, {
        position: "fixed", inset: "0", display: "flex", alignItems: "center",
        justifyContent: "center", pointerEvents: "none", zIndex: "10001",
      });
      calDiv.innerHTML = `<div style="font-family:monospace;color:#fff;font-size:min(52vw,52vh);line-height:1;font-weight:900;text-shadow:0 0 18px #000,0 0 40px #000,0 0 70px #00aaff;-webkit-text-stroke:4px #001a3a">${displayNumber ?? "?"}</div>`;
      break;
    }
    // calibration は詳細調整用なので従来どおり全面パターンを表示する。
    case "calibration": {
      g.rect(0, 0, ww, wh).fill({ color: 0x0a0820 });
      g.setStrokeStyle({ width: 6, color: 0x00aaff });
      g.rect(6, 6, ww - 12, wh - 12).stroke();
      const cx2 = ww / 2, cy2 = wh / 2;
      g.setStrokeStyle({ width: 3, color: 0xffffff, alpha: 0.4 });
      g.moveTo(cx2, 0).lineTo(cx2, wh);
      g.moveTo(0, cy2).lineTo(ww, cy2);
      g.stroke();
      
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
        <div style="font-family:monospace;color:#ffffff;font-size:32vw;line-height:0.85;font-weight:900;text-shadow:0 0 40px #00aaff">${displayNumber ?? "?"}</div>
        <div style="font-family:monospace;color:#00aaff;font-size:4vw;font-weight:bold;margin-top:0.3em">${DISPLAY_ID}</div>
        <div style="font-family:monospace;color:#ffffff;font-size:3vw;margin-top:1em;opacity:0.7">
          ${STATE.VP.width}&times;${STATE.VP.height} &nbsp;|&nbsp; scale: ${STATE.VP.scale} &nbsp;|&nbsp; pos: (${STATE.VP.x}, ${STATE.VP.y})
        </div>
      `;
      break;
    }

    case "worldmap": {
      g.rect(0, 0, ww, wh).fill({ color: 0x000820 });

      const wStep = 100;
      const wx0 = Math.floor(STATE.VP.x / wStep) * wStep;
      const wy0 = Math.floor(STATE.VP.y / wStep) * wStep;
      const wRight  = STATE.VP.x + STATE.VP.width;
      const wBottom = STATE.VP.y + STATE.VP.height;
      g.setStrokeStyle({ width: 0.5, color: 0x1a4a7a, alpha: 0.9 });
      for (let wx = wx0; wx <= wRight;  wx += wStep) g.moveTo((wx - STATE.VP.x) * STATE.scaleX, 0).lineTo((wx - STATE.VP.x) * STATE.scaleX, wh);
      for (let wy = wy0; wy <= wBottom; wy += wStep) g.moveTo(0, (wy - STATE.VP.y) * STATE.scaleY).lineTo(ww, (wy - STATE.VP.y) * STATE.scaleY);
      g.stroke();

      const mStep = 500;
      const mx0 = Math.floor(STATE.VP.x / mStep) * mStep;
      const my0 = Math.floor(STATE.VP.y / mStep) * mStep;
      g.setStrokeStyle({ width: 1.5, color: 0x2a7acc, alpha: 0.9 });
      for (let wx = mx0; wx <= wRight;  wx += mStep) g.moveTo((wx - STATE.VP.x) * STATE.scaleX, 0).lineTo((wx - STATE.VP.x) * STATE.scaleX, wh);
      for (let wy = my0; wy <= wBottom; wy += mStep) g.moveTo(0, (wy - STATE.VP.y) * STATE.scaleY).lineTo(ww, (wy - STATE.VP.y) * STATE.scaleY);
      g.stroke();

      if (STATE.VP.x <= 0 && STATE.VP.y <= 0 && wRight >= 0 && wBottom >= 0) {
        const ox = -STATE.VP.x * STATE.scaleX;
        const oy = -STATE.VP.y * STATE.scaleY;
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

  ctx.fillStyle = "#4a9aff";
  ctx.font = `bold ${Math.round(13 * STATE.scaleY)}px monospace`;
  ctx.textBaseline = "top";
  const mStep = 500;
  const mx0 = Math.ceil(STATE.VP.x / mStep) * mStep;
  const my0 = Math.ceil(STATE.VP.y / mStep) * mStep;
  const wRight  = STATE.VP.x + STATE.VP.width;
  const wBottom = STATE.VP.y + STATE.VP.height;

  for (let wx = mx0; wx < wRight; wx += mStep) {
    ctx.fillText(String(wx), (wx - STATE.VP.x) * STATE.scaleX + 3, 3 * STATE.scaleY);
  }
  for (let wy = my0; wy < wBottom; wy += mStep) {
    ctx.fillText(String(wy), 3, (wy - STATE.VP.y) * STATE.scaleY + 2 * STATE.scaleY);
  }

  ctx.fillStyle = "rgba(0,8,32,0.8)";
  ctx.fillRect(0, 0, ctx.measureText(`ID: ${DISPLAY_ID}`).width + 12 * STATE.scaleX, 24 * STATE.scaleY);
  ctx.fillStyle = "#7ec8e3";
  ctx.font = `${Math.round(11 * STATE.scaleY)}px monospace`;
  ctx.fillText(`ID: ${DISPLAY_ID}  [${STATE.VP.x},${STATE.VP.y} / ${STATE.VP.width}×${STATE.VP.height}]`, 6, 6);

  const WORLD_W = STATE.WORLD_W;
  const WORLD_H = STATE.WORLD_H;
  const MINI_W_CSS = 200;
  const MINI_H_CSS = Math.round(MINI_W_CSS * WORLD_H / WORLD_W);
  // Canvasの内部サイズをCSSピクセルに合わせているため、ここではDPRを重ねない。
  const pR = 1;
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

  const vpMiniX = MINI_X + (STATE.VP.x / WORLD_W) * MINI_W;
  const vpMiniY = MINI_Y + (STATE.VP.y / WORLD_H) * MINI_H;
  const vpMiniW = (STATE.VP.width / WORLD_W) * MINI_W;
  const vpMiniH = (STATE.VP.height / WORLD_H) * MINI_H;
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
    Viewport: x=${STATE.VP.x}, y=${STATE.VP.y}<br>
    Size: ${STATE.VP.width} × ${STATE.VP.height}<br>
    Scale: ${STATE.VP.scale}<br>
    Screen: ${window.screen.width} × ${window.screen.height}
  `.trim();
  document.body.appendChild(div);
}

// ----------------------------------------------------
// Updater Loop
// ----------------------------------------------------

export function applyViewport(app: Application, silent = false): void {
  document.getElementById("worldmap-overlay")?.remove();
  document.getElementById("calibration-overlay")?.remove();
  app.renderer.resize(window.innerWidth, window.innerHeight);
  
  if (!silent) {
    if (currentPattern !== "off") drawTestPattern(app, currentPattern);
    else document.getElementById("vp-overlay")?.remove();
  }
  
  if (currentScene.length > 0) renderSceneObjects(app, currentScene);
  layoutBackground();
  updateLayersView(app);
}

export function spawnFish(app: Application, fishMap: Map<string, FishEntry>, fd: UdpFishData, sx: number, sy: number, appliedScale: number): void {
  const texture = fd.u ? getLoadedFishTexture(fd.u) ?? buildPlaceholder(app) : buildPlaceholder(app);
  
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.x = sx; sprite.y = sy;
  sprite.rotation = fd.r;
  // vx < 0 のとき（左向き移動）は scaleX を反転して画像を左向きにする
  const facing = fd.d ?? 1;
  const flipSign = fd.fx ? -1 : 1;
  const initialScale = normalizedFishScale(texture, appliedScale);
  sprite.scale.set(initialScale * facing * flipSign, initialScale);
  sprite.alpha = fd.o;
  sprite.tint = brightnessTint(fd.br ?? 1);
  sprite.zIndex = fd.z;
  const layerIndex = fd.l ?? 0;
  (ensureFishLayerContainer(layerIndex) ?? ensureFishLayerContainer(0))?.addChild(sprite);
  const entry: FishEntry = {
    sprite,
    textureUrl: fd.u,
    textureReady: Boolean(fd.u && getLoadedFishTexture(fd.u)),
    layerIndex,
    desiredScale: appliedScale,
    facing,
    flipSign,
    targetBeat: fd.b ?? 0,
    targetX: sx,
    targetY: sy,
    targetRotation: fd.r,
    targetScale: initialScale * facing * flipSign,
    targetAlpha: fd.o,
    targetZIndex: fd.z,
    targetTint: brightnessTint(fd.br ?? 1),
  };
  fishMap.set(fd.i, entry);
  if (fd.u) updateFishTexture(fd.i, fd.u, fishMap);
}

export function destroyFish(fishMap: Map<string, FishEntry>, id: string): void {
  const e = fishMap.get(id);
  if (!e) return;
  e.sprite.destroy();
  fishMap.delete(id);
}

export function updateFishTexture(id: string, textureUrl: string, fishMap: Map<string, FishEntry>) {
  const entry = fishMap.get(id);
  if (!entry) return;
  if (entry.textureUrl !== textureUrl) {
    entry.textureUrl = textureUrl;
    entry.textureReady = false;
  }
  if (entry.textureReady) return;

  void requestFishTexture(textureUrl)
    .then((texture) => {
      const current = fishMap.get(id);
      if (!current || current.textureUrl !== textureUrl) return;
      current.sprite.texture = texture;
      current.textureReady = true;
      current.targetScale = normalizedFishScale(texture, current.desiredScale) * current.facing * current.flipSign;
    })
    .catch(() => undefined);
}

export function setupRenderLoop(app: Application, fishMap: Map<string, FishEntry>) {
  app.ticker.add(() => {
    for (const [, e] of fishMap) {
      const s = e.sprite;
      s.x        = lerp(s.x, e.targetX, 0.12);
      s.y        = lerp(s.y, e.targetY, 0.12);
      s.rotation = lerpAngle(s.rotation, e.targetRotation, 0.08);
      // targetScale は符号込み（負なら左向き反転）なので符号を保持したままLerp
      const sign = e.targetScale < 0 ? -1 : 1;
      const absTarget = Math.abs(e.targetScale);
      const absScale  = Math.abs(s.scale.x);
      const beatSquash = 1 + e.targetBeat * 0.025;
      s.scale.set(lerp(absScale, absTarget, 0.05) * sign, lerp(Math.abs(s.scale.y), absTarget * beatSquash, 0.08));
      s.skew.y = lerp(s.skew.y, e.targetBeat * 0.045 * sign, 0.12);
      s.alpha    = lerp(s.alpha, e.targetAlpha, 0.05);
      if (s.tint !== e.targetTint) s.tint = e.targetTint;
      if (s.zIndex !== e.targetZIndex) s.zIndex = e.targetZIndex;
    }
  });
}

function brightnessTint(brightness: number): number {
  const channel = Math.round(Math.max(0.18, Math.min(brightness, 1)) * 255);
  return (channel << 16) | (channel << 8) | channel;
}
