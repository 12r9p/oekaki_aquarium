import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// school.ts — イワシ群れ型: 視野制限 (FOV) による追従ストリーム群れ
//
// 改善点:
//   - 視野角制限 (FOV: Field of View) を導入。
//     進行方向から背後120度以上 (内積 < -0.5) にいる他の魚を無視することで、
//     前の魚に追従し、自然な「帯状のストリーム」を形成するように改善。
//   - アライメント (整列) の重みを最適化し、群れ全体の進行同調性を向上。
//   - Wander（ランダム角度変更）の変動幅を適度に抑制し、推進方向の安定性を向上。
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

const WALL_REPULSE    = 80;
const WALL_FORCE      = 0.35;

interface SchoolState {
  group: number;
  desiredAngle: number;
  turnRate: number;
  framesUntilTurn: number;
  personalSpeed: number;
  depth: DepthBehaviorState;
}

const schoolState = new Map<string, SchoolState>();

function groupForFish(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 8;
}

export function applySchool(fish: ActiveFish, allFish: ActiveFish[]): void {
  const world = getWorld();
  const pos = fish.physics.pos;
  const vel = fish.physics.vel;
  const profile = motionProfileFor(fish);
  const baseSpeed = PHYSICS.BOIDS_MAX_SPEED * movementScale(fish) * (0.82 + profile.glide * 0.12);
  const vdamp = Math.max(0.72, Math.min(0.96, PHYSICS.SCHOOL_VERTICAL_DAMPING + (profile.glide - 1) * 0.04));

  let state = schoolState.get(fish.id);
  if (!state) {
    const initialAngle = Math.hypot(vel.x, vel.y) > 0.01
      ? Math.atan2(vel.y, vel.x)
      : Math.random() * Math.PI * 2;
    state = {
      group: groupForFish(fish.id),
      desiredAngle: initialAngle,
      turnRate: 0.015,
      framesUntilTurn: 0,
      personalSpeed: 0.75 + Math.random() * 0.5,
      depth: initDepthBehavior(fish),
    };
    schoolState.set(fish.id, state);
  }

  // --- 1. Wander推進力 (進行方向のゆっくりしたドリフト) ---
  state.framesUntilTurn--;
  if (state.framesUntilTurn <= 0) {
    const currentAngle = Math.hypot(vel.x, vel.y) > 0.01 ? Math.atan2(vel.y, vel.x) : state.desiredAngle;
    // 変動幅を π*0.48 に絞り、ストリームとしての直進安定性を強化
    state.desiredAngle = currentAngle + (Math.random() - 0.5) * Math.PI * 0.48;
    state.turnRate = 0.006 + Math.random() * 0.012;
    state.framesUntilTurn = 90 + Math.floor(Math.random() * 180);
  }

  const curLen = Math.hypot(vel.x, vel.y);
  const curAngle = curLen > 0.01 ? Math.atan2(vel.y, vel.x) : state.desiredAngle;
  let angleDiff = state.desiredAngle - curAngle;
  while (angleDiff > Math.PI)  angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
  const turnRate = state.turnRate * turnStrengthForFish(fish);
  const turn = Math.max(-turnRate, Math.min(turnRate, angleDiff));
  const newAngle = curAngle + turn;

  const cruiseSpeed = baseSpeed * state.personalSpeed;
  let fx = Math.cos(newAngle) * cruiseSpeed * 0.15;
  let fy = Math.sin(newAngle) * cruiseSpeed * 0.10 * verticalSpreadForFish(fish);

  // --- 2. Boids 力 (視野角制限付き) ---
  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;

  // 視野角判定の準備 (進行方向ベクトル)
  const hasHeading = curLen > 0.05;
  const hx = hasHeading ? vel.x / curLen : Math.cos(state.desiredAngle);
  const hy = hasHeading ? vel.y / curLen : Math.sin(state.desiredAngle);

  for (const other of allFish) {
    if (
      other.id === fish.id ||
      other.isArchived ||
      other.isAutoHidden ||
      other.type === "anchor"
    ) continue;

    const toOtherX = other.physics.pos.x - pos.x;
    const toOtherY = other.physics.pos.y - pos.y;
    let dist = Math.hypot(toOtherX, toOtherY);
    if (dist < 0.001) continue;

    // --- 視野制限 (FOV) ---
    // 背後120度（cos(120) = -0.5）にいる他魚は無視することで、帯状のストリームが形成される
    const dot = (toOtherX / dist) * hx + (toOtherY / dist) * hy;
    if (dot < -0.5) continue;

    // 分離ベクトルは pos - other (元のコードの極性を維持)
    const separationRadius = PHYSICS.BOIDS_SEPARATION_RADIUS * 1.05;
    if (dist < separationRadius) {
      sepX += (-toOtherX / dist) / dist;
      sepY += (-toOtherY / dist) / dist;
      sepCount++;
    }
    if (other.type === "school" && groupForFish(other.id) === state.group && dist < PHYSICS.BOIDS_ALIGNMENT_RADIUS * 1.15) {
      aliX += other.physics.vel.x;
      aliY += other.physics.vel.y;
      aliCount++;
    }
    if (other.type === "school" && groupForFish(other.id) === state.group && dist < PHYSICS.BOIDS_COHESION_RADIUS * 1.15) {
      cohX += other.physics.pos.x;
      cohY += other.physics.pos.y;
      cohCount++;
    }
  }

  if (sepCount > 0) {
    const sepDesired = normalize({ x: sepX / sepCount, y: sepY / sepCount });
    const s = steer({ x: sepDesired.x * baseSpeed, y: sepDesired.y * baseSpeed }, vel);
    fx += s.x * PHYSICS.BOIDS_SEPARATION_WEIGHT * 0.95;
    fy += s.y * PHYSICS.BOIDS_SEPARATION_WEIGHT * 0.35;
  }
  if (aliCount > 0) {
    const aliDesired = normalize({ x: aliX / aliCount, y: aliY / aliCount });
    const a = steer({ x: aliDesired.x * baseSpeed, y: aliDesired.y * baseSpeed }, vel);
    // アライメントの同調力を高め、群れの向きを揃えやすくする
    fx += a.x * PHYSICS.BOIDS_ALIGNMENT_WEIGHT * 0.85;
    fy += a.y * PHYSICS.BOIDS_ALIGNMENT_WEIGHT * 0.28 * vdamp;
  }
  if (cohCount > 0) {
    const tx = cohX / cohCount, ty = cohY / cohCount;
    const dd = Math.hypot(tx - pos.x, ty - pos.y);
    if (dd > 0) {
      const cohDesired = {
        x: ((tx - pos.x) / dd) * baseSpeed,
        y: ((ty - pos.y) / dd) * baseSpeed,
      };
      const c = steer(cohDesired, vel);
      fx += c.x * PHYSICS.BOIDS_COHESION_WEIGHT * 0.08;
      fy += c.y * PHYSICS.BOIDS_COHESION_WEIGHT * 0.04 * vdamp;
    }
  }

  // --- 3. 相対的な壁・禁止エリアからの反発 ---
  const ww = world.width;
  const wh = world.height;

  if (pos.x < WALL_REPULSE)       fx += WALL_FORCE * (1 - pos.x / WALL_REPULSE);
  if (pos.x > ww - WALL_REPULSE) fx -= WALL_FORCE * (1 - (ww - pos.x) / WALL_REPULSE);
  if (pos.y < WALL_REPULSE)       fy += WALL_FORCE * (1 - pos.y / WALL_REPULSE);
  if (pos.y > wh - WALL_REPULSE) fy -= WALL_FORCE * (1 - (wh - pos.y) / WALL_REPULSE);

  for (const fz of world.forbiddenZones) {
    const cx = fz.x + fz.width / 2;
    const cy = fz.y + fz.height / 2;
    const halfW = fz.width / 2 + WALL_REPULSE;
    const halfH = fz.height / 2 + WALL_REPULSE;
    const dx = pos.x - cx;
    const dy = pos.y - cy;
    if (Math.abs(dx) < halfW && Math.abs(dy) < halfH) {
      const overlapX = halfW - Math.abs(dx);
      const overlapY = halfH - Math.abs(dy);
      if (overlapX < overlapY) {
        fx += Math.sign(dx) * WALL_FORCE * (overlapX / WALL_REPULSE);
      } else {
        fy += Math.sign(dy) * WALL_FORCE * (overlapY / WALL_REPULSE);
      }
    }
  }

  fy += updateDepthBehavior(fish, state.depth, 0.0035) * turnStrengthForFish(fish) * 0.45;

  vel.x = (vel.x + fx) * 0.992;
  vel.y = (vel.y + fy) * vdamp;

  const clamped = limit(vel, baseSpeed * state.personalSpeed);
  fish.physics.vel = clamped;

  pos.x += vel.x;
  pos.y += vel.y;
}

export function resetSchoolState(fishId: string, x: number, y: number): void {
  const state = schoolState.get(fishId);
  if (!state) return;
  resetDepthBehavior(state.depth, y);
  state.framesUntilTurn = 1;
}
