import React from "react";
import type { DisplayClientInfo, ActiveFish, PendingFish, TestPattern } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MonitorPlay, Layers, Paintbrush, Locate, Square, CheckSquare, Maximize, PlusCircle } from "lucide-react";
import { ws } from "../main";

interface ToolbarProps {
    displays: DisplayClientInfo[];
    activeFish: ActiveFish[];
    pendingFish: PendingFish[];
    connected: boolean;
    tab: "layout" | "fish" | "pending";
    setTab: (t: "layout" | "fish" | "pending") => void;
    onAddDemoFish: () => void;
}

export function Toolbar({
    displays, activeFish, pendingFish, connected,
    tab, setTab, onAddDemoFish
}: ToolbarProps): React.ReactElement {
    return (
        <div className="flex items-center justify-between px-6 py-2 bg-white border-b border-slate-200 h-14 flex-shrink-0 z-50">
            {/* Left: Branding & Tabs */}
            <div className="flex items-center gap-8 h-full">
                <div className="font-bold text-lg text-slate-800 flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.8)]" />
                    Aquarium Manage
                </div>

                <div className="flex gap-1 h-full items-end">
                    <button
                        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === "layout" ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        onClick={() => setTab("layout")}
                    >
                        <Layers className="w-4 h-4 inline-block mr-1.5 align-text-bottom" /> Layout
                    </button>
                    <button
                        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === "fish" ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        onClick={() => setTab("fish")}
                    >
                        🐟 Fish Data
                    </button>
                    <button
                        className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === "pending" ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                        onClick={() => setTab("pending")}
                    >
                        📥 Pending
                    </button>
                </div>
            </div>

            {/* Right: Actions & Status */}
            <div className="flex items-center gap-6">

                <div className="flex items-center gap-4 text-sm text-slate-600">
                    <Button variant="outline" size="sm" onClick={onAddDemoFish} className="gap-1 text-slate-600 border-slate-200 bg-slate-50 hover:bg-slate-100">
                        <PlusCircle className="w-4 h-4 text-sky-500" /> Demo Fish
                    </Button>
                </div>

                <div className="flex items-center gap-4">
                    <div className="text-xs font-semibold text-slate-500 flex gap-4">
                        <span className="flex items-center gap-1.5"><MonitorPlay className="w-3.5 h-3.5" /> Disps: {displays.length}</span>
                        <span>🐟 Appr: {activeFish.length}</span>
                        <span>📥 Pend: {pendingFish.length}</span>
                    </div>

                    <div className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider uppercase border
                        ${connected ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}
                    >
                        {connected ? "Connected" : "Disconnected"}
                    </div>
                </div>
            </div>
        </div>
    );
}
