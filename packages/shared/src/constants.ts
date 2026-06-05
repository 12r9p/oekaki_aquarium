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

export function replaceLayerConfig(next: LayerConfig[]): void {
  const normalized = next
    .filter(layer => Number.isFinite(layer.maxCount) && layer.maxCount > 0)
    .map((layer, index) => ({
      id: index,
      maxCount: Math.max(1, Math.round(layer.maxCount)),
      scale: Math.max(0.1, Math.min(layer.scale, 5)),
      opacity: Math.max(0.18, Math.min(layer.opacity, 1)),
      speedFactor: Math.max(0.05, Math.min(layer.speedFactor, 3)),
      zIndex: Number.isFinite(layer.zIndex) ? layer.zIndex : 100 - index * 30,
    }));
  if (normalized.length === 0) return;
  LAYER_CONFIG.splice(0, LAYER_CONFIG.length, ...normalized);
}

// ============================================================
// 仮想水槽のデフォルトサイズ。接続クライアントの解像度とは独立して管理する。
// ============================================================
export const DEFAULT_WORLD = {
  width: 1080,
  height: 1440,
} as const;

// ============================================================
// 物理演算パラメータ
// ============================================================
export const PHYSICS = {
  // Boids (school)
  BOIDS_MAX_SPEED: 3.0,
  BOIDS_MAX_FORCE: 0.15,
  BOIDS_SEPARATION_RADIUS: 80,
  BOIDS_ALIGNMENT_RADIUS: 150,
  BOIDS_COHESION_RADIUS: 200,
  BOIDS_SEPARATION_WEIGHT: 1.5,
  BOIDS_ALIGNMENT_WEIGHT: 1.0,
  BOIDS_COHESION_WEIGHT: 1.0,
  // schoolの縦速度抑制係数 (0〜1、小さいほど縦に動かない)
  SCHOOL_VERTICAL_DAMPING: 0.88,

  // Tuna (マグロ: 高速直線往復)
  TUNA_SPEED: 5.5,        // 基本速度 (px/frame)
  TUNA_VERTICAL_DRIFT: 0.008, // Y方向のごく緩やかなドリフト振幅

  // Squid (イカ: ホバリング+パルス推進)
  SQUID_CRUISE_SPEED: 0.8,    // 巡航速度
  SQUID_PULSE_SPEED: 3.5,     // パルス射出速度
  SQUID_PULSE_FRAMES: 12,     // パルス継続フレーム
  SQUID_REST_FRAMES: 40,      // 休止フレーム
  SQUID_HOVER_AMP: 60,        // 上下ホバリング振幅 (px)
  SQUID_HOVER_PERIOD: 180,    // 上下ホバリング周期 (frames)

  // Jellyfish (クラゲ: 縮め伸ばしパルス上下浮遊)
  JELLYFISH_FLOAT_SPEED: 0.5, // X方向ドリフト速度
  JELLYFISH_PULSE_AMP: 60,    // 上下パルス振幅 (px)
  JELLYFISH_PULSE_PERIOD: 120,// 上下パルス周期 (frames)

  // Shark (サメ: 大弧単独回遊)
  SHARK_SPEED: 2.2,           // 速度
  SHARK_TURN_RATE: 0.012,     // 毎フレームの旋回量 (rad)
  SHARK_VERTICAL_DAMPING: 0.5, // 縦抑制（緩め）

  // 壁の跳ね返し
  WALL_FORCE: 0.5,
  WALL_MARGIN: 100,

  // エサの引力
  FOOD_RADIUS: 400,
  FOOD_FORCE: 2.0,
  FOOD_LIFETIME_MS: 5000,
} as const;

// ============================================================
// ゲームループ
// ============================================================
export const GAME_LOOP_MS = 16; // ~60fps
