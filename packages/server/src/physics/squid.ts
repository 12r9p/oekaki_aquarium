import type { ActiveFish } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// squid.ts — イカ型: ホバリング + Sin波パルス推進 (相対座標・滑らかな物理)
//
// 動作原理:
//   - 「休止 → パルス推進 → 休止」サイクルを繰り返す
//   - Y方向は絶対目標位置への引き寄せを廃止。
//   - 初回位置をベースに緩やかなランダムドリフトと壁反発で baseY を決定し、
//     そこを基準にふわふわホバリングする。
//   - Y方向の速度は位置差分を直接代入せず、力学的な補間（スプリング力）に修正。
// ============================================================

const squidState = new Map<string, {
  frame: number;    // サイクル内フレーム
  dir: 1 | -1;     // 現在の向き
  baseY: number;   // Y基準
  phase: number;
  turnCooldown: number;
  depth: DepthBehaviorState;
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
      turnCooldown: 0,
      depth: initDepthBehavior(fish),
    });
  }
  const state = squidState.get(fish.id)!;
  const profile = motionProfileFor(fish);
  state.frame = (state.frame + 1) % CYCLE;
  state.turnCooldown = Math.max(0, state.turnCooldown - 1);

  const margin = PHYSICS.WALL_MARGIN * 1.5;
  if (world.horizontalBoundaryMode === "bounce" && state.turnCooldown === 0) {
    if (fish.physics.pos.x > world.width - margin && state.dir === 1) {
      state.dir = -1;
      state.turnCooldown = 75;
    }
    if (fish.physics.pos.x < margin && state.dir === -1) {
      state.dir = 1;
      state.turnCooldown = 75;
    }
  }

  // --- X方向: パルス推進 (漏斗噴射) ---
  const isJetting = state.frame < PHYSICS.SQUID_PULSE_FRAMES;
  const targetVX = isJetting
    ? PHYSICS.SQUID_PULSE_SPEED * state.dir * movementScale(fish) * Math.max(0.55, profile.tailBeat)
    : PHYSICS.SQUID_CRUISE_SPEED * state.dir * movementScale(fish);

  const turning = fish.physics.vel.x * state.dir < 0;
  let accel = 0.06;
  if (turning) {
    accel = 0.045 / Math.max(0.45, profile.glide);
  } else if (isJetting) {
    accel = 0.28; // 噴射時の急加速
  } else {
    // 噴射直後、巡航目標速度より現在の速度が大きいときは、急速に減速(ドラッグ)させる
    const currentSpeed = Math.abs(fish.physics.vel.x);
    const targetSpeed = Math.abs(targetVX);
    if (currentSpeed > targetSpeed) {
      accel = 0.18 / Math.max(0.45, profile.glide);
    } else {
      accel = 0.065 / Math.max(0.45, profile.glide);
    }
  }
  fish.physics.vel.x += (targetVX - fish.physics.vel.x) * accel;
  fish.physics.pos.x += fish.physics.vel.x;

  // --- Y方向: ホバリング & 相対ベースラインドリフト ---
  // 1. baseY の緩やかな相対ドリフト
  state.baseY += (Math.random() - 0.5) * 0.4 * verticalSpreadForFish(fish);

  // 2. 壁からの反発で baseY をクランプ・補正
  const WALL_REPULSE = 80;
  const WALL_FORCE_BASE = 1.0;
  if (state.baseY < WALL_REPULSE) {
    state.baseY += WALL_FORCE_BASE * (1 - state.baseY / WALL_REPULSE);
  }
  if (state.baseY > world.height - WALL_REPULSE) {
    state.baseY -= WALL_FORCE_BASE * (1 - (world.height - state.baseY) / WALL_REPULSE);
  }

  // 禁止エリアからの反発で baseY を押し戻す
  for (const fz of world.forbiddenZones) {
    const cy = fz.y + fz.height / 2;
    const halfH = fz.height / 2 + WALL_REPULSE;
    const dyBase = state.baseY - cy;
    if (Math.abs(fish.physics.pos.x - (fz.x + fz.width / 2)) < fz.width / 2 + WALL_REPULSE) {
      if (Math.abs(dyBase) < halfH) {
        state.baseY += Math.sign(dyBase) * WALL_FORCE_BASE * ((halfH - Math.abs(dyBase)) / WALL_REPULSE);
      }
    }
  }

  // 3. ホバリング (Sin波) の計算
  const t = state.phase + (Date.now() / 1000) * (Math.PI * 2 / (PHYSICS.SQUID_HOVER_PERIOD / 60)) * Math.max(0.55, profile.tailBeat);
  const hoverOffset = Math.sin(t) * PHYSICS.SQUID_HOVER_AMP * verticalSpreadForFish(fish);

  const targetY = state.baseY + hoverOffset;
  const depthForce = updateDepthBehavior(fish, state.depth, 0.007) * 8;

  // 位置差分に基づくスプリング力を速度に加算 (直接代入ではなく滑らかに追従)
  const springForce = (targetY - fish.physics.pos.y) * 0.02 * (1 + turnStrengthForFish(fish) * 0.5);
  fish.physics.vel.y = (fish.physics.vel.y + springForce + depthForce) * 0.88;

  // 最大速度のクランプ
  const maxVY = PHYSICS.SQUID_PULSE_SPEED * 0.5 * verticalSpreadForFish(fish);
  fish.physics.vel.y = Math.max(-maxVY, Math.min(maxVY, fish.physics.vel.y));

  fish.physics.pos.y += fish.physics.vel.y;
}

export function resetSquidState(fishId: string, newY: number): void {
  const state = squidState.get(fishId);
  if (state) {
    state.baseY = newY;
    resetDepthBehavior(state.depth, newY);
  }
}
