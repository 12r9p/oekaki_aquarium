import React from "react";
import type { DisplayClientInfo, TestPattern } from "@aquarium/shared";
import { ws } from "../main";

interface SidebarProps {
    displays: DisplayClientInfo[];
    selectedDisplayIds: string[]; // 現状は1つ想定だが拡張用
    onTestPattern: (pattern: TestPattern, uuid?: string) => Promise<void>;
    // 以下設定やその他詳細表示用
    worldW: number;
    worldH: number;
    onAddDemoFish: () => void;
    onSaveViewport: (uuid: string, vp: NonNullable<DisplayClientInfo["viewport"]>) => Promise<void>;
}

export function Sidebar({ displays, selectedDisplayIds, onTestPattern, worldW, worldH, onAddDemoFish, onSaveViewport }: SidebarProps): React.ReactElement {
    const selectedDisplay = displays.find(d => selectedDisplayIds.includes(d.uuid));

    return (
        <aside className="manage-sidebar">
            <h3>設定 / プロパティ</h3>

            <div className="panel-section">
                <div className="panel-section-title">World Size</div>
                <div>W: {worldW} px</div>
                <div>H: {worldH} px</div>
            </div>

            <div className="panel-section" style={{ marginTop: "12px" }}>
                <div className="panel-section-title">選択中のディスプレイ</div>
                {!selectedDisplay ? (
                    <div style={{ color: "rgba(255,255,255,0.4)" }}>選択されていません</div>
                ) : (
                    <>
                        <div><strong>ID:</strong> {selectedDisplay.uuid}</div>
                        <div style={{ marginTop: "8px" }}><strong>Viewport:</strong></div>
                        {selectedDisplay.viewport ? (
                            <div className="form-grid">
                                <div className="form-field">
                                    <span>X</span>
                                    <input type="number" value={Math.round(selectedDisplay.viewport.x)} onChange={(e) => onSaveViewport(selectedDisplay.uuid, { ...selectedDisplay.viewport!, x: Number(e.target.value) })} />
                                </div>
                                <div className="form-field">
                                    <span>Y</span>
                                    <input type="number" value={Math.round(selectedDisplay.viewport.y)} onChange={(e) => onSaveViewport(selectedDisplay.uuid, { ...selectedDisplay.viewport!, y: Number(e.target.value) })} />
                                </div>
                                <div className="form-field">
                                    <span>Width</span>
                                    <input type="number" value={Math.round(selectedDisplay.viewport.width)} onChange={(e) => onSaveViewport(selectedDisplay.uuid, { ...selectedDisplay.viewport!, width: Number(e.target.value) })} />
                                </div>
                                <div className="form-field">
                                    <span>Height</span>
                                    <input type="number" value={Math.round(selectedDisplay.viewport.height)} onChange={(e) => onSaveViewport(selectedDisplay.uuid, { ...selectedDisplay.viewport!, height: Number(e.target.value) })} />
                                </div>
                                <div className="form-field" style={{ gridColumn: "span 2" }}>
                                    <span>Scale</span>
                                    <input type="number" step="0.01" value={selectedDisplay.viewport.scale.toFixed(2)} onChange={(e) => onSaveViewport(selectedDisplay.uuid, { ...selectedDisplay.viewport!, scale: Number(e.target.value) })} />
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: "var(--danger)" }}>未設定</div>
                        )}

                        <div style={{ marginTop: "12px" }}><strong>この画面にテスト送信:</strong></div>
                        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "4px" }}>
                            <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("colorbars", selectedDisplay.uuid)}>Colorbars</button>
                            <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("grid", selectedDisplay.uuid)}>Grid</button>
                            <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("calibration", selectedDisplay.uuid)}>Calibration</button>
                            <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("worldmap", selectedDisplay.uuid)}>WorldMap</button>
                            <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("off", selectedDisplay.uuid)}>Off</button>
                        </div>
                    </>
                )}
            </div>

            <div className="panel-section" style={{ marginTop: "12px" }}>
                <div className="panel-section-title">一括テスト送信</div>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("colorbars")}>Colorbars</button>
                    <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("grid")}>Grid</button>
                    <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("calibration")}>Calibration</button>
                    <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("worldmap")}>Worldmap</button>
                    <button className="btn btn-sm btn-pattern" onClick={() => onTestPattern("off")}>Off</button>
                    <button className="btn btn-sm btn-primary" onClick={onAddDemoFish}>
                        🐟 デモ魚を追加
                    </button>
                </div>
            </div>
        </aside>
    );
}
