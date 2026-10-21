import type { Context } from "hono";
import type { AppLayerConfig, HorizontalBoundaryMode, MotionSettings } from "@aquarium/shared";
import {
  updateForbiddenZones,
  updateLayers,
  updateSpawnPoints,
  updateWorldMotionSettings,
  setWorldSize,
  getWorld,
} from "../world";
import { broadcastToAll, getCurrentBgUrl, pushStateToManagers, setCurrentBgUrl } from "../ws-handler";

type ForbiddenZone = { id: string; x: number; y: number; width: number; height: number };
type SpawnPoint = { id: string; x: number; y: number };

type WorldSettingsPatch = {
  width?: number;
  height?: number;
  bgUrl?: string;
  forbiddenZones?: ForbiddenZone[];
  spawnPoints?: SpawnPoint[];
  layers?: AppLayerConfig[];
  horizontalBoundaryMode?: HorizontalBoundaryMode;
  fishSpeedMultiplier?: number;
  fishScaleMultiplier?: number;
  motionSettings?: MotionSettings;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isZone(value: unknown): value is ForbiddenZone {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
    && finite(value.x) && finite(value.y)
    && finite(value.width) && value.width > 0
    && finite(value.height) && value.height > 0;
}

function isSpawnPoint(value: unknown): value is SpawnPoint {
  return isRecord(value)
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
    && finite(value.x) && finite(value.y);
}

function isLayer(value: unknown): value is AppLayerConfig {
  if (!isRecord(value)) return false;
  const numericKeys = ["x", "y", "width", "height", "zIndex", "opacity"] as const;
  return typeof value.id === "string" && value.id.length > 0 && value.id.length <= 128
    && typeof value.name === "string" && value.name.length <= 200
    && (value.type === "image" || value.type === "fish" || value.type === "foreground")
    && (value.url === undefined || (typeof value.url === "string" && value.url.length <= 2048 && !/^data:|^blob:/i.test(value.url)))
    && numericKeys.every((key) => value[key] === undefined || finite(value[key]))
    && typeof value.zIndex === "number" && Number.isFinite(value.zIndex)
    && typeof value.visible === "boolean"
    && finite(value.opacity) && value.opacity >= 0 && value.opacity <= 1
    && (value.aspectRatioLocked === undefined || typeof value.aspectRatioLocked === "boolean");
}

function isMotionSettings(value: unknown): value is MotionSettings {
  if (!isRecord(value) || !finite(value.verticalSpread) || !finite(value.turnStrength)) return false;
  if (value.typeProfiles !== undefined && !isRecord(value.typeProfiles)) return false;
  if (value.customCode !== undefined && (typeof value.customCode !== "string" || value.customCode.length > 20_000)) return false;
  if (value.customPresets !== undefined) {
    if (!Array.isArray(value.customPresets) || value.customPresets.length > 50) return false;
    if (!value.customPresets.every((preset) => isRecord(preset)
      && typeof preset.id === "string" && preset.id.length <= 80
      && typeof preset.name === "string" && preset.name.length <= 80
      && typeof preset.code === "string" && preset.code.length <= 20_000)) return false;
  }
  return value.currentCustomPresetId === undefined
    || (typeof value.currentCustomPresetId === "string" && value.currentCustomPresetId.length <= 80);
}

function validatePatch(value: unknown): value is WorldSettingsPatch {
  if (!isRecord(value) || Object.keys(value).length === 0) return false;
  const allowedKeys = new Set([
    "width",
    "height",
    "bgUrl",
    "forbiddenZones",
    "spawnPoints",
    "layers",
    "horizontalBoundaryMode",
    "fishSpeedMultiplier",
    "fishScaleMultiplier",
    "motionSettings",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (value.width !== undefined && (!finite(value.width) || value.width < 1 || value.width > 100_000)) return false;
  if (value.height !== undefined && (!finite(value.height) || value.height < 1 || value.height > 100_000)) return false;
  if (value.bgUrl !== undefined && (typeof value.bgUrl !== "string" || value.bgUrl.length > 2048 || /^data:|^blob:/i.test(value.bgUrl))) return false;
  if (value.forbiddenZones !== undefined && (!Array.isArray(value.forbiddenZones) || value.forbiddenZones.length > 500 || !value.forbiddenZones.every(isZone))) return false;
  if (value.spawnPoints !== undefined && (!Array.isArray(value.spawnPoints) || value.spawnPoints.length > 500 || !value.spawnPoints.every(isSpawnPoint))) return false;
  if (value.layers !== undefined && (!Array.isArray(value.layers) || value.layers.length > 200 || !value.layers.every(isLayer))) return false;
  if (value.horizontalBoundaryMode !== undefined && value.horizontalBoundaryMode !== "bounce" && value.horizontalBoundaryMode !== "wrap") return false;
  if (value.fishSpeedMultiplier !== undefined && !finite(value.fishSpeedMultiplier)) return false;
  if (value.fishScaleMultiplier !== undefined && !finite(value.fishScaleMultiplier)) return false;
  if (value.motionSettings !== undefined && !isMotionSettings(value.motionSettings)) return false;
  return true;
}

/** Persist aquarium settings through the Worker command/revision path. */
export async function worldSettingsRoute(c: Context, authorized: boolean): Promise<Response> {
  if (!authorized) return c.json({ error: "Forbidden" }, 403);

  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 256 * 1024) {
    return c.json({ error: "World settings request is too large" }, 413);
  }

  let patch: unknown;
  try {
    const body = await c.req.text();
    if (new TextEncoder().encode(body).byteLength > 256 * 1024) {
      return c.json({ error: "World settings request is too large" }, 413);
    }
    patch = JSON.parse(body) as unknown;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  if (!validatePatch(patch)) return c.json({ error: "Invalid world settings" }, 400);

  const before = getWorld();
  const width = patch.width ?? before.width;
  const height = patch.height ?? before.height;
  if (patch.width !== undefined || patch.height !== undefined) setWorldSize(width, height);
  if (patch.forbiddenZones !== undefined) updateForbiddenZones(patch.forbiddenZones);
  if (patch.spawnPoints !== undefined) updateSpawnPoints(patch.spawnPoints);
  if (patch.layers !== undefined) updateLayers(patch.layers);
  updateWorldMotionSettings(
    patch.horizontalBoundaryMode,
    patch.fishSpeedMultiplier,
    patch.fishScaleMultiplier,
    patch.motionSettings,
  );

  // This persists the current settings and emits the same state update used by
  // connected displays, after the entire patch has been applied.
  const bgUrl = patch.bgUrl ?? getCurrentBgUrl();
  setCurrentBgUrl(bgUrl);

  if (patch.width !== undefined || patch.height !== undefined) {
    broadcastToAll({ event: "update_world_size", width, height });
  }
  pushStateToManagers();

  const world = getWorld();
  const revisionHeader = c.req.header("x-aquarium-revision");
  const revisionValue = revisionHeader !== undefined && /^\d+$/.test(revisionHeader)
    ? Number(revisionHeader)
    : undefined;
  return c.json({
    success: true,
    revision: revisionValue !== undefined && Number.isSafeInteger(revisionValue) ? revisionValue : undefined,
    world: {
      width: world.width,
      height: world.height,
      bgUrl,
      forbiddenZones: world.forbiddenZones,
      spawnPoints: world.spawnPoints,
      layers: world.layers,
      horizontalBoundaryMode: world.horizontalBoundaryMode,
      fishSpeedMultiplier: world.fishSpeedMultiplier,
      fishScaleMultiplier: world.fishScaleMultiplier,
      motionSettings: world.motionSettings,
    },
  });
}
