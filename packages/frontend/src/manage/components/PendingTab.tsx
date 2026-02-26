import React from "react";
import type { PendingFish } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Check, Trash2 } from "lucide-react";

interface PendingTabProps {
    pendingFish: PendingFish[];
    onRefresh: () => void;
}

export function PendingTab({ pendingFish, onRefresh }: PendingTabProps) {
    const releaseFish = async (fish: PendingFish) => {
        await fetch("/api/release", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                id: fish.id,
                type: "swimmer",
                textureUrl: fish.imageUrl,
                userParams: { scale: 0.8, speed: 1.0, rotationOffset: 0 }
            }),
        });
        onRefresh();
    };

    const deletePending = async (id: string) => {
        if (!confirm("この待機中の魚を削除（拒否）しますか？")) return;
        await fetch(`/api/pending/${encodeURIComponent(id)}`, { method: "DELETE" });
        onRefresh();
    };

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            <h2 className="text-xl font-bold text-slate-800 mb-4">待機中の魚一覧 ({pendingFish.length}匹)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {pendingFish.map(f => (
                    <div key={f.id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex flex-col gap-3">
                        <div className="w-full aspect-square bg-slate-100 rounded flex items-center justify-center p-2 border border-slate-200">
                            <img src={f.imageUrl} alt="pending fish" className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="flex flex-col gap-1 items-center">
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 rounded">
                                {f.id.slice(0, 8)}
                            </span>
                        </div>
                        <div className="flex gap-2 w-full mt-2">
                            <Button
                                variant="default"
                                className="flex-1 bg-sky-500 hover:bg-sky-600 text-white font-bold h-8 text-xs"
                                onClick={() => releaseFish(f)}
                            >
                                <Check className="w-3 h-3 mr-1" /> 放流
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 px-2 text-slate-500 hover:text-red-500 hover:bg-red-50 border-slate-300"
                                onClick={() => deletePending(f.id)}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                ))}
            </div>
            {pendingFish.length === 0 && (
                <div className="text-slate-400 text-center py-12">待機中の魚はいません</div>
            )}
        </div>
    );
}
