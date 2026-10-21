import type { ClientConfig, AppLayerConfig, HorizontalBoundaryMode, LayerConfig, MotionSettings, MotionTypeProfile, FishType } from "@aquarium/shared";
import { DEFAULT_WORLD, LAYER_CONFIG, replaceLayerConfig } from "@aquarium/shared";

// ============================================================
// WorldConfig: 全クライアントのViewportを統合した仮想水槽
// ============================================================

export interface WorldConfig {
  width: number;
  height: number;
  /** 接続済みクライアントが定義する「泳げるエリア」の一覧 */
  validZones: ValidZone[];
  /** ユーザーが指定した進入禁止エリア (赤枠) */
  forbiddenZones: { id: string; x: number; y: number; width: number; height: number }[];
  /** 放流ポイント（初期配置位置） */
  spawnPoints: { id: string; x: number; y: number }[];
  /** アプリケーション全体の統合レイヤー管理 */
  layers: AppLayerConfig[];
  /** 左右端で跳ね返るか、反対側へ回り込むか */
  horizontalBoundaryMode: HorizontalBoundaryMode;
  /** 全魚に適用する速度倍率 */
  fishSpeedMultiplier: number;
  /** 全魚に適用する表示倍率。UI上の1.0は従来の3倍相当。 */
  fishScaleMultiplier: number;
  motionSettings: MotionSettings;
}

export const FISH_SCALE_BASE_MULTIPLIER = 3;

export interface ValidZone {
  clientUuid: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** このモニターの床Y座標 (Type C アンカー配置用) */
  floorY: number;
}

const defaultLayers: AppLayerConfig[] = [
  { id: "layer_system", name: "System (モニター・壁)", type: "foreground", zIndex: -100, visible: true, opacity: 1.0 },
  ...LAYER_CONFIG.map(l => ({
    id: `layer_fish_${l.id}`,
    name: `Lyr ${l.id} (魚レイヤー)`,
    type: "fish" as const,
    zIndex: l.zIndex,
    visible: true,
    opacity: 1.0
  })).sort((a, b) => b.zIndex - a.zIndex) // 奥から手前へ
];

// シングルトンとして管理する仮想水槽状態
const world: WorldConfig = {
  width: DEFAULT_WORLD.width,
  height: DEFAULT_WORLD.height,
  validZones: [],
  forbiddenZones: [],
  spawnPoints: [],
  layers: defaultLayers,
  horizontalBoundaryMode: "wrap",
  fishSpeedMultiplier: 1,
  fishScaleMultiplier: 1,
  motionSettings: { verticalSpread: 1, turnStrength: 1 },
};

/**
 * クライアントが接続・設定を送信したときに ValidZone を登録/更新する。
 * Viewport は表示範囲としてのみ扱い、world サイズには影響させない。
 */
export function registerClientViewport(config: ClientConfig): void {
  const zone: ValidZone = {
    clientUuid: config.uuid,
    x: config.viewport.x,
    y: config.viewport.y,
    width: config.viewport.width,
    height: config.viewport.height,
    floorY: config.viewport.y + config.viewport.height,
  };

  const idx = world.validZones.findIndex((z) => z.clientUuid === config.uuid);
  if (idx >= 0) {
    world.validZones[idx] = zone;
  } else {
    world.validZones.push(zone);
  }
}

export function setWorldSize(width: number, height: number): void {
  world.width = width;
  world.height = height;
}

export function updateForbiddenZones(zones: { id: string; x: number; y: number; width: number; height: number }[]): void {
  world.forbiddenZones = zones;
}

export function updateSpawnPoints(points: { id: string; x: number; y: number }[]): void {
  world.spawnPoints = points;
}

export function updateLayers(layers: AppLayerConfig[]): void {
  world.layers = layers.filter(layer => layer.type === "image" || layer.type === "fish" || layer.type === "foreground");
}

