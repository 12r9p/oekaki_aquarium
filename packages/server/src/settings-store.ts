import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppLayerConfig, ClientConfig, HorizontalBoundaryMode, WorldObject } from "@aquarium/shared";

export const DEFAULT_BACKGROUND_URL = "/images/scene/aquarium-default.png";

export interface PersistedAquariumSettings {
  world?: {
    width: number;
    height: number;
    forbiddenZones: { id: string; x: number; y: number; width: number; height: number }[];
    spawnPoints: { id: string; x: number; y: number }[];
    layers: AppLayerConfig[];
    horizontalBoundaryMode: HorizontalBoundaryMode;
    fishSpeedMultiplier: number;
  };
  bgUrl?: string;
  viewports?: Record<string, ClientConfig["viewport"]>;
  sceneObjects?: WorldObject[];
}

const SETTINGS_PATH = join(import.meta.dir, "..", "..", "..", "data", "aquarium-settings.json");
let persisted: PersistedAquariumSettings = loadFromDisk();

function loadFromDisk(): PersistedAquariumSettings {
  if (!existsSync(SETTINGS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as PersistedAquariumSettings;
  } catch (error) {
    console.error("[Settings] Failed to load persisted settings:", error);
    return {};
  }
}

function saveToDisk(): void {
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  const tempPath = `${SETTINGS_PATH}.tmp`;
  writeFileSync(tempPath, JSON.stringify(persisted, null, 2));
  renameSync(tempPath, SETTINGS_PATH);
}

export function getPersistedSettings(): Readonly<PersistedAquariumSettings> {
  return persisted;
}

export function updatePersistedSettings(patch: Partial<PersistedAquariumSettings>): void {
  persisted = { ...persisted, ...patch };
  saveToDisk();
}

export function persistViewport(uuid: string, viewport: ClientConfig["viewport"]): void {
  const viewports = { ...(persisted.viewports ?? {}) };
  if (uuid.startsWith("display:")) {
    for (const savedUuid of Object.keys(viewports)) {
      if (savedUuid.startsWith(`${uuid}-`)) delete viewports[savedUuid];
    }
  }
  viewports[uuid] = viewport;
  persisted = {
    ...persisted,
    viewports,
  };
  saveToDisk();
}
