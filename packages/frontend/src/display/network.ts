import { createWsClient } from "../shared/useWs";
import { STATE, DISPLAY_ID, updateStateVP, updateWorldSize, updateLayers } from "./state";
import {
  spawnFish,
  destroyFish,
  updateFishTexture,
  updateFishTargets,
  type FishEntry
} from "./renderer/fish-renderer";
import { LAYER_CONFIG } from "@aquarium/shared";
import { renderSceneObjects, updateBackground } from "./renderer/scene-renderer";
import { drawTestPattern, currentPattern, setDisplayNumber } from "./renderer/test-pattern-overlay";
import { applyViewport } from "./renderer/viewport";
import type { ActiveFish, WsServerMessage, UdpFishData, UdpPacket } from "@aquarium/shared";
import { Application } from "pixi.js";

// ============================================================
// display/network.ts
// WebSocket接続とサーバーからのメッセージ受信ハンドリング
// ============================================================

export const ws = createWsClient(`display:${DISPLAY_ID}`);

export function setupNetwork(app: Application, fishMap: Map<string, FishEntry>) {
  const applyFrame = (packet: UdpPacket): void => {
    const receivedIds = new Set<string>();

    for (const fd of packet.f) {
      receivedIds.add(fd.i);
      const screenX = (fd.x - STATE.VP.x) * STATE.scaleX;
      const screenY = (fd.y - STATE.VP.y) * STATE.scaleY;
      const inView = fd.x >= STATE.VP.x - 200 && fd.x <= STATE.VP.x + STATE.VP.width + 200 &&
                     fd.y >= STATE.VP.y - 200 && fd.y <= STATE.VP.y + STATE.VP.height + 200;
      if (!inView) { destroyFish(fishMap, fd.i); continue; }

      const fishScale = fd.s * Math.min(STATE.scaleX, STATE.scaleY);

      if (!fishMap.has(fd.i)) {
        spawnFish(app, fishMap, fd, screenX, screenY, fishScale);
      } else {
        const entry = fishMap.get(fd.i)!;
        updateFishTargets(entry, fd, screenX, screenY, fishScale);
        if (fd.u && (!entry.textureReady || entry.textureUrl !== fd.u)) {
          updateFishTexture(fd.i, fd.u, fishMap);
        }
      }
    }
    for (const id of fishMap.keys()) {
      if (!receivedIds.has(id)) destroyFish(fishMap, id);
    }
  };

  const createSnapshotFrame = (fish: ActiveFish[]): UdpPacket => ({
    t: Date.now(),
    e: [],
    f: fish
      .filter((item) => !item.isArchived && !item.isAutoHidden)
      .map((item): UdpFishData => {
        const layer = LAYER_CONFIG[item.layerIndex];
        const vx = item.physics.vel.x;
        const vy = item.physics.vel.y;
        const direction = item.userParams.direction === "left" ? -1 : item.userParams.direction === "right" ? 1 : vx < 0 ? -1 : 1;
        return {
          i: item.id.slice(0, 8),
          x: item.physics.pos.x,
          y: item.physics.pos.y,
          r: Math.max(-0.55, Math.min(0.55, Math.atan2(vy, Math.max(Math.abs(vx), 0.25)))),
          s: item.targetScale,
          o: item.targetOpacity,
          z: layer?.zIndex ?? 50,
          l: item.layerIndex,
          u: item.textureUrl,
          d: direction,
          fx: item.userParams.flipX ?? false,
          br: layer?.opacity ?? 1,
          vx,
        };
      }),
  });

  ws.onMessage((msg: WsServerMessage) => {
    if (msg.event === "reload_images") {
      location.reload();
      return;
    }

    if (msg.event === "state_snapshot") {
      if (msg.displayNumber !== undefined) document.title = `Display:${msg.displayNumber}`;
      if (msg.viewport) updateStateVP(msg.viewport);
      updateWorldSize(msg.worldW, msg.worldH);
      updateLayers(msg.layers);
      updateBackground(app, msg.bgUrl);
      applyViewport(app);
      renderSceneObjects(app, msg.scene);
      if (currentPattern === "worldmap") drawTestPattern(app, "worldmap");
      else if (currentPattern === "off") applyFrame(createSnapshotFrame(msg.activeFish));
      return;
    }
    // Viewport設定・更新
    if (msg.event === "config") {
      if (msg.displayNumber !== undefined) document.title = `Display:${msg.displayNumber}`;
      updateStateVP(msg.viewport);
      updateWorldSize(msg.worldW, msg.worldH);
      if (msg.layers) updateLayers(msg.layers);
      updateBackground(app, msg.bgUrl);
      applyViewport(app);
      if (currentPattern === "worldmap") drawTestPattern(app, "worldmap");
      return;
    }
    
    // 背景・レイヤー・ワールド設定更新
    if (msg.event === "update_world_config") {
      if (msg.layers) updateLayers(msg.layers);
      updateBackground(app, msg.bgUrl);
      applyViewport(app);
      if (currentPattern === "worldmap") drawTestPattern(app, "worldmap");
      return;
    }
    
    if (msg.event === "update_viewport") {
      updateStateVP(msg.viewport);
      applyViewport(app);
      return;
    }

    // World size更新
    if (msg.event === "update_world_size") {
      updateWorldSize(msg.width, msg.height);
      if (currentPattern === "worldmap") drawTestPattern(app, "worldmap");
      return;
    }

    // リアルタイムプレビュー
    if (msg.event === "viewport_preview") {
      updateStateVP(msg.viewport);
      applyViewport(app, true);
      // WorldMap表示中はViewport変更に合わせて即座に再描画する
      if (currentPattern === "worldmap") drawTestPattern(app, "worldmap");
      return;
    }

    // シーンオブジェクト更新
    if (msg.event === "scene_update") {
      renderSceneObjects(app, msg.objects);
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
      
      const viewX = (msg.x - STATE.VP.x) * STATE.scaleX;
      const viewY = (msg.y - STATE.VP.y) * STATE.scaleY;

      // 表示範囲内なら表示、範囲外なら隠す
      const inView = msg.x >= STATE.VP.x && msg.x <= STATE.VP.x + STATE.VP.width &&
                     msg.y >= STATE.VP.y && msg.y <= STATE.VP.y + STATE.VP.height;
      
      pointer.style.left = `${viewX}px`;
      pointer.style.top = `${viewY}px`;
      pointer.style.opacity = inView ? "1" : "0";
      
      // 1秒間更新がなければ消す
      clearTimeout(Number(pointer.dataset.timer));
      pointer.dataset.timer = String(setTimeout(() => { pointer && (pointer.style.opacity = "0"); }, 1000));
      return;
    }

    // UDPフレームデータ
    if (msg.event === "frame") {
      if (currentPattern !== "off") return;
      const packet = msg as unknown as { event: "frame" } & UdpPacket;
      applyFrame(packet);
      return;
    }

    if (msg.event === "test_pattern") {
      setDisplayNumber(msg.displayNumber);
      drawTestPattern(app, msg.pattern);
      return;
    }

    if (msg.event === "fish_released") {
      updateFishTexture(msg.fish.id.slice(0, 8), msg.fish.textureUrl, fishMap);
      return;
    }
  });
}
