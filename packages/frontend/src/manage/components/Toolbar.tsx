import React from "react";
import type { DisplayClientInfo, ActiveFish, PendingFish } from "@aquarium/shared";
import { CircleGauge, Fish, Layers, Monitor, Settings, Send } from "lucide-react";

export type ManagePage = "dashboard" | "layout" | "fish" | "pending" | "clients" | "settings";

interface ToolbarProps {
    displays: DisplayClientInfo[];
    activeFish: ActiveFish[];
    pendingFish: PendingFish[];
    connected: boolean;
    tab: ManagePage;
    setTab: (t: ManagePage) => void;
}

export function Toolbar({
    displays, activeFish, pendingFish, connected,
    tab, setTab
}: ToolbarProps): React.ReactElement {
    return (
        <aside className="flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-slate-200">
            <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
                <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                <div>
                    <div className="text-sm font-bold text-white">お絵かき水族館</div>
                    <div className="text-[10px] font-medium text-slate-400">運用管理</div>
                </div>
            </div>
            <nav className="flex flex-1 flex-col gap-1 p-3">
                {([
                    ["dashboard", "現在の状態", CircleGauge],
                    ["fish", "魚", Fish],
                    ["pending", "承認待ち", Send],
                    ["layout", "水槽レイアウト", Layers],
                    ["clients", "表示端末", Monitor],
                    ["settings", "設定", Settings],
                ] as const).map(([value, label, Icon]) => (
                    <button key={value} onClick={() => setTab(value)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${tab === value ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"}`}>
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{label}</span>
                        {value === "pending" && pendingFish.length > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">{pendingFish.length}</span>}
                    </button>
                ))}
            </nav>
            <div className="border-t border-slate-800 p-4">
                <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{displays.length}</div><div className="text-[10px] text-slate-400">端末</div></div>
                    <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{activeFish.length}</div><div className="text-[10px] text-slate-400">魚</div></div>
                </div>
                <div className={`mt-3 flex items-center gap-2 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                    <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                    {connected ? "サーバー接続中" : "サーバー切断中"}
                </div>
            </div>
        </aside>
    );
}
