import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale } from "./motion-profile";

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
  phase: number;
}>();

const CYCLE = PHYSICS.SQUID_PULSE_FRAMES + PHYSICS.SQUID_REST_FRAMES;

export function applySquid(fish: ActiveFish): void {
  const world = getWorld();

  if (!squidState.has(fish.id)) {
    squidState.set(fish.id, {
      frame: Math.floor(Math.random() * CYCLE),
      dir: Math.random() < 0.5 ? 1 : -1,
      baseY: fish.physics.pos.y,
      phase: Math.random() * Math.PI * 2,
    });
  }
  const state = squidState.get(fish.id)!;
  state.frame = (state.frame + 1) % CYCLE;
  const margin = PHYSICS.WALL_MARGIN * 1.5;
  if (world.horizontalBoundaryMode === "bounce") {
    if (fish.physics.pos.x > world.width - margin && state.dir === 1) state.dir = -1;
    if (fish.physics.pos.x < margin && state.dir === -1) state.dir = 1;
  }
  state.baseY = Math.max(margin, Math.min(world.height - margin, state.baseY));

  // X方向: パルスか巡航か
  const isJetting = state.frame < PHYSICS.SQUID_PULSE_FRAMES;
  const targetVX = isJetting
    ? PHYSICS.SQUID_PULSE_SPEED * state.dir * movementScale(fish)
    : PHYSICS.SQUID_CRUISE_SPEED * state.dir * movementScale(fish);

  // 速度を滑らかに補間
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * 0.2;
  fish.physics.pos.x += fish.physics.vel.x;

  // Y方向: sin波ホバリング
  const t = state.phase + (Date.now() / 1000) * (Math.PI * 2 / (PHYSICS.SQUID_HOVER_PERIOD / 60));
  const targetY = state.baseY + Math.sin(t) * PHYSICS.SQUID_HOVER_AMP * world.motionSettings.verticalSpread;
  const dy = (targetY - fish.physics.pos.y) * 0.04;
  fish.physics.vel.y = dy;
  fish.physics.pos.y += dy;
}

export function resetSquidState(fishId: string, newY: number): void {
  const state = squidState.get(fishId);
  if (state) state.baseY = newY;
}
