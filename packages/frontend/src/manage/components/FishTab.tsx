import React, { useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Pin } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

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
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800">水槽の魚一覧 ({activeFish.length}匹)</h2>
            </div>

            {/* --- レイヤー所属状況の視覚化 --- */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-bold text-slate-700 mb-3">レイヤーの混雑状況 (自動押し出し)</h3>
                <div className="flex flex-col gap-3">
                    {LAYER_CONFIG.map((conf, idx) => {
                        const count = activeFish.filter(f => !f.isPinned && f.layerIndex === idx).length;
                        const max = conf.maxCount;
                        const ratio = Math.min(count / max, 1);
                        const isFull = count >= max;
                        return (
                            <div key={conf.id} className="flex items-center gap-3">
                                <div className="w-16 text-[11px] font-bold text-slate-500 text-right mt-0.5">Lyr {conf.id}</div>
                                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative border border-slate-200 outline outline-1 outline-white mt-1">
                                    <div
                                        className={`absolute top-0 left-0 h-full transition-all duration-300 ${isFull ? "bg-amber-400" : "bg-emerald-400"}`}
                                        style={{ width: `${ratio * 100}%` }}
                                    />
                                </div>
                                <div className={`w-12 text-xs font-mono text-right mt-0.5 ${isFull ? "text-amber-600 font-bold" : "text-slate-500"}`}>
                                    {count}/{max}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-3 text-[10px] text-slate-400 leading-snug">
                    ※最前面(Lyr0)がいっぱいになると、順次奥のレイヤーへ押し出されます。ピン留め(固定)された魚はこの自動計算グラフの「定員({LAYER_CONFIG.reduce((acc, c) => acc + c.maxCount, 0)}匹)」からは除外されます。
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <Table>
                    <TableHeader className="bg-slate-50">
                        <TableRow>
                            <TableHead className="w-16 text-center">画像</TableHead>
                            <TableHead className="w-48">情報</TableHead>
                            <TableHead className="w-32">パラメータ(Scale/Speed)</TableHead>
                            <TableHead className="w-40">レイヤー設定</TableHead>
                            <TableHead className="text-right w-20">操作</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {activeFish.map(f => (
                            <FishRow key={f.id} fish={f} onUpdate={updateFish} onDelete={deleteFish} />
                        ))}
                    </TableBody>
                </Table>
            </div>
            {activeFish.length === 0 && (
                <div className="text-slate-400 text-center py-12">現在水槽に魚はいません</div>
            )}
        </div>
    );
}

function FishRow({ fish, onUpdate, onDelete }: {
    fish: ActiveFish;
    onUpdate: (id: string, updates: any) => void;
    onDelete: (id: string) => void;
}) {
    // ローカルステートで入力を管理し、Blur時に保存する
    const [scale, setScale] = useState(fish.userParams.scale);
    const [speed, setSpeed] = useState(fish.userParams.speed);
    const [pinnedLayerId, setPinnedLayerId] = useState(fish.pinnedLayerId ?? 0);

    return (
        <TableRow>
            <TableCell className="p-2 align-middle border-r border-slate-100">
                <div className="w-12 h-12 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 mx-auto">
                    <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" />
                </div>
            </TableCell>

            <TableCell className="align-middle border-r border-slate-100">
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-white bg-sky-500 px-2 py-0.5 rounded-full">{fish.type}</span>
                    </div>
                    <span className="text-xs font-mono text-slate-500 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded flex w-min items-center gap-2">
                        {fish.id.slice(0, 8)}
                        <Copy className="w-3 h-3 cursor-pointer hover:text-slate-800" onClick={() => navigator.clipboard.writeText(fish.id)} />
                    </span>
                </div>
            </TableCell>

            <TableCell className="align-middle border-r border-slate-100">
                <div className="flex gap-2">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Scale</label>
                        <Input
                            type="number" step="0.1" min="0.1"
                            value={scale}
                            onChange={e => setScale(Number(e.target.value))}
                            onBlur={() => onUpdate(fish.id, { scale })}
                            className="h-7 w-20 text-xs text-right font-mono"
                        />
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] text-slate-500 font-bold uppercase">Speed</label>
                        <Input
                            type="number" step="0.1" min="0"
                            value={speed}
                            onChange={e => setSpeed(Number(e.target.value))}
                            onBlur={() => onUpdate(fish.id, { speed })}
                            className="h-7 w-20 text-xs text-right font-mono"
                        />
                    </div>
                </div>
            </TableCell>

            <TableCell className="align-middle border-r border-slate-100">
                <div className="flex flex-col gap-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer hover:text-sky-600 transition-colors">
                        <input
                            type="checkbox"
                            checked={fish.isPinned}
                            onChange={e => onUpdate(fish.id, { isPinned: e.target.checked })}
                            className="form-checkbox text-sky-500 rounded-sm w-3.5 h-3.5"
                        />
                        <Pin className="w-3.5 h-3.5 -mt-0.5 text-slate-400" />
                        <div>ピン留め</div>
                    </label>
                    <div className="flex items-center justify-between mt-0.5">
                        {fish.isPinned ? (
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-sky-600 font-semibold bg-sky-50 px-1.5 py-0.5 rounded">Layer ID</span>
                                <Input
                                    type="number"
                                    value={pinnedLayerId}
                                    onChange={e => setPinnedLayerId(Number(e.target.value))}
                                    onBlur={() => onUpdate(fish.id, { pinnedLayerId })}
                                    className="h-6 w-16 text-xs text-center px-1 py-0 my-0 border-sky-200 bg-sky-50/50"
                                />
                            </div>
                        ) : (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">Auto assigned</span>
                                <span className="text-[11px] font-mono font-semibold text-slate-600">[{fish.layerIndex}]</span>
                            </div>
                        )}
                    </div>
                </div>
            </TableCell>

            <TableCell className="text-right align-middle">
                <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                    onClick={() => onDelete(fish.id)}
                    title="削除"
                >
                    <Trash2 className="w-4 h-4" />
                </Button>
            </TableCell>
        </TableRow>
    );
}
