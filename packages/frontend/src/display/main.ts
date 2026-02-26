import "../styles/global.css";
import { Application } from "pixi.js";
import { DISPLAY_ID, STATE, updateStateVP } from "./state";
import { setupNetwork } from "./network";
import { applyViewport, setupRenderLoop, currentPattern, drawTestPattern, initRenderer, type FishEntry } from "./renderer";
import { setupInteractions } from "./interaction";

// ============================================================
// display/main.ts
// エントリーポイント: 分割したモジュールを統合する
// ============================================================

async function main(): Promise<void> {
  // 1. App 初期化
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
  document.title = `Display: ${DISPLAY_ID}`;

  // 初期スケールの計算
  updateStateVP(STATE.VP);

  // ウィンドウリサイズ監視
  window.addEventListener("resize", () => {
    updateStateVP(STATE.VP);
    applyViewport(app);
  });

  // 初期パターンの描画
  if (currentPattern !== "off") {
    drawTestPattern(app, currentPattern);
  }

  // 2. モジュールのセットアップ
  initRenderer(app);
  const fishMap = new Map<string, FishEntry>();
  
  // マウス/タッチ インタラクション (タップ餌やり、ドラッグ移動)
  setupInteractions(app);
  
  // 通信ハンドリング (Viewport更新、シーン描画、魚位置のUDPフレーム等)
  setupNetwork(app, fishMap);
  
  // 描画ループ処理 (Pixi.js ticker でのLerpなど)
  setupRenderLoop(app, fishMap);
}

// 起動
main().catch(console.error);
