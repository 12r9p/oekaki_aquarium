import type { ServerWebSocket } from "bun";
import type { WsClientMessage, WsServerMessage, TestPattern, DisplayClientInfo, ClientConfig, WorldObject } from "@aquarium/shared";
import { LAYER_CONFIG, PHYSICS, replaceLayerConfig } from "@aquarium/shared";
import { foodItems } from "./physics/boundaries";
import { getWorld, registerClientViewport, restoreWorldSettings, unregisterClient } from "./world";
import { getAllActiveFish, getPendingQueue } from "./fish-manager";
import { v4 as uuidv4 } from "uuid";
import { DEFAULT_BACKGROUND_URL, getPersistedSettings, persistViewport, updatePersistedSettings } from "./settings-store";
import { getSystemMetrics } from "./system-metrics";

// ============================================================
// ws-handler.ts（Bun ネイティブ WebSocket 版）
// ============================================================
// グローバルな水槽背景状態（再起動でリセット）
// ============================================================
const restoredSettings = getPersistedSettings();
if (restoredSettings.fishLayers) replaceLayerConfig(restoredSettings.fishLayers);
restoreWorldSettings(restoredSettings.world ?? {});
let currentBgUrl = restoredSettings.bgUrl ?? DEFAULT_BACKGROUND_URL;
const REVISION_EPOCH = uuidv4();
let revisionWatermark = 0;

/** 現在の背景画像URLを取得する */
export function getCurrentBgUrl(): string { return currentBgUrl; }

/** Restore or change the aquarium background and synchronize connected clients. */
export function setCurrentBgUrl(url: string): void {
  currentBgUrl = url;
  persistServerSettings();
  const w = getWorld();
  broadcastToAll({
    event: "update_world_config",
    bgUrl: currentBgUrl,
    forbiddenZones: w.forbiddenZones,
    spawnPoints: w.spawnPoints,
    layers: w.layers,
    horizontalBoundaryMode: w.horizontalBoundaryMode,
    fishSpeedMultiplier: w.fishSpeedMultiplier,
    fishScaleMultiplier: w.fishScaleMultiplier,
    motionSettings: w.motionSettings,
  });
}

// ============================================================
// Store / State
// ============================================================

export interface ClientData {
  uuid: string;
  clientType: string;
  accessAuthenticated: boolean;
  accessSubject: string | null;
  accessRoles: string[];
  accessExpiresAt: number | null;
  lastHeartbeat: number;
  screenW: number;
  screenH: number;
  viewport: ClientConfig["viewport"] | null;
  testPattern: TestPattern;
  ping: number;
  revisionSequence: number;
  frameSequence: number;
}

const sockets = new Set<ServerWebSocket<ClientData>>();

export type ViewportSnapshot = Record<string, NonNullable<ClientConfig["viewport"]>>;

/**
 * Cloudflare Workerから渡された信頼済みDO revisionで、このContainerの同期基準を更新する。
 * HTTP commandのupstream requestではWorkerがcurrent + 1を渡す。
 */
export function refreshRevisionWatermark(revision: number): void {
  if (Number.isSafeInteger(revision) && revision >= 0) {
    revisionWatermark = Math.max(revisionWatermark, revision);
  }
}

/** Authenticated displayのHTTP viewport変更に限り、同一Access subjectのWS登録を許可する。 */
export function isDisplaySessionAuthorized(subject: string, uuid: string): boolean {
  if (!subject || !uuid) return false;
  return [...sockets].some((ws) =>
    ws.data.clientType === "display" &&
    ws.data.uuid === uuid &&
    ws.data.accessSubject === subject &&
    hasDisplayAccess(ws),
  );
}

function isLocalUntrustedFallback(ws: ServerWebSocket<ClientData>): boolean {
  return !ws.data.accessAuthenticated && process.env.AQUARIUM_ALLOW_UNTRUSTED_WS === "true";
}

function hasValidAccessIdentity(ws: ServerWebSocket<ClientData>): boolean {
  return ws.data.accessAuthenticated &&
    ws.data.accessExpiresAt !== null &&
    ws.data.accessExpiresAt > Date.now() / 1000;
}

