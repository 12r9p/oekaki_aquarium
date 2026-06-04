import type { Point, Rect, ResizeHandleType } from "../types";

export const HANDLE_R = 6;

export function getHandles(rect: Rect): Record<ResizeHandleType | "move", Point> {
    const { x, y, width: w, height: h } = rect;
    return {
        move: { x: x + w / 2, y: y + h / 2 },
        tl: { x, y },
        t: { x: x + w / 2, y },
        tr: { x: x + w, y },
        r: { x: x + w, y: y + h / 2 },
        br: { x: x + w, y: y + h },
        b: { x: x + w / 2, y: y + h },
        bl: { x, y: y + h },
        l: { x, y: y + h / 2 },
    };
}
