import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// wander.ts — 角度ドリフト方式 Wander（速度ベクトル空間で動作）
//
// 設計思想:
//   目標位置に「引き寄せる」方式を廃止。
//   代わりに魚の進行方向（速度ベクトルの角度）をゆっくりランダム回転させる。
//
//   これにより:
//   - 禁止エリア境界に「吸い付く」現象がなくなる（ターゲットがないため）
//   - 壁・禁止エリアのboundaries.tsによる跳ね返しと自然に共存できる
//   - worldサイズ変化の影響を受けない
//
//   アルゴリズム:
//   1. 個体ごとに不規則な間隔で新しい「希望角度」を選ぶ
//   2. 方向転換の速さも個体・区間ごとにランダム化する
//   3. 現在速度の角度と希望角度の差分に比例した小さな力を加算
//   4. 壁・禁止エリアに近いとき追加反発力を付与（境界べったり防止）
// ============================================================

// 個体ごとに不規則な間隔で目標方向を選び、そこへ緩やかに旋回する。
const MIN_TURN_RATE   = 0.008;
const MAX_TURN_RATE   = 0.035;
const DRIFT_SPEED     = 0.18;
const MIN_HOLD_FRAMES = 90;
const MAX_HOLD_FRAMES = 300;
const WALL_REPULSE    = 180;    // 壁・禁止エリアの反発開始距離(px)
const WALL_FORCE      = 0.35;   // 壁反発力

interface WanderState {
  desiredAngle: number;
  turnRate: number;
  framesUntilTurn: number;
}

const wanderMap = new Map<string, WanderState>();

/**
 * 角度ドリフトによる探索ステアリングを速度に加算する。
 * 各 applyXxx() の後に呼び出すこと。
 */
export function applyWander(fish: ActiveFish): void {
  const world = getWorld();
  const pos = fish.physics.pos;
  const vel = fish.physics.vel;
  // 初回と一定間隔ごとに、次の進行方向と旋回速度をランダムに選ぶ。
  let state = wanderMap.get(fish.id);
  if (!state) {
    const initialAngle = Math.hypot(vel.x, vel.y) > 0.01
      ? Math.atan2(vel.y, vel.x)
      : Math.random() * Math.PI * 2;
    state = {
      desiredAngle: initialAngle,
      turnRate: MIN_TURN_RATE,
      framesUntilTurn: 0,
    };
    wanderMap.set(fish.id, state);
  }
  state.framesUntilTurn--;
  if (state.framesUntilTurn <= 0) {
    const currentAngle = Math.hypot(vel.x, vel.y) > 0.01
      ? Math.atan2(vel.y, vel.x)
      : state.desiredAngle;
    state.desiredAngle = currentAngle + (Math.random() - 0.5) * Math.PI * 1.5;
    state.turnRate = MIN_TURN_RATE + Math.random() * (MAX_TURN_RATE - MIN_TURN_RATE);
    state.framesUntilTurn = Math.floor(MIN_HOLD_FRAMES + Math.random() * (MAX_HOLD_FRAMES - MIN_HOLD_FRAMES));
  }

  // 現在の速度ベクトルの角度
  const curLen = Math.hypot(vel.x, vel.y);
  const curAngle = curLen > 0.01 ? Math.atan2(vel.y, vel.x) : state.desiredAngle;

  // 角度差に比例した小さな回転力を加算
  let angleDiff = state.desiredAngle - curAngle;
  // 角度差を [-π, π] に正規化
  while (angleDiff > Math.PI)  angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  const turnRate = state.turnRate * turnStrengthForFish(fish);
  const turn = Math.max(-turnRate, Math.min(turnRate, angleDiff));

  // 回転後の速度ベクトルに小さな寄与として加算
  const newAngle = curAngle + turn;
  const driftMag = DRIFT_SPEED * movementScale(fish);
  vel.x += Math.cos(newAngle) * driftMag;
  vel.y += Math.sin(newAngle) * driftMag * verticalSpreadForFish(fish);
  fish.physics.pos.y += Math.sin(newAngle) * driftMag * 0.8 * verticalSpreadForFish(fish);

  // ---- 壁・禁止エリアへの追加反発 ----
  // boundaries.ts の跳ね返しを補完し、「張りつき」をさらに防ぐ
  const ww = world.width;
  const wh = world.height;

  // 外壁反発
  if (pos.x < WALL_REPULSE)       vel.x += WALL_FORCE * (1 - pos.x / WALL_REPULSE);
  if (pos.x > ww - WALL_REPULSE) vel.x -= WALL_FORCE * (1 - (ww - pos.x) / WALL_REPULSE);
  if (pos.y < WALL_REPULSE)       vel.y += WALL_FORCE * (1 - pos.y / WALL_REPULSE);
  if (pos.y > wh - WALL_REPULSE) vel.y -= WALL_FORCE * (1 - (wh - pos.y) / WALL_REPULSE);

  // 禁止エリア反発（各面から押し戻す）
  for (const fz of world.forbiddenZones) {
    const cx = fz.x + fz.width / 2;
    const cy = fz.y + fz.height / 2;
    const halfW = fz.width / 2 + WALL_REPULSE;
    const halfH = fz.height / 2 + WALL_REPULSE;
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    // BBox内に入ったら各面ごとに反発力を加算
    if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
      const overlapX = halfW - Math.abs(dx);
      const overlapY = halfH - Math.abs(dy);
      // より近い面を優先して押し戻す
      if (overlapX < overlapY) {
        vel.x += Math.sign(dx) * WALL_FORCE * (overlapX / WALL_REPULSE);
      } else {
        vel.y += Math.sign(dy) * WALL_FORCE * (overlapY / WALL_REPULSE);
      }
    }
  }
}

/** 魚が削除されたときにwander状態も削除する */
export function removeWanderState(fishId: string): void {
  wanderMap.delete(fishId);
}
