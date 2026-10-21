import type { Context } from "hono";
import type { ClientConfig, WorldObject } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";
import {
  getFishStateSnapshot,
  mergeNewerFishPositionCheckpoint,
  prepareFishSnapshotForRestore,
  restorePreparedFishSnapshot,
} from "../fish-manager";
import { getWorld, prepareWorldStateSnapshot, restorePreparedWorldSnapshot } from "../world";
import {
  getCurrentBgUrl,
  getScene,
  getViewportSnapshot,
  replaceScene,
  restoreViewportSnapshot,
  setCurrentBgUrl,
} from "../ws-handler";
import type { ViewportSnapshot } from "../ws-handler";

const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAssetReference(value: unknown, allowEmpty = false): value is string {
  return typeof value === "string"
    && value.length <= 4096
    && (allowEmpty || value.length > 0)
    && !/^data:/i.test(value)
    && !/^blob:/i.test(value);
}

function parseScene(value: unknown): WorldObject[] | undefined {
  if (!Array.isArray(value) || value.length > 10_000) return undefined;
  const result: WorldObject[] = [];
  for (const object of value) {
    if (
      !isRecord(object)
      || typeof object.id !== "string" || object.id.length === 0 || object.id.length > 200
      || (object.type !== "image" && object.type !== "rect" && object.type !== "ellipse" && object.type !== "text")
      || !isFiniteNumber(object.x) || !isFiniteNumber(object.y)
      || !isFiniteNumber(object.width) || object.width < 0
      || !isFiniteNumber(object.height) || object.height < 0
      || !isFiniteNumber(object.zIndex)
      || !isFiniteNumber(object.opacity) || object.opacity < 0 || object.opacity > 1
      || !isFiniteNumber(object.rotation)
      || (object.label !== undefined && (typeof object.label !== "string" || object.label.length > 500))
      || (object.imageUrl !== undefined && !isAssetReference(object.imageUrl))
      || (object.imageFit !== undefined && object.imageFit !== "fill" && object.imageFit !== "contain" && object.imageFit !== "cover")
      || (object.fillColor !== undefined && (typeof object.fillColor !== "string" || object.fillColor.length > 128))
      || (object.strokeColor !== undefined && (typeof object.strokeColor !== "string" || object.strokeColor.length > 128))
      || (object.strokeWidth !== undefined && (!isFiniteNumber(object.strokeWidth) || object.strokeWidth < 0))
      || (object.text !== undefined && (typeof object.text !== "string" || object.text.length > 20_000))
      || (object.fontSize !== undefined && (!isFiniteNumber(object.fontSize) || object.fontSize <= 0))
      || (object.textColor !== undefined && (typeof object.textColor !== "string" || object.textColor.length > 128))
      || (object.fontWeight !== undefined && object.fontWeight !== "normal" && object.fontWeight !== "bold")
    ) return undefined;

    result.push({
      id: object.id,
      type: object.type,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      zIndex: object.zIndex,
      opacity: object.opacity,
      rotation: object.rotation,
      ...(object.label === undefined ? {} : { label: object.label as string }),
      ...(object.imageUrl === undefined ? {} : { imageUrl: object.imageUrl as string }),
      ...(object.imageFit === undefined ? {} : { imageFit: object.imageFit as WorldObject["imageFit"] }),
      ...(object.fillColor === undefined ? {} : { fillColor: object.fillColor as string }),
      ...(object.strokeColor === undefined ? {} : { strokeColor: object.strokeColor as string }),
      ...(object.strokeWidth === undefined ? {} : { strokeWidth: object.strokeWidth as number }),
      ...(object.text === undefined ? {} : { text: object.text as string }),
      ...(object.fontSize === undefined ? {} : { fontSize: object.fontSize as number }),
      ...(object.textColor === undefined ? {} : { textColor: object.textColor as string }),
      ...(object.fontWeight === undefined ? {} : { fontWeight: object.fontWeight as WorldObject["fontWeight"] }),
    });
  }
  return result;
}

function parseViewports(input: unknown): ViewportSnapshot | undefined {
  if (!isRecord(input) || Object.keys(input).length > 500) return undefined;
  const viewports: ViewportSnapshot = {};
  for (const [uuid, viewportValue] of Object.entries(input)) {
    if (!uuid || uuid.length > 256 || !isRecord(viewportValue)) return undefined;
    const { x, y, width, height, scale } = viewportValue;
    if (
      !isFiniteNumber(x) || Math.abs(x) > 1_000_000
      || !isFiniteNumber(y) || Math.abs(y) > 1_000_000
      || !isFiniteNumber(width) || width <= 0 || width > 100_000
      || !isFiniteNumber(height) || height <= 0 || height > 100_000
      || !isFiniteNumber(scale) || scale <= 0 || scale > 1_000
    ) return undefined;
    viewports[uuid] = { x, y, width, height, scale } satisfies ClientConfig["viewport"];
  }
  return viewports;
}

function jsonNoStore(c: Context, value: unknown, status: 200 | 400 | 413 | 500 = 200): Response {
  return c.json(value, status, { "Cache-Control": "no-store" });
}

