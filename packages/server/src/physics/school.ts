import type { ActiveFish, Vector2 } from "@aquarium/shared";
import { PHYSICS } from "@aquarium/shared";
import { getWorld } from "../world";
import { initDepthBehavior, resetDepthBehavior, updateDepthBehavior, type DepthBehaviorState } from "./depth-behavior";
import { motionProfileFor, movementScale, verticalSpreadForFish, turnStrengthForFish } from "./motion-profile";

// ============================================================
// school.ts — イワシ群れ型: 横巡航を主軸にしたBoids
//
//   - 個体ごとの巡航レーンをゆっくり変える
//   - 群れの整列・分離は横方向を強め、縦方向は尾振り程度に抑える
//   - 進行方向が急に反転しないよう、レーン巡航とBoids力を合成する
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

const schoolState = new Map<string, {
  group: number;
  targetX: number;
  targetY: number;
  cruiseDir: 1 | -1;
  framesUntilChange: number;
  phase: number;
  personalSpeed: number;
  formationAngle: number;
  formationRadius: number;
  depth: DepthBehaviorState;
}>();

function groupForFish(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % 8;
}

function formationSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

function schoolCenterForGroup(group: number, world: { width: number; height: number }): Vector2 {
  const t = Date.now() * 0.000035;
  const phase = group * 0.91;
  const marginX = Math.min(world.width * 0.28, Math.max(PHYSICS.WALL_MARGIN * 2.0, world.width * 0.12));
  const marginY = Math.min(world.height * 0.30, Math.max(PHYSICS.WALL_MARGIN * 1.5, world.height * 0.12));
  return {
    x: world.width / 2 + Math.sin(t + phase) * Math.max(1, world.width / 2 - marginX),
    y: world.height / 2 + Math.sin(t * 0.58 + phase * 1.7) * Math.max(1, world.height / 2 - marginY),
  };
}

export function applySchool(fish: ActiveFish, allFish: ActiveFish[]): void {
  const world = getWorld();
  const profile = motionProfileFor(fish);
  const baseSpeed = PHYSICS.BOIDS_MAX_SPEED * movementScale(fish) * (0.82 + profile.glide * 0.12);
  const vdamp = Math.max(0.72, Math.min(0.96, PHYSICS.SCHOOL_VERTICAL_DAMPING + (profile.glide - 1) * 0.04));
  let state = schoolState.get(fish.id);
  if (!state) {
    state = {
      group: groupForFish(fish.id),
      targetX: fish.physics.pos.x,
      targetY: fish.physics.pos.y,
      cruiseDir: fish.physics.vel.x < 0 ? -1 : 1,
      framesUntilChange: 1,
      phase: Math.random() * Math.PI * 2,
      personalSpeed: 0.75 + Math.random() * 0.5,
      formationAngle: formationSeed(fish.id) * Math.PI * 2,
      formationRadius: 35 + formationSeed(`${fish.id}:r`) * 95,
      depth: initDepthBehavior(fish),
    };
    schoolState.set(fish.id, state);
  }
  const center = schoolCenterForGroup(state.group, world);
  state.phase += 0.010 * state.personalSpeed * Math.max(0.5, profile.tailBeat);
  const breathe = 0.82 + Math.sin(state.phase * 0.37) * 0.18;
  state.targetX = center.x + Math.cos(state.formationAngle + Math.sin(state.phase) * 0.18) * state.formationRadius * breathe;
  state.targetY = center.y + Math.sin(state.formationAngle) * state.formationRadius * 0.42 * breathe;
  state.cruiseDir = fish.physics.vel.x < 0 ? -1 : 1;

  let sepX = 0, sepY = 0, sepCount = 0;
  let aliX = 0, aliY = 0, aliCount = 0;
  let cohX = 0, cohY = 0, cohCount = 0;

  for (const other of allFish) {
    if (
      other.id === fish.id ||
      other.isArchived ||
      other.isAutoHidden ||
      other.type === "anchor"
    ) continue;
    let dx = fish.physics.pos.x - other.physics.pos.x;
    let dy = fish.physics.pos.y - other.physics.pos.y;
    let dist = Math.hypot(dx, dy);
    if (dist < 0.001) {
      const angle = (groupForFish(fish.id + other.id) / 8) * Math.PI * 2;
      dx = Math.cos(angle);
      dy = Math.sin(angle);
      dist = 1;
    }

    const separationRadius = PHYSICS.BOIDS_SEPARATION_RADIUS * 1.05;
    if (dist < separationRadius) {
      sepX += (dx / dist) / dist;
      sepY += (dy / dist) / dist;
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

  let fx = 0, fy = 0;

  if (sepCount > 0) {
    const sepDesired = normalize({ x: sepX / sepCount, y: sepY / sepCount });
    const s = steer({ x: sepDesired.x * baseSpeed, y: sepDesired.y * baseSpeed }, fish.physics.vel);
    fx += s.x * PHYSICS.BOIDS_SEPARATION_WEIGHT * 0.95;
    fy += s.y * PHYSICS.BOIDS_SEPARATION_WEIGHT * 0.35;
  }
  if (aliCount > 0) {
    const aliDesired = normalize({ x: aliX / aliCount, y: aliY / aliCount });
    const a = steer({ x: aliDesired.x * baseSpeed, y: aliDesired.y * baseSpeed }, fish.physics.vel);
    fx += a.x * PHYSICS.BOIDS_ALIGNMENT_WEIGHT * 0.55;
    fy += a.y * PHYSICS.BOIDS_ALIGNMENT_WEIGHT * 0.18 * vdamp;
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
      fx += c.x * PHYSICS.BOIDS_COHESION_WEIGHT * 0.08;
      fy += c.y * PHYSICS.BOIDS_COHESION_WEIGHT * 0.04 * vdamp;
    }
  }

  const dxTarget = state.targetX - fish.physics.pos.x;
  const dyTarget = state.targetY - fish.physics.pos.y;
  const targetDist = Math.max(1, Math.hypot(dxTarget, dyTarget));

  // グループの周遊中心に対して、個体ごとの隊列位置へ滑らかについていく。
  const targetForce = 0.038 * turnStrengthForFish(fish);
  fx += (dxTarget / targetDist) * targetForce;
  fy += (dyTarget / targetDist) * targetForce * 0.55 * verticalSpreadForFish(fish);
  fy += Math.sin(state.phase) * 0.006 * verticalSpreadForFish(fish);
  fy += updateDepthBehavior(fish, state.depth, 0.0035) * turnStrengthForFish(fish) * 0.45;

  fish.physics.vel.x = (fish.physics.vel.x + fx) * 0.992;
  fish.physics.vel.y = (fish.physics.vel.y + fy) * vdamp;

  const clamped = limit(fish.physics.vel, baseSpeed * state.personalSpeed);
  fish.physics.vel = clamped;

  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}

export function resetSchoolState(fishId: string, x: number, y: number): void {
  const state = schoolState.get(fishId);
  if (!state) return;
  state.targetX = x;
  state.targetY = y;
  resetDepthBehavior(state.depth, y);
  state.framesUntilChange = 1;
}
