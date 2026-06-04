import { useCallback, useRef } from "react";
import type { Camera } from "./types";

export function useCanvasCamera() {
    const cameraRef = useRef<Camera>({ panX: 0, panY: 0, zoom: 1 });

    const worldToCanvas = useCallback((wx: number, wy: number) => {
        const { panX, panY, zoom } = cameraRef.current;
        return { x: wx * zoom + panX, y: wy * zoom + panY };
    }, []);

    const canvasToWorld = useCallback((cx: number, cy: number) => {
        const { panX, panY, zoom } = cameraRef.current;
        return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
    }, []);

    return { cameraRef, worldToCanvas, canvasToWorld };
}
