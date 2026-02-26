import React from "react";
import type { DisplayClientInfo, ActiveFish, PendingFish } from "@aquarium/shared";
import { ws } from "../main";

interface ToolbarProps {
    displays: DisplayClientInfo[];
    activeFish: ActiveFish[];
    pendingFish: PendingFish[];
    connected: boolean;
    tab: "layout" | "fish" | "pending";
    setTab: (t: "layout" | "fish" | "pending") => void;
    // レート設定
    sendRateSetting: number;
    setSendRateSetting: (rate: number) => void;
    // デモ魚追加機能
    onAddDemoFish: () => void;
}

export function Toolbar({
    displays, activeFish, pendingFish, connected,
    tab, setTab,
    sendRateSetting, setSendRateSetting,
    onAddDemoFish
}: ToolbarProps): React.ReactElement {
    return (
        <>
            <header className="manage-header">
                <div className="manage-logo">🎛 お絵かき水族館・管理画面</div>
                <div className="manage-header-right">
                    <span className="manage-stat">🖥 {displays.length}台</span>
                    <span className="manage-stat">🐟 {activeFish.length}匹</span>
                    <span className="manage-stat">⏳ {pendingFish.length}匹</span>
                    <div className={`manage-connection ${connected ? "ok" : "ng"}`}>
                        {connected ? "🟢 WS接続中" : "🔴 切断"}
                    </div>
                </div>
            </header>

            <div className="layout-toolbar">
                <nav className="manage-tabs">
                    {(["layout", "fish", "pending"] as const).map((t) => (
                        <button key={t} className={`manage-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
                            {{ layout: "🗺 ディスプレイ配置", fish: "🐟 水槽の魚", pending: "⏳ 待合室" }[t]}
                        </button>
                    ))}
                </nav>

                <div className="manage-actions">
                    <div className="manage-setting-item">
                        <span style={{ fontSize: "12px", marginRight: "8px" }}>送信レート (ms): {sendRateSetting}</span>
                        <input
                            type="range"
                            min="16" max="500" step="1"
                            value={sendRateSetting}
                            onChange={(e) => setSendRateSetting(Number(e.target.value))}
                        />
                    </div>
                    <button className="btn btn-sm btn-primary" onClick={onAddDemoFish}>
                        🐟 デモ魚を追加
                    </button>
                </div>
            </div>
        </>
    );
}
