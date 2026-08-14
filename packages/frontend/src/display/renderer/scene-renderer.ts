import { Application, Sprite, Texture, Graphics, Assets, Container } from "pixi.js";
import { STATE } from "../state";
import type { WorldObject } from "@aquarium/shared";
import { syncFishLayerVisibility } from "./fish-renderer";

// ============================================================
// display/renderer/scene-renderer.ts
// 背景・シーンオブジェクト・画像レイヤーの描画
// ============================================================

let sceneContainer: Container | null = null;
let currentScene: WorldObject[] = [];
let backgroundSprite: Sprite | null = null;
let backgroundUrl = "";

const imageLayerSprites = new Map<string, Sprite>();

export function getCurrentScene(): WorldObject[] {
  return currentScene;
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

export function layoutBackground(): void {
  if (!backgroundSprite) return;
  backgroundSprite.x = -STATE.VP.x * STATE.scaleX;
  backgroundSprite.y = -STATE.VP.y * STATE.scaleY;
  backgroundSprite.width = STATE.WORLD_W * STATE.scaleX;
  backgroundSprite.height = STATE.WORLD_H * STATE.scaleY;
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
  syncFishLayerVisibility(layers);

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
