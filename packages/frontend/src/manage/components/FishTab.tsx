import React, { useState } from "react";
import type { ActiveFish } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Trash2, Pin, Archive, CopyPlus } from "lucide-react";
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
    const [galleryImages, setGalleryImages] = useState<string[]>([]);
    const [isGalleryOpen, setIsGalleryOpen] = useState(false);

    React.useEffect(() => {
        fetch("/api/gallery").then(res => res.json()).then(data => {
            if (data.images) setGalleryImages(data.images);
        }).catch(e => console.error("Gallery fetch error:", e));
    }, []);

    const updateFish = async (id: string, updates: Partial<{ scale: number; speed: number; isPinned: boolean; pinnedLayerId: number; type: string; isArchived: boolean }>) => {
        await fetch(`/api/fish/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        onRefresh();
    };

    const duplicateFish = async (id: string) => {
        await fetch(`/api/fish/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
        onRefresh();
    };

    const addFromGallery = async (url: string) => {
        const types = ["swimmer", "looper", "anchor"];
        const randomType = types[Math.floor(Math.random() * types.length)];
        const scale = 0.5 + Math.random() * 0.5; // 0.5 ~ 1.0

        const scanRes = await fetch("/api/scan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId: "demo-gallery", imageUrl: url, imageLocalPath: url })
        });
        const scanData = await scanRes.json();

        if (scanData.fishId) {
            await fetch("/api/release", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: scanData.fishId,
                    type: randomType,
                    textureUrl: url,
                    userParams: { scale, speed: 1.0, rotationOffset: 0 }
                })
            });
            onRefresh();
            setIsGalleryOpen(false);
        }
    };

    const addDemoFish = async () => {
        const urls = [
            "https://illustrain.com/img/work/2016/illustrain02-sakana1.png",
            "https://illustrain.com/img/work/2016/illustrain02-sakana2.png",
            "https://illustrain.com/img/work/2016/illustrain02-sakana3.png"
        ];
        const randomUrl = urls[Math.floor(Math.random() * urls.length)];
        await addFromGallery(randomUrl);
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
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setIsGalleryOpen(!isGalleryOpen)} className="bg-white">
                        {isGalleryOpen ? "ギャラリーを閉じる" : "ギャラリーから追加"}
                    </Button>
                    <Button onClick={addDemoFish} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                        + デモ魚を追加
                    </Button>
                </div>
            </div>

            {/* --- ギャラリー表示エリア --- */}
            {isGalleryOpen && (
                <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-700 mb-3">過去の魚ギャラリー (クリックで放流)</h3>
                    <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2 overflow-y-auto max-h-48 p-2 bg-slate-50 rounded-lg border border-slate-100">
                        {galleryImages.length > 0 ? galleryImages.map((url, idx) => (
                            <div
                                key={idx}
                                onClick={() => addFromGallery(url)}
                                className="aspect-square bg-white rounded cursor-pointer border border-transparent hover:border-emerald-500 hover:shadow-md transition-all flex items-center justify-center p-1"
                            >
                                <img src={url} alt={`gallery-${idx}`} className="max-w-full max-h-full object-contain" loading="lazy" />
                            </div>
                        )) : (
                            <div className="col-span-full text-xs text-slate-400 text-center py-4">画像が見つかりません</div>
                        )}
                    </div>
                </div>
            )}

            {/* --- レイヤー所属状況の視覚化 --- */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <h3 className="text-sm font-bold text-slate-700 mb-3">レイヤーの混雑状況 (自動押し出し)</h3>
                <div className="flex flex-col gap-3">
                    {LAYER_CONFIG.map((conf, idx) => {
                        const inLayer = activeFish.filter(f => !f.isPinned && f.layerIndex === idx && !f.isArchived);
                        const count = inLayer.length;
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
                            <FishRow key={f.id} fish={f} onUpdate={updateFish} onDelete={deleteFish} onDuplicate={duplicateFish} />
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

function FishRow({ fish, onUpdate, onDelete, onDuplicate }: {
    fish: ActiveFish;
    onUpdate: (id: string, updates: any) => void;
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
}) {
    // ローカルステートで入力を管理し、Blur時に保存する
    const [scale, setScale] = useState(fish.userParams.scale);
    const [speed, setSpeed] = useState(fish.userParams.speed);
    const [pinnedLayerId, setPinnedLayerId] = useState(fish.pinnedLayerId ?? 0);

    return (
        <TableRow className={fish.isArchived ? "opacity-50" : ""}>
            <TableCell className="p-2 align-middle border-r border-slate-100 relative">
                <div className="w-12 h-12 bg-slate-100 rounded-lg overflow-hidden flex items-center justify-center border border-slate-200 mx-auto">
                    <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" />
                </div>
                {fish.isArchived && (
                    <div className="absolute top-1 right-1 bg-slate-700 text-white text-[9px] px-1 rounded">Arc</div>
                )}
            </TableCell>

            <TableCell className="align-middle border-r border-slate-100">
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <select
                            value={fish.type}
                            onChange={e => onUpdate(fish.id, { type: e.target.value })}
                            className="text-[10px] font-bold text-white bg-sky-500 px-2 py-0.5 rounded-full border-none outline-none cursor-pointer hover:bg-sky-600 appearance-none text-center"
                        >
                            <option value="swimmer">swimmer</option>
                            <option value="looper">looper</option>
                            <option value="anchor">anchor</option>
                        </select>
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
                        <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer hover:text-amber-600 transition-colors mt-1">
                            <input
                                type="checkbox"
                                checked={!!fish.isArchived}
                                onChange={e => onUpdate(fish.id, { isArchived: e.target.checked })}
                                className="form-checkbox text-amber-500 rounded-sm w-3.5 h-3.5"
                            />
                            <Archive className="w-3.5 h-3.5 -mt-0.5 text-slate-400" />
                            <div className="text-[10px]">アーカイブ (非表示)</div>
                        </label>
                    </div>
                </div>
            </TableCell>

            <TableCell className="text-right align-middle">
                <div className="flex justify-end gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-stone-500 hover:text-stone-700 hover:bg-stone-100 h-8 w-8 p-0"
                        onClick={() => onDuplicate(fish.id)}
                        title="複製"
                    >
                        <CopyPlus className="w-4 h-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                        onClick={() => onDelete(fish.id)}
                        title="削除"
                    >
                        <Trash2 className="w-4 h-4" />
                    </Button>
                </div>
            </TableCell>
        </TableRow>
    );
}
