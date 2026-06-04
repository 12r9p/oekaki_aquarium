import type { ServerWebSocket } from "bun";
import type { WsClientMessage, WsServerMessage, TestPattern, DisplayClientInfo, ClientConfig, WorldObject } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { foodItems } from "./physics/boundaries";
import { registerClientViewport, unregisterClient, setWorldSize, getWorld,
  updateForbiddenZones,
  updateSpawnPoints,
  updateLayers,
} from "./world";
import { getAllActiveFish, getPendingQueue } from "./fish-manager";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// ws-handler.ts（Bun ネイティブ WebSocket 版）
// ============================================================
// グローバルな水槽背景状態（再起動でリセット）
// ============================================================
let currentBgUrl = "";

/** 現在の背景画像URLを取得する */
export function getCurrentBgUrl(): string { return currentBgUrl; }

// ============================================================
// Store / State
// ============================================================

export interface ClientData {
  uuid: string;
  clientType: string;
  lastHeartbeat: number;
  screenW: number;
  screenH: number;
  viewport: ClientConfig["viewport"] | null;
  testPattern: TestPattern;
}

const sockets = new Set<ServerWebSocket<ClientData>>();

/**
 * displayIDごとにViewportを永続保存するMap。
 * これにより、displayが再接続しても管理画面で設定したViewportが維持される。
 * サーバー再起動でリセットされる（永続化が必要な場合はファイルに書き出す）。
 */
const viewportStore = new Map<string, NonNullable<ClientConfig["viewport"]>>();

/** 切断されたディスプレイの履歴を一定期間（猶予期間）保持するためのリスト */
let disconnectedDisplays: DisplayClientInfo[] = [];

/**
 * シーンオブジェクトのストア。
 * WorldObject[] をサーバーIn-memoryで管理。
 * ブロードキャスト時は全displayとmanageに送信。
 */
let sceneObjects: WorldObject[] = [];

export function getScene(): WorldObject[] { return sceneObjects; }

export function addSceneObject(obj: WorldObject): void {
  sceneObjects.push(obj);
  broadcastSceneUpdate();
}

export function updateSceneObject(id: string, patch: Partial<WorldObject>): boolean {
  const idx = sceneObjects.findIndex(o => o.id === id);
  if (idx === -1) return false;
  sceneObjects[idx] = { ...sceneObjects[idx]!, ...patch, id };
  broadcastSceneUpdate();
  return true;
}

export function deleteSceneObject(id: string): boolean {
  const before = sceneObjects.length;
  sceneObjects = sceneObjects.filter(o => o.id !== id);
  if (sceneObjects.length !== before) { broadcastSceneUpdate(); return true; }
  return false;
}

export function replaceScene(objects: WorldObject[]): void {
  sceneObjects = objects;
  broadcastSceneUpdate();
}

/** シーン更新をdisplay+manageにブロードキャスト */
function broadcastSceneUpdate(): void {
  const msg: WsServerMessage = { event: "scene_update", objects: sceneObjects };
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.data.clientType === "display" || ws.data.clientType === "manage") {
      ws.send(data);
    }
  }
}

// ---- ハンドラー -------------------------------------------------

export const wsHandlers = {
  open(ws: ServerWebSocket<ClientData>): void {
    ws.data = {
      uuid: uuidv4(),
      clientType: "unknown",
      lastHeartbeat: Date.now(),
      screenW: 1920,
      screenH: 1080,
      viewport: null,
      testPattern: "off",
    };
    sockets.add(ws);
    console.log(`[WS] Connected: ${ws.data.uuid}`);
  },

  message(ws: ServerWebSocket<ClientData>, raw: string | Buffer): void {
    let msg: WsClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as WsClientMessage;
    } catch {
      return;
    }
    handleMessage(ws, msg);
  },

  close(ws: ServerWebSocket<ClientData>): void {
    console.log(`[WS] Disconnected: ${ws.data.uuid} (${ws.data.clientType})`);
    
    // Displayクライアントが切断された場合、猶予リストへ追加する
    if (ws.data.clientType === "display") {
      // 既存の同名エントリがあれば削除
      disconnectedDisplays = disconnectedDisplays.filter(d => d.uuid !== ws.data.uuid);
      disconnectedDisplays.push({
        uuid: ws.data.uuid,
        clientType: ws.data.clientType,
        lastSeen: ws.data.lastHeartbeat,
        viewport: ws.data.viewport,
        testPattern: ws.data.testPattern,
        screenW: ws.data.screenW,
        screenH: ws.data.screenH,
        disconnectedAt: Date.now()
      });
    }
    
    sockets.delete(ws);
    // 管理画面に更新をプッシュ
    pushClientListToManagers();
  },
};

