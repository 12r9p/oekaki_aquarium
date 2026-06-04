import { Gauge } from "lucide-react";
import { Input } from "@/components/ui/input";

function BulkMultiplierSlider({
    label,
    value,
    onChange,
    accentClass,
}: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    accentClass: string;
}) {
    const setClampedValue = (next: number) => onChange(Math.max(0.1, Math.min(next, 3)));
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-600">{label}</label>
                <div className="flex items-center gap-1">
                    <span className="text-xs text-slate-400">×</span>
                    <Input
                        type="number"
                        min="0.1"
                        max="3"
                        step="0.05"
                        value={value}
                        onChange={event => setClampedValue(Number(event.target.value) || 1)}
                        className="h-7 w-20 text-right text-xs font-mono"
                    />
                </div>
            </div>
            <input
                type="range"
                min="0.1"
                max="3"
                step="0.05"
                value={value}
                onChange={event => setClampedValue(Number(event.target.value))}
                className={`w-full ${accentClass}`}
            />
            <div className="flex justify-between text-[10px] text-slate-400">
                <span>×0.1</span><span>×1.0</span><span>×3.0</span>
            </div>
        </div>
    );
}

export function BulkMultiplierSection({
    scale,
    speed,
    onScaleChange,
    onSpeedChange,
}: {
    scale: number;
    speed: number;
    onScaleChange: (value: number) => void;
    onSpeedChange: (value: number) => void;
}) {
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Gauge className="w-4 h-4 text-sky-500" />
                    <h3 className="text-sm font-bold text-slate-700">全魚の速度・スケールを一括調整</h3>
                </div>
                <span className="text-xs font-semibold text-emerald-600">変更は自動反映</span>
            </div>
            <div className="grid grid-cols-2 gap-6">
                <BulkMultiplierSlider label="スケール倍率" value={scale} onChange={onScaleChange} accentClass="accent-sky-500" />
                <BulkMultiplierSlider label="速度倍率" value={speed} onChange={onSpeedChange} accentClass="accent-emerald-500" />
            </div>
            <p className="mt-3 text-[10px] text-slate-400">倍率を動かすと、全魚の現在値へ差分が随時反映されます。</p>
        </div>
    );
}
