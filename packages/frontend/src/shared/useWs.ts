import type { WsClientMessage, WsServerMessage } from "@aquarium/shared";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// shared/useWs.ts
// 全ページ共用の WebSocket 接続管理
//
// - /ws エンドポイントに接続（サーバーと同一オリジン）
// - 自動再接続（指数バックオフ + ジッター、接続安定後にリセット）
// - 10秒ごとにハートビートを送信（サーバーの30秒タイムアウト対策）
// - メッセージハンドラーの登録/解除
// ============================================================

/** このブラウザセッションの固有 ID。Display以外の一時クライアントに使う。 */
export const SESSION_UUID = uuidv4();

type MessageHandler = (msg: WsServerMessage) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private pendingMessages: WsServerMessage[] = [];
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private clientType: string;
  private lastFps = 60;
  private lastMessageAt = Date.now();
  private reconnectAttempt = 0;
  private destroyed = false;

  constructor(clientType: string) {
    this.clientType = clientType;
    this.connect();
    window.addEventListener("online", this.reconnectNow);
    document.addEventListener("visibilitychange", this.reconnectWhenVisible);
  }

  private reconnectNow = (): void => {
    if (this.destroyed) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  };

  private reconnectWhenVisible = (): void => {
    if (document.visibilityState === "visible") this.reconnectNow();
  };

  private connect(): void {
    if (this.destroyed) return;
    // 開発時は Vite プロキシ経由、本番は同一オリジンになる
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onopen = () => {
      if (this.destroyed || this.ws !== socket) {
        socket.close();
        return;
      }
      console.log(`[WS] Connected as ${this.clientType}`);
      this.lastMessageAt = Date.now();
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = setTimeout(() => {
        this.reconnectAttempt = 0;
        this.stableTimer = null;
      }, 15_000);
      // サーバーに自分の種別を登録
      this.send({
        event: "register",
        // DisplayはlocalStorage由来のIDをそのまま使い、再起動後もViewportを復元できるようにする。
        uuid: this.clientType.startsWith("display:") ? this.clientType : `${this.clientType}-${SESSION_UUID}`,
        // screen.width/height は物理解像度（HiDPIで実際と異なる場合がある）。
        // ブラウザの表示領域(innerWidth/Height)をAR算出に使いたいためこちらを送る。
        hardware: { w: window.innerWidth, h: window.innerHeight },
      });
      // 10秒ごとにハートビートを送信（タイムアウト30秒に対して余裕を持たせる）
      this.startHeartbeat();
    };

    socket.onmessage = (ev) => {
      if (this.destroyed || this.ws !== socket) return;
      this.lastMessageAt = Date.now();
      try {
        const msg = JSON.parse(ev.data as string) as WsServerMessage;
        if (msg.event === "ping_probe") {
          this.send({ event: "ping_response", sentAt: msg.sentAt });
          return;
        }
        if (this.handlers.size === 0) {
          this.pendingMessages.push(msg);
          if (this.pendingMessages.length > 50) this.pendingMessages.shift();
        } else {
          for (const handler of this.handlers) handler(msg);
        }
      } catch {/* 壊れたパケットは無視 */}
    };

    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      this.stopHeartbeat();
      if (this.stableTimer) clearTimeout(this.stableTimer);
      this.stableTimer = null;
      const backoff = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
      const delay = Math.round(backoff * (0.8 + Math.random() * 0.4));
      this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
      console.warn(`[WS] Disconnected, retrying in ${delay}ms...`);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.connect();
      }, delay);
    };

    socket.onerror = (error) => {
      if (this.ws === socket) console.error(error);
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat(); // 二重起動防止
    this.heartbeatTimer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        this.ws?.readyState === WebSocket.OPEN &&
        Date.now() - this.lastMessageAt > 30_000
      ) {
        this.ws.close();
        return;
      }
      this.send({ event: "heartbeat", fps: this.lastFps });
    }, 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** display クライアントが描画FPSを報告するために呼ぶ */
  setFps(fps: number): void {
    this.lastFps = fps;
  }

  send(msg: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    for (const msg of this.pendingMessages.splice(0)) handler(msg);
    return () => this.handlers.delete(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  destroy(): void {
    this.destroyed = true;
    this.stopHeartbeat();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.retryTimer = null;
    this.stableTimer = null;
    const socket = this.ws;
    this.ws = null;
    socket?.close();
    window.removeEventListener("online", this.reconnectNow);
    document.removeEventListener("visibilitychange", this.reconnectWhenVisible);
  }
}

/** 各ページが使うシングルトン WS クライアント */
export function createWsClient(clientType: string): WsClient {
  return new WsClient(clientType);
}
