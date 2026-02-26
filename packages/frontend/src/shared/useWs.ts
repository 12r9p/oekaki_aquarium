import type { WsClientMessage, WsServerMessage } from "@aquarium/shared";
import { v4 as uuidv4 } from "uuid";

// ============================================================
// shared/useWs.ts
// 全ページ共用の WebSocket 接続管理
//
// - /ws エンドポイントに接続（サーバーと同一オリジン）
// - 自動再接続（3秒後）
// - 10秒ごとにハートビートを送信（サーバーの30秒タイムアウト対策）
// - メッセージハンドラーの登録/解除
// ============================================================

/** このブラウザセッションの固有 ID（ページリロードで変わる） */
export const SESSION_UUID = uuidv4();

type MessageHandler = (msg: WsServerMessage) => void;

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<MessageHandler>();
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private clientType: string;
  private lastFps = 60;

  constructor(clientType: string) {
    this.clientType = clientType;
    this.connect();
  }

  private connect(): void {
    // 開発時は Vite プロキシ経由、本番は同一オリジンになる
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${location.host}/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log(`[WS] Connected as ${this.clientType}`);
      // サーバーに自分の種別を登録
      this.send({
        event: "register",
        uuid: `${this.clientType}-${SESSION_UUID}`,
        hardware: { w: window.screen.width, h: window.screen.height },
      });
      // 10秒ごとにハートビートを送信（タイムアウト30秒に対して余裕を持たせる）
      this.startHeartbeat();
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as WsServerMessage;
        for (const handler of this.handlers) handler(msg);
      } catch {/* 壊れたパケットは無視 */}
    };

    this.ws.onclose = () => {
      console.warn("[WS] Disconnected, reconnecting in 3s...");
      this.stopHeartbeat();
      this.retryTimer = setTimeout(() => this.connect(), 3_000);
    };

    this.ws.onerror = console.error;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat(); // 二重起動防止
    this.heartbeatTimer = setInterval(() => {
      this.send({ event: "heartbeat", fps: this.lastFps });
    }, 10_000); // 10秒ごと（サーバーのタイムアウト30秒より十分短い）
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
    return () => this.handlers.delete(handler);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  destroy(): void {
    this.stopHeartbeat();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws?.close();
  }
}

/** 各ページが使うシングルトン WS クライアント */
export function createWsClient(clientType: string): WsClient {
  return new WsClient(clientType);
}
