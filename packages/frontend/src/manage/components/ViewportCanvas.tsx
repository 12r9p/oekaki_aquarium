import React, { useRef, useEffect, useCallback, useState } from "react";
import type { DisplayClientInfo } from "@aquarium/shared";
import { ws } from "../main";

interface ViewportCanvasProps {
    worldW: number;
    worldH: number;
    displaysSt: DisplayClientInfo[];
    displaysRef: React.MutableRefObject<DisplayClientInfo[]>;
    pendingViewports: React.MutableRefObject<Map<string, NonNullable<DisplayClientInfo["viewport"]>>>;
    selected: string | null;
    setSelected: (id: string | null) => void;
    hoveredRef: React.MutableRefObject<string | null>;
    setHoveredUI: (id: string | null) => void;
    undoStackRef: React.MutableRefObject<any[]>; // 複雑なのでanyで
    redoStackRef: React.MutableRefObject<any[]>;
    snapshotViewports: () => any[];
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
    arLocked: boolean;
    sendRateSetting: number;
}

// ハンドルの種類（8点＋ボディ移動）
type HandleType = "move" | "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";
interface Camera { panX: number; panY: number; zoom: number; }
interface DragState {
    handle: HandleType;
    uuid: string;
    startMouseX: number; startMouseY: number;
    startVp: { x: number; y: number; width: number; height: number; scale: number };
}

const HANDLE_R = 6;
const COLORS = ["#4ecdc4", "#ff6b6b", "#f7dc6f", "#82e0aa", "#bb8fce", "#f0b27a"];

function getHandles(vp: NonNullable<DisplayClientInfo["viewport"]>): Record<HandleType, { x: number; y: number }> {
    const { x, y, width: w, height: h } = vp;
    return {
        move: { x: x + w / 2, y: y + h / 2 },
        tl: { x, y }, t: { x: x + w / 2, y }, tr: { x: x + w, y },
        r: { x: x + w, y: y + h / 2 }, br: { x: x + w, y: y + h },
        b: { x: x + w / 2, y: y + h }, bl: { x, y: y + h },
        l: { x, y: y + h / 2 },
    };
}