export function updateWorldMotionSettings(
  horizontalBoundaryMode?: HorizontalBoundaryMode,
  fishSpeedMultiplier?: number,
  fishScaleMultiplier?: number,
  motionSettings?: MotionSettings,
): void {
  if (horizontalBoundaryMode) world.horizontalBoundaryMode = horizontalBoundaryMode;
  if (fishSpeedMultiplier !== undefined) {
    world.fishSpeedMultiplier = Math.max(0, Math.min(fishSpeedMultiplier, 5));
  }
  if (fishScaleMultiplier !== undefined) {
    world.fishScaleMultiplier = Math.max(0.1, Math.min(fishScaleMultiplier, 5));
  }
  if (motionSettings) {
    world.motionSettings = {
      verticalSpread: Math.max(0.2, Math.min(motionSettings.verticalSpread, 2)),
      turnStrength: Math.max(0.2, Math.min(motionSettings.turnStrength, 2)),
      typeProfiles: normalizeMotionTypeProfiles(motionSettings.typeProfiles),
      customCode: typeof motionSettings.customCode === "string" ? motionSettings.customCode.slice(0, 20_000) : undefined,
      customPresets: Array.isArray(motionSettings.customPresets)
        ? motionSettings.customPresets.slice(0, 50).map((preset, index) => ({
            id: typeof preset.id === "string" && preset.id ? preset.id.slice(0, 80) : `custom_${index}`,
            name: typeof preset.name === "string" && preset.name ? preset.name.slice(0, 80) : `カスタム ${index + 1}`,
            code: typeof preset.code === "string" ? preset.code.slice(0, 20_000) : "",
          })).filter(preset => preset.code.trim().length > 0)
        : undefined,
      currentCustomPresetId: typeof motionSettings.currentCustomPresetId === "string" ? motionSettings.currentCustomPresetId.slice(0, 80) : undefined,
    };
  }
}

function normalizeMotionTypeProfiles(
  profiles: MotionSettings["typeProfiles"],
): MotionSettings["typeProfiles"] {
  if (!profiles) return undefined;
  const normalized: NonNullable<MotionSettings["typeProfiles"]> = {};
  for (const [type, profile] of Object.entries(profiles)) {
    if (!profile) continue;
    normalized[type as keyof NonNullable<MotionSettings["typeProfiles"]>] = {
      speedMultiplier: Math.max(0.1, Math.min(profile.speedMultiplier ?? 1, 5)),
      verticalSpread: Math.max(0.1, Math.min(profile.verticalSpread ?? 1, 5)),
      turnStrength: Math.max(0.1, Math.min(profile.turnStrength ?? 1, 5)),
      tailBeat: Math.max(0.1, Math.min(profile.tailBeat ?? 1, 5)),
      glide: Math.max(0.1, Math.min(profile.glide ?? 1, 5)),
    };
  }
  return normalized;
}

export function restoreWorldSettings(settings: Partial<Omit<WorldConfig, "validZones">>): void {
  if (settings.width !== undefined && settings.height !== undefined) setWorldSize(settings.width, settings.height);
  if (settings.forbiddenZones) updateForbiddenZones(settings.forbiddenZones);
  if (settings.spawnPoints) updateSpawnPoints(settings.spawnPoints);
  if (settings.layers) updateLayers(settings.layers);
  updateWorldMotionSettings(settings.horizontalBoundaryMode, settings.fishSpeedMultiplier, settings.fishScaleMultiplier, settings.motionSettings);
}

