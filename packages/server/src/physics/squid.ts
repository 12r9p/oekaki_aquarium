import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";

// ============================================================
// squid.ts — イカ型: ホバリング + Sin波パルス推進
//
// 動作原理:
//   - 「休止 → パルス推進 → 休止」サイクルを繰り返す
//   - Y方向は緩やかなSin波でふわふわホバリング
//   - 壁でUターン
// ============================================================

const squidState = new Map<string, {
  frame: number;    // サイクル内フレーム
  dir: 1 | -1;     // 現在の向き
  baseY: number;   // Y基準
}>();

const CYCLE = PHYSICS.SQUID_PULSE_FRAMES + PHYSICS.SQUID_REST_FRAMES;

export function applySquid(fish: ActiveFish): void {
  const world = { width: 8000, height: 4000 }; // worldは境界で制御するので大きめ

  if (!squidState.has(fish.id)) {
    squidState.set(fish.id, {
      frame: Math.floor(Math.random() * CYCLE),
      dir: Math.random() < 0.5 ? 1 : -1,
      baseY: fish.physics.pos.y,
    });
  }
  const state = squidState.get(fish.id)!;
  state.frame = (state.frame + 1) % CYCLE;

  // X方向: パルスか巡航か
  const isJetting = state.frame < PHYSICS.SQUID_PULSE_FRAMES;
  const targetVX = isJetting
    ? PHYSICS.SQUID_PULSE_SPEED * state.dir * fish.physics.speedMultiplier
    : PHYSICS.SQUID_CRUISE_SPEED * state.dir * fish.physics.speedMultiplier;

  // 速度を滑らかに補間
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * 0.2;
  fish.physics.pos.x += fish.physics.vel.x;

  // Y方向: sin波ホバリング
  const t = (Date.now() / 1000) * (Math.PI * 2 / (PHYSICS.SQUID_HOVER_PERIOD / 60));
  const targetY = state.baseY + Math.sin(t) * PHYSICS.SQUID_HOVER_AMP;
  const dy = (targetY - fish.physics.pos.y) * 0.04;
  fish.physics.vel.y = dy;
  fish.physics.pos.y += dy;
}
