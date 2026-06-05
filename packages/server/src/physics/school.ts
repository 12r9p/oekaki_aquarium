import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

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

const schoolState = new Map<string, { group: number; targetY: number; cruiseDir: 1 | -1; framesUntilChange: number }>();

function groupForFish(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 8;
}

export function applySchool(fish: ActiveFish, allFish: ActiveFish[]): void {
  const world = getWorld();
  const baseSpeed = PHYSICS.BOIDS_MAX_SPEED * movementScale(fish);
  const vdamp = PHYSICS.SCHOOL_VERTICAL_DAMPING;
  let state = schoolState.get(fish.id);
  if (!state) {
    state = {
      group: groupForFish(fish.id),
      targetY: fish.physics.pos.y,
      cruiseDir: fish.physics.vel.x < 0 ? -1 : 1,
      framesUntilChange: 0,
    };
    schoolState.set(fish.id, state);
  }
  state.framesUntilChange--;
  if (state.framesUntilChange <= 0) {
    const edge = Math.max(0.02, 0.08 / verticalSpreadForFish(fish));
    state.targetY = world.height * (edge + Math.random() * (1 - edge * 2));
    if (Math.random() < 0.25) state.cruiseDir *= -1;
    state.framesUntilChange = 300 + Math.floor(Math.random() * 500);
  }

  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;

  // schoolとswimmerを同一群れとして扱う（互換維持）
  const schoolTypes = new Set(["school", "swimmer"]);

  for (const other of allFish) {
    if (
      other.id === fish.id ||
      !schoolTypes.has(other.type) ||
      groupForFish(other.id) !== state.group
    ) continue;
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

  // 小さな群れごとに水槽内を巡回する。全個体が中央へ密集するのを防ぐ。
  fx += state.cruiseDir * 0.025;
  const verticalForce = 0.09 * verticalSpreadForFish(fish);
  fy += Math.max(-verticalForce, Math.min(verticalForce, (state.targetY - fish.physics.pos.y) * 0.0015));

  fish.physics.vel.x += fx;
  // Y方向速度を直接抑制してから加算
  fish.physics.vel.y = (fish.physics.vel.y + fy) * vdamp;

  const clamped = limit(fish.physics.vel, baseSpeed);
  fish.physics.vel = clamped;

  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}
