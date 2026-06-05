import type { ActiveFish, AppLayerConfig, DisplayClientInfo } from "@aquarium/shared";
import type {
    Camera,
    DragState,
    ForbiddenZone,
    PendingWorldSize,
    Point,
    ResizeHandleType,
    SnapGuides,
    SpawnPoint,
} from "../types";
import { getHandles, HANDLE_R } from "./handles";

const COLORS = ["#10b981"];

interface DrawViewportCanvasOptions {
    canvas: HTMLCanvasElement | null;
    camera: Camera;
    worldW: number;
    worldH: number;
    pendingWorldSize: PendingWorldSize | null;
    bgUrl: string;
    displays: DisplayClientInfo[];
    selected: string | null;
    hovered: string | null;
    selectedLocalId: string | null;
    dragState: DragState | null;
    dragFishId: string | null;
    snapGuides: SnapGuides;
    forbiddenZones: ForbiddenZone[];
    spawnPoints: SpawnPoint[];
    layers: AppLayerConfig[];
    activeLayerId?: string;
    activeFish: ActiveFish[];
    worldToCanvas: (wx: number, wy: number) => Point;
    loadFishImage: (url: string) => HTMLImageElement | null;
    loadLayerImage: (url: string) => HTMLImageElement;
}

export function drawViewportCanvas({
    canvas,
    camera: cam,
    worldW,
    worldH,
    pendingWorldSize,
    bgUrl,
    displays,
    selected,
    hovered,
    selectedLocalId,
    dragState,
    dragFishId,
    snapGuides,
    forbiddenZones,
    spawnPoints,
    layers,
    activeLayerId,
    activeFish,
    worldToCanvas,
    loadFishImage,
    loadLayerImage,
}: DrawViewportCanvasOptions): void {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const CW = canvas.width;
    const CH = canvas.height;

    ctx.clearRect(0, 0, CW, CH);

    // 背景チェッカーボード (Canvas領域全体の背景)
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, CW, CH);
    const CHECKER = 24;
    ctx.fillStyle = "rgba(0, 0, 0, 0.03)";
    for (let cx2 = 0; cx2 < CW; cx2 += CHECKER * 2) {
        for (let cy2 = 0; cy2 < CH; cy2 += CHECKER * 2) {
            ctx.fillRect(cx2, cy2, CHECKER, CHECKER);
            ctx.fillRect(cx2 + CHECKER, cy2 + CHECKER, CHECKER, CHECKER);
        }
    }

    // --- 1. ワールド背景（床）の描画 ---
    const wDraw = pendingWorldSize?.w ?? worldW;
    const hDraw = pendingWorldSize?.h ?? worldH;
    const tl = worldToCanvas(0, 0);
    const br = worldToCanvas(wDraw, hDraw);
    const ww = br.x - tl.x;
    const wh = br.y - tl.y;

    ctx.shadowColor = "rgba(0, 0, 0, 0.05)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tl.x, tl.y, ww, wh);
    if (bgUrl) {
        const background = loadFishImage(bgUrl);
        if (background?.naturalWidth) {
            ctx.globalAlpha = 0.72;
            ctx.drawImage(background, tl.x, tl.y, ww, wh);
            ctx.globalAlpha = 1;
        }
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 2;
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, ww - 1, wh - 1);

    // キャンバスリサイズ用のハンドル（World Size）
    ctx.fillStyle = "#f59e0b";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    const R = 8;
    ctx.beginPath();
    ctx.arc(br.x, br.y, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // グリッド
    const GRID = 100;
    const MAJ = 500;
    const wx0 = Math.floor(-cam.panX / cam.zoom / GRID) * GRID;
    const wy0 = Math.floor(-cam.panY / cam.zoom / GRID) * GRID;
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.04)";
    for (let x = wx0; x < wx0 + CW / cam.zoom + GRID * 2; x += GRID) {
        if (x < 0 || x > wDraw) continue;
        const px = worldToCanvas(x, 0).x;
        ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
    }
    for (let y = wy0; y < wy0 + CH / cam.zoom + GRID * 2; y += GRID) {
        if (y < 0 || y > hDraw) continue;
        const py = worldToCanvas(0, y).y;
        ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    for (let x = 0; x <= wDraw; x += MAJ) {
        const px = worldToCanvas(x, 0).x;
        ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
    }
    for (let y = 0; y <= hDraw; y += MAJ) {
        const py = worldToCanvas(0, y).y;
        ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
    }

    // ルーラー
    const RULER = 20;
    ctx.fillStyle = "rgba(241, 245, 249, 0.9)";
    ctx.fillRect(0, 0, CW, RULER);
    ctx.fillRect(0, 0, RULER, CH);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, RULER); ctx.lineTo(CW, RULER); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(RULER, 0); ctx.lineTo(RULER, CH); ctx.stroke();

    ctx.fillStyle = "#64748b";
    ctx.font = `${Math.max(8, 7 * cam.zoom)}px monospace`;
    ctx.textBaseline = "top";
    for (let x = 0; x <= wDraw; x += MAJ) {
        const px = worldToCanvas(x, 0).x;
        if (px < RULER || px > CW) continue;
        ctx.fillText(String(x), px + 2, 3);
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, RULER - 4); ctx.lineTo(px, RULER); ctx.stroke();
    }
    for (let y = 0; y <= hDraw; y += MAJ) {
        const py = worldToCanvas(0, y).y;
        if (py < RULER || py > CH) continue;
        ctx.save();
        ctx.translate(3, py + 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(y), 0, 0);
        ctx.restore();
        ctx.strokeStyle = "#94a3b8";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(RULER - 4, py); ctx.lineTo(RULER, py); ctx.stroke();
    }

    // --- 2. 描画オブジェクトのリスト化とZ-Index昇順（奥から手前）ソート ---
    const drawObjects: { type: string; zIndex: number; layerId?: string; idx?: number; data: any }[] = [];
    forbiddenZones.forEach(z => drawObjects.push({ type: "system_fz", zIndex: 3100, data: z }));
    spawnPoints.forEach(sp => drawObjects.push({ type: "system_sp", zIndex: 3200, data: sp }));

    const frameFish = (window as any).__lastFrame;
    const fishTextureMap = new Map<string, string>();
    for (const fish of activeFish) {
        fishTextureMap.set(fish.id, fish.textureUrl);
        fishTextureMap.set(fish.id.slice(0, 8), fish.textureUrl);
    }

    layers.forEach(layer => {
        if (layer.type === "image" && layer.url) {
            drawObjects.push({ type: "image", zIndex: layer.zIndex, layerId: layer.id, data: layer });
        } else if (layer.type === "fish" && frameFish?.f) {
            frameFish.f.forEach((fish: any) => {
                if (fish.z === layer.zIndex) {
                    drawObjects.push({ type: "fish", zIndex: layer.zIndex, layerId: layer.id, data: fish });
                }
            });
        }
    });

    displays.forEach((display, index) => {
        if (display.viewport) drawObjects.push({ type: "display", zIndex: 3000, idx: index, data: display });
    });
    drawObjects.sort((a, b) => a.zIndex - b.zIndex);

    // --- 3. ソート順に従い描画 ---
    for (const obj of drawObjects) {
        const zIndexGroup = Math.floor(obj.zIndex / 10);

        if (obj.type === "image") {
            const layer = obj.data;
            const img = loadLayerImage(layer.url);
            if (img.complete && img.naturalWidth > 0) {
                ctx.save();
                const imgX = layer.x ?? 0;
                const imgY = layer.y ?? 0;
                const imgW = layer.width ?? wDraw;
                const imgH = layer.height ?? hDraw;
                const p1 = worldToCanvas(imgX, imgY);
                const p2 = worldToCanvas(imgX + imgW, imgY + imgH);
                const iww = p2.x - p1.x;
                const iwh = p2.y - p1.y;

                ctx.globalAlpha = layer.opacity ?? 0.5;
                ctx.drawImage(img, p1.x, p1.y, iww, iwh);

                const isGroupActive = !activeLayerId || activeLayerId === layer.id;
                const isSel = isGroupActive && (dragState?.uuid === layer.id || selectedLocalId === layer.id);
                if (isSel) {
                    ctx.strokeStyle = "#a855f7";
                    ctx.lineWidth = 2;
                    ctx.strokeRect(p1.x, p1.y, iww, iwh);
                    ctx.lineWidth = 1.5;
                    const pts = getHandles({ x: imgX, y: imgY, width: imgW, height: imgH });
                    (["tl", "t", "tr", "r", "br", "b", "bl", "l"] as const).forEach(handle => {
                        const cp = worldToCanvas(pts[handle].x, pts[handle].y);
                        ctx.beginPath(); ctx.arc(cp.x, cp.y, HANDLE_R, 0, Math.PI * 2);
                        ctx.fill(); ctx.stroke();
                    });
                }
                ctx.restore();
            }
        } else if (obj.type === "fish") {
            const fish = obj.data;
            const pt = worldToCanvas(fish.x, fish.y);
            const layerColors = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4"];
            const colorIdx = (zIndexGroup + layerColors.length) % layerColors.length;
            const isDragging = dragFishId === fish.i;
            const textureUrl = fish.u ?? fishTextureMap.get(fish.i);
            const previewScale = Math.sqrt(Math.max(0.1, fish.s ?? 1));
            const sz = Math.max(8, Math.min(34, 16 * previewScale) * cam.zoom);

            if (textureUrl) {
                const img = loadFishImage(textureUrl);
                if (img && img.width > 0) {
                    ctx.save();
                    ctx.translate(pt.x, pt.y);
                    if (fish.d === -1) ctx.scale(-1, 1);
                    ctx.drawImage(img, -sz / 2, -sz / 2, sz, sz);
                    if (isDragging) {
                        ctx.strokeStyle = "#f59e0b";
                        ctx.lineWidth = 3 / cam.zoom;
                        ctx.beginPath(); ctx.arc(0, 0, sz / 2 + 4, 0, Math.PI * 2); ctx.stroke();
                    }
                    ctx.restore();
                } else {
                    ctx.fillStyle = layerColors[colorIdx] + "88";
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, Math.max(4, 20 * cam.zoom), 0, Math.PI * 2);
                    ctx.fill();
                }
            } else {
                ctx.fillStyle = isDragging ? "#f59e0b" : layerColors[colorIdx];
                ctx.beginPath();
                ctx.arc(pt.x, pt.y, Math.max(4, 18 * cam.zoom), 0, Math.PI * 2);
                ctx.fill();

                ctx.font = "8px monospace";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillStyle = "#fff";
                ctx.fillText(fish.i?.slice(0, 6) ?? "", pt.x + 10, pt.y);
            }
        } else if (obj.type === "display") {
            const display = obj.data;
            const index = obj.idx ?? 0;
            const viewport = display.viewport;
            if (!viewport) continue;
            const p = worldToCanvas(viewport.x, viewport.y);
            const p2 = worldToCanvas(viewport.x + viewport.width, viewport.y + viewport.height);
            const dw = p2.x - p.x;
            const dh = p2.y - p.y;
            const color = COLORS[index % COLORS.length];
            const isSel = display.uuid === selected;
            const isHov = display.uuid === hovered && !isSel;

            if (isSel) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 18;
            } else if (isHov) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
            }
            ctx.fillStyle = isSel ? color + "40" : isHov ? color + "28" : color + "18";
            ctx.fillRect(p.x, p.y, dw, dh);
            ctx.shadowBlur = 0;

            ctx.strokeStyle = isSel ? color : isHov ? color : color + "dd";
            ctx.lineWidth = isSel ? 3 : 2;
            ctx.strokeRect(p.x, p.y, dw, dh);

            const displayNumber = String(index + 1);
            ctx.fillStyle = isSel ? "#0f172a" : "#334155";
            ctx.font = `900 ${Math.max(24, Math.min(dw, dh) * 0.46)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(displayNumber, p.x + dw / 2, p.y + dh / 2);

            const whText = `${Math.round(viewport.width)}×${Math.round(viewport.height)}`;
            ctx.font = `${Math.max(9, 10 * cam.zoom)}px monospace`;
            ctx.textAlign = "left";
            ctx.textBaseline = "bottom";
            ctx.fillText(whText, p.x + 4, p.y + dh - 18 * cam.zoom);
            ctx.fillText(display.uuid.split(":")[1] || display.uuid, p.x + 4, p.y + dh - 4);

            if (isSel) {
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = color;
                ctx.lineWidth = 1.5;
                const pts = getHandles(viewport);
                (["tl", "t", "tr", "r", "br", "b", "bl", "l"] as ResizeHandleType[]).forEach(handle => {
                    const cp = worldToCanvas(pts[handle].x, pts[handle].y);
                    ctx.beginPath(); ctx.arc(cp.x, cp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                });
            }
        } else if (obj.type === "system_fz") {
            const zone = obj.data;
            const p = worldToCanvas(zone.x, zone.y);
            const p2 = worldToCanvas(zone.x + zone.width, zone.y + zone.height);
            const dw = p2.x - p.x;
            const dh = p2.y - p.y;
            const isSel = dragState?.uuid === zone.id || selectedLocalId === zone.id;

            ctx.fillStyle = "rgba(220, 38, 38, 0.15)";
            ctx.fillRect(p.x, p.y, dw, dh);
            ctx.strokeStyle = "rgba(220, 38, 38, 0.8)";
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeRect(p.x, p.y, dw, dh);
            ctx.fillStyle = "rgba(153, 27, 27, 0.8)";
            ctx.font = `bold ${Math.max(10, 12 * cam.zoom)}px sans-serif`;
            ctx.textBaseline = "bottom";
            ctx.fillText("FORBIDDEN", p.x + 4, p.y + dh - 4);

            if (isSel) {
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = "rgba(220, 38, 38, 1)";
                ctx.lineWidth = 1.5;
                const pts = getHandles(zone);
                (["tl", "t", "tr", "r", "br", "b", "bl", "l"] as ResizeHandleType[]).forEach(handle => {
                    const cp = worldToCanvas(pts[handle].x, pts[handle].y);
                    ctx.beginPath(); ctx.arc(cp.x, cp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                });
            }
        } else if (obj.type === "system_sp") {
            const spawnPoint = obj.data;
            const p = worldToCanvas(spawnPoint.x, spawnPoint.y);
            const isSel = dragState?.uuid === spawnPoint.id || selectedLocalId === spawnPoint.id;
            ctx.strokeStyle = isSel ? "#0369a1" : "#0ea5e9";
            ctx.lineWidth = isSel ? 4 : 3;
            ctx.beginPath();
            ctx.arc(p.x, p.y, HANDLE_R * 2.7, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(p.x - HANDLE_R * 3.5, p.y); ctx.lineTo(p.x + HANDLE_R * 3.5, p.y);
            ctx.moveTo(p.x, p.y - HANDLE_R * 3.5); ctx.lineTo(p.x, p.y + HANDLE_R * 3.5);
            ctx.stroke();
            ctx.fillStyle = isSel ? "#0284c7" : "#38bdf8";
            ctx.beginPath();
            ctx.arc(p.x, p.y, HANDLE_R * 1.5, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#fff";
            ctx.font = `bold ${Math.max(10, 14 * cam.zoom)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("✨", p.x, p.y);
            ctx.fillStyle = "#0369a1";
            ctx.font = `bold ${Math.max(10, 11 * cam.zoom)}px sans-serif`;
            ctx.fillText("放流ポイント", p.x + HANDLE_R * 2, p.y);
            ctx.textAlign = "left";
        }
    }

    // --- 4. スナップライン等のUI補助 ---
    if (snapGuides.x !== undefined || snapGuides.y !== undefined) {
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#f39c12";
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (snapGuides.x !== undefined) {
            const cx = worldToCanvas(snapGuides.x, 0).x;
            ctx.moveTo(cx, 0); ctx.lineTo(cx, CH);
        }
        if (snapGuides.y !== undefined) {
            const cy = worldToCanvas(0, snapGuides.y).y;
            ctx.moveTo(0, cy); ctx.lineTo(CW, cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
}
