import type { ActiveFish } from "@aquarium/shared";
import { LAYER_CONFIG } from "@aquarium/shared";

export function LayerOccupancySection({ activeFish }: { activeFish: ActiveFish[] }) {
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-bold text-slate-700 mb-3">レイヤーの混雑状況 (自動押し出し)</h3>
            <div className="flex flex-col gap-3">
                {LAYER_CONFIG.map((conf, idx) => {
                    const count = activeFish.filter(f => !f.isPinned && f.layerIndex === idx && !f.isArchived).length;
                    const ratio = Math.min(count / conf.maxCount, 1);
                    const isFull = count >= conf.maxCount;
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
                                {count}/{conf.maxCount}
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="mt-3 text-[10px] text-slate-400 leading-snug">
                ※最前面(Lyr0)がいっぱいになると、順次奥のレイヤーへ押し出されます。ピン留めされた魚は定員({LAYER_CONFIG.reduce((acc, conf) => acc + conf.maxCount, 0)}匹)から除外されます。
            </div>
        </div>
    );
}
