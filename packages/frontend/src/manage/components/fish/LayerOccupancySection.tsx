import type { ActiveFish, LayerConfig } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Plus } from "lucide-react";

export function LayerOccupancySection({ activeFish, configs = LAYER_CONFIG, compact = false, onUpdate }: { activeFish: ActiveFish[]; configs?: LayerConfig[]; compact?: boolean; onUpdate?: (configs: LayerConfig[]) => void }) {
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-700">レイヤー</h3>{onUpdate && <Button variant="outline" size="sm" onClick={() => onUpdate([...configs, { id: configs.length, maxCount: 20, scale: 0.5, opacity: 0.7, speedFactor: 0.5, zIndex: Math.max(0, 100 - configs.length * 30) }])}><Plus className="mr-1 h-4 w-4" />追加</Button>}</div>
            <div className="flex flex-col gap-3">
                {configs.map((conf, idx) => {
                    const count = activeFish.filter(f => !f.isPinned && f.layerIndex === idx && !f.isArchived).length;
                    const ratio = Math.min(count / conf.maxCount, 1);
                    const isFull = count >= conf.maxCount;
                    return (
                        <div key={conf.id} className={`flex items-center gap-3 ${onUpdate ? "rounded-lg border border-slate-100 bg-slate-50 p-3" : ""}`}>
                            <div className="w-16 text-[11px] font-bold text-slate-500 text-right mt-0.5">Lyr {conf.id}</div>
                            <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden relative border border-slate-200 outline outline-1 outline-white mt-1">
                                <div
                                    className={`absolute top-0 left-0 h-full transition-all duration-300 ${isFull ? "bg-amber-400" : "bg-emerald-400"}`}
                                    style={{ width: `${ratio * 100}%` }}
                                />
                            </div>
                            <div className={`w-12 text-xs font-mono text-right mt-0.5 ${isFull ? "text-amber-600 font-bold" : "text-slate-500"}`}>
                                {count}/{conf.maxCount}
                            </div>
                            {onUpdate && <>
                                <label className="w-20 text-[10px] font-bold text-slate-500">定員<Input className="mt-1 h-7 bg-white text-xs" type="number" min={1} value={conf.maxCount} onChange={event => onUpdate(configs.map((item, i) => i === idx ? { ...item, maxCount: Number(event.target.value) || 1 } : item))} /></label>
                                <div className="w-44"><div className="mb-1 flex justify-between text-[10px] font-bold text-slate-500"><span>速度</span><span>×{conf.speedFactor.toFixed(2)}</span></div><Slider value={[conf.speedFactor]} min={0.05} max={3} step={0.05} onValueChange={value => onUpdate(configs.map((item, i) => i === idx ? { ...item, speedFactor: value[0] } : item))} /></div>
                                {configs.length > 1 && <button className="text-[10px] font-bold text-rose-500" onClick={() => onUpdate(configs.filter((_, i) => i !== idx))}>削除</button>}
                            </>}
                        </div>
                    );
                })}
            </div>
            {!compact && <div className="mt-3 text-[10px] text-slate-400 leading-snug">
                ※最前面(Lyr0)がいっぱいになると、順次奥のレイヤーへ押し出されます。ピン留めされた魚は定員({configs.reduce((acc, conf) => acc + conf.maxCount, 0)}匹)から除外されます。
            </div>}
        </div>
    );
}