function hasAccessRole(ws: ServerWebSocket<ClientData>, ...roles: string[]): boolean {
  return hasValidAccessIdentity(ws) && roles.some((role) => ws.data.accessRoles.includes(role));
}

function hasManageAccess(ws: ServerWebSocket<ClientData>): boolean {
  if (ws.data.clientType === "unknown") return false;
  return hasAccessRole(ws, "manage", "admin") ||
    (isLocalUntrustedFallback(ws) && ws.data.clientType === "manage");
}

function hasDisplayAccess(ws: ServerWebSocket<ClientData>): boolean {
  return hasAccessRole(ws, "display", "admin") ||
    (isLocalUntrustedFallback(ws) && ws.data.clientType === "display");
}

function classifyClientType(uuid: string): string {
  const prefix = uuid.split(":")[0] ?? "";
  if (prefix.startsWith("display")) return "display";
  if (prefix.startsWith("controller")) return "controller";
  if (prefix.startsWith("guest")) return "guest";
  if (prefix.startsWith("manage")) return "manage";
  return "unknown";
}

function mayRegisterClient(ws: ServerWebSocket<ClientData>, clientType: string): boolean {
  // 来場者・放流画面は公開クライアント。UUIDは権限には使わない。
  if (clientType === "controller" || clientType === "guest") return true;

  if (ws.data.accessAuthenticated) {
    if (!hasValidAccessIdentity(ws)) return false;
    if (clientType === "display") return hasAccessRole(ws, "display", "admin");
    if (clientType === "manage") return hasAccessRole(ws, "manage", "admin");
    return false;
  }

  // ローカル開発の明示 opt-in のみ、従来のUUID prefix判定を許可する。
  return process.env.AQUARIUM_ALLOW_UNTRUSTED_WS === "true" &&
    (clientType === "display" || clientType === "manage");
}

function rejectSocket(ws: ServerWebSocket<ClientData>, reason: string): void {
  console.warn(`[WS] Rejected ${ws.data.uuid}: ${reason}`);
  ws.close(1008, reason);
}

