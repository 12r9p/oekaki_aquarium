import type { ActiveFish } from "@aquarium/shared";
import { getWorld } from "../world";
import { movementScale, turnStrengthForFish, verticalSpreadForFish } from "./motion-profile";

type CustomUpdate = (fish: ActiveFish, t: number, api: CustomMotionApi) => void;

interface CustomMotionApi {
  world: { width: number; height: number };
  speed: number;
  verticalSpread: number;
  turnStrength: number;
  age: number;
  clamp(value: number, min: number, max: number): number;
  lerp(a: number, b: number, t: number): number;
  noise(seed?: number): number;
  sin(value: number): number;
  cos(value: number): number;
}

let compiledSource = "";
let compiledUpdate: CustomUpdate | null = null;
let lastCompileErrorAt = 0;

export function applyCustomMotion(fish: ActiveFish): void {
  const code = getWorld().motionSettings.customCode?.trim();
  if (!code) {
    applyDefaultCustomMotion(fish);
    return;
  }

  const update = compileCustomMotion(code);
  if (!update) {
    applyDefaultCustomMotion(fish);
    return;
  }

  try {
    update(fish, Date.now(), createApi(fish));
    if (!Number.isFinite(fish.physics.pos.x) || !Number.isFinite(fish.physics.pos.y)) {
      throw new Error("custom motion produced invalid position");
    }
    if (!Number.isFinite(fish.physics.vel.x) || !Number.isFinite(fish.physics.vel.y)) {
      throw new Error("custom motion produced invalid velocity");
    }
  } catch (error) {
    logCustomMotionError(error);
    applyDefaultCustomMotion(fish);
  }
}

function compileCustomMotion(code: string): CustomUpdate | null {
  if (code === compiledSource) return compiledUpdate;
  compiledSource = code;
  compiledUpdate = null;
  try {
    const normalized = code
      .replace(/^\s*export\s+default\s+function\s+update\s*\(/m, "function update(")
      .replace(/^\s*export\s+function\s+update\s*\(/m, "function update(");
    const factory = new Function(`${normalized}\nreturn typeof update === "function" ? update : null;`);
    const result = factory() as unknown;
    compiledUpdate = typeof result === "function" ? result as CustomUpdate : null;
  } catch (error) {
    logCustomMotionError(error);
  }
  return compiledUpdate;
}

function createApi(fish: ActiveFish): CustomMotionApi {
  const world = getWorld();
  return {
    world: { width: world.width, height: world.height },
    speed: movementScale(fish),
    verticalSpread: verticalSpreadForFish(fish),
    turnStrength: turnStrengthForFish(fish),
    age: Math.max(0, Date.now() - fish.releasedAt),
    clamp,
    lerp: (a, b, t) => a + (b - a) * clamp(t, 0, 1),
    noise: (seed = 0) => {
      const x = Math.sin(seed * 12.9898 + fish.id.length * 78.233) * 43758.5453;
      return x - Math.floor(x);
    },
    sin: Math.sin,
    cos: Math.cos,
  };
}

function applyDefaultCustomMotion(fish: ActiveFish): void {
  const t = Date.now() * 0.001;
  const speed = 2.4 * movementScale(fish);
  const dir = fish.physics.vel.x < 0 ? -1 : 1;
  fish.physics.vel.x = dir * speed;
  fish.physics.vel.y += Math.sin(t * 1.7 + fish.id.length) * 0.06 * verticalSpreadForFish(fish);
  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}

function logCustomMotionError(error: unknown): void {
  const now = Date.now();
  if (now - lastCompileErrorAt < 3000) return;
  lastCompileErrorAt = now;
  console.error("[CustomMotion]", error);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Number.isFinite(value) ? value : min, max));
}
