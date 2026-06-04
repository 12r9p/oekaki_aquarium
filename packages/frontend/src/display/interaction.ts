import { Application } from "pixi.js";
import { STATE, updateStateVP, DISPLAY_ID } from "./state";
import { ws } from "./network";
import { api } from "../shared/api";

// ============================================================
// display/interaction.ts
// Display画面上でのマウス・タッチイベントを処理し、
// 餌やり（クリック）やViewport位置調整（ドラッグ）を行う
// ============================================================

export function setupInteractions(app: Application) {
  // canvasに対するポインターイベントを有効化 (CSS側でpointerEvents: autoも必要)
  app.canvas.style.cursor = "grab";
  app.canvas.style.pointerEvents = "auto";

  let isDragging = false;
  let startClientX = 0;
  let startClientY = 0;
  let startVPX = 0;
  let startVPY = 0;
  let dragDistance = 0;

  // GlobalからScreenへの変換ではなく、Screen (CSS px) からWorld座標への逆変換
  function getHoverWorldPos(clientX: number, clientY: number): { x: number, y: number } {
    return {
      x: STATE.VP.x + (clientX / STATE.scaleX),
      y: STATE.VP.y + (clientY / STATE.scaleY)
    };
  }

  // --- Pointer Down (ドラッグ開始) ---
  app.canvas.addEventListener("pointerdown", (e) => {
    isDragging = true;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startVPX = STATE.VP.x;
    startVPY = STATE.VP.y;
    dragDistance = 0;
    app.canvas.style.cursor = "grabbing";
    e.preventDefault();
  });

  // --- Pointer Move (ドラッグ中移動) ---
  app.canvas.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startClientX;
    const dy = e.clientY - startClientY;
    dragDistance = Math.sqrt(dx * dx + dy * dy);

    // CSS上のマウスマイナス移動量 = World座標上のプラス移動量 (カメラ視点)
    const newVpX = Math.round(startVPX - (dx / STATE.scaleX));
    const newVpY = Math.round(startVPY - (dy / STATE.scaleY));

    // ドラッグ中のリアルタイムプレビューをローカルで即座に見せるためにSTATEを更新
    updateStateVP({
      ...STATE.VP,
      x: newVpX,
      y: newVpY
    });

    // リサイズ同様にレンダラーを更新させる必要がある場合は外部のコールバックを呼ぶか、
    // （今回はPixiの描画位置自体はズレず、中のオブジェクトの位置計算で考慮される）
    // updateStateVPが実行されれば次フレームからずれて描画される
  });

  // --- Pointer Up / Cancel (ドラッグ終了 または タップ判定) ---
  const handlePointerUp = (e: PointerEvent) => {
    if (!isDragging) return;
    isDragging = false;
    app.canvas.style.cursor = "grab";

    // 移動距離がわずかなら「タップ（クリック）」とみなして餌やり
    if (dragDistance < 10) {
      const { x: wx, y: wy } = getHoverWorldPos(e.clientX, e.clientY);
      // /api/release へ ダミーの餌(エサ画像) を追加送信
      void api.request("/api/release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: "/images/food.png", // 既存のエサ画像
          worldX: wx,
          worldY: wy
        })
      });
      console.log(`[Interaction] Tapped to feed at World(${wx.toFixed()}, ${wy.toFixed()})`);
    } else {
      // 実際にある程度ドラッグ移動した場合は、新しいViewport位置をサーバーへ永続保存要求
      ws.send({
        event: "update_viewport",
        clientInfo: {
          uuid: DISPLAY_ID,
          name: DISPLAY_ID,
          viewport: STATE.VP,
          debug: { showGrid: false, showId: false }
        }
      });
      console.log(`[Interaction] Dragged to new VP(${STATE.VP.x}, ${STATE.VP.y}) -> Saved to server`);
    }
  };

  app.canvas.addEventListener("pointerup", handlePointerUp);
  app.canvas.addEventListener("pointercancel", handlePointerUp);
  app.canvas.addEventListener("pointerleave", handlePointerUp);
}
