import { Application, Sprite, Texture, Graphics, Container } from "pixi.js";
import { STATE } from "../state";
import type { UdpFishData, AppLayerConfig } from "@aquarium/shared";
import { getLoadedFishTexture, requestFishTexture } from "../fish-texture-loader";

// ============================================================
// display/renderer/fish-renderer.ts
// 魚スプライトの生成・更新・アニメーションループ
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

const fishLayerContainers = new Map<number, Container>();
const FISH_BASE_SIZE = 48;
let rendererApp: Application | null = null;

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

function brightnessTint(brightness: number): number {
  const channel = Math.round(Math.max(0.18, Math.min(brightness, 1)) * 255);
  return (channel << 16) | (channel << 8) | channel;
}

function buildPlaceholder(app: Application): Texture {
  const g = new Graphics();
  g.circle(0, 0, 12).fill({ color: 0x4a90b8, alpha: 0.25 });
  return app.renderer.generateTexture(g);
}

export function initFishLayers(app: Application) {
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

export function syncFishLayerVisibility(layers: AppLayerConfig[]): void {
  for (const [layerIndex, container] of fishLayerContainers) {
    const fishLayer = layers.find(l => l.id === `layer_fish_${layerIndex}`);
    container.zIndex = fishLayer?.zIndex ?? [100, 50, 10][layerIndex] ?? 50;
    container.alpha = 1;
    container.visible = fishLayer?.visible ?? true;
  }
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
      const beatSquash = 1 + e.targetBeat * 0.012;
      s.scale.set(lerp(absScale, absTarget, 0.05) * sign, lerp(Math.abs(s.scale.y), absTarget * beatSquash, 0.08));
      s.skew.y = lerp(s.skew.y, e.targetBeat * 0.018 * sign, 0.10);
      s.alpha    = lerp(s.alpha, e.targetAlpha, 0.05);
      if (s.tint !== e.targetTint) s.tint = e.targetTint;
      if (s.zIndex !== e.targetZIndex) s.zIndex = e.targetZIndex;
    }
  });
}
