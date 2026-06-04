import type React from "react";
import type { ActiveFish, AppLayerConfig, DisplayClientInfo } from "@aquarium/shared";

export interface ForbiddenZone {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface SpawnPoint {
    id: string;
    x: number;
    y: number;
}

export interface ViewportCanvasProps {
    worldW: number;
    worldH: number;
    bgUrl: string;
    displaysSt: DisplayClientInfo[];
    displaysRef: React.MutableRefObject<DisplayClientInfo[]>;
    pendingViewports: React.MutableRefObject<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>;
    selected: string | null;
    setSelected: (id: string | null) => void;
    hoveredRef: React.MutableRefObject<string | null>;
    setHoveredUI: (id: string | null) => void;
    undoStackRef: React.MutableRefObject<any[]>;
    redoStackRef: React.MutableRefObject<any[]>;
    snapshotViewports: () => any[];
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
    arLocked: boolean;
    sendRateSetting: number;
    setWorldSize: (w: number, h: number) => void;
    forbiddenZones: ForbiddenZone[];
    onUpdateForbiddenZones: (zones: ForbiddenZone[]) => void;
    spawnPoints: SpawnPoint[];
    onUpdateSpawnPoints: (points: SpawnPoint[]) => void;
    layers: AppLayerConfig[];
    onUpdateLayers?: (layers: AppLayerConfig[]) => void;
    activeLayerId?: string;
    /** 管理画面に表示するアクティブな魚一覧 */
    activeFish: ActiveFish[];
    /** 魚をドラッグした際に呼び出すコールバック */
    onMoveFish?: (fishId: string, x: number, y: number) => void;
}

export type ResizeHandleType = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";
export type HandleType = ResizeHandleType | "move" | "world_br" | `fz_${string}` | `sp_${string}` | `ImgLayer_${string}`;

export interface Camera {
    panX: number;
    panY: number;
    zoom: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DragState {
    handle: HandleType;
    uuid: string;
    startMouseX: number;
    startMouseY: number;
    startRect: Rect & { scale?: number };
}

export interface Point {
    x: number;
    y: number;
}

export interface CanvasSize {
    w: number;
    h: number;
}

export interface SnapGuides {
    x?: number;
    y?: number;
}

export interface PendingWorldSize {
    w: number;
    h: number;
}