export function updateFishLayerConfig(layers: import("@aquarium/shared").LayerConfig[]): void {
  replaceLayerConfig(layers);
  updateFishLayersInAppLayers();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSnapshotWorldLayers(value: unknown): AppLayerConfig[] | undefined {
  if (!Array.isArray(value) || value.length > 10_000) return undefined;
  const layers: AppLayerConfig[] = [];
  for (const layer of value) {
    if (
      !isRecord(layer)
      || typeof layer.id !== "string" || layer.id.length === 0 || layer.id.length > 200
      || typeof layer.name !== "string" || layer.name.length > 500
      || (layer.type !== "image" && layer.type !== "fish" && layer.type !== "foreground")
      || !isFiniteNumber(layer.zIndex)
      || typeof layer.visible !== "boolean"
      || !isFiniteNumber(layer.opacity) || layer.opacity < 0 || layer.opacity > 1
      || (layer.url !== undefined && (typeof layer.url !== "string" || layer.url.length > 4096 || /^data:|^blob:/i.test(layer.url)))
      || (layer.x !== undefined && !isFiniteNumber(layer.x))
      || (layer.y !== undefined && !isFiniteNumber(layer.y))
      || (layer.width !== undefined && (!isFiniteNumber(layer.width) || layer.width < 0))
      || (layer.height !== undefined && (!isFiniteNumber(layer.height) || layer.height < 0))
      || (layer.aspectRatioLocked !== undefined && typeof layer.aspectRatioLocked !== "boolean")
    ) return undefined;
    layers.push({
      id: layer.id,
      name: layer.name,
      type: layer.type,
      zIndex: layer.zIndex,
      visible: layer.visible,
      opacity: layer.opacity,
      ...(layer.url === undefined ? {} : { url: layer.url as string }),
      ...(layer.x === undefined ? {} : { x: layer.x as number }),
      ...(layer.y === undefined ? {} : { y: layer.y as number }),
      ...(layer.width === undefined ? {} : { width: layer.width as number }),
      ...(layer.height === undefined ? {} : { height: layer.height as number }),
      ...(layer.aspectRatioLocked === undefined ? {} : { aspectRatioLocked: layer.aspectRatioLocked as boolean }),
    });
  }
  return layers;
}

function parseSnapshotMotionSettings(value: unknown): MotionSettings | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.verticalSpread) || !isFiniteNumber(value.turnStrength)) return undefined;
  let typeProfiles: MotionSettings["typeProfiles"];
  if (value.typeProfiles !== undefined) {
    if (!isRecord(value.typeProfiles)) return undefined;
    const profiles: Partial<Record<FishType, MotionTypeProfile>> = {};
    const knownTypes = new Set<FishType>(["anchor", "tuna", "school", "squid", "jellyfish", "shark", "custom"]);
    for (const [type, profile] of Object.entries(value.typeProfiles)) {
      if (!knownTypes.has(type as FishType)) continue;
      if (!isRecord(profile)) return undefined;
      const keys = ["speedMultiplier", "verticalSpread", "turnStrength", "tailBeat", "glide"] as const;
      if (keys.some((key) => profile[key] !== undefined && !isFiniteNumber(profile[key]))) return undefined;
      profiles[type as FishType] = {
        speedMultiplier: isFiniteNumber(profile.speedMultiplier) ? profile.speedMultiplier : 1,
        verticalSpread: isFiniteNumber(profile.verticalSpread) ? profile.verticalSpread : 1,
        turnStrength: isFiniteNumber(profile.turnStrength) ? profile.turnStrength : 1,
        tailBeat: isFiniteNumber(profile.tailBeat) ? profile.tailBeat : 1,
        glide: isFiniteNumber(profile.glide) ? profile.glide : 1,
      };
    }
    typeProfiles = profiles;
  }

  if (value.customCode !== undefined && typeof value.customCode !== "string") return undefined;
  if (value.currentCustomPresetId !== undefined && typeof value.currentCustomPresetId !== "string") return undefined;
  let customPresets: MotionSettings["customPresets"];
  if (value.customPresets !== undefined) {
    if (!Array.isArray(value.customPresets) || value.customPresets.length > 50) return undefined;
    customPresets = [];
    for (const preset of value.customPresets) {
      if (
        !isRecord(preset)
        || typeof preset.id !== "string"
        || typeof preset.name !== "string"
        || typeof preset.code !== "string"
      ) return undefined;
      customPresets.push({ id: preset.id, name: preset.name, code: preset.code });
    }
  }

  return {
    verticalSpread: value.verticalSpread,
    turnStrength: value.turnStrength,
    ...(typeProfiles === undefined ? {} : { typeProfiles }),
    ...(value.customCode === undefined ? {} : { customCode: value.customCode as string }),
    ...(customPresets === undefined ? {} : { customPresets }),
    ...(value.currentCustomPresetId === undefined ? {} : { currentCustomPresetId: value.currentCustomPresetId as string }),
  };
}

