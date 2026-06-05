import { Gauge } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

function GlobalScaleControl({
    value,
    onChange,
}: {
    value: number;
    onChange: (value: number) => void;
}) {
    const setClampedValue = (next: number) => onChange(Math.max(0.1, Math.min(next, 5)));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-600">全体表示倍率</label>
                <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">×</span>
                    <Input
                        type="number"
                        min="0.1"
                        max="5"
                        step="0.05"
                        value={value}
                        onChange={event => setClampedValue(Number(event.target.value) || 1)}
                        className="h-7 w-20 text-right text-xs font-mono"
                    />
                </div>
            </div>
            <Slider value={[value]} min={0.1} max={5} step={0.05} onValueChange={next => setClampedValue(next[0] ?? 1)} />
            <div className="flex justify-between text-[10px] text-slate-400">
                <span>×0.1</span><span>現状相当 ×1.0</span><span>×5.0</span>
            </div>
        </div>
    );
}

export function BulkMultiplierSection({
    scale,
    onScaleChange,
}: {
    scale: number;
    onScaleChange: (value: number) => void;
}) {
    return (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-sky-500" />
                    <h3 className="text-sm font-bold text-slate-700">魚の全体表示倍率</h3>
                </div>
            </div>
            <GlobalScaleControl value={scale} onChange={onScaleChange} />
            <p className="mt-3 text-[10px] leading-snug text-slate-400">
                個別の魚サイズは変更せず、描画時に全体倍率として掛けます。UI上の ×1.0 は従来の ×3.0 相当です。
            </p>
        </div>
    );
}
