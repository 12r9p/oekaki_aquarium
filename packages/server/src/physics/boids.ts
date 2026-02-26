import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";

// ============================================================
// Boids アルゴリズム (Type A: Swimmer)
//
// 3つの古典的なルール:
//   1. Separation: 近すぎる仲間から離れる
//   2. Alignment:  仲間の平均速度方向に揃える
//   3. Cohesion:   仲間の重心へ向かう
// ============================================================

/** 速度ベクトルを最大値でクランプする */
function limit(v: Vector2, max: number): Vector2 {
  const len = Math.hypot(v.x, v.y);
  if (len > max) {
    return { x: (v.x / len) * max, y: (v.y / len) * max };
  }
  return v;
}

/** 単位ベクトル化する */
function normalize(v: Vector2): Vector2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/** 目標方向ステアリング力を計算する */
function steer(desired: Vector2, current: Vector2): Vector2 {
  return limit(
    { x: desired.x - current.x, y: desired.y - current.y },
    PHYSICS.BOIDS_MAX_FORCE
  );
}

/** Boids ルールに基づいてフレームごとの速度を更新する */
export function applyBoids(fish: ActiveFish, allFish: ActiveFish[]): void {
  const baseSpeed = PHYSICS.BOIDS_MAX_SPEED * fish.physics.speedMultiplier;
  const baseForce = PHYSICS.BOIDS_MAX_FORCE;

  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;

  for (const other of allFish) {
    if (other.id === fish.id || other.type !== "swimmer") continue;

    const dx = fish.physics.pos.x - other.physics.pos.x;
    const dy = fish.physics.pos.y - other.physics.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) continue;

    // 1. Separation
    if (dist < PHYSICS.BOIDS_SEPARATION_RADIUS) {
      // 距離に反比例した逃げ方向ベクトルを加算
      sepX += (dx / dist) / dist;
      sepY += (dy / dist) / dist;
      sepCount++;
    }

    // 2. Alignment
    if (dist < PHYSICS.BOIDS_ALIGNMENT_RADIUS) {
      aliX += other.physics.vel.x;
      aliY += other.physics.vel.y;
      aliCount++;
    }

    // 3. Cohesion
    if (dist < PHYSICS.BOIDS_COHESION_RADIUS) {
      cohX += other.physics.pos.x;
      cohY += other.physics.pos.y;
      cohCount++;
    }
  }

  let fx = 0, fy = 0;

  // Separation の合力を加算
  if (sepCount > 0) {
    const sepDesired = normalize({ x: sepX / sepCount, y: sepY / sepCount });
    const s = steer(
      { x: sepDesired.x * baseSpeed, y: sepDesired.y * baseSpeed },
      fish.physics.vel
    );
    fx += s.x * PHYSICS.BOIDS_SEPARATION_WEIGHT;
    fy += s.y * PHYSICS.BOIDS_SEPARATION_WEIGHT;
  }

  // Alignment の合力を加算
  if (aliCount > 0) {
    const aliDesired = normalize({ x: aliX / aliCount, y: aliY / aliCount });
    const a = steer(
      { x: aliDesired.x * baseSpeed, y: aliDesired.y * baseSpeed },
      fish.physics.vel
    );
    fx += a.x * PHYSICS.BOIDS_ALIGNMENT_WEIGHT;
    fy += a.y * PHYSICS.BOIDS_ALIGNMENT_WEIGHT;
  }

  // Cohesion の合力を加算（仲間の重心へ向かうSteer）
  if (cohCount > 0) {
    const targetX = cohX / cohCount;
    const targetY = cohY / cohCount;
    const dd = Math.hypot(targetX - fish.physics.pos.x, targetY - fish.physics.pos.y);
    if (dd > 0) {
      const cohDesired = {
        x: ((targetX - fish.physics.pos.x) / dd) * baseSpeed,
        y: ((targetY - fish.physics.pos.y) / dd) * baseSpeed,
      };
      const c = steer(cohDesired, fish.physics.vel);
      fx += c.x * PHYSICS.BOIDS_COHESION_WEIGHT;
      fy += c.y * PHYSICS.BOIDS_COHESION_WEIGHT;
    }
  }

  // 速度に合力を加算してクランプ
  fish.physics.vel.x += fx;
  fish.physics.vel.y += fy;
  const clamped = limit(fish.physics.vel, baseSpeed);
  fish.physics.vel = clamped;

  // 位置を更新
  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;

  // 速度から回転角を計算（画像の向きは右向き基準）
  // rotation プロパティはゲームループで一元管理するため ここでは vel を更新するだけ
}
