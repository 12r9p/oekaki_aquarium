import React, { useState } from "react";
import type { ActiveFish, FishType, LayerConfig } from "@aquarium/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/shared/api";
import { Trash2, Pin, Archive, CopyPlus, X, Shuffle, Upload, Download, Gauge, FlipHorizontal2, Save } from "lucide-react";
import { BulkMultiplierSection } from "./fish/BulkMultiplierSection";
import { FishTable } from "./fish/FishTable";
import { LayerOccupancySection } from "./fish/LayerOccupancySection";
import { PageHeader } from "./PageHeader";
import { MotionPreview } from "./MotionPage";
interface FishTabProps {
    activeFish: ActiveFish[];
    fishLayers: LayerConfig[];
    fishScaleMultiplier: number;
    onRefresh: () => void;
}

const DEFAULT_FISH_CUSTOM_CODE = `function update(fish, t, api) {
  const state = fish.__custom ??= { phase: api.noise(1) * Math.PI * 2, dir: api.noise(2) < 0.5 ? -1 : 1 };
  state.phase += 0.04 * api.speed;
  fish.physics.vel.x = api.lerp(fish.physics.vel.x, 2.0 * api.speed * state.dir, 0.08);
  fish.physics.vel.y = api.lerp(fish.physics.vel.y, Math.sin(state.phase) * api.verticalSpread, 0.08);
  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}`;

