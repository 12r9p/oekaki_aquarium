import React, { useRef, useEffect, useCallback, useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { ws } from "../main";
import { drawViewportCanvas } from "./canvas/drawing/drawViewportCanvas";
import { getHandles, HANDLE_R } from "./canvas/drawing/handles";
import type { DragState, HandleType, PendingWorldSize, SnapGuides, ViewportCanvasProps } from "./canvas/types";
import { useCanvasCamera } from "./canvas/useCanvasCamera";
import { useCanvasImageCache } from "./canvas/useCanvasImageCache";

export function ViewportCanvas({
    worldW, worldH, bgUrl, displaysSt, displaysRef, pendingViewports,
    selected, setSelected, hoveredRef, setHoveredUI,
    undoStackRef, redoStackRef, snapshotViewports, onSaveViewport,
    arLocked, sendRateSetting, setWorldSize, forbiddenZones, onUpdateForbiddenZones,
    spawnPoints, onUpdateSpawnPoints, layers, onUpdateLayers, activeLayerId,
    activeFish = [], onMoveFish
}: ViewportCanvasProps): React.ReactElement {

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<DragState | null>(null);
    const { cameraRef: camRef, worldToCanvas, canvasToWorld } = useCanvasCamera();
    const rafRef = useRef<number | null>(null);
    const isPanningRef = useRef(false);
    const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });
    const spaceRef = useRef(false);
    const drawRef = useRef<() => void>(() => void 0);

    const previewThrottleRef = useRef<number>(0);
    const pointerThrottleRef = useRef<number>(0);
    const snapGuides = useRef<SnapGuides>({});
    const pendingWorldSizeRef = useRef<PendingWorldSize | null>(null);

    // キャンバス内オブジェクトのローカル選択状態 (FZやSPなど)
    const [selectedLocalId, setSelectedLocalId] = useState<string | null>(null);
    // 魚 D&D 用: 現在ドラッグ中の魚ID
    const dragFishIdRef = useRef<string | null>(null);

    const { loadFishImage, loadLayerImage } = useCanvasImageCache(rafRef, drawRef);
    // activeFishの参照をdrawCallback内で最新化するため
    const activeFishRef = useRef<ActiveFish[]>(activeFish);
    useEffect(() => { activeFishRef.current = activeFish; }, [activeFish]);
    const onMoveFishRef = useRef(onMoveFish);
    useEffect(() => { onMoveFishRef.current = onMoveFish; }, [onMoveFish]);

    const draw = useCallback(() => {
        drawViewportCanvas({
            canvas: canvasRef.current,
            camera: camRef.current,
            worldW,
            worldH,
            pendingWorldSize: pendingWorldSizeRef.current,
            bgUrl,
            displays: displaysRef.current,
            selected,
            hovered: hoveredRef.current,
            selectedLocalId,
            dragState: dragRef.current,
            dragFishId: dragFishIdRef.current,
            snapGuides: snapGuides.current,
            forbiddenZones,
            spawnPoints,
            layers,
            activeLayerId,
            activeFish: activeFishRef.current,
            worldToCanvas,
            loadFishImage,
            loadLayerImage,
        });
    }, [selected, selectedLocalId, worldW, worldH, bgUrl, worldToCanvas, forbiddenZones, spawnPoints, layers, activeLayerId, displaysRef, hoveredRef, loadFishImage, loadLayerImage]);


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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [worldW, worldH]);

    // Request Animation Frame描画トリガー (displaysの更新時など)
    useEffect(() => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
    }, [displaysSt, draw]);

    // 魚のリアルタイム情報受信時の再描画トリガー
    useEffect(() => {
        const onFrame = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        };
        window.addEventListener("aquarium_frame", onFrame);
        return () => window.removeEventListener("aquarium_frame", onFrame);
    }, [draw]);

    // Delete / Backspace キーボード操作
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.key === "Backspace" || e.key === "Delete") {
                if (selectedLocalId) {
                    if (forbiddenZones.find(z => z.id === selectedLocalId)) {
                        onUpdateForbiddenZones(forbiddenZones.filter(z => z.id !== selectedLocalId));
                        setSelectedLocalId(null);
                    } else if (spawnPoints.find(p => p.id === selectedLocalId)) {
                        onUpdateSpawnPoints(spawnPoints.filter(p => p.id !== selectedLocalId));
                        setSelectedLocalId(null);
                    } else if (layers.find(l => l.id === selectedLocalId && l.type === "image")) {
                        if (onUpdateLayers) {
                            onUpdateLayers(layers.map(l => l.id === selectedLocalId ? { ...l, url: undefined, name: "空レイヤー" } : l));
                        }
                        setSelectedLocalId(null);
                    }
                }
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [selectedLocalId, forbiddenZones, spawnPoints, layers, onUpdateForbiddenZones, onUpdateSpawnPoints, onUpdateLayers]);

    // マウスイベント処理
    const getCanvasPt = useCallback((evtX: number, evtY: number) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return { mx: evtX - rect.left, my: evtY - rect.top };
    }, []);

    const handleMouseDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        if (e.button === 1 || spaceRef.current) {
            isPanningRef.current = true;
            const { mx, my } = getCanvasPt(e.clientX, e.clientY);
            panStartRef.current = { mx, my, px: camRef.current.panX, py: camRef.current.panY };
            canvasRef.current!.style.cursor = "grabbing";
            return;
        }

        const { mx, my } = getCanvasPt(e.clientX, e.clientY);
        const wPt = canvasToWorld(mx, my);

        // 新規追加 (右クリドラッグでForbiddenZone)
        if (e.button === 2) {
            const canMoveFz = !activeLayerId || activeLayerId === "layer_system";
            if (!canMoveFz) return;

            const newZone = { id: `fz_${Date.now()}_${Math.random().toString(36).slice(2)}`, x: wPt.x, y: wPt.y, width: 0, height: 0 };
            onUpdateForbiddenZones([...forbiddenZones, newZone]);
            dragRef.current = { handle: "fz_br", uuid: newZone.id, startMouseX: mx, startMouseY: my, startRect: { ...newZone } };
            setSelected(null);
            setSelectedLocalId(newZone.id);
            return;
        }

        if (e.button !== 0) return;

        // まず World Resizer かどうか判定
        const z = camRef.current.zoom;
        const R_WORLD = 12 / z; // 当たり判定少し大きめ
        const currentWorldW = pendingWorldSizeRef.current?.w ?? worldW;
        const currentWorldH = pendingWorldSizeRef.current?.h ?? worldH;
        // World Resizer はいつでも触れる、または選択制限をかけるか？
        // World設定はグローバルなのでレイヤー制限には含めないでおく
        if (Math.abs(wPt.x - currentWorldW) <= R_WORLD && Math.abs(wPt.y - currentWorldH) <= R_WORLD) {
            undoStackRef.current.push(snapshotViewports());
            redoStackRef.current.length = 0;
            pendingWorldSizeRef.current = { w: worldW, h: worldH }; // Store current world size for pending updates
            dragRef.current = {
                handle: "world_br", uuid: "world", startMouseX: mx, startMouseY: my,
                startRect: { x: 0, y: 0, width: currentWorldW, height: currentWorldH, scale: 1 }
            };
            return;
        }

        // --- ヒットテスト用オブジェクトリストの作成（手前から奥の順＝Z-Index降順） ---
        const hitObjects: { type: "system_fz" | "system_sp" | "fish" | "image" | "display", zIndex: number, data: any, layerId?: string }[] = [];

        // 1. システム層 (Z-Index: 999 相当とする)
        const canMoveSystem = activeLayerId === "layer_system";
        if (canMoveSystem) {
            for (const fz of forbiddenZones) hitObjects.push({ type: "system_fz", zIndex: 999, data: fz, layerId: "layer_system" });
            for (const sp of spawnPoints) hitObjects.push({ type: "system_sp", zIndex: 999, data: sp, layerId: "layer_system" });
        }

        // 2. ユーザーレイヤー (Z-Indexに基づく)
        for (const l of layers) {
            const isActiveLayer = activeLayerId === l.id;
            if (!isActiveLayer) continue;

            if (l.type === "image") {
                hitObjects.push({ type: "image", zIndex: l.zIndex, data: l, layerId: l.id });
            } else if (l.type === "fish") {
                // 魚レイヤーに所属する描画要素(frame.f)をすべて追加
                const frame = (window as any).__lastFrame;
                if (frame && frame.f) {
                    for (const f of frame.f) {
                        if (f.z === l.zIndex) {
                            hitObjects.push({ type: "fish", zIndex: l.zIndex, data: f, layerId: l.id });
                        }
                    }
                }
            }
        }

        // Z-Index 降順（手前から奥）にソート
        hitObjects.sort((a, b) => b.zIndex - a.zIndex);

        // --- 統合ヒットテスト ---
        const HANDLE_R_W = HANDLE_R / z;

        for (const obj of hitObjects) {
            if (obj.type === "fish") {
                const f = obj.data;
                const FISH_R = Math.max(16, 40 * z) / z;
                if (Math.abs(wPt.x - f.x) <= FISH_R && Math.abs(wPt.y - f.y) <= FISH_R) {
                    dragFishIdRef.current = f.i;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    setSelectedLocalId(null);
                    setSelected(null);
                    if (rafRef.current) cancelAnimationFrame(rafRef.current);
                    rafRef.current = requestAnimationFrame(draw);
                    return;
                }
            } else if (obj.type === "image") {
                const layer = obj.data;
                const imgX = layer.x ?? 0;
                const imgY = layer.y ?? 0;
                const imgW = layer.width ?? currentWorldW;
                const imgH = layer.height ?? currentWorldH;
                const pts = getHandles({ x: imgX, y: imgY, width: imgW, height: imgH });

                const isSel = dragRef.current?.uuid === layer.id || selectedLocalId === layer.id;

                if (isSel) {
                    if (Math.abs(wPt.x - pts.br.x) < HANDLE_R_W && Math.abs(wPt.y - pts.br.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_br", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.tr.x) < HANDLE_R_W && Math.abs(wPt.y - pts.tr.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_tr", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.bl.x) < HANDLE_R_W && Math.abs(wPt.y - pts.bl.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_bl", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.tl.x) < HANDLE_R_W && Math.abs(wPt.y - pts.tl.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_tl", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.r.x) < HANDLE_R_W && Math.abs(wPt.y - pts.r.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_r", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.l.x) < HANDLE_R_W && Math.abs(wPt.y - pts.l.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_l", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.b.x) < HANDLE_R_W && Math.abs(wPt.y - pts.b.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_b", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                    if (Math.abs(wPt.x - pts.t.x) < HANDLE_R_W && Math.abs(wPt.y - pts.t.y) < HANDLE_R_W) { dragRef.current = { handle: "ImgLayer_t", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } }; return; }
                }

                if (wPt.x >= imgX && wPt.x <= imgX + imgW && wPt.y >= imgY && wPt.y <= imgY + imgH) {
                    if (e.altKey) {
                        if (onUpdateLayers) {
                            onUpdateLayers(layers.map(l => l.id === layer.id ? { ...l, url: undefined, name: "空レイヤー" } : l));
                        }
                        return; // 画像本体削除ならここで終了
                    }
                    setSelectedLocalId(layer.id);
                    setSelected(null);
                    dragRef.current = { handle: "move", uuid: layer.id, startMouseX: mx, startMouseY: my, startRect: { x: imgX, y: imgY, width: imgW, height: imgH } };
                    return; // 一つ掴んだら終了
                }
            } else if (obj.type === "system_fz") {
                const fz = obj.data;
                const pts = getHandles(fz as any);
                if (Math.abs(wPt.x - pts.br.x) < HANDLE_R_W && Math.abs(wPt.y - pts.br.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_br", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.tr.x) < HANDLE_R_W && Math.abs(wPt.y - pts.tr.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_tr", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.bl.x) < HANDLE_R_W && Math.abs(wPt.y - pts.bl.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_bl", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.tl.x) < HANDLE_R_W && Math.abs(wPt.y - pts.tl.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_tl", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.r.x) < HANDLE_R_W && Math.abs(wPt.y - pts.r.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_r", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.l.x) < HANDLE_R_W && Math.abs(wPt.y - pts.l.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_l", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.b.x) < HANDLE_R_W && Math.abs(wPt.y - pts.b.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_b", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }
                if (Math.abs(wPt.x - pts.t.x) < HANDLE_R_W && Math.abs(wPt.y - pts.t.y) < HANDLE_R_W) { dragRef.current = { handle: "fz_t", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } }; return; }

                if (wPt.x >= fz.x && wPt.x <= fz.x + fz.width && wPt.y >= fz.y && wPt.y <= fz.y + fz.height) {
                    if (e.altKey) {
                        onUpdateForbiddenZones(forbiddenZones.filter(z => z.id !== fz.id));
                        return;
                    }
                    dragRef.current = { handle: "fz_move", uuid: fz.id, startMouseX: mx, startMouseY: my, startRect: { ...fz } };
                    setSelected(null);
                    setSelectedLocalId(fz.id);
                    return;
                }
            } else if (obj.type === "system_sp") {
                const sp = obj.data;
                const RW_SP = (HANDLE_R * 1.5) / z;
                if (Math.abs(wPt.x - sp.x) <= RW_SP && Math.abs(wPt.y - sp.y) <= RW_SP) {
                    if (e.altKey) {
                        onUpdateSpawnPoints(spawnPoints.filter(p => p.id !== sp.id));
                        return;
                    }
                    dragRef.current = { handle: `sp_move` as HandleType, uuid: sp.id, startMouseX: mx, startMouseY: my, startRect: { ...sp, width: 0, height: 0, scale: 1 } };
                    setSelected(null);
                    setSelectedLocalId(sp.id);
                    return;
                }
            }
        }

        const canMoveDisp = !activeLayerId;
        if (canMoveDisp) {
            if (selected) {
                const t = displaysRef.current.find(d => d.uuid === selected);
                if (t && t.viewport) {
                    const pts = getHandles(t.viewport);
                    const z = camRef.current.zoom;
                    const RW = HANDLE_R / z + 2;
                    let hitHandle: HandleType | null = null;

                    for (const [k, v] of Object.entries(pts as any)) {
                        if (k === "move") continue;
                        if (Math.abs(wPt.x - (v as any).x) <= RW && Math.abs(wPt.y - (v as any).y) <= RW) { hitHandle = k as HandleType; break; }
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
                            startRect: { ...t.viewport! }
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
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
                    startRect: { ...t.viewport! }
                };
                e.currentTarget.setPointerCapture(e.pointerId);
                setSelectedLocalId(null);
            } else {
                setSelected(null);
                setSelectedLocalId(null);
            }
        } else {
            if (selected) setSelected(null);
        }
    }, [selected, displaysRef, getCanvasPt, canvasToWorld, snapshotViewports, setSelected, undoStackRef, redoStackRef, forbiddenZones, onUpdateForbiddenZones, spawnPoints, onUpdateSpawnPoints, worldW, worldH, activeLayerId]);

    const handleMouseMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
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

        // --- 魚のドラッグ中：ワールド座標でライブ再描画 ---
        if (dragFishIdRef.current) {
            const wp = canvasToWorld(mx, my);
            const frameData = (window as any).__lastFrame;
            if (frameData?.f) {
                const fish = (frameData.f as any[]).find((f: any) => f.i === dragFishIdRef.current);
                if (fish) { fish.x = wp.x; fish.y = wp.y; }
            }
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

        // --- ワールド / フレームドラッグ・リサイズ ---
        const drag = dragRef.current;
        const z = camRef.current.zoom;
        const dx = (mx - drag.startMouseX) / z;
        const dy = (my - drag.startMouseY) / z;

        if (drag.handle === "world_br") {
            const wPt = canvasToWorld(mx, my);
            let nw = Math.max(1000, wPt.x);
            let nh = Math.max(400, wPt.y);
            pendingWorldSizeRef.current = { w: nw, h: nh };
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (drag.handle.startsWith("sp_")) {
            const target = spawnPoints.find(p => p.id === drag.uuid);
            if (!target) return;
            const nx = drag.startRect.x + dx;
            const ny = drag.startRect.y + dy;
            onUpdateSpawnPoints(spawnPoints.map(p => p.id === target.id ? { ...p, x: nx, y: ny } : p));
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (drag.handle.startsWith("fz_")) {
            // ForbiddenZoneの操作
            const target = forbiddenZones.find(z => z.id === drag.uuid);
            if (!target) return;

            let nx = drag.startRect.x, ny = drag.startRect.y, nw = drag.startRect.width, nh = drag.startRect.height;
            const h = drag.handle.replace("fz_", "");

            if (h === "move") {
                nx += dx; ny += dy;
            } else {
                if (h.includes("l")) { nx += dx; nw -= dx; }
                if (h.includes("r")) { nw += dx; }
                if (h.includes("t")) { ny += dy; nh -= dy; }
                if (h.includes("b")) { nh += dy; }
            }
            // Ensure minimum size and normalize negative dimensions
            if (nw < 5) { if (h.includes("l")) nx += (nw - 5); nw = 5; }
            if (nh < 5) { if (h.includes("t")) ny += (nh - 5); nh = 5; }

            onUpdateForbiddenZones(forbiddenZones.map(z => z.id === target.id ? { ...z, x: nx, y: ny, width: nw, height: nh } : z));
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (drag.handle.startsWith("ImgLayer_") || (drag.handle === "move" && layers.find(l => l.id === drag.uuid && l.type === "image"))) {
            // 画像レイヤーの操作
            const target = layers.find(l => l.id === drag.uuid);
            if (!target) return;

            let nx = drag.startRect.x, ny = drag.startRect.y, nw = drag.startRect.width, nh = drag.startRect.height;
            const h = drag.handle.replace("ImgLayer_", "");

            if (h === "move") {
                nx += dx; ny += dy;
            } else {
                if (h.includes("l")) { nx += dx; nw -= dx; }
                if (h.includes("r")) { nw += dx; }
                if (h.includes("t")) { ny += dy; nh -= dy; }
                if (h.includes("b")) { nh += dy; }

                if (target.aspectRatioLocked) {
                    const AR = drag.startRect.width / drag.startRect.height;
                    if (h.includes("r") || h.includes("l")) nh = nw / AR;
                    else if (h.includes("t") || h.includes("b")) nw = nh * AR;
                }
            }

            if (nw < 10) { if (h.includes("l")) nx += (nw - 10); nw = 10; }
            if (nh < 10) { if (h.includes("t")) ny += (nh - 10); nh = 10; }

            if (onUpdateLayers) {
                onUpdateLayers(layers.map(l => l.id === target.id ? { ...l, x: Math.round(nx), y: Math.round(ny), width: Math.round(nw), height: Math.round(nh) } : l));
            }
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        const dObj = displaysRef.current.find(d => d.uuid === drag.uuid);
        if (!dObj || !dObj.viewport) return;
        const vp = dObj.viewport;

        // ... （ドラッグロジック: startRect をもとに dx/dy を加算・減算する処理）...
        // 今回は既存のコードそのまま移植
        let nx = drag.startRect.x, ny = drag.startRect.y, nw = drag.startRect.width, nh = drag.startRect.height;

        if (drag.handle === "move") {
            nx += dx; ny += dy;
        } else {
            if (drag.handle.includes("l")) { nx += dx; nw -= dx; }
            if (drag.handle.includes("r")) { nw += dx; }
            if (drag.handle.includes("t")) { ny += dy; nh -= dy; }
            if (drag.handle.includes("b")) { nh += dy; }
            if (arLocked) {
                const AR = drag.startRect.width / drag.startRect.height;
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
        const currentWorldW = pendingWorldSizeRef.current?.w ?? worldW;
        const currentWorldH = pendingWorldSizeRef.current?.h ?? worldH;
        if (!snapObjX) {
            if (Math.abs(nx) < SNAP) { nx = 0; snapObjX = 0; }
            if (Math.abs(nx + nw - currentWorldW) < SNAP) { snapObjX = currentWorldW; if (drag.handle === "move") nx = currentWorldW - nw; else nw = currentWorldW - nx; }
        }
        if (!snapObjY) {
            if (Math.abs(ny) < SNAP) { ny = 0; snapObjY = 0; }
            if (Math.abs(ny + nh - currentWorldH) < SNAP) { snapObjY = currentWorldH; if (drag.handle === "move") ny = currentWorldH - nh; else nh = currentWorldH - ny; }
        }
        snapGuides.current = { x: snapObjX, y: snapObjY };

        vp.x = nx; vp.y = ny; vp.width = nw; vp.height = nh;

        // Scaleの再計算（横幅から逆算・表示機器の情報は変わらない前提）
        vp.scale = vp.width / (drag.startRect.width / (drag.startRect.scale || 1));

        // リストへの差分適用
        pendingViewports.current.set(drag.uuid, { ...vp });

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);

        const now = Date.now();
        if (now - previewThrottleRef.current > sendRateSetting) {
            previewThrottleRef.current = now;
            ws.send({ event: "viewport_preview", displayUuid: drag.uuid, viewport: vp });
        }
    }, [getCanvasPt, canvasToWorld, displaysRef, worldW, worldH, arLocked, sendRateSetting, draw, forbiddenZones, onUpdateForbiddenZones, spawnPoints, onUpdateSpawnPoints, pendingWorldSizeRef]);

    const handleMouseUp = useCallback((e?: React.PointerEvent<HTMLCanvasElement>) => {
        isPanningRef.current = false;
        if (canvasRef.current) canvasRef.current.style.cursor = "default";
        snapGuides.current = {};

        if (dragFishIdRef.current) {
            const shortId = dragFishIdRef.current;
            const frameFish = (window as any).__lastFrame?.f?.find((f: any) => f.i === shortId);
            const fullId = activeFishRef.current.find(f => f.id.startsWith(shortId))?.id;
            if (frameFish && fullId) void onMoveFishRef.current?.(fullId, frameFish.x, frameFish.y);
            dragFishIdRef.current = null;
            if (e?.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
            return;
        }

        if (dragRef.current) {
            if (dragRef.current.handle === "world_br") {
                if (pendingWorldSizeRef.current) {
                    setWorldSize(Math.round(pendingWorldSizeRef.current.w), Math.round(pendingWorldSizeRef.current.h));
                }
                pendingWorldSizeRef.current = null;
            } else if (dragRef.current.handle.startsWith("fz_") || dragRef.current.handle.startsWith("sp_")) {
                // Already updated via state continuously
                // Normalize forbidden zones after drag ends
                if (dragRef.current.handle.startsWith("fz_")) {
                    onUpdateForbiddenZones(forbiddenZones.map(z => {
                        if (z.id === dragRef.current?.uuid) {
                            return {
                                ...z,
                                x: Math.round(z.width < 0 ? z.x + z.width : z.x),
                                y: Math.round(z.height < 0 ? z.y + z.height : z.y),
                                width: Math.round(Math.abs(z.width)),
                                height: Math.round(Math.abs(z.height))
                            };
                        }
                        return z;
                    }).filter(z => z.width >= 5 && z.height >= 5)); // Filter out too small zones
                }
            } else {
                const dObj = displaysRef.current.find(d => d.uuid === dragRef.current!.uuid);
                if (dObj && dObj.viewport) {
                    onSaveViewport(dObj.uuid, dObj.viewport).then(() => {
                        pendingViewports.current.delete(dObj.uuid);
                    });
                }
            }
            dragRef.current = null;
            if (e?.currentTarget.hasPointerCapture(e.pointerId)) {
                e.currentTarget.releasePointerCapture(e.pointerId);
            }
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        }
    }, [displaysRef, onSaveViewport, draw, onUpdateForbiddenZones, forbiddenZones]);


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
        if (e.code === "Space") { spaceRef.current = true; if (canvasRef.current) canvasRef.current.style.cursor = "grab"; e.preventDefault(); return; }

        // 矢印キーでの1px微調整機能
        if (selected && (e.code === "ArrowUp" || e.code === "ArrowDown" || e.code === "ArrowLeft" || e.code === "ArrowRight")) {
            e.preventDefault();
            const dObj = displaysRef.current.find(d => d.uuid === selected);
            if (!dObj || !dObj.viewport) return;
            const vp = { ...dObj.viewport };
            const speed = e.shiftKey ? 10 : 1; // Shift押下時は10px
            if (e.code === "ArrowUp") vp.y -= speed;
            if (e.code === "ArrowDown") vp.y += speed;
            if (e.code === "ArrowLeft") vp.x -= speed;
            if (e.code === "ArrowRight") vp.x += speed;

            undoStackRef.current.push(snapshotViewports());
            redoStackRef.current.length = 0;

            // update state directly and save
            dObj.viewport = vp;
            onSaveViewport(selected, vp);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(draw);
        }
    }, [selected, displaysRef, snapshotViewports, onSaveViewport, draw]);
    const handleKeyUp = useCallback((e: KeyboardEvent) => {
        if (e.code === "Space") { spaceRef.current = false; if (canvasRef.current && !isPanningRef.current) canvasRef.current.style.cursor = "default"; }
    }, []);

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); };
    }, [handleKeyDown, handleKeyUp]);

    return (
        <div className="flex-1 relative cursor-crosshair overflow-hidden touch-none" ref={wrapperRef} onWheel={handleWheel}>
            <canvas
                ref={canvasRef}
                onPointerDown={handleMouseDown}
                onPointerMove={handleMouseMove}
                onPointerUp={handleMouseUp}
                onPointerCancel={handleMouseUp}
                onPointerLeave={handleMouseUp}
                onContextMenu={e => e.preventDefault()}
                style={{ width: "100%", height: "100%", display: "block" }}
            />
        </div>
    );
}