export function ViewportCanvas({
    worldW, worldH, displaysSt, displaysRef, pendingViewports,
    selected, setSelected, hoveredRef, setHoveredUI,
    undoStackRef, redoStackRef, snapshotViewports, onSaveViewport,
    arLocked, sendRateSetting
}: ViewportCanvasProps): React.ReactElement {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const camRef = useRef<Camera>({ panX: 0, panY: 0, zoom: 1 });
    const rafRef = useRef<number | null>(null);
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
    const spaceRef = useRef(false);
    const drawRef = useRef<() => void>(() => void 0);

    const previewThrottleRef = useRef<number>(0);
    const pointerThrottleRef = useRef<number>(0);
    const snapGuides = useRef<{ x?: number; y?: number }>({});

    const canvasSize = useCallback(() => {
        const c = canvasRef.current;
        return c ? { w: c.width, h: c.height } : { w: 780, h: 280 };
    }, []);
    const worldToCanvas = useCallback((wx: number, wy: number) => {
        const { panX, panY, zoom } = camRef.current;
        return { x: wx * zoom + panX, y: wy * zoom + panY };
    }, []);
    const canvasToWorld = useCallback((cx: number, cy: number) => {
        const { panX, panY, zoom } = camRef.current;
        return { x: (cx - panX) / zoom, y: (cy - panY) / zoom };
    }, []);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const { w: CW, h: CH } = canvasSize();
        const cam = camRef.current;

        ctx.clearRect(0, 0, CW, CH);

        // 背景チェッカーボード
        ctx.fillStyle = "#080c14";
        ctx.fillRect(0, 0, CW, CH);
        const CHECKER = 24;
        ctx.fillStyle = "rgba(255,255,255,0.015)";
        for (let cx2 = 0; cx2 < CW; cx2 += CHECKER * 2) {
            for (let cy2 = 0; cy2 < CH; cy2 += CHECKER * 2) {
                ctx.fillRect(cx2, cy2, CHECKER, CHECKER);
                ctx.fillRect(cx2 + CHECKER, cy2 + CHECKER, CHECKER, CHECKER);
            }
        }

        // ワールド矩形
        const tl = worldToCanvas(0, 0);
        const br = worldToCanvas(worldW, worldH);
        const ww = br.x - tl.x, wh = br.y - tl.y;
        ctx.shadowColor = "rgba(100,150,255,0.15)";
        ctx.shadowBlur = 20;
        ctx.fillStyle = "#0b1020";
        ctx.fillRect(tl.x, tl.y, ww, wh);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(80,120,220,0.4)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, ww - 1, wh - 1);

        // グリッド
        const GRID = 100, MAJ = 500;
        const wx0 = Math.floor(-cam.panX / cam.zoom / GRID) * GRID;
        const wy0 = Math.floor(-cam.panY / cam.zoom / GRID) * GRID;

        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        for (let x = wx0; x < wx0 + CW / cam.zoom + GRID * 2; x += GRID) {
            if (x < 0 || x > worldW) continue;
            const px = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
        }
        for (let y = wy0; y < wy0 + CH / cam.zoom + GRID * 2; y += GRID) {
            if (y < 0 || y > worldH) continue;
            const py = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
        }
        // メジャーグリッド
        ctx.lineWidth = 0.5;
        ctx.strokeStyle = "rgba(80,120,200,0.12)";
        for (let x = 0; x <= worldW; x += MAJ) {
            const px = worldToCanvas(x, 0).x;
            ctx.beginPath(); ctx.moveTo(px, tl.y); ctx.lineTo(px, br.y); ctx.stroke();
        }
        for (let y = 0; y <= worldH; y += MAJ) {
            const py = worldToCanvas(0, y).y;
            ctx.beginPath(); ctx.moveTo(tl.x, py); ctx.lineTo(br.x, py); ctx.stroke();
        }

        // ルーラー
        const RULER = 20;
        ctx.fillStyle = "rgba(10,16,30,0.85)";
        ctx.fillRect(0, 0, CW, RULER);
        ctx.fillRect(0, 0, RULER, CH);
        ctx.strokeStyle = "rgba(100,150,255,0.25)";
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.moveTo(0, RULER); ctx.lineTo(CW, RULER); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(RULER, 0); ctx.lineTo(RULER, CH); ctx.stroke();

        ctx.fillStyle = "rgba(200,220,255,0.5)";
        ctx.font = `${Math.max(8, 7 * cam.zoom)}px monospace`;
        ctx.textBaseline = "top";
        for (let x = 0; x <= worldW; x += MAJ) {
            const px = worldToCanvas(x, 0).x;
            if (px < RULER || px > CW) continue;
            ctx.fillText(String(x), px + 2, 3);
            ctx.strokeStyle = "rgba(100,150,255,0.3)";
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(px, RULER - 4); ctx.lineTo(px, RULER); ctx.stroke();
        }
        for (let y = 0; y <= worldH; y += MAJ) {
            const py = worldToCanvas(0, y).y;
            if (py < RULER || py > CH) continue;
            ctx.save();
            ctx.translate(3, py + 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(y), 0, 0);
            ctx.restore();
            ctx.strokeStyle = "rgba(100,150,255,0.3)";
            ctx.lineWidth = 0.5;
            ctx.beginPath(); ctx.moveTo(RULER - 4, py); ctx.lineTo(RULER, py); ctx.stroke();
        }

        // ディスプレイ描画
        displaysRef.current.forEach((d, i) => {
            const vp = d.viewport;
            if (!vp) return;
            const p = worldToCanvas(vp.x, vp.y);
            const p2 = worldToCanvas(vp.x + vp.width, vp.y + vp.height);
            const dw = p2.x - p.x, dh = p2.y - p.y;
            const col = COLORS[i % COLORS.length];
            const isSel = d.uuid === selected;
            const isHov = d.uuid === hoveredRef.current && !isSel;

            // ドロップシャドウ
            if (isSel) {
                ctx.shadowColor = col;
                ctx.shadowBlur = 18;
            } else if (isHov) {
                ctx.shadowColor = col;
                ctx.shadowBlur = 8;
            }

            ctx.fillStyle = isSel ? col + "40" : isHov ? col + "28" : col + "14";
            ctx.fillRect(p.x, p.y, dw, dh);
            ctx.shadowBlur = 0;

            ctx.strokeStyle = isSel ? col : isHov ? col + "aa" : col + "66";
            ctx.lineWidth = isSel ? 2 : 1.5;
            ctx.strokeRect(p.x, p.y, dw, dh);

            ctx.fillStyle = isSel ? col : col + "aa";
            ctx.font = `bold ${Math.max(10, 12 * cam.zoom)}px sans-serif`;
            ctx.textBaseline = "bottom";
            ctx.fillText(`ID: ${d.uuid.split(":")[1] || d.uuid}`, p.x + 4, p.y + dh - 4);

            const whText = `${Math.round(vp.width)}×${Math.round(vp.height)}`;
            ctx.font = `${Math.max(9, 10 * cam.zoom)}px monospace`;
            ctx.fillText(whText, p.x + 4, p.y + dh - 18 * cam.zoom);

            if (isSel) {
                ctx.fillStyle = "#fff";
                ctx.strokeStyle = col;
                ctx.lineWidth = 1.5;
                const pts = getHandles(vp);
                (["tl", "t", "tr", "r", "br", "b", "bl", "l"] as HandleType[]).forEach((ht) => {
                    const cp = worldToCanvas(pts[ht].x, pts[ht].y);
                    ctx.beginPath(); ctx.arc(cp.x, cp.y, HANDLE_R, 0, Math.PI * 2);
                    ctx.fill(); ctx.stroke();
                });
            }
        });

        // スナップライン描画
        const sg = snapGuides.current;
        if (sg.x !== undefined || sg.y !== undefined) {
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = "#f39c12"; // オレンジ色
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (sg.x !== undefined) {
                const cx = worldToCanvas(sg.x, 0).x;
                ctx.moveTo(cx, 0); ctx.lineTo(cx, CH);
            }
            if (sg.y !== undefined) {
                const cy = worldToCanvas(0, sg.y).y;
                ctx.moveTo(0, cy); ctx.lineTo(CW, cy);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [selected, worldW, worldH, canvasSize, worldToCanvas]);

    drawRef.current = draw;

    // 初期カメラ計算
    useEffect(() => {
        if (!canvasRef.current || !wrapperRef.current) return;
        const cw = wrapperRef.current.clientWidth;
        const ch = wrapperRef.current.clientHeight;
        canvasRef.current.width = cw;
        canvasRef.current.height = ch;

        // Fit to World
        camRef.current.zoom = Math.min((cw - 100) / worldW, (ch - 100) / worldH);
        camRef.current.panX = (cw - worldW * camRef.current.zoom) / 2;
        camRef.current.panY = (ch - worldH * camRef.current.zoom) / 2;
        draw();

        const ro = new ResizeObserver((entries) => {
            for (const ent of entries) {
                canvasRef.current!.width = ent.contentRect.width;
                canvasRef.current!.height = ent.contentRect.height;
                draw();
            }
        });
        ro.observe(wrapperRef.current);
        return () => ro.disconnect();
    }, [worldW, worldH, draw]);

    // Request Animation Frame描画トリガー (displaysの更新時など)
    useEffect(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [displaysSt, draw]);

    // マウスイベント処理
    const getCanvasPt = useCallback((evtX: number, evtY: number) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return { mx: evtX - rect.left, my: evtY - rect.top };
    }, []);

    const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        if (e.button === 1 || spaceRef.current || e.button === 2) {
            isPanningRef.current = true;
            const { mx, my } = getCanvasPt(e.clientX, e.clientY);
            panStartRef.current = { mx, my, px: camRef.current.panX, py: camRef.current.panY };
            canvasRef.current!.style.cursor = "grabbing";
            return;
        }
        if (e.button !== 0) return;

        const { mx, my } = getCanvasPt(e.clientX, e.clientY);
        const wPt = canvasToWorld(mx, my);

        if (selected) {
            const t = displaysRef.current.find(d => d.uuid === selected);
            if (t && t.viewport) {
                const pts = getHandles(t.viewport);
                const z = camRef.current.zoom;
                const RW = HANDLE_R / z + 2;
                let hitHandle: HandleType | null = null;

                for (const [k, v] of Object.entries(pts)) {
                    if (k === "move") continue;
                    if (Math.abs(wPt.x - v.x) <= RW && Math.abs(wPt.y - v.y) <= RW) { hitHandle = k as HandleType; break; }
                }
                if (!hitHandle) {
                    const vp = t.viewport;
                    if (wPt.x >= vp.x && wPt.x <= vp.x + vp.width && wPt.y >= vp.y && wPt.y <= vp.y + vp.height) { hitHandle = "move"; }
                }

                if (hitHandle) {
                    undoStackRef.current.push(snapshotViewports());
                    redoStackRef.current.length = 0;
                    dragRef.current = {
                        handle: hitHandle, uuid: selected, startMouseX: mx, startMouseY: my,
                        startVp: { ...t.viewport }
                    };
                    return;
                }
            }
        }

        let hitBody: string | null = null;
        for (const d of displaysRef.current) {
            const vp = d.viewport;
            if (!vp) continue;
            if (wPt.x >= vp.x && wPt.x <= vp.x + vp.width && wPt.y >= vp.y && wPt.y <= vp.y + vp.height) {
                hitBody = d.uuid;
                break; // 手前優先なら逆順で探すべきだけど、現状は単配列ループ
            }
        }

        if (hitBody !== selected) setSelected(hitBody);

        if (hitBody) {
            const t = displaysRef.current.find(d => d.uuid === hitBody)!;
            undoStackRef.current.push(snapshotViewports());
            redoStackRef.current.length = 0;
            dragRef.current = {
                handle: "move", uuid: hitBody, startMouseX: mx, startMouseY: my,
                startVp: { ...t.viewport! }
            };
        } else {
            setSelected(null);
        }
    }, [selected, displaysRef, getCanvasPt, canvasToWorld, snapshotViewports, setSelected, undoStackRef, redoStackRef]);

    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const { mx, my } = getCanvasPt(e.clientX, e.clientY);

        // パン
        if (isPanningRef.current) {
            const dx = mx - panStartRef.current.mx;
            const dy = my - panStartRef.current.my;
            camRef.current.panX = panStartRef.current.px + dx;
            camRef.current.panY = panStartRef.current.py + dy;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        // ドラッグ中ではない（ホバー・レーザーポインター送信）
        if (!dragRef.current) {
            const wp2 = canvasToWorld(mx, my);
            let hitH: string | null = null;
            for (const d of displaysRef.current) {
                const vp = d.viewport;
                if (!vp) continue;
                if (wp2.x >= vp.x && wp2.x <= vp.x + vp.width && wp2.y >= vp.y && wp2.y <= vp.y + vp.height) { hitH = d.uuid; break; }
            }
            if (hitH !== hoveredRef.current) { hoveredRef.current = hitH; setHoveredUI(hitH); if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = requestAnimationFrame(draw); }

            const now = Date.now();
            if (now - pointerThrottleRef.current > sendRateSetting) {
                pointerThrottleRef.current = now;
                ws.send({ event: "pointer_move", x: wp2.x, y: wp2.y });
            }
            return;
        }

        // --- ここからフレームドラッグ・リサイズ ---
        const drag = dragRef.current;
        const z = camRef.current.zoom;
        const dx = (mx - drag.startMouseX) / z;
        const dy = (my - drag.startMouseY) / z;
        const dObj = displaysRef.current.find(d => d.uuid === drag.uuid);
        if (!dObj || !dObj.viewport) return;
        const vp = dObj.viewport;

        // ... （ドラッグロジック: startVp をもとに dx/dy を加算・減算する処理）...
        // 今回は既存のコードそのまま移植
        let nx = drag.startVp.x, ny = drag.startVp.y, nw = drag.startVp.width, nh = drag.startVp.height;

        if (drag.handle === "move") {
            nx += dx; ny += dy;
        } else {
            if (drag.handle.includes("l")) { nx += dx; nw -= dx; }
            if (drag.handle.includes("r")) { nw += dx; }
            if (drag.handle.includes("t")) { ny += dy; nh -= dy; }
            if (drag.handle.includes("b")) { nh += dy; }
            if (arLocked) {
                const AR = drag.startVp.width / drag.startVp.height;
                if (drag.handle.includes("r") || drag.handle.includes("l")) nh = nw / AR;
                else if (drag.handle.includes("t") || drag.handle.includes("b")) nw = nh * AR;
            }
        }
        if (nw < 100) { if (drag.handle.includes("l")) nx -= (100 - nw); nw = 100; }
        if (nh < 100) { if (drag.handle.includes("t")) ny -= (100 - nh); nh = 100; }

        // スナップロジック
        const SNAP = 8 / z;
        const vPts = { l: nx, r: nx + nw, cX: nx + nw / 2, t: ny, b: ny + nh, cY: ny + nh / 2 };
        let snapObjX: number | undefined, snapObjY: number | undefined;

        for (const other of displaysRef.current) {
            if (other.uuid === drag.uuid || !other.viewport) continue;
            const ovp = other.viewport;
            const oPts = { l: ovp.x, r: ovp.x + ovp.width, cX: ovp.x + ovp.width / 2, t: ovp.y, b: ovp.y + ovp.height, cY: ovp.y + ovp.height / 2 };

            if (!snapObjX) {
                if (Math.abs(vPts.l - oPts.r) < SNAP) { nx = oPts.r; snapObjX = oPts.r; }
                else if (Math.abs(vPts.r - oPts.l) < SNAP) { snapObjX = oPts.l; if (drag.handle === "move") nx = oPts.l - nw; else nw = oPts.l - nx; }
                else if (Math.abs(vPts.l - oPts.l) < SNAP) { nx = oPts.l; snapObjX = oPts.l; }
                else if (Math.abs(vPts.r - oPts.r) < SNAP) { snapObjX = oPts.r; if (drag.handle === "move") nx = oPts.r - nw; else nw = oPts.r - nx; }
                else if (Math.abs(vPts.cX - oPts.cX) < SNAP) { snapObjX = oPts.cX; if (drag.handle === "move") nx = oPts.cX - nw / 2; }
            }
            if (!snapObjY) {
                if (Math.abs(vPts.t - oPts.b) < SNAP) { ny = oPts.b; snapObjY = oPts.b; }
                else if (Math.abs(vPts.b - oPts.t) < SNAP) { snapObjY = oPts.t; if (drag.handle === "move") ny = oPts.t - nh; else nh = oPts.t - ny; }
                else if (Math.abs(vPts.t - oPts.t) < SNAP) { ny = oPts.t; snapObjY = oPts.t; }
                else if (Math.abs(vPts.b - oPts.b) < SNAP) { snapObjY = oPts.b; if (drag.handle === "move") ny = oPts.b - nh; else nh = oPts.b - ny; }
                else if (Math.abs(vPts.cY - oPts.cY) < SNAP) { snapObjY = oPts.cY; if (drag.handle === "move") ny = oPts.cY - nh / 2; }
            }
        }
        // World境界スナップ
        if (!snapObjX) {
            if (Math.abs(nx) < SNAP) { nx = 0; snapObjX = 0; }
            if (Math.abs(nx + nw - worldW) < SNAP) { snapObjX = worldW; if (drag.handle === "move") nx = worldW - nw; else nw = worldW - nx; }
        }
        if (!snapObjY) {
            if (Math.abs(ny) < SNAP) { ny = 0; snapObjY = 0; }
            if (Math.abs(ny + nh - worldH) < SNAP) { snapObjY = worldH; if (drag.handle === "move") ny = worldH - nh; else nh = worldH - ny; }
        }
        snapGuides.current = { x: snapObjX, y: snapObjY };

        vp.x = nx; vp.y = ny; vp.width = nw; vp.height = nh;

        // Scaleの再計算（横幅から逆算・表示機器の情報は変わらない前提）
        vp.scale = nx / drag.startVp.width * drag.startVp.scale; // 適当な再計算ではなく、元のARから。ここは元通り
        vp.scale = vp.width / (drag.startVp.width / drag.startVp.scale);

        // リストへの差分適用
        pendingViewports.current.set(drag.uuid, { ...vp });

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);

        const now = Date.now();
        if (now - previewThrottleRef.current > sendRateSetting) {
            previewThrottleRef.current = now;
            ws.send({ event: "viewport_preview", displayUuid: drag.uuid, viewport: vp });
        }
    }, [getCanvasPt, canvasToWorld, displaysRef, worldW, worldH, arLocked, sendRateSetting, draw]);

    const handleMouseUp = useCallback(() => {
        isPanningRef.current = false;
        canvasRef.current!.style.cursor = "default";
        snapGuides.current = {};

        if (dragRef.current) {
            const dObj = displaysRef.current.find(d => d.uuid === dragRef.current!.uuid);
            if (dObj && dObj.viewport) {
                onSaveViewport(dObj.uuid, dObj.viewport).then(() => {
                    pendingViewports.current.delete(dObj.uuid);
                });
            }
            dragRef.current = null;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        }
    }, [displaysRef, onSaveViewport, draw]);

    const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { // ピンチ・ズーム
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            const rect = canvasRef.current!.getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const wPtStr = canvasToWorld(mx, my);
            camRef.current.zoom *= zoomDelta;
            camRef.current.panX = mx - wPtStr.x * camRef.current.zoom;
            camRef.current.panY = my - wPtStr.y * camRef.current.zoom;
        } else { // パン
            camRef.current.panX -= e.deltaX;
            camRef.current.panY -= e.deltaY;
        }
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [canvasToWorld, draw]);

    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.code === "Space") { spaceRef.current = true; if (canvasRef.current) canvasRef.current.style.cursor = "grab"; e.preventDefault(); }
    }, []);
    const handleKeyUp = useCallback((e: KeyboardEvent) => {
        if (e.code === "Space") { spaceRef.current = false; if (canvasRef.current && !isPanningRef.current) canvasRef.current.style.cursor = "default"; }
    }, []);

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
    }, [handleKeyDown, handleKeyUp]);

    return (
        <div className="manage-canvas-wrapper" ref={wrapperRef} onWheel={handleWheel}>
            <canvas
                ref={canvasRef}
                onPointerDown={handleMouseDown}
                onPointerMove={handleMouseMove}
                onPointerUp={handleMouseUp}
                onPointerLeave={handleMouseUp}
                onContextMenu={e => e.preventDefault()}
                style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
            />
        </div>
    );
}