function parseSnapshotFishLayers(value: unknown): LayerConfig[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) return undefined;
  const layers: LayerConfig[] = [];
  for (const layer of value) {
    if (
      !isRecord(layer)
      || !isFiniteNumber(layer.id) || !Number.isInteger(layer.id)
      || !isFiniteNumber(layer.maxCount) || layer.maxCount <= 0
      || !isFiniteNumber(layer.scale)
      || !isFiniteNumber(layer.opacity)
      || !isFiniteNumber(layer.speedFactor)
      || !isFiniteNumber(layer.zIndex)
    ) return undefined;
    layers.push({
      id: layer.id,
      maxCount: layer.maxCount,
      scale: layer.scale,
      opacity: layer.opacity,
      speedFactor: layer.speedFactor,
      zIndex: layer.zIndex,
    });
  }
  return layers;
}

/** Restore persisted aquarium dimensions, world layers, and fish layer configuration. */
export function restoreWorldStateFromSnapshot(snapshot: unknown): void {
  if (!isRecord(snapshot) || !isRecord(snapshot.settings) || !isRecord(snapshot.settings.world)) {
    throw new TypeError("Invalid aquarium world snapshot: settings.world is required");
  }
  const worldSnapshot = snapshot.settings.world;
  const fishLayers = parseSnapshotFishLayers(snapshot.fishLayers);
  if (!fishLayers) throw new TypeError("Invalid aquarium world snapshot: fishLayers is invalid");

  const settings: Partial<Omit<WorldConfig, "validZones">> = {};
  if (worldSnapshot.width !== undefined || worldSnapshot.height !== undefined) {
    if (
      !isFiniteNumber(worldSnapshot.width) || worldSnapshot.width <= 0 || worldSnapshot.width > 1_000_000
      || !isFiniteNumber(worldSnapshot.height) || worldSnapshot.height <= 0 || worldSnapshot.height > 1_000_000
    ) throw new TypeError("Invalid aquarium world snapshot: width and height must be positive finite numbers");
    settings.width = worldSnapshot.width;
    settings.height = worldSnapshot.height;
  }

  if (worldSnapshot.forbiddenZones !== undefined) {
    if (!Array.isArray(worldSnapshot.forbiddenZones) || worldSnapshot.forbiddenZones.length > 10_000) {
      throw new TypeError("Invalid aquarium world snapshot: forbiddenZones is invalid");
    }
    const zones: WorldConfig["forbiddenZones"] = [];
    for (const zone of worldSnapshot.forbiddenZones) {
      if (
        !isRecord(zone) || typeof zone.id !== "string"
        || !isFiniteNumber(zone.x) || !isFiniteNumber(zone.y)
        || !isFiniteNumber(zone.width) || zone.width < 0
        || !isFiniteNumber(zone.height) || zone.height < 0
      ) throw new TypeError("Invalid aquarium world snapshot: forbidden zone is invalid");
      zones.push({ id: zone.id, x: zone.x, y: zone.y, width: zone.width, height: zone.height });
    }
    settings.forbiddenZones = zones;
  }

  if (worldSnapshot.spawnPoints !== undefined) {
    if (!Array.isArray(worldSnapshot.spawnPoints) || worldSnapshot.spawnPoints.length > 10_000) {
      throw new TypeError("Invalid aquarium world snapshot: spawnPoints is invalid");
    }
    const points: WorldConfig["spawnPoints"] = [];
    for (const point of worldSnapshot.spawnPoints) {
      if (!isRecord(point) || typeof point.id !== "string" || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
        throw new TypeError("Invalid aquarium world snapshot: spawn point is invalid");
      }
      points.push({ id: point.id, x: point.x, y: point.y });
    }
    settings.spawnPoints = points;
  }

  if (worldSnapshot.layers !== undefined) {
    const layers = parseSnapshotWorldLayers(worldSnapshot.layers);
    if (!layers) throw new TypeError("Invalid aquarium world snapshot: layers is invalid");
    settings.layers = layers;
  }

  if (worldSnapshot.horizontalBoundaryMode !== undefined) {
    if (worldSnapshot.horizontalBoundaryMode !== "bounce" && worldSnapshot.horizontalBoundaryMode !== "wrap") {
      throw new TypeError("Invalid aquarium world snapshot: horizontalBoundaryMode is invalid");
    }
    settings.horizontalBoundaryMode = worldSnapshot.horizontalBoundaryMode as HorizontalBoundaryMode;
  }
  if (worldSnapshot.fishSpeedMultiplier !== undefined) {
    if (!isFiniteNumber(worldSnapshot.fishSpeedMultiplier)) throw new TypeError("Invalid aquarium world snapshot: fishSpeedMultiplier is invalid");
    settings.fishSpeedMultiplier = worldSnapshot.fishSpeedMultiplier;
  }
  if (worldSnapshot.fishScaleMultiplier !== undefined) {
    if (!isFiniteNumber(worldSnapshot.fishScaleMultiplier)) throw new TypeError("Invalid aquarium world snapshot: fishScaleMultiplier is invalid");
    settings.fishScaleMultiplier = worldSnapshot.fishScaleMultiplier;
  }
  if (worldSnapshot.motionSettings !== undefined) {
    const motionSettings = parseSnapshotMotionSettings(worldSnapshot.motionSettings);
    if (!motionSettings) throw new TypeError("Invalid aquarium world snapshot: motionSettings is invalid");
    settings.motionSettings = motionSettings;
  }

  // Update the fish layer source first, then restore saved app-layer visibility and ordering.
  updateFishLayerConfig(fishLayers);
  restoreWorldSettings(settings);
}