/** Internal Container endpoint used by the Worker Durable Object to fetch a state snapshot. */
export function getInternalSnapshotRoute(c: Context): Response {
  let fishSnapshot: ReturnType<typeof getFishStateSnapshot>;
  try {
    fishSnapshot = getFishStateSnapshot();
  } catch {
    return jsonNoStore(c, { error: "Current aquarium fish state cannot be represented as a snapshot" }, 500);
  }
  const world = getWorld();
  const scene = parseScene(getScene());
  const viewports = getViewportSnapshot();
  const bgUrl = getCurrentBgUrl();
  if (
    !scene
    || !isAssetReference(bgUrl, true)
    || world.layers.some((layer) => layer.url !== undefined && !isAssetReference(layer.url))
  ) {
    return jsonNoStore(c, { error: "Current aquarium state cannot be represented as a snapshot" }, 500);
  }

  return jsonNoStore(c, {
    schemaVersion: 1,
    savedAt: Date.now(),
    ...fishSnapshot,
    settings: {
      world: {
        width: world.width,
        height: world.height,
        forbiddenZones: world.forbiddenZones.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
        spawnPoints: world.spawnPoints.map(({ id, x, y }) => ({ id, x, y })),
        layers: world.layers.map(({ id, name, type, url, x, y, width, height, zIndex, visible, opacity, aspectRatioLocked }) => ({
          id,
          name,
          type,
          ...(url === undefined ? {} : { url }),
          ...(x === undefined ? {} : { x }),
          ...(y === undefined ? {} : { y }),
          ...(width === undefined ? {} : { width }),
          ...(height === undefined ? {} : { height }),
          zIndex,
          visible,
          opacity,
          ...(aspectRatioLocked === undefined ? {} : { aspectRatioLocked }),
        })),
        horizontalBoundaryMode: world.horizontalBoundaryMode,
        fishSpeedMultiplier: world.fishSpeedMultiplier,
        fishScaleMultiplier: world.fishScaleMultiplier,
        motionSettings: {
          verticalSpread: world.motionSettings.verticalSpread,
          turnStrength: world.motionSettings.turnStrength,
          ...(world.motionSettings.typeProfiles === undefined ? {} : { typeProfiles: world.motionSettings.typeProfiles }),
          ...(world.motionSettings.customCode === undefined ? {} : { customCode: world.motionSettings.customCode }),
          ...(world.motionSettings.customPresets === undefined ? {} : { customPresets: world.motionSettings.customPresets }),
          ...(world.motionSettings.currentCustomPresetId === undefined ? {} : { currentCustomPresetId: world.motionSettings.currentCustomPresetId }),
        },
      },
      bgUrl,
    },
    fishLayers: LAYER_CONFIG.map(({ id, maxCount, scale, opacity, speedFactor, zIndex }) => ({ id, maxCount, scale, opacity, speedFactor, zIndex })),
    scene,
    viewports,
  });
}

/** Restore a validated full snapshot, with pending-only compatibility for older R2 seeds. */
export async function postInternalSnapshotRoute(c: Context): Promise<Response> {
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SNAPSHOT_BYTES) {
    return jsonNoStore(c, { error: "Snapshot is too large" }, 413);
  }

  let snapshot: unknown;
  try {
    const body = await c.req.text();
    if (new TextEncoder().encode(body).byteLength > MAX_SNAPSHOT_BYTES) {
      return jsonNoStore(c, { error: "Snapshot is too large" }, 413);
    }
    snapshot = JSON.parse(body) as unknown;
  } catch {
    return jsonNoStore(c, { error: "Invalid snapshot JSON" }, 400);
  }

  if (
    !isRecord(snapshot)
    || snapshot.schemaVersion !== 1
    || !isFiniteNumber(snapshot.savedAt)
  ) return jsonNoStore(c, { error: "Invalid snapshot envelope" }, 400);

  let fishSnapshot: ReturnType<typeof prepareFishSnapshotForRestore>;
  let worldSnapshot: ReturnType<typeof prepareWorldStateSnapshot>;
  let scene: WorldObject[] | undefined;
  let viewports: ViewportSnapshot | undefined;
  let bgUrl: string | undefined;
  try {
    fishSnapshot = prepareFishSnapshotForRestore(snapshot);
    if (fishSnapshot.rejectedActiveFish > 0 || fishSnapshot.rejectedPendingFish > 0) {
      return jsonNoStore(c, { error: "Snapshot contains invalid fish entries" }, 400);
    }

    worldSnapshot = prepareWorldStateSnapshot(snapshot);
    if (snapshot.scene !== undefined) {
      scene = parseScene(snapshot.scene);
      if (!scene) return jsonNoStore(c, { error: "Snapshot contains an invalid scene" }, 400);
    }
    if (snapshot.viewports !== undefined) {
      viewports = parseViewports(snapshot.viewports);
      if (!viewports) return jsonNoStore(c, { error: "Snapshot contains invalid viewports" }, 400);
    }
    if (isRecord(snapshot.settings) && snapshot.settings.bgUrl !== undefined) {
      if (!isAssetReference(snapshot.settings.bgUrl, true)) {
        return jsonNoStore(c, { error: "Snapshot contains an invalid background URL" }, 400);
      }
      bgUrl = snapshot.settings.bgUrl;
    }
  } catch {
    return jsonNoStore(c, { error: "Snapshot contains invalid aquarium state" }, 400);
  }

  const positionMerge = mergeNewerFishPositionCheckpoint(fishSnapshot.activeFish, snapshot.savedAt);

  // All sections have been staged and validated before any live state is changed.
  if (worldSnapshot) restorePreparedWorldSnapshot(worldSnapshot);
  const restoredFish = restorePreparedFishSnapshot(fishSnapshot);
  if (bgUrl !== undefined) setCurrentBgUrl(bgUrl);
  if (scene !== undefined) replaceScene(scene);
  if (viewports !== undefined) restoreViewportSnapshot(viewports);

  return jsonNoStore(c, {
    success: true,
    preservedActiveFish: restoredFish.preservedActiveFish,
    restoredActiveFish: restoredFish.restoredActiveFish,
    restoredPendingFish: restoredFish.restoredPendingFish,
    savedAt: snapshot.savedAt,
    positionCheckpointSavedAt: positionMerge.checkpointSavedAt ?? null,
    positionsMergedFromCheckpoint: positionMerge.mergedPositions,
  });
}
