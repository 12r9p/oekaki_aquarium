import type { FishType, MotionSettings, MotionTypeProfile } from "@aquarium/shared";
import { PageHeader } from "./PageHeader";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Code2, RotateCcw } from "lucide-react";

const FISH_TYPES: Array<{ type: FishType; label: string; description: string }> = [
    { type: "tuna", label: "マグロ", description: "高速直線往復" },
    { type: "school", label: "群れ", description: "Boids で集団回遊" },
    { type: "squid", label: "イカ", description: "休止とパルス推進" },
    { type: "jellyfish", label: "クラゲ", description: "上下浮遊と横流れ" },
    { type: "shark", label: "サメ", description: "大きな弧で単独回遊" },
    { type: "anchor", label: "固定", description: "床や背景に固定" },
];

const DEFAULT_PROFILE: MotionTypeProfile = {
    speedMultiplier: 1,
    verticalSpread: 1,
    turnStrength: 1,
};

const DEFAULT_CUSTOM_CODE = `// 将来のカスタム泳ぎ定義用です。現在は保存のみで実行されません。
// 入力例:
// export function update(fish, t, api) {
//   fish.vel.x += Math.sin(t * 0.01) * 0.2;
//   fish.vel.y += Math.cos(t * 0.02) * 0.1;
// }`;

export function MotionPage({ settings, onChange }: { settings: MotionSettings; onChange: (settings: MotionSettings) => void }) {
    const updateProfile = (type: FishType, patch: Partial<MotionTypeProfile>) => {
        const current = settings.typeProfiles?.[type] ?? DEFAULT_PROFILE;
        onChange({
            ...settings,
            typeProfiles: {
                ...(settings.typeProfiles ?? {}),
                [type]: { ...current, ...patch },
            },
        });
    };

    const resetProfile = (type: FishType) => {
        const next = { ...(settings.typeProfiles ?? {}) };
        delete next[type];
        onChange({ ...settings, typeProfiles: next });
    };

    return (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-7">
                <PageHeader title="魚の動き" description="全体の泳ぎ方と、魚種ごとの動き倍率を調整します。" />

                <Tabs defaultValue="global" className="w-full">
                    <TabsList>
                        <TabsTrigger value="global">全体</TabsTrigger>
                        <TabsTrigger value="types">魚種ごと</TabsTrigger>
                        <TabsTrigger value="custom">カスタム</TabsTrigger>
                    </TabsList>

                    <TabsContent value="global" className="mt-5 grid gap-5 md:grid-cols-2">
                        <SettingCard title="縦方向の散らばり" description="大きくすると、魚が水槽の上部から下部まで広く泳ぎます。" value={settings.verticalSpread} min={0.2} max={2} onChange={verticalSpread => onChange({ ...settings, verticalSpread })} />
                        <SettingCard title="旋回の強さ" description="大きくすると、魚が進行方向を変える頻度と強さが増えます。" value={settings.turnStrength} min={0.2} max={2} onChange={turnStrength => onChange({ ...settings, turnStrength })} />
                    </TabsContent>

                    <TabsContent value="types" className="mt-5 grid gap-4 lg:grid-cols-2">
                        {FISH_TYPES.map(({ type, label, description }) => {
                            const profile = settings.typeProfiles?.[type] ?? DEFAULT_PROFILE;
                            return (
                                <section key={type} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="mb-5 flex items-start justify-between gap-4">
                                        <div>
                                            <h2 className="font-bold text-slate-900">{label}</h2>
                                            <p className="mt-1 text-xs text-slate-500">{description}</p>
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => resetProfile(type)} className="gap-1.5 text-slate-500">
                                            <RotateCcw className="h-3.5 w-3.5" />リセット
                                        </Button>
                                    </div>
                                    <div className="grid gap-5">
                                        <SettingRow label="速度" value={profile.speedMultiplier} min={0.1} max={5} onChange={speedMultiplier => updateProfile(type, { speedMultiplier })} />
                                        <SettingRow label="縦幅" value={profile.verticalSpread} min={0.1} max={5} onChange={verticalSpread => updateProfile(type, { verticalSpread })} />
                                        <SettingRow label="旋回" value={profile.turnStrength} min={0.1} max={5} onChange={turnStrength => updateProfile(type, { turnStrength })} />
                                    </div>
                                </section>
                            );
                        })}
                    </TabsContent>

                    <TabsContent value="custom" className="mt-5">
                        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                            <div className="mb-4 flex items-start gap-3">
                                <div className="rounded-md bg-slate-100 p-2 text-slate-700"><Code2 className="h-4 w-4" /></div>
                                <div>
                                    <h2 className="font-bold text-slate-900">カスタム泳ぎコード</h2>
                                    <p className="mt-1 text-xs leading-5 text-slate-500">ここに動き定義を保存できます。安全な実行環境は未接続なので、現在は実行されません。</p>
                                </div>
                            </div>
                            <Textarea
                                value={settings.customCode ?? DEFAULT_CUSTOM_CODE}
                                onChange={event => onChange({ ...settings, customCode: event.target.value })}
                                spellCheck={false}
                                className="min-h-[280px] font-mono text-xs"
                            />
                        </section>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}

function SettingCard({ title, description, value, min, max, onChange }: { title: string; description: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
    return <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-5"><div><h2 className="font-bold text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-500">{description}</p></div><span className="rounded-md bg-slate-100 px-3 py-2 font-mono text-sm font-bold">x{value.toFixed(2)}</span></div>
        <Slider className="mt-6" value={[value]} min={min} max={max} step={0.05} onValueChange={next => onChange(next[0] ?? 1)} />
    </section>;
}

function SettingRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
    return <div>
        <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
            <span>{label}</span>
            <span className="font-mono text-slate-700">x{value.toFixed(2)}</span>
        </div>
        <Slider value={[value]} min={min} max={max} step={0.05} onValueChange={next => onChange(next[0] ?? 1)} />
    </div>;
}
