import React, { useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Pin } from "lucide-react";

interface FishTabProps {
    activeFish: ActiveFish[];
    onRefresh: () => void;
}

export function FishTab({ activeFish, onRefresh }: FishTabProps) {
    const updateFish = async (id: string, updates: Partial<{ scale: number; speed: number; isPinned: boolean; pinnedLayerId: number }>) => {
        await fetch(`/api/fish/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        onRefresh();
    };

    const deleteFish = async (id: string) => {
        if (!confirm("この魚を水槽から削除しますか？")) return;
        await fetch(`/api/fish/${encodeURIComponent(id)}`, { method: "DELETE" });
        onRefresh();
    };

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            <h2 className="text-xl font-bold text-slate-800 mb-4">水槽の魚一覧 ({activeFish.length}匹)</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {activeFish.map(f => (
                    <FishCard key={f.id} fish={f} onUpdate={updateFish} onDelete={deleteFish} />
                ))}
            </div>
            {activeFish.length === 0 && (
                <div className="text-slate-400 text-center py-12">現在水槽に魚はいません</div>
            )}
        </div>
    );
}

function FishCard({ fish, onUpdate, onDelete }: {
    fish: ActiveFish;
    onUpdate: (id: string, updates: any) => void;
    onDelete: (id: string) => void;
}) {
    // ローカルステートで入力を管理し、Blur時に保存する
    const [scale, setScale] = useState(fish.userParams.scale);
    const [speed, setSpeed] = useState(fish.userParams.speed);
    const [pinnedLayerId, setPinnedLayerId] = useState(fish.pinnedLayerId ?? 0);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between">
                <div className="w-16 h-16 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200">
                    <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" />
                </div>
                <div className="flex flex-col items-end gap-1">
                    <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded flex items-center gap-1">
                        {fish.id.slice(0, 8)}
                        <Copy className="w-3 h-3 cursor-pointer hover:text-slate-800" onClick={() => navigator.clipboard.writeText(fish.id)} />
                    </span>
                    <span className="text-[10px] font-bold text-white bg-sky-500 px-2 py-0.5 rounded-full">{fish.type}</span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold">Scale</label>
                    <Input
                        type="number" step="0.1" min="0.1"
                        value={scale}
                        onChange={e => setScale(Number(e.target.value))}
                        onBlur={() => onUpdate(fish.id, { scale })}
                        className="h-7 text-xs"
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-slate-500 font-bold">Speed</label>
                    <Input
                        type="number" step="0.1" min="0"
                        value={speed}
                        onChange={e => setSpeed(Number(e.target.value))}
                        onBlur={() => onUpdate(fish.id, { speed })}
                        className="h-7 text-xs"
                    />
                </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-1">
                <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-1 text-xs font-bold text-slate-700 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={fish.isPinned}
                            onChange={e => onUpdate(fish.id, { isPinned: e.target.checked })}
                            className="form-checkbox text-sky-500"
                        />
                        <Pin className="w-3 h-3" /> Pin Layer
                    </label>
                    {fish.isPinned && (
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] text-slate-500">Layer ID:</span>
                            <Input
                                type="number"
                                value={pinnedLayerId}
                                onChange={e => setPinnedLayerId(Number(e.target.value))}
                                onBlur={() => onUpdate(fish.id, { pinnedLayerId })}
                                className="h-6 w-16 text-xs px-1 py-0 my-0 border-slate-300"
                            />
                        </div>
                    )}
                    {!fish.isPinned && (
                        <span className="text-[10px] text-slate-400">Current Auto: {fish.layerIndex}</span>
                    )}
                </div>

                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 px-2" onClick={() => onDelete(fish.id)}>
                    <Trash2 className="w-4 h-4" />
                </Button>
            </div>
        </div>
    );
}