function handleMessage(ws: ServerWebSocket<ClientData>, msg: WsClientMessage): void {
  switch (msg.event) {
    case "register": {
      ws.data.uuid = msg.uuid;
      ws.data.screenW = msg.hardware.w;
      ws.data.screenH = msg.hardware.h;
      ws.data.lastHeartbeat = Date.now();

      // UUID の prefix から種別を判定（例: "display:left-monitor", "manage-uuid"）
      const prefix = msg.uuid.split(":")[0];
      ws.data.clientType = prefix.startsWith("display")    ? "display"
                         : prefix.startsWith("controller") ? "controller"
                         : prefix.startsWith("guest")      ? "guest"
                         : prefix.startsWith("manage")     ? "manage"
                         : "unknown";

      console.log(`[WS] Registered: ${msg.uuid} (${ws.data.clientType})`);

      if (ws.data.clientType === "display") {
        // 保存済みViewportがあれば復元、なければハードウェアサイズをデフォルトに
        const savedVp = viewportStore.get(msg.uuid);
        const vp: ClientConfig["viewport"] = savedVp ?? {
          x: 0, y: 0,
          width: msg.hardware.w,
          height: msg.hardware.h,
          scale: 1,
        };
        ws.data.viewport = vp;
        if (!savedVp) viewportStore.set(msg.uuid, vp); // 初回接続は保存
        const w = getWorld();
        sendTo(ws, {
          event: "config",
          viewport: vp,
          debug: { showGrid: false, showId: false },
          worldW: w.width,
          worldH: w.height,
          bgUrl: currentBgUrl,
          forbiddenZones: w.forbiddenZones,
          spawnPoints: w.spawnPoints,
          layers: w.layers,
        });
      }
      // 初回接続: シーンを送信
      if (ws.data.clientType === "display" || ws.data.clientType === "manage") {
        sendTo(ws, { event: "scene_update", objects: sceneObjects });
      }
      // 復帰した場合は disconnectedDisplays から除外
      if (ws.data.clientType === "display") {
        disconnectedDisplays = disconnectedDisplays.filter(d => d.uuid !== ws.data.uuid);
      }

      // 管理画面に接続クライアントリストを push
      pushClientListToManagers();
      break;
    }
    case "update_viewport":
      updateDisplayViewport(ws.data.uuid, msg.clientInfo.viewport);
      // Viewport（Display側）が動いたことを管理画面へ即時反映する
      pushStateToManagers();
      break;

    case "spawn_food":
      foodItems.push({
        id: uuidv4(),
        pos: { x: msg.x, y: msg.y },
        expiresAt: Date.now() + PHYSICS.FOOD_LIFETIME_MS,
      });
      break;

    case "viewport_preview": {
      // 管理画面からのドラッグ中リアルタイムプレビュー: 対象displayのみに転送
      const target = [...sockets].find(s => s.data.uuid === msg.displayUuid);
      if (target) sendTo(target, { event: "viewport_preview", viewport: msg.viewport });
      break;
    }

    case "pointer_move": {
      // 管理画面からのマウスポインター位置を全てのディスプレイに転送
      broadcastToDisplays({ event: "pointer_move", x: msg.x, y: msg.y });
      break;
    }
    // @ts-ignore
    case "update_world_size": {
      // 既存のイベント互換用（使わない方針だが残しておく）
      setWorldSize((msg as any).width, (msg as any).height);
      pushClientListToManagers();
      break;
    }

    case "update_world_config": {
      // 管理画面から背景や禁止エリアが更新されたら全体へ通知
      currentBgUrl = msg.bgUrl;
      updateForbiddenZones(msg.forbiddenZones);
      updateSpawnPoints(msg.spawnPoints);
      if (msg.layers) updateLayers(msg.layers);

      broadcastToAll({
        event: "update_world_config",
        bgUrl: currentBgUrl,
        forbiddenZones: msg.forbiddenZones,
        spawnPoints: msg.spawnPoints,
        layers: msg.layers,
      });
      // 管理画面のstate_pushもトリガー
      pushStateToManagers();
      break;
    }
  }
}

// ---- ユーティリティ -------------------------------------------

function sendTo(ws: ServerWebSocket<ClientData>, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** 全クライアントにブロードキャスト */
export function broadcastToAll(msg: WsServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) ws.send(data);
}