function updateFishLayersInAppLayers(): void {
  const nonFishLayers = world.layers.filter(layer => layer.type !== "fish");
  const fishLayers: AppLayerConfig[] = LAYER_CONFIG.map(layer => ({
    id: `layer_fish_${layer.id}`,
    name: `Lyr ${layer.id} (魚レイヤー)`,
    type: "fish",
    zIndex: layer.zIndex,
    visible: true,
    opacity: 1,
  }));
  world.layers = [...nonFishLayers, ...fishLayers];
}

/** クライアントが切断したときに ValidZone を削除する */
export function unregisterClient(uuid: string): void {
  const idx = world.validZones.findIndex((z) => z.clientUuid === uuid);
  if (idx >= 0) world.validZones.splice(idx, 1);
}

/** 現在の世界設定を取得 */
export function getWorld(): Readonly<WorldConfig> {
  return world;
}

/** 与えられた座標が ValidZone 内かどうかを判定 */
export function isInValidZone(x: number, y: number): boolean {
  return world.validZones.some(
    (z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height
  );
}

/** 最も近い ValidZone の中心座標を返す（Void からの押し戻し先） */
export function nearestValidZoneCenter(x: number, y: number): { x: number; y: number } {
  if (world.validZones.length === 0) {
    return { x: DEFAULT_WORLD.width / 2, y: DEFAULT_WORLD.height / 2 };
  }

  let nearest = world.validZones[0];
  let minDist = Infinity;

  for (const z of world.validZones) {
    const cx = z.x + z.width / 2;
    const cy = z.y + z.height / 2;
    const dist = Math.hypot(cx - x, cy - y);
    if (dist < minDist) {
      minDist = dist;
      nearest = z;
    }
  }

  return {
    x: nearest.x + nearest.width / 2,
    y: nearest.y + nearest.height / 2,
  };
}