/** 魚コンフィグポップアップ */
function FishConfigPopup({
    fish,
    onUpdate,
    onDelete,
    onDuplicate,
    onClose,
    layerCount,
}: {
    fish: ActiveFish;
    onUpdate: (id: string, updates: Record<string, unknown>) => void;
    onDelete: (id: string) => void;
    onDuplicate: (id: string) => void;
    onClose: () => void;
    layerCount: number;
}) {
    const [scale, setScale] = useState(fish.userParams.scale);
    const [speed, setSpeed] = useState(fish.userParams.speed);
    const [opacity, setOpacity] = useState(fish.userParams.opacity ?? 1);
    const [flipX, setFlipX] = useState(fish.userParams.flipX ?? false);
    const [pinnedLayerId, setPinnedLayerId] = useState(fish.pinnedLayerId ?? 0);
    const [isPinned, setIsPinned] = useState(fish.isPinned);
    const [isArchived, setIsArchived] = useState(!!fish.isArchived);
    const [type, setType] = useState(fish.type);
    const [direction, setDirection] = useState(fish.userParams.direction ?? "auto");
    const [customName, setCustomName] = useState(fish.customMotion?.name ?? "この魚のカスタム");
    const [customCode, setCustomCode] = useState(fish.customMotion?.code ?? DEFAULT_FISH_CUSTOM_CODE);
    // 削除確認インラインUIの表示状態
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // fish.id が変化したとき（別の魚を選択）にローカルstateを同期する
    React.useEffect(() => {
        setScale(fish.userParams.scale);
        setSpeed(fish.userParams.speed);
        setOpacity(fish.userParams.opacity ?? 1);
        setFlipX(fish.userParams.flipX ?? false);
        setPinnedLayerId(fish.pinnedLayerId ?? 0);
        setIsPinned(fish.isPinned);
        setIsArchived(!!fish.isArchived);
        setType(fish.type);
        setDirection(fish.userParams.direction ?? "auto");
        setCustomName(fish.customMotion?.name ?? "この魚のカスタム");
        setCustomCode(fish.customMotion?.code ?? DEFAULT_FISH_CUSTOM_CODE);
        setShowDeleteConfirm(false);
    }, [fish.id]);

    // デバウンス付き即時反映（スライダ高速操作時のAPI過負荷防止）
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const debouncedUpdate = (updates: Record<string, unknown>) => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            onUpdate(fish.id, updates);
        }, 120);
    };

    const handleType = (val: string) => {
        setType(val as FishType);
        onUpdate(fish.id, { type: val });
    };
    const handleScale = (val: number) => {
        setScale(val);
        debouncedUpdate({ scale: val });
    };
    const handleSpeed = (val: number) => {
        setSpeed(val);
        debouncedUpdate({ speed: val });
    };
    const handleOpacity = (val: number) => {
        setOpacity(val);
        debouncedUpdate({ opacity: val });
    };
    const handleFlipX = () => {
        const next = !flipX;
        setFlipX(next);
        onUpdate(fish.id, { flipX: next });
    };
    const handleDirection = (val: "auto" | "left" | "right") => {
        setDirection(val);
        onUpdate(fish.id, { direction: val });
    };
    const handleIsPinned = (val: boolean) => {
        setIsPinned(val);
        onUpdate(fish.id, { isPinned: val, pinnedLayerId: val ? pinnedLayerId : undefined });
    };
    const handlePinnedLayerId = (val: number) => {
        setPinnedLayerId(val);
        debouncedUpdate({ isPinned: true, pinnedLayerId: val });
    };
    const handleIsArchived = (val: boolean) => {
        setIsArchived(val);
        onUpdate(fish.id, { isArchived: val });
    };

    // クリーンアップ
    React.useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden">
                {/* ヘッダー */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                    <div className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 flex items-center justify-center flex-shrink-0">
                        <img src={fish.textureUrl} alt="fish" className="max-w-full max-h-full object-contain" style={{ transform: flipX ? "scaleX(-1)" : undefined }} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-mono text-slate-400 truncate">{fish.id}</div>
                        <div className="text-sm font-bold text-slate-800 truncate">{fish.author ?? "anonymous"}</div>
                        <div className="text-[10px] text-slate-400">レイヤー: {fish.layerIndex} {fish.isPinned && <span className="text-sky-500">固定中</span>}</div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* フォーム */}
                <div className="p-5 flex flex-col gap-5 overflow-y-auto">
                    <MotionPreview mode={type} />
                    {/* 動きタイプ */}
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">動きタイプ</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            {[
                                { val: "school", label: "横に移動" },
                                { val: "jellyfish", label: "浮遊主体" },
                                { val: "anchor", label: "固定" },
                                { val: "tuna", label: "高速" },
                                { val: "squid", label: "パルス" },
                                { val: "shark", label: "大きな弧" },
                                { val: "custom", label: "カスタム" },
                            ].map(({ val, label }) => (
                                <button
                                    key={val}
                                    onClick={() => handleType(val)}
                                    className={`text-xs py-1.5 px-2 rounded-lg border font-medium transition-all ${type === val ? "bg-sky-500 text-white border-sky-500 shadow-sm" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-sky-300 hover:bg-sky-50"}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* スライダー系 */}
                    <div className="grid grid-cols-3 gap-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">スケール <span className="font-mono text-sky-600">{scale.toFixed(2)}</span></label>
                            <input
                                type="range" min="0.1" max="3.0" step="0.05"
                                value={scale}
                                onChange={e => handleScale(Number(e.target.value))}
                                className="w-full accent-sky-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>0.1</span><span>1.0</span><span>3.0</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">速度 <span className="font-mono text-emerald-600">{speed.toFixed(2)}</span></label>
                            <input
                                type="range" min="0" max="5.0" step="0.05"
                                value={speed}
                                onChange={e => handleSpeed(Number(e.target.value))}
                                className="w-full accent-emerald-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>0</span><span>1.0</span><span>5.0</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">透明度 <span className="font-mono text-cyan-600">{Math.round(opacity * 100)}%</span></label>
                            <input
                                type="range" min="0" max="1" step="0.01"
                                value={opacity}
                                onChange={e => handleOpacity(Number(e.target.value))}
                                className="w-full accent-cyan-500"
                            />
                            <div className="flex justify-between text-[10px] text-slate-400">
                                <span>0</span><span>100</span>
                            </div>
                        </div>
                    </div>

                    {/* 数値入力 */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500 font-bold">大きさ（数値入力）</label>
                            <Input type="number" step="0.05" min="0.1" max="3.0"
                                value={scale}
                                onChange={e => handleScale(Number(e.target.value))}
                                className="h-8 text-xs text-right font-mono"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500 font-bold">速度（数値入力）</label>
                            <Input type="number" step="0.05" min="0" max="5.0"
                                value={speed}
                                onChange={e => handleSpeed(Number(e.target.value))}
                                className="h-8 text-xs text-right font-mono"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] text-slate-500 font-bold">透明度</label>
                            <Input type="number" step="0.01" min="0" max="1"
                                value={opacity}
                                onChange={e => handleOpacity(Number(e.target.value))}
                                className="h-8 text-xs text-right font-mono"
                            />
                        </div>
                    </div>

                    <Button variant="outline" onClick={handleFlipX} className="gap-1.5">
                        <FlipHorizontal2 className="h-4 w-4" />画像を左右反転
                    </Button>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">泳ぐ向き</label>
                        <div className="grid grid-cols-3 gap-1.5">
                            <div className={`text-center text-xs py-1.5 px-2 rounded-lg border font-medium ${direction === "auto" ? "bg-slate-100 text-slate-500 border-slate-300" : "bg-slate-50 text-slate-400 border-slate-200"}`}>自動</div>
                            {([
                                ["left", "← 左"],
                                ["right", "右 →"],
                            ] as const).map(([value, label]) => (
                                <button key={value} onClick={() => handleDirection(value)}
                                    className={`text-xs py-1.5 px-2 rounded-lg border font-medium ${direction === value ? "bg-sky-500 text-white border-sky-500" : "bg-slate-50 text-slate-600 border-slate-200"}`}>
                                    {label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {type === "custom" && (
                        <div className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                            <div className="flex items-center gap-2 text-sm font-bold text-slate-700"><Save className="h-4 w-4 text-slate-500" />この魚だけの動き</div>
                            <Input value={customName} onChange={event => setCustomName(event.target.value)} className="h-8 text-xs" />
                            <Textarea value={customCode} onChange={event => setCustomCode(event.target.value)} spellCheck={false} className="min-h-40 font-mono text-xs" />
                            <Button size="sm" onClick={() => onUpdate(fish.id, { customMotion: { name: customName.trim() || "この魚のカスタム", code: customCode } })}>保存</Button>
                        </div>
                    )}

                    {/* ピン留め */}
                    <div className="flex flex-col gap-2 bg-slate-50 rounded-xl p-3 border border-slate-100">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={isPinned}
                                onChange={e => handleIsPinned(e.target.checked)}
                                className="w-4 h-4 rounded text-sky-500"
                            />
                            <Pin className="w-4 h-4 text-sky-500" />
                            <span className="text-sm font-semibold text-slate-700">レイヤーにピン留め</span>
                        </label>
                        {isPinned && (
                            <div className="flex items-center gap-2 ml-6">
                                <label className="text-xs text-slate-500 w-16">レイヤー番号</label>
                                <Input
                                    type="number" min="0" max={layerCount - 1}
                                    value={pinnedLayerId}
                                    onChange={e => handlePinnedLayerId(Math.max(0, Math.min(Number(e.target.value), layerCount - 1)))}
                                    className="h-7 w-20 text-xs text-center font-mono border-sky-200 bg-sky-50/50"
                                />
                            </div>
                        )}
                    </div>

                    {/* アーカイブ */}
                    <label className="flex items-center gap-2 cursor-pointer bg-amber-50 rounded-xl p-3 border border-amber-100">
                        <input
                            type="checkbox"
                            checked={isArchived}
                            onChange={e => handleIsArchived(e.target.checked)}
                            className="w-4 h-4 rounded text-amber-500"
                        />
                        <Archive className="w-4 h-4 text-amber-500" />
                        <div>
                            <div className="text-sm font-semibold text-slate-700">アーカイブ（非表示）</div>
                            <div className="text-[10px] text-slate-400">水槽から隠しますが削除はしません</div>
                        </div>
                    </label>
                </div>

                {/* フッター */}
                <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50/50">
                    {showDeleteConfirm ? (
                        /* 削除確認 UI */
                        <>
                            <span className="text-sm text-red-600 font-semibold">🗑️ 本当に削除しますか?</span>
                            <Button
                                variant="ghost" size="sm"
                                className="text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                onClick={() => setShowDeleteConfirm(false)}
                            >
                                キャンセル
                            </Button>
                            <Button
                                size="sm"
                                className="bg-red-500 hover:bg-red-600 text-white gap-1"
                                onClick={() => { onDelete(fish.id); onClose(); }}
                            >
                                <Trash2 className="w-3.5 h-3.5" /> 削除する
                            </Button>
                        </>
                    ) : (
                        /* 通常アクション */
                        <>
                            <Button
                                variant="ghost" size="sm"
                                className="text-stone-500 hover:text-stone-700 hover:bg-stone-100 gap-1.5"
                                onClick={() => { onDuplicate(fish.id); onClose(); }}
                            >
                                <CopyPlus className="w-4 h-4" /> 複製
                            </Button>
                            <Button
                                variant="ghost" size="sm"
                                className="text-red-500 hover:text-red-600 hover:bg-red-50 gap-1.5"
                                onClick={() => setShowDeleteConfirm(true)}
                            >
                                <Trash2 className="w-4 h-4" /> 削除
                            </Button>
                            <Button
                                variant="outline"
                                className="ml-auto px-6"
                                onClick={onClose}
                            >
                                閉じる
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div >
    );
}

export function FishTab({ activeFish, fishLayers, fishScaleMultiplier, onRefresh }: FishTabProps) {
    const [selectedFish, setSelectedFish] = useState<ActiveFish | null>(null);
    const [showBulk, setShowBulk] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [bulkScaleMultiplier, setBulkScaleMultiplier] = useState(fishScaleMultiplier);
    const bulkTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const importFish = async (files: FileList | null) => {
        if (!files?.length) return;
        setIsImporting(true);
        const form = new FormData();
        Array.from(files).forEach(file => form.append("files", file));
        try {
            await api.request("/api/fish/import", { method: "POST", body: form });
            onRefresh();
        } finally {
            setIsImporting(false);
        }
    };

    const exportFish = async () => {
        const response = await api.request("/api/fish/export");
        const blob = await response.blob();
        const now = new Date();
        const stamp = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-")
            + `-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `お絵描き水族館-${stamp}.zip`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const updateFishLayers = async (layers: LayerConfig[]) => {
        await api.request("/api/fish-layers", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ layers }),
        });
        onRefresh();
    };

    const updateFish = async (id: string, updates: Record<string, unknown>) => {
        await api.request(`/api/fish/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updates),
        });
        onRefresh();
    };

    const duplicateFish = async (id: string) => {
        await api.request(`/api/fish/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
        onRefresh();
    };

    const deleteFish = async (id: string) => {
        await api.request(`/api/fish/${encodeURIComponent(id)}`, { method: "DELETE" });
        onRefresh();
    };

    React.useEffect(() => setBulkScaleMultiplier(fishScaleMultiplier), [fishScaleMultiplier]);

    React.useEffect(() => {
        if (!showBulk) return;
        if (bulkTimer.current) clearTimeout(bulkTimer.current);
        bulkTimer.current = setTimeout(async () => {
            const response = await api.request("/api/fish-scale-multiplier", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ value: bulkScaleMultiplier }),
            });
            if (response.ok) onRefresh();
        }, 150);
        return () => { if (bulkTimer.current) clearTimeout(bulkTimer.current); };
    }, [bulkScaleMultiplier, showBulk]);

    return (
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 flex flex-col gap-6">
            <PageHeader
                title="魚"
                description={`登録済み ${activeFish.length}匹。表示中の魚を確認し、必要に応じて編集します。`}
                actions={
                    <>
                    <Button variant="outline" onClick={() => setShowBulk(true)} className="bg-white gap-1.5"><Gauge className="h-4 w-4" />一括調整</Button>
                    <Button variant="outline" className="relative bg-white gap-1.5" disabled={isImporting}>
                        <Upload className="h-4 w-4" />{isImporting ? "インポート中" : "画像・zipをインポート"}
                        <input type="file" multiple accept="image/png,image/jpeg,image/webp,.zip" className="absolute inset-0 cursor-pointer opacity-0" onChange={event => void importFish(event.target.files)} />
                    </Button>
                    <Button variant="outline" className="relative bg-white gap-1.5">
                        <Upload className="h-4 w-4" />フォルダをインポート
                        <input type="file" multiple className="absolute inset-0 cursor-pointer opacity-0" {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={event => void importFish(event.target.files)} />
                    </Button>
                    <Button variant="outline" onClick={() => void exportFish()} className="bg-white gap-1.5"><Download className="h-4 w-4" />エクスポート</Button>
                    <Button
                        variant="outline"
                        onClick={async () => {
                            await api.request("/api/fish/redistribute", { method: "POST" });
                        }}
                        className="bg-white gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        title="worldサイズ変更後に魚が偏った場合、全体に再均等配置します"
                    >
                        <Shuffle className="h-4 w-4" /> 全魚を再配置
                    </Button>

                    </>
                }
            />

            {/* --- レイヤー所属状況の視覚化 --- */}
            <LayerOccupancySection activeFish={activeFish} configs={fishLayers} onUpdate={layers => void updateFishLayers(layers)} />

            <FishTable
                activeFish={activeFish}
                onEdit={setSelectedFish}
                onDuplicate={duplicateFish}
                onDelete={deleteFish}
            />
            {activeFish.length === 0 && (
                <div className="text-slate-400 text-center py-12">現在水槽に魚はいません</div>
            )}

            {/* --- 魚コンフィグポップアップ --- */}
            {selectedFish && (
                <FishConfigPopup
                    fish={selectedFish}
                    onUpdate={updateFish}
                    onDelete={deleteFish}
                    onDuplicate={duplicateFish}
                    onClose={() => setSelectedFish(null)}
                    layerCount={fishLayers.length}
                />
            )}
            {showBulk && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={event => { if (event.target === event.currentTarget) setShowBulk(false); }}>
                    <div className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-2xl">
                        <BulkMultiplierSection scale={bulkScaleMultiplier} onScaleChange={setBulkScaleMultiplier} />
                        <div className="mt-4 flex justify-end"><Button variant="outline" onClick={() => setShowBulk(false)}>閉じる</Button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
