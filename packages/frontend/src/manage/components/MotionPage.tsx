import type { MotionSettings } from "@aquarium/shared";
import { PageHeader } from "./PageHeader";
import { Slider } from "@/components/ui/slider";

export function MotionPage({ settings, onChange }: { settings: MotionSettings; onChange: (settings: MotionSettings) => void }) {
    return <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
        <div className="mx-auto flex max-w-4xl flex-col gap-7">
            <PageHeader title="魚の動き" description="水槽内を周遊する魚の動き方を調整します。" />
            <SettingCard title="縦方向の散らばり" description="大きくすると、魚が水槽の上部から下部まで広く泳ぎます。" value={settings.verticalSpread} onChange={verticalSpread => onChange({ ...settings, verticalSpread })} />
            <SettingCard title="旋回の強さ" description="大きくすると、魚が進行方向を変える頻度と強さが増えます。" value={settings.turnStrength} onChange={turnStrength => onChange({ ...settings, turnStrength })} />
        </div>
    </div>;
}

function SettingCard({ title, description, value, onChange }: { title: string; description: string; value: number; onChange: (value: number) => void }) {
    return <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div><span className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm font-bold">×{value.toFixed(2)}</span></div>
        <Slider className="mt-6" value={[value]} min={0.2} max={2} step={0.05} onValueChange={next => onChange(next[0])} />
    </section>;
}
