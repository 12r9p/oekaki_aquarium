import type { LayerConfig } from "./types";

// ============================================================
// ネットワーク設定
// ============================================================
export const PORTS = {
  HTTP: 3000,
  WS: 8080,
  UDP: 41234,
} as const;

// ============================================================
// ところてんレイヤー設定
// Layer 0: 最前面（最新の魚）
// Layer 1: 中景
// Layer 2: 遠景（古い魚）
// ============================================================
export const LAYER_CONFIG: LayerConfig[] = [
  {
    id: 0,
    maxCount: 10,
    scale: 1.0,
    opacity: 1.0,
    speedFactor: 1.0,
    zIndex: 100,
  },
  {
    id: 1,
    maxCount: 20,
    scale: 0.7,
    opacity: 0.8,
    speedFactor: 0.6,
    zIndex: 50,
  },
  {
    id: 2,
    maxCount: 50,
    scale: 0.4,
    opacity: 0.4,
    speedFactor: 0.3,
    zIndex: 10,
  },
];

// ============================================================
// 仮想水槽のデフォルトサイズ（4K×2面分を想定）
// 接続クライアントの Viewport を統合して動的に更新される
// ============================================================
export const DEFAULT_WORLD = {
  width: 3840,
  height: 1080,
} as const;

// ============================================================
// 物理演算パラメータ
// ============================================================
export const PHYSICS = {
  // Boids (Type A)
  BOIDS_MAX_SPEED: 3.0,
  BOIDS_MAX_FORCE: 0.15,
  BOIDS_SEPARATION_RADIUS: 80,
  BOIDS_ALIGNMENT_RADIUS: 150,
  BOIDS_COHESION_RADIUS: 200,
  BOIDS_SEPARATION_WEIGHT: 1.5,
  BOIDS_ALIGNMENT_WEIGHT: 1.0,
  BOIDS_COHESION_WEIGHT: 1.0,

  // 壁の跳ね返し強度
  WALL_FORCE: 0.5,
  WALL_MARGIN: 100,

  // エサの引力半径と強度
  FOOD_RADIUS: 400,
  FOOD_FORCE: 2.0,
  FOOD_LIFETIME_MS: 5000,
} as const;

// ============================================================
// ゲームループ
// ============================================================
export const GAME_LOOP_MS = 16; // ~60fps
