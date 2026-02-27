import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";

// ============================================================
// school.ts — イワシ群れ型: 改良Boids（横バイアス・縦抑制）
//
// 旧 swimmer (Boids) の改良版:
//   - Y方向の速度を SCHOOL_VERTICAL_DAMPING 倍に抑制（横移動中心）
//   - 群れに属さない孤立魚は画面中央へ向かう引力を加算
//   - 向きがランダムにバラけないよう初期速度に横バイアスを付与
// ============================================================

function limit(v: Vector2, max: number): Vector2 {
  const len = Math.hypot(v.x, v.y);
  if (len > max) return { x: (v.x / len) * max, y: (v.y / len) * max };
  return v;
}
function normalize(v: Vector2): Vector2 {
  const len = Math.hypot(v.x, v.y);
  if (len === 0) return { x: 1, y: 0 };
  return { x: v.x / len, y: v.y / len };
}
function steer(desired: Vector2, current: Vector2): Vector2 {
  return limit(
    { x: desired.x - current.x, y: desired.y - current.y },
    PHYSICS.BOIDS_MAX_FORCE
  );
}

export function applySchool(fish: ActiveFish, allFish: ActiveFish[]): void {
  const baseSpeed = PHYSICS.BOIDS_MAX_SPEED * fish.physics.speedMultiplier;
  const vdamp = PHYSICS.SCHOOL_VERTICAL_DAMPING;

  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;

  // schoolとswimmerを同一群れとして扱う（互換維持）
  const schoolTypes = new Set(["school", "swimmer"]);

  for (const other of allFish) {
    if (other.id === fish.id || !schoolTypes.has(other.type)) continue;
    const dx = fish.physics.pos.x - other.physics.pos.x;
    const dy = fish.physics.pos.y - other.physics.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) continue;

    if (dist < PHYSICS.BOIDS_SEPARATION_RADIUS) {
      sepX += (dx / dist) / dist;
      sepY += (dy / dist) / dist;
      sepCount++;
    }
    if (dist < PHYSICS.BOIDS_ALIGNMENT_RADIUS) {
      aliX += other.physics.vel.x;
      aliY += other.physics.vel.y;
      aliCount++;
    }
    if (dist < PHYSICS.BOIDS_COHESION_RADIUS) {
      cohX += other.physics.pos.x;
      cohY += other.physics.pos.y;
      cohCount++;
    }
  }

  let fx = 0, fy = 0;

  if (sepCount > 0) {
    const sepDesired = normalize({ x: sepX / sepCount, y: sepY / sepCount });
    const s = steer({ x: sepDesired.x * baseSpeed, y: sepDesired.y * baseSpeed }, fish.physics.vel);
    fx += s.x * PHYSICS.BOIDS_SEPARATION_WEIGHT;
    fy += s.y * PHYSICS.BOIDS_SEPARATION_WEIGHT * vdamp; // 縦抑制
  }
  if (aliCount > 0) {
    const aliDesired = normalize({ x: aliX / aliCount, y: aliY / aliCount });
    const a = steer({ x: aliDesired.x * baseSpeed, y: aliDesired.y * baseSpeed }, fish.physics.vel);
    fx += a.x * PHYSICS.BOIDS_ALIGNMENT_WEIGHT;
    fy += a.y * PHYSICS.BOIDS_ALIGNMENT_WEIGHT * vdamp;
  }
  if (cohCount > 0) {
    const tx = cohX / cohCount, ty = cohY / cohCount;
    const dd = Math.hypot(tx - fish.physics.pos.x, ty - fish.physics.pos.y);
    if (dd > 0) {
      const cohDesired = {
        x: ((tx - fish.physics.pos.x) / dd) * baseSpeed,
        y: ((ty - fish.physics.pos.y) / dd) * baseSpeed,
      };
      const c = steer(cohDesired, fish.physics.vel);
      fx += c.x * PHYSICS.BOIDS_COHESION_WEIGHT;
      fy += c.y * PHYSICS.BOIDS_COHESION_WEIGHT * vdamp;
    }
  }

  // 群れが全くいなければ右方向へのバイアス力を加える
  if (cohCount === 0 && aliCount === 0) {
    const bias = fish.physics.vel.x >= 0 ? 1 : -1;
    fx += bias * 0.05;
  }

  fish.physics.vel.x += fx;
  // Y方向速度を直接抑制してから加算
  fish.physics.vel.y = (fish.physics.vel.y + fy) * vdamp;

  const clamped = limit(fish.physics.vel, baseSpeed);
  fish.physics.vel = clamped;

  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}