function isSafeCounter(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function createStateSnapshot(ws: ServerWebSocket<ClientData>): WsServerMessage {
  const w = getWorld();
  const snapshot: WsServerMessage = {
    event: "state_snapshot",
    clients: getDisplayClientInfoList(),
    activeFish: getAllActiveFish(),
    pendingFish: getPendingQueue(),
    worldW: w.width,
    worldH: w.height,
    bgUrl: currentBgUrl,
    forbiddenZones: w.forbiddenZones,
    spawnPoints: w.spawnPoints,
    layers: w.layers,
    fishLayers: LAYER_CONFIG,
    horizontalBoundaryMode: w.horizontalBoundaryMode,
    fishSpeedMultiplier: w.fishSpeedMultiplier,
    fishScaleMultiplier: w.fishScaleMultiplier,
    motionSettings: w.motionSettings,
    systemMetrics: getSystemMetrics(),
    scene: sceneObjects,
    frameSequence: ws.data.frameSequence,
    ...(ws.data.clientType === "display" ? {
      viewport: ws.data.viewport ?? defaultViewport(ws.data.screenW, ws.data.screenH),
      debug: { showGrid: false, showId: false },
      displayNumber: getDisplayNumber(ws),
    } : {}),
  };
  return snapshot;
}

function getDisplayNumber(target: ServerWebSocket<ClientData>): number {
  return [...sockets]
    .filter((socket) => socket.data.clientType === "display")
    .sort((a, b) => a.data.uuid.localeCompare(b.data.uuid))
    .findIndex((socket) => socket === target) + 1;
}

function sendDisplayConfig(ws: ServerWebSocket<ClientData>): void {
  const w = getWorld();
  sendTo(ws, {
    event: "config",
    viewport: ws.data.viewport ?? defaultViewport(ws.data.screenW, ws.data.screenH),
    debug: { showGrid: false, showId: false },
    worldW: w.width,
    worldH: w.height,
    bgUrl: currentBgUrl,
    forbiddenZones: w.forbiddenZones,
    spawnPoints: w.spawnPoints,
    layers: w.layers,
    horizontalBoundaryMode: w.horizontalBoundaryMode,
    fishSpeedMultiplier: w.fishSpeedMultiplier,
    fishScaleMultiplier: w.fishScaleMultiplier,
    motionSettings: w.motionSettings,
    displayNumber: getDisplayNumber(ws),
  });
}

function sendClientSnapshot(ws: ServerWebSocket<ClientData>): void {
  sendTo(ws, createStateSnapshot(ws));
  if (ws.data.clientType === "display") {
    sendDisplayConfig(ws);
    sendTo(ws, { event: "scene_update", objects: sceneObjects });
  } else if (ws.data.clientType === "manage") {
    sendStatePush(ws);
  }
}

/**
 * displayIDごとにViewportを永続保存するMap。
 * これにより、displayが再接続しても管理画面で設定したViewportが維持される。
 * ローカルsettings-storeとWorkerの内部状態snapshotの両方に保存する。
 */
const viewportStore = new Map<string, NonNullable<ClientConfig["viewport"]>>(
  Object.entries(restoredSettings.viewports ?? {}),
);

/** Return a detached copy of the persisted viewport registry for Worker snapshots. */
export function getViewportSnapshot(): ViewportSnapshot {
  return Object.fromEntries(
    [...viewportStore].map(([uuid, viewport]) => [uuid, { ...viewport }]),
  );
}

/** Replace all saved viewports and persist them alongside local aquarium settings. */
export function restoreViewportSnapshot(viewports: ViewportSnapshot): void {
  viewportStore.clear();
  for (const [uuid, viewport] of Object.entries(viewports)) {
    viewportStore.set(uuid, { ...viewport });
  }
  updatePersistedSettings({ viewports: getViewportSnapshot() });

  for (const ws of sockets) {
    if (ws.data.clientType !== "display") continue;
    const savedViewport = viewportStore.get(ws.data.uuid)
      ?? [...viewportStore.entries()].find(([uuid]) => uuid.startsWith(`${ws.data.uuid}-`))?.[1];
    const viewport = savedViewport ?? defaultViewport(ws.data.screenW, ws.data.screenH);
    ws.data.viewport = viewport;
    registerClientViewport({ uuid: ws.data.uuid, name: ws.data.uuid, viewport, debug: { showGrid: false, showId: false } });
    sendTo(ws, { event: "update_viewport", targetUuid: ws.data.uuid, viewport });
  }
  pushClientListToManagers();
}

/** 切断されたディスプレイの履歴を一定期間（猶予期間）保持するためのリスト */
let disconnectedDisplays: DisplayClientInfo[] = [];

/**
 * シーンオブジェクトのストア。
 * WorldObject[] をサーバーIn-memoryで管理。
 * ブロードキャスト時は全displayとmanageに送信。
 */
let sceneObjects: WorldObject[] = [...(restoredSettings.sceneObjects ?? [])];

function persistServerSettings(): void {
  const w = getWorld();
  updatePersistedSettings({
    bgUrl: currentBgUrl,
    sceneObjects,
    fishLayers: LAYER_CONFIG,
    world: {
      width: w.width,
      height: w.height,
      forbiddenZones: w.forbiddenZones,
      spawnPoints: w.spawnPoints,
      layers: w.layers,
      horizontalBoundaryMode: w.horizontalBoundaryMode,
      fishSpeedMultiplier: w.fishSpeedMultiplier,
      fishScaleMultiplier: w.fishScaleMultiplier,
      motionSettings: w.motionSettings,
    },
  });
}

export function getScene(): WorldObject[] { return sceneObjects; }

export function addSceneObject(obj: WorldObject): void {
  sceneObjects.push(obj);
  persistServerSettings();
  broadcastSceneUpdate();
}

export function updateSceneObject(id: string, patch: Partial<WorldObject>): boolean {
  const idx = sceneObjects.findIndex(o => o.id === id);
  if (idx === -1) return false;
  sceneObjects[idx] = { ...sceneObjects[idx]!, ...patch, id };
  persistServerSettings();
  broadcastSceneUpdate();
  return true;
}

export function deleteSceneObject(id: string): boolean {
  const before = sceneObjects.length;
  sceneObjects = sceneObjects.filter(o => o.id !== id);
  if (sceneObjects.length !== before) { persistServerSettings(); broadcastSceneUpdate(); return true; }
  return false;
}

export function replaceScene(objects: WorldObject[]): void {
  sceneObjects = objects;
  persistServerSettings();
  broadcastSceneUpdate();
}

/** シーン更新をdisplay+manageにブロードキャスト */
function broadcastSceneUpdate(): void {
  const msg: WsServerMessage = { event: "scene_update", objects: sceneObjects };
  for (const ws of sockets) {
    if (ws.data.clientType === "display" || ws.data.clientType === "manage") {
      sendTo(ws, msg);
    }
  }
}

// ---- ハンドラー -------------------------------------------------

export const wsHandlers = {
  open(ws: ServerWebSocket<ClientData>): void {
    ws.data = {
      ...ws.data,
      uuid: uuidv4(),
      clientType: "unknown",
      accessSubject: ws.data.accessSubject ?? null,
      lastHeartbeat: Date.now(),
      screenW: 1920,
      screenH: 1080,
      viewport: null,
      testPattern: "off",
      ping: 0,
      revisionSequence: 0,
      frameSequence: 0,
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
    if (![...sockets].some(socket => socket.data.uuid === ws.data.uuid)) {
      unregisterClient(ws.data.uuid);
    }
    // 管理画面に更新をプッシュ
    pushClientListToManagers();
  },
};

function handleMessage(ws: ServerWebSocket<ClientData>, msg: WsClientMessage): void {
  if (ws.data.accessAuthenticated && !hasValidAccessIdentity(ws)) {
    rejectSocket(ws, "Access identity expired");
    return;
  }

  // 永続状態の更新はrevisionを割り当てるHTTP commandに集約する。
  // 古いクライアントがWS経由で送ってきた場合も黙って無視せず、再接続を促す。
  const event = (msg as { event?: unknown }).event;
  if (event === "update_viewport" || event === "update_world_size" || event === "update_world_config") {
    rejectSocket(ws, `${event} is no longer accepted over WebSocket; use the authenticated HTTP command`);
    return;
  }

  // heartbeat を含む正常な受信を生存確認として扱う。
  ws.data.lastHeartbeat = Date.now();
  switch (msg.event) {
    case "heartbeat":
      break;
    case "ping_response":
      ws.data.ping = Math.max(0, Date.now() - msg.sentAt);
      break;

    case "register": {
      const requestedClientType = classifyClientType(msg.uuid);
      if (!mayRegisterClient(ws, requestedClientType)) {
        rejectSocket(ws, `registration is not allowed for ${requestedClientType}`);
        return;
      }

      ws.data.uuid = msg.uuid;
      ws.data.screenW = msg.hardware.w;
      ws.data.screenH = msg.hardware.h;
      ws.data.lastHeartbeat = Date.now();
      ws.data.clientType = requestedClientType;
      ws.data.revisionSequence = msg.lastRevisionEpoch === REVISION_EPOCH && isSafeCounter(msg.lastRevisionSequence)
        ? msg.lastRevisionSequence
        : 0;
      ws.data.frameSequence = msg.lastFrameEpoch === REVISION_EPOCH && isSafeCounter(msg.lastFrameSequence)
        ? msg.lastFrameSequence
        : 0;

      console.log(`[WS] Registered: ${msg.uuid} (${ws.data.clientType})`);

      if (ws.data.clientType === "display") {
        if (msg.lastFrameEpoch === REVISION_EPOCH && isSafeCounter(msg.lastFrameSequence)) {
          ws.data.frameSequence = msg.lastFrameSequence;
        }
        // 保存済みViewportがあれば復元。初回は水槽内に収まる表示範囲を割り当てる。
        const savedVp = viewportStore.get(msg.uuid)
          ?? [...viewportStore.entries()].find(([uuid]) => uuid.startsWith(`${msg.uuid}-`))?.[1];
        const vp: ClientConfig["viewport"] = savedVp ?? defaultViewport(msg.hardware.w, msg.hardware.h);
        ws.data.viewport = vp;
        if (!viewportStore.has(msg.uuid)) {
          viewportStore.set(msg.uuid, vp);
          persistViewport(msg.uuid, vp);
        }
        registerClientViewport({ uuid: msg.uuid, name: msg.uuid, viewport: vp, debug: { showGrid: false, showId: false } });
      }
      sendClientSnapshot(ws);
      // 復帰した場合は disconnectedDisplays から除外
      if (ws.data.clientType === "display") {
        disconnectedDisplays = disconnectedDisplays.filter(d => d.uuid !== ws.data.uuid);
      }

      // 管理画面に接続クライアントリストを push
      pushClientListToManagers();
      break;
    }
    case "sync_request": {
      if (ws.data.clientType === "unknown") {
        rejectSocket(ws, "sync_request requires registration");
        return;
      }
      if (msg.lastRevisionEpoch === REVISION_EPOCH && isSafeCounter(msg.lastRevisionSequence)) {
        // Snapshotはclientが実際に適用できた位置から新しい連番で再開する。
        ws.data.revisionSequence = msg.lastRevisionSequence;
      }
      sendClientSnapshot(ws);
      break;
    }
    case "spawn_food":
      if (ws.data.clientType !== "controller" && ws.data.clientType !== "guest") {
        rejectSocket(ws, "spawn_food requires a controller or guest registration");
        return;
      }
      foodItems.push({
        id: uuidv4(),
        pos: { x: msg.x, y: msg.y },
        expiresAt: Date.now() + PHYSICS.FOOD_LIFETIME_MS,
      });
      break;

    case "viewport_preview": {
      if (!hasManageAccess(ws)) {
        rejectSocket(ws, "viewport_preview requires manage access");
        return;
      }
      // 管理画面からのドラッグ中リアルタイムプレビュー: 対象displayのみに転送
      const target = [...sockets].find(s => s.data.uuid === msg.displayUuid);
      if (target) sendTo(target, { event: "viewport_preview", viewport: msg.viewport });
      break;
    }

    case "pointer_move": {
      if (!hasManageAccess(ws)) {
        rejectSocket(ws, "pointer_move requires manage access");
        return;
      }
      // 管理画面からのマウスポインター位置を全てのディスプレイに転送
      broadcastToDisplays({ event: "pointer_move", x: msg.x, y: msg.y });
      break;
    }
  }
}

// ---- ユーティリティ -------------------------------------------

function sendTo(ws: ServerWebSocket<ClientData>, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    // スリープ復帰直後など、送信キューが詰まったクライアントへ古いフレームを積み続けない。
    if (msg.event === "frame" && ws.getBufferedAmount() > 512_000) return;
    let outgoing = msg;
    if (isRevisionedMessage(msg)) {
      ws.data.revisionSequence += 1;
      outgoing = {
        ...msg,
        revision: revisionWatermark,
        revisionEpoch: REVISION_EPOCH,
        revisionSequence: ws.data.revisionSequence,
      };
    } else if (msg.event === "frame") {
      ws.data.frameSequence += 1;
      outgoing = {
        ...msg,
        frameEpoch: REVISION_EPOCH,
        frameSequence: ws.data.frameSequence,
      };
    }
    ws.send(JSON.stringify(outgoing));
  }
}

function isRevisionedMessage(msg: WsServerMessage): boolean {
  switch (msg.event) {
    case "config":
    case "fish_added":
    case "fish_locked":
    case "fish_released":
    case "state_push":
    case "state_snapshot":
    case "update_world_config":
    case "test_pattern":
    case "update_viewport":
    case "client_list":
    case "fish_list":
    case "scene_update":
    case "update_world_size":
      return true;
    default:
      return false;
  }
}

/** 全クライアントにブロードキャスト */
export function broadcastToAll(msg: WsServerMessage): void {
  for (const ws of sockets) sendTo(ws, msg);
}

/** displayクライアントにのみ送る */
export function broadcastToDisplays(msg: WsServerMessage): void {
  for (const ws of sockets) {
    if (ws.data.clientType === "display") sendTo(ws, msg);
  }
}

/** 描画フレームを display と管理画面のプレビューへ送る */
export function broadcastToRenderClients(msg: WsServerMessage): void {
  for (const ws of sockets) {
    if (ws.data.clientType === "display" || ws.data.clientType === "manage") {
      sendTo(ws, msg);
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
  if (viewport) {
    viewportStore.set(targetUuid, viewport);
    persistViewport(targetUuid, viewport);
  }
  for (const ws of sockets) {
    if (ws.data.uuid === targetUuid) {
      ws.data.viewport = viewport;
      registerClientViewport({ uuid: targetUuid, name: targetUuid, viewport, debug: { showGrid: false, showId: false } });
      sendTo(ws, { event: "update_viewport", targetUuid, viewport });
      pushClientListToManagers();
      return true;
    }
  }
  // 対象が切断中でも保存はしておく（再接続時に適用される）
  pushClientListToManagers();
  return false;
}

function defaultViewport(screenW: number, screenH: number): ClientConfig["viewport"] {
  const world = getWorld();
  const aspect = Math.max(screenW, 1) / Math.max(screenH, 1);
  let width = world.width;
  let height = width / aspect;
  if (height > world.height) {
    height = world.height;
    width = height * aspect;
  }
  return {
    x: (world.width - width) / 2,
    y: (world.height - height) / 2,
    width,
    height,
    scale: 1,
  };
}

/** テストパターンを特定/全displayに送信 */
export function sendTestPattern(pattern: TestPattern, targetUuid?: string): void {
  const displays = [...sockets]
    .filter(ws => ws.data.clientType === "display")
    .sort((a, b) => a.data.uuid.localeCompare(b.data.uuid));
  if (targetUuid) {
    for (const [index, ws] of displays.entries()) {
      if (ws.data.uuid === targetUuid) {
        ws.data.testPattern = pattern;
        sendTo(ws, { event: "test_pattern", pattern, targetUuid, displayNumber: index + 1 });
        return;
      }
    }
  } else {
    for (const [index, ws] of displays.entries()) {
      ws.data.testPattern = pattern;
      sendTo(ws, { event: "test_pattern", pattern, displayNumber: index + 1 });
    }
  }
  pushClientListToManagers();
}

// --- 状態のブロードキャスト -----------------------------------------

/** [ServerLoop] 全manageクライアントへ同期状態(state_push)を送る */
export function pushStateToManagers(): void {
  for (const ws of sockets) {
    if (ws.data.clientType === "manage") sendStatePush(ws);
  }
}

function createStatePush(): WsServerMessage {
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
    fishLayers: LAYER_CONFIG,
    horizontalBoundaryMode: w.horizontalBoundaryMode,
    fishSpeedMultiplier: w.fishSpeedMultiplier,
    fishScaleMultiplier: w.fishScaleMultiplier,
    motionSettings: w.motionSettings,
    systemMetrics: getSystemMetrics(),
  };
  return msg;
}

function sendStatePush(ws: ServerWebSocket<ClientData>): void {
  sendTo(ws, createStatePush());
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
      ping: ws.data.ping
    }));

  // アクティブ + 切断猶予中 の両方を返す
  return [...active, ...disconnectedDisplays].sort((a, b) => a.uuid.localeCompare(b.uuid));
}

/** ハートビートタイムアウトチェック */
export function startHeartbeatWatcher(): void {
  setInterval(() => {
    // バックグラウンドタブではブラウザがタイマーを強く間引くため猶予を長めに取る。
    const timeout = 120_000;
    const now = Date.now();
    for (const ws of sockets) {
      if (now - ws.data.lastHeartbeat > timeout) {
        console.warn(`[WS] Heartbeat timeout: ${ws.data.uuid}`);
        ws.close();
      }
    }
  }, 5_000);

  // 5秒ごとに管理画面へ接続リストをプッシュ（heartbeat確認）
  setInterval(() => {
    const sentAt = Date.now();
    for (const ws of sockets) {
      if (ws.data.clientType === "display") sendTo(ws, { event: "ping_probe", sentAt });
    }
    pushClientListToManagers();
  }, 5_000);
}
