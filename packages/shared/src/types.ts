// ============================================================
// 全コンポーネントで共有するコア型定義
// ============================================================

// -------------------------------------------------------
// 魚の挙動タイプ
// -------------------------------------------------------
export type FishType = "swimmer" | "looper" | "anchor";

// -------------------------------------------------------
// 放流時に iPad から送られる設定データ
// -------------------------------------------------------
export interface FishConfig {
  id: string;
  type: FishType;
  /** サーバーの静的配信 URL: http://server/images/xxx.png */
  textureUrl: string;
  userParams: {
    /** 表示スケール倍率（ユーザー指定の "大きさ"） */
    scale: number;
    /** 速度倍率（ユーザー指定の "速さ"） */
    speed: number;
    /** 右向き統一のための回転補正値（ラジアン） */
    rotationOffset: number;
  };
  /** Type B/C 用: 手描きモーションパス */
  motionPath?: Vector2[];
  /** レイヤー移動を無効化して常に最前面に固定する */
  isPinned?: boolean;
  /** isPinned=true の場合のターゲットレイヤーID（デフォルト: 0） */
  pinnedLayerId?: number;
}

// -------------------------------------------------------
// サーバー内でアクティブに管理されている魚オブジェクト
// -------------------------------------------------------
export interface ActiveFish extends FishConfig {
  /** 放流時刻（ところてんレイヤーソートのキー） */
  timestamp: number;
  physics: {
    pos: Vector2;
    vel: Vector2;
    /** レイヤーの speedFactor が反映される乗算係数 */
    speedMultiplier: number;
  };
  /** 現在所属しているレイヤー ID */
  layerIndex: number;
  /** クライアント補間の目標スケール（レイヤー補正済み） */
  targetScale: number;
  /** クライアント補間の目標透明度（レイヤー補正済み） */
  targetOpacity: number;
}

// -------------------------------------------------------
// スキャン後・放流前の待機状態の魚
// -------------------------------------------------------
export interface PendingFish {
  id: string;
  imageUrl: string;
  timestamp: number;
  /** 排他制御: 現在編集中の iPad の UUID。undefined なら空き */
  lockedBy?: string;
}

// -------------------------------------------------------
// 各 Renderer クライアントの設定
// -------------------------------------------------------
export interface ClientConfig {
  uuid: string;
  name: string;
  viewport: {
    /** グローバル座標系でのこのモニターの左上X */
    x: number;
    /** グローバル座標系でのこのモニターの左上Y */
    y: number;
    width: number;
    height: number;
    /** FHD/4K の解像度差を吸収する表示倍率 */
    scale: number;
  };
  debug: {
    showGrid: boolean;
    showId: boolean;
  };
}

// -------------------------------------------------------
// ところてんレイヤーの定義
// -------------------------------------------------------
export interface LayerConfig {
  id: number;
  /** このレイヤーに収容できる最大魚数 */
  maxCount: number;
  /** このレイヤーの表示スケール */
  scale: number;
  /** このレイヤーの透明度 */
  opacity: number;
  /** 移動量の乗数（パララックス効果: 奥の魚はゆっくり動く） */
  speedFactor: number;
  /** Z-Index（大きいほど手前） */
  zIndex: number;
}

// -------------------------------------------------------
// UDP ブロードキャストパケット (Server → All Clients, 60fps)
// -------------------------------------------------------
export interface UdpPacket {
  /** Unix タイムスタンプ (ms) */
  t: number;
  /** 全アクティブ魚の現在座標リスト */
  f: UdpFishData[];
  /** エフェクトイベント（着水エフェクト座標など） */
  e: UdpEvent[];
}

export interface UdpFishData {
  /** 魚 ID（短縮 UUID） */
  i: string;
  /** グローバル X 座標 */
  x: number;
  /** グローバル Y 座標 */
  y: number;
  /** 回転角（ラジアン） */
  r: number;
  /** スケール（レイヤー補正済み） */
  s: number;
  /** 透明度（レイヤー補正済み） */
  o: number;
  /** Z-Index */
  z: number;
}

export interface UdpEvent {
  type: "spawn" | "feed";
  x: number;
  y: number;
}

// -------------------------------------------------------
// WebSocket メッセージ型
// -------------------------------------------------------
export type WsClientMessage =
  | { event: "register"; uuid: string; hardware: { w: number; h: number } }
  | { event: "heartbeat"; fps: number }
  | { event: "spawn_food"; x: number; y: number };

export type WsServerMessage =
  | { event: "config"; viewport: ClientConfig["viewport"]; debug: ClientConfig["debug"] }
  | { event: "reload" }
  | { event: "fish_added"; fish: PendingFish }
  | { event: "fish_locked"; fishId: string; lockedBy: string }
  | { event: "fish_released"; fish: ActiveFish }
  /** 60fps フレームデータ（display クライアント専用） */
  | ({ event: "frame" } & UdpPacket)
  /** 管理画面向け状態スナップショット */
  | { event: "state_push"; clients: unknown[]; activeFish: ActiveFish[]; pendingFish: PendingFish[] }
  /** display クライアントへテストパターン表示指示 */
  | { event: "test_pattern"; pattern: TestPattern; targetUuid?: string }
  /** display クライアントの Viewport を更新する */
  | { event: "update_viewport"; targetUuid: string; viewport: ClientConfig["viewport"] }
  /** 接続クライアント一覧を管理画面に push する */
  | { event: "client_list"; clients: DisplayClientInfo[] };

/** テストパターンの種類 */
export type TestPattern = "off" | "grid" | "colorbars" | "white" | "black" | "crosshair" | "worldmap";

/** 管理画面に公開するディスプレイクライアント情報 */
export interface DisplayClientInfo {
  uuid: string;
  clientType: string;
  lastSeen: number;
  viewport: ClientConfig["viewport"] | null;
  testPattern: TestPattern;
  /** 物理解像度（アスペクト比固定リサイズに使用） */
  screenW: number;
  screenH: number;}

// -------------------------------------------------------
// 汎用型
// -------------------------------------------------------
export interface Vector2 {
  x: number;
  y: number;
}