/** displayクライアントにのみ送る */
export function broadcastToDisplays(msg: WsServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.data.clientType === "display") ws.send(data);
  }
}

/** 描画フレームを display と管理画面のプレビューへ送る */
export function broadcastToRenderClients(msg: WsServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.data.clientType === "display" || ws.data.clientType === "manage") {
      ws.send(data);
    }
  }
}

/** 特定のdisplayクライアントに送る */
export function sendToDisplay(targetUuid: string, msg: WsServerMessage): boolean {
  for (const ws of sockets) {
    if (ws.data.uuid === targetUuid) {
      sendTo(ws, msg);
      return true;
    }
  }
  return false;
}

/** Viewport をサーバー側にも保存してdisplayに送信 */
export function updateDisplayViewport(targetUuid: string, viewport: ClientConfig["viewport"]): boolean {
  // ViewportをMapに永続保存（再接続後も維持される）
  if (viewport) viewportStore.set(targetUuid, viewport);
  for (const ws of sockets) {
    if (ws.data.uuid === targetUuid) {
      ws.data.viewport = viewport;
      sendTo(ws, { event: "update_viewport", targetUuid, viewport });
      pushClientListToManagers();
      return true;
    }
  }
  // 対象が切断中でも保存はしておく（再接続時に適用される）
  pushClientListToManagers();
  return false;
}

/** テストパターンを特定/全displayに送信 */
export function sendTestPattern(pattern: TestPattern, targetUuid?: string): void {
  if (targetUuid) {
    for (const ws of sockets) {
      if (ws.data.uuid === targetUuid) {
        ws.data.testPattern = pattern;
        sendTo(ws, { event: "test_pattern", pattern, targetUuid });
        return;
      }
    }
  } else {
    for (const ws of sockets) {
      if (ws.data.clientType === "display") {
        ws.data.testPattern = pattern;
        sendTo(ws, { event: "test_pattern", pattern });
      }
    }
  }
  pushClientListToManagers();
}

// --- 状態のブロードキャスト -----------------------------------------

/** [ServerLoop] 全manageクライアントへ同期状態(state_push)を送る */
export function pushStateToManagers(): void {
  const list = getDisplayClientInfoList();
  const fish = getAllActiveFish();
  const pending = getPendingQueue();
  const w = getWorld();

  const msg: WsServerMessage = {
    event: "state_push",
    clients: list,
    activeFish: fish,
    pendingFish: pending,
    worldW: w.width,
    worldH: w.height,
    bgUrl: currentBgUrl,
    forbiddenZones: w.forbiddenZones,
    spawnPoints: w.spawnPoints,
    layers: w.layers,
  };
  const data = JSON.stringify(msg);
  for (const ws of sockets) {
    if (ws.data.clientType === "manage") ws.send(data);
  }
}

/** [Server => Manage] クライアントリストの再送 */
export function pushClientListToManagers(): void {
  pushStateToManagers();
}

/** クライアント情報リスト取得（APIエンドポイント用） */
export function getDisplayClientInfoList(): DisplayClientInfo[] {
  // 有効期限切れ（10秒以上経過した）切断ディスプレイをクリーンアップ
  const now = Date.now();
  disconnectedDisplays = disconnectedDisplays.filter(d => d.disconnectedAt && (now - d.disconnectedAt < 10_000));

  const active: DisplayClientInfo[] = [...sockets]
    .filter(ws => ws.data.clientType === "display")
    .map((ws): DisplayClientInfo => ({
      uuid: ws.data.uuid,
      clientType: ws.data.clientType,
      lastSeen: ws.data.lastHeartbeat,
      viewport: ws.data.viewport,
      testPattern: ws.data.testPattern,
      screenW: ws.data.screenW,
      screenH: ws.data.screenH,
      ping: now - ws.data.lastHeartbeat // 実際のpingではなく最終通信からの経過時間を指標とする
    }));

  // アクティブ + 切断猶予中 の両方を返す
  return [...active, ...disconnectedDisplays];
}

/** ハートビートタイムアウトチェック（30秒） */
export function startHeartbeatWatcher(): void {
  setInterval(() => {
    const timeout = 30_000;
    const now = Date.now();
    for (const ws of sockets) {
      if (now - ws.data.lastHeartbeat > timeout) {
        console.warn(`[WS] Heartbeat timeout: ${ws.data.uuid}`);
        ws.close();
      }
    }
  }, 5_000);

  // 5秒ごとに管理画面へ接続リストをプッシュ（heartbeat確認）
  setInterval(() => pushClientListToManagers(), 5_000);
}
