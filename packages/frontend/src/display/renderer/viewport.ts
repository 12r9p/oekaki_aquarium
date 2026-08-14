import { Application } from "pixi.js";
import { currentPattern, drawTestPattern } from "./test-pattern-overlay";
import { getCurrentScene, renderSceneObjects, layoutBackground, updateLayersView } from "./scene-renderer";

// ============================================================
// display/renderer/viewport.ts
// リサイズ/viewport変更時に各描画レイヤーを再適用するグルー処理
// ============================================================

export function applyViewport(app: Application, silent = false): void {
  document.getElementById("worldmap-overlay")?.remove();
  document.getElementById("calibration-overlay")?.remove();
  app.renderer.resize(window.innerWidth, window.innerHeight);

  if (!silent) {
    if (currentPattern !== "off") drawTestPattern(app, currentPattern);
    else document.getElementById("vp-overlay")?.remove();
  }

  const currentScene = getCurrentScene();
  if (currentScene.length > 0) renderSceneObjects(app, currentScene);
  layoutBackground();
  updateLayersView(app);
}
