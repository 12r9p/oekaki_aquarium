import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";

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
//   1. 魚IDからシードを生成してフェーズオフセットを決定（個性付け）
//   2. 毎フレーム sin/cos の時間関数で「希望角度」を更新
//   3. 現在速度の角度と希望角度の差分に比例した小さな力を加算
//   4. 壁・禁止エリアに近いとき追加反発力を付与（境界べったり防止）
// ============================================================

// ジッター: 1フレームごとの最大角度変化量（クランプ前）
const DRIFT_TURN_RATE = 0.035;  // 大きいほど素早く方向転換
const DRIFT_SPEED     = 1.8;    // 速度ベクトルのスケール係数
const WALL_REPULSE    = 180;    // 壁・禁止エリアの反発開始距離(px)
const WALL_FORCE      = 0.35;   // 壁反発力

// IDハッシュ (djb2) → 個体固有の位相オフセット
function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  }
  return h;
}

interface WanderState {
  phaseOffset: number;   // 個体固有の位相オフセット [0, 2π)
  angleOffset: number;   // 2段目の位相（方向変化をネスト）
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
  const now = Date.now() / 1000; // 秒単位

  // 初回: IDハッシュから個体固有の位相を生成
  let state = wanderMap.get(fish.id);
  if (!state) {
    const h = hashId(fish.id);
    const p1 = ((h & 0xffff) / 0xffff) * Math.PI * 2;          // [0, 2π)
    const p2 = (((h >> 16) & 0xffff) / 0xffff) * Math.PI * 2;  // [0, 2π)
    state = { phaseOffset: p1, angleOffset: p2 };
    wanderMap.set(fish.id, state);
  }

  // 個体固有の速度でゆっくり変化する「希望進行角度」を計算
  // sin の入れ子でカオス的な非周期変化を生成
  const t1 = now * 0.13 + state.phaseOffset;
  const t2 = now * 0.07 + state.angleOffset;
  const desiredAngle = Math.sin(t1) * Math.PI + Math.sin(t2 + Math.sin(t1) * 1.3) * Math.PI * 0.8;

  // 現在の速度ベクトルの角度
  const curLen = Math.hypot(vel.x, vel.y);
  const curAngle = curLen > 0.01 ? Math.atan2(vel.y, vel.x) : desiredAngle;

  // 角度差に比例した小さな回転力を加算（最大 DRIFT_TURN_RATE rad/frame）
  let angleDiff = desiredAngle - curAngle;
  // 角度差を [-π, π] に正規化
  while (angleDiff > Math.PI)  angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  const turn = Math.max(-DRIFT_TURN_RATE, Math.min(DRIFT_TURN_RATE, angleDiff));

  // 回転後の速度ベクトルに小さな寄与として加算
  const newAngle = curAngle + turn;
  const driftMag = DRIFT_SPEED;
  vel.x += Math.cos(newAngle) * driftMag;
  vel.y += Math.sin(newAngle) * driftMag;
  // pos.y を直接更新: school.ts が vel.y をdampingで毎フレーム減衰させるため、
  // vel.yへの加算だけでは縦移動が打ち消される。直接位置を動かすことで確実に縦移動させる。
  fish.physics.pos.y += Math.sin(newAngle) * driftMag * 1.2;

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
