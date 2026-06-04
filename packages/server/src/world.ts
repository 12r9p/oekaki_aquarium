import type { ClientConfig, AppLayerConfig, HorizontalBoundaryMode, MotionSettings } from "@aquarium/shared";
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
  motionSettings: MotionSettings;
}

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
  world.layers = layers;
}

export function updateWorldMotionSettings(
  horizontalBoundaryMode?: HorizontalBoundaryMode,
  fishSpeedMultiplier?: number,
  motionSettings?: MotionSettings,
): void {
  if (horizontalBoundaryMode) world.horizontalBoundaryMode = horizontalBoundaryMode;
  if (fishSpeedMultiplier !== undefined) {
    world.fishSpeedMultiplier = Math.max(0.1, Math.min(fishSpeedMultiplier, 3));
  }
  if (motionSettings) {
    world.motionSettings = {
      verticalSpread: Math.max(0.2, Math.min(motionSettings.verticalSpread, 2)),
      turnStrength: Math.max(0.2, Math.min(motionSettings.turnStrength, 2)),
    };
  }
}

export function restoreWorldSettings(settings: Partial<Omit<WorldConfig, "validZones">>): void {
  if (settings.width !== undefined && settings.height !== undefined) setWorldSize(settings.width, settings.height);
  if (settings.forbiddenZones) updateForbiddenZones(settings.forbiddenZones);
  if (settings.spawnPoints) updateSpawnPoints(settings.spawnPoints);
  if (settings.layers) updateLayers(settings.layers);
  updateWorldMotionSettings(settings.horizontalBoundaryMode, settings.fishSpeedMultiplier, settings.motionSettings);
}

export function updateFishLayerConfig(layers: import("@aquarium/shared").LayerConfig[]): void {
  replaceLayerConfig(layers);
  updateFishLayersInAppLayers();
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
