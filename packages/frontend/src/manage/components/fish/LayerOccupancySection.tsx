import type { ActiveFish, LayerConfig } from "@aquarium/shared";
import { useState } from "react";
import { LAYER_CONFIG } from "@aquarium/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ChevronDown, EyeOff, Plus, Wand2 } from "lucide-react";
import { getLayerColor } from "./layer-colors";

export function LayerOccupancySection({ activeFish, configs = LAYER_CONFIG, compact = false, onUpdate }: { activeFish: ActiveFish[]; configs?: LayerConfig[]; compact?: boolean; onUpdate?: (configs: LayerConfig[]) => void }) {
    const [collapsed, setCollapsed] = useState(false);
    const visibleCount = activeFish.filter(fish => !fish.isArchived && !fish.isAutoHidden).length;
    const capacity = configs.reduce((acc, conf) => acc + conf.maxCount, 0);
    const autoTunePerspective = () => {
        if (!onUpdate) return;
        const denominator = Math.max(1, configs.length - 1);
        onUpdate(configs.map((layer, idx) => {
            const t = idx / denominator;
            return {
                ...layer,
                scale: Number((1 - t * 0.65).toFixed(2)),
                opacity: Number((1 - t * 0.58).toFixed(2)),
                speedFactor: Number((1 - t * 0.72).toFixed(2)),
                zIndex: Math.max(0, 100 - idx * 30),
            };
        }));
    };

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="mb-3 flex items-center justify-between gap-3">
                <button type="button" className="flex items-center gap-2 text-left" onClick={() => setCollapsed(value => !value)}>
                    <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                    <div>
                        <h3 className="text-sm font-bold text-slate-700">レイヤー</h3>
                        <div className="text-[10px] font-medium text-slate-400">{visibleCount}/{capacity}匹 表示中</div>
                    </div>
                </button>
                {onUpdate && <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={autoTunePerspective}><Wand2 className="mr-1 h-4 w-4" />遠近感を自動設定</Button>
                    <Button variant="outline" size="sm" onClick={() => onUpdate([...configs, { id: configs.length, maxCount: 20, scale: 0.5, opacity: 0.7, speedFactor: 0.5, zIndex: Math.max(0, 100 - configs.length * 30) }])}><Plus className="mr-1 h-4 w-4" />追加</Button>
                </div>}
            </div>
            {collapsed ? (
                <div className="h-2.5 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                    <div className="h-full bg-sky-500" style={{ width: `${capacity ? Math.min(visibleCount / capacity, 1) * 100 : 0}%` }} />
                </div>
            ) : <>
            <div className="flex flex-col gap-3">
                {configs.map((conf, idx) => {
                    const count = activeFish.filter(f => !f.isPinned && f.layerIndex === idx && !f.isArchived && !f.isAutoHidden).length;
                    const ratio = Math.min(count / conf.maxCount, 1);
                    const layerColor = getLayerColor(idx, configs.length);
                    return (
                        <div key={conf.id} className={`flex items-center gap-3 ${onUpdate ? "rounded-lg border border-slate-100 bg-slate-50 p-3" : ""}`}>
                            <div className="flex w-20 items-center justify-end gap-2 text-[11px] font-bold text-slate-500 mt-0.5">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ background: layerColor }} />
                                <span>Lyr {conf.id}</span>
                            </div>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative border border-slate-200 outline outline-1 outline-white mt-1">
                                <div
                                    className="absolute top-0 left-0 h-full transition-all duration-300"
                                    style={{ width: `${ratio * 100}%`, background: layerColor }}
                                />
                            </div>
                            <div className="w-12 text-xs font-mono text-right mt-0.5 text-slate-500">
                                {count}/{conf.maxCount}
                            </div>
                            {onUpdate && <>
                                <label className="w-20 text-[10px] font-bold text-slate-500">定員<Input className="mt-1 h-7 bg-white text-xs" type="number" min={1} value={conf.maxCount} onChange={event => onUpdate(configs.map((item, i) => i === idx ? { ...item, maxCount: Number(event.target.value) || 1 } : item))} /></label>
                                <div className="w-44"><div className="mb-1 flex justify-between text-[10px] font-bold text-slate-500"><span>大きさ</span><span>×{conf.scale.toFixed(2)}</span></div><Slider value={[conf.scale]} min={0.1} max={5} step={0.05} onValueChange={value => onUpdate(configs.map((item, i) => i === idx ? { ...item, scale: value[0] } : item))} /></div>
                                <div className="w-44"><div className="mb-1 flex justify-between text-[10px] font-bold text-slate-500"><span>明るさ</span><span>{Math.round(conf.opacity * 100)}%</span></div><Slider value={[conf.opacity]} min={0.18} max={1} step={0.01} onValueChange={value => onUpdate(configs.map((item, i) => i === idx ? { ...item, opacity: value[0] } : item))} /></div>
                                <div className="w-44"><div className="mb-1 flex justify-between text-[10px] font-bold text-slate-500"><span>速度</span><span>×{conf.speedFactor.toFixed(2)}</span></div><Slider value={[conf.speedFactor]} min={0.05} max={3} step={0.05} onValueChange={value => onUpdate(configs.map((item, i) => i === idx ? { ...item, speedFactor: value[0] } : item))} /></div>
                                {configs.length > 1 && <button className="text-[10px] font-bold text-rose-500" onClick={() => onUpdate(configs.filter((_, i) => i !== idx))}>削除</button>}
                            </>}
                        </div>
                    );
                })}
                <div className={`flex items-center gap-3 ${onUpdate ? "rounded-lg border border-slate-100 bg-slate-50 p-3" : ""}`}>
                    <div className="flex w-20 items-center justify-end gap-2 text-[11px] font-bold text-slate-500">
                        <EyeOff className="h-3.5 w-3.5" />
                        <span>非表示</span>
                    </div>
                    <div className="flex-1 h-2.5 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
                        <div className="h-full bg-slate-400" style={{ width: `${activeFish.length ? (activeFish.filter(f => f.isArchived || f.isAutoHidden).length / activeFish.length) * 100 : 0}%` }} />
                    </div>
                    <div className="w-12 text-right font-mono text-xs text-slate-500">{activeFish.filter(f => f.isArchived || f.isAutoHidden).length}</div>
                    {onUpdate && <div className="w-[24rem] text-[10px] leading-snug text-slate-400">アーカイブ済み、またはレイヤー定員を超えた魚をここに表示します。</div>}
                </div>
            </div>
            {!compact && <div className="mt-3 text-[10px] text-slate-400 leading-snug">
                ※放流が新しい魚から Lyr0 に入り、いっぱいになると奥のレイヤーへ送られます。明るさを下げると、そのレイヤーの魚だけが遠くにいるように暗くなります。
            </div>}
            </>}
        </div>
    );
}
