import React from "react";
import type { FishType, MotionCustomPreset, MotionSettings, MotionTypeProfile } from "@aquarium/shared";
import { ClipboardCopy, Code2, Plus, RotateCcw, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "./PageHeader";

const FISH_TYPES: Array<{ type: FishType; label: string; description: string }> = [
    { type: "tuna", label: "マグロ", description: "高速直線往復" },
    { type: "school", label: "群れ", description: "Boids で集団回遊" },
    { type: "squid", label: "イカ", description: "休止とパルス推進" },
    { type: "jellyfish", label: "クラゲ", description: "上下浮遊と横流れ" },
    { type: "shark", label: "サメ", description: "大きな弧で単独回遊" },
    { type: "anchor", label: "固定", description: "その場に留まる" },
    { type: "custom", label: "カスタム", description: "保存したコードを適用" },
];

const DEFAULT_PROFILE: MotionTypeProfile = {
    speedMultiplier: 1,
    verticalSpread: 1,
    turnStrength: 1,
    tailBeat: 1,
    glide: 1,
};

const DEFAULT_CUSTOM_CODE = `function update(fish, t, api) {
  const state = fish.__custom ??= {
    dir: api.noise(1) < 0.5 ? -1 : 1,
    baseY: fish.physics.pos.y,
    phase: api.noise(2) * Math.PI * 2,
  };

  const margin = 120;
  if (fish.physics.pos.x > api.world.width - margin) state.dir = -1;
  if (fish.physics.pos.x < margin) state.dir = 1;

  state.phase += 0.045 * api.speed;
  const cruise = 2.4 * api.speed * state.dir;
  const targetY = state.baseY + Math.sin(state.phase * 0.55) * 70 * api.verticalSpread;

  fish.physics.vel.x = api.lerp(fish.physics.vel.x, cruise, 0.08);
  fish.physics.vel.y = api.lerp(fish.physics.vel.y, (targetY - fish.physics.pos.y) * 0.035, 0.12);
  fish.physics.pos.x += fish.physics.vel.x;
  fish.physics.pos.y += fish.physics.vel.y;
}`;

const CUSTOM_CODE_GUIDE = `お絵描き水族館の管理者用カスタム泳ぎコード仕様:
- function update(fish, t, api) または export function update(fish, t, api) を定義します。
- fish.physics.pos.x / y が現在位置、fish.physics.vel.x / y が速度です。
- api.world.width / height で水槽サイズを取得できます。
- api.speed, api.verticalSpread, api.turnStrength が管理画面と魚ごとの倍率です。
- api.clamp, api.lerp, api.noise, api.sin, api.cos が使えます。`;

type MotionSelection =
    | { kind: "global"; key: "verticalSpread" | "turnStrength"; title: string; description: string }
    | { kind: "type"; type: FishType; title: string; description: string }
    | { kind: "custom"; id: string; title: string; description: string };

export function MotionPage({ settings, onChange }: { settings: MotionSettings; onChange: (settings: MotionSettings) => void }) {
    const [selection, setSelection] = React.useState<MotionSelection | null>(null);
    const customPresets = normalizedCustomPresets(settings);

    const updateProfile = (type: FishType, patch: Partial<MotionTypeProfile>) => {
        const current = { ...DEFAULT_PROFILE, ...(settings.typeProfiles?.[type] ?? {}) };
        onChange({
            ...settings,
            typeProfiles: { ...(settings.typeProfiles ?? {}), [type]: { ...current, ...patch } },
        });
    };

    const saveCustomPreset = (preset: MotionCustomPreset) => {
        const nextPresets = customPresets.some(item => item.id === preset.id)
            ? customPresets.map(item => item.id === preset.id ? preset : item)
            : [...customPresets, preset];
        onChange({ ...settings, customPresets: nextPresets, currentCustomPresetId: preset.id, customCode: preset.code });
    };

    const addCustomPreset = () => {
        const id = `custom_${Date.now()}`;
        const preset = { id, name: `カスタム ${customPresets.length + 1}`, code: settings.customCode ?? DEFAULT_CUSTOM_CODE };
        saveCustomPreset(preset);
        setSelection({ kind: "custom", id, title: preset.name, description: "名前をつけて保存したカスタム泳ぎ" });
    };

    return (
        <div className="flex-1 overflow-y-auto bg-slate-50 p-8">
            <div className="mx-auto flex max-w-6xl flex-col gap-7">
                <PageHeader title="魚の動き" description="全体、魚種ごと、名前付きカスタムをカードから編集します。" />

                <MotionSection title="全体">
                    <MotionCard title="縦方向の散らばり" description="上から下まで泳ぐ広がりを調整" preview="float" onClick={() => setSelection({ kind: "global", key: "verticalSpread", title: "縦方向の散らばり", description: "大きくすると水槽全体に広く散らばります。" })} />
                    <MotionCard title="旋回の強さ" description="方向転換の頻度と強さを調整" preview="turn" onClick={() => setSelection({ kind: "global", key: "turnStrength", title: "旋回の強さ", description: "大きくすると向きを変える動きが強くなります。" })} />
                </MotionSection>

                <MotionSection title="魚種ごと">
                    {FISH_TYPES.map(item => (
                        <MotionCard key={item.type} title={item.label} description={item.description} preview={item.type} onClick={() => setSelection({ kind: "type", type: item.type, title: item.label, description: item.description })} />
                    ))}
                </MotionSection>

                <MotionSection title="カスタム" action={<Button variant="outline" size="sm" onClick={addCustomPreset} className="gap-1.5"><Plus className="h-4 w-4" />追加</Button>}>
                    {customPresets.map(preset => (
                        <MotionCard key={preset.id} title={preset.name} description="名前をつけて保存したカスタム泳ぎ" preview="custom" onClick={() => setSelection({ kind: "custom", id: preset.id, title: preset.name, description: "名前をつけて保存したカスタム泳ぎ" })} />
                    ))}
                    {customPresets.length === 0 && (
                        <button type="button" onClick={addCustomPreset} className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-left text-sm font-bold text-slate-500 hover:border-sky-300 hover:text-sky-700">
                            カスタム泳ぎを追加
                        </button>
                    )}
                </MotionSection>

                <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                            <h2 className="font-bold text-slate-900">AIに渡す説明文</h2>
                            <p className="mt-1 text-xs leading-5 text-slate-500">カスタム泳ぎを作るときにコピーします。</p>
                        </div>
                        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(CUSTOM_CODE_GUIDE)} className="gap-1.5">
                            <ClipboardCopy className="h-4 w-4" />コピー
                        </Button>
                    </div>
                    <pre className="max-h-44 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{CUSTOM_CODE_GUIDE}</pre>
                </section>
            </div>
            {selection && (
                <MotionDialog
                    selection={selection}
                    settings={settings}
                    customPresets={customPresets}
                    onClose={() => setSelection(null)}
                    onChange={onChange}
                    onUpdateProfile={updateProfile}
                    onSaveCustom={saveCustomPreset}
                    onDeleteCustom={id => {
                        const next = customPresets.filter(preset => preset.id !== id);
                        onChange({ ...settings, customPresets: next, currentCustomPresetId: next[0]?.id, customCode: next[0]?.code });
                        setSelection(null);
                    }}
                />
            )}
        </div>
    );
}

function MotionSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return <section className="flex flex-col gap-3"><div className="flex items-center justify-between"><h2 className="text-sm font-bold text-slate-700">{title}</h2>{action}</div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{children}</div></section>;
}

function MotionCard({ title, description, preview, onClick }: { title: string; description: string; preview: string; onClick: () => void }) {
    return <button type="button" onClick={onClick} className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-sky-300 hover:shadow">
        <MotionPreview mode={preview} />
        <h3 className="mt-3 font-bold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
    </button>;
}

function MotionDialog({ selection, settings, customPresets, onClose, onChange, onUpdateProfile, onSaveCustom, onDeleteCustom }: {
    selection: MotionSelection;
    settings: MotionSettings;
    customPresets: MotionCustomPreset[];
    onClose: () => void;
    onChange: (settings: MotionSettings) => void;
    onUpdateProfile: (type: FishType, patch: Partial<MotionTypeProfile>) => void;
    onSaveCustom: (preset: MotionCustomPreset) => void;
    onDeleteCustom: (id: string) => void;
}) {
    const preset = selection.kind === "custom" ? customPresets.find(item => item.id === selection.id) : undefined;
    const [customName, setCustomName] = React.useState(preset?.name ?? "カスタム");
    const [customCode, setCustomCode] = React.useState(preset?.code ?? settings.customCode ?? DEFAULT_CUSTOM_CODE);
    const profile = selection.kind === "type" ? { ...DEFAULT_PROFILE, ...(settings.typeProfiles?.[selection.type] ?? {}) } : DEFAULT_PROFILE;

    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
                <div><h2 className="font-bold text-slate-900">{selection.title}</h2><p className="mt-1 text-xs text-slate-500">{selection.description}</p></div>
                <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
            </div>
            <div className="grid gap-5 overflow-y-auto p-5 md:grid-cols-[260px_1fr]">
                <MotionPreview mode={selection.kind === "type" ? selection.type : selection.kind} large />
                <div className="flex flex-col gap-5">
                    {selection.kind === "global" && (
                        <SettingRow label={selection.title} value={settings[selection.key]} min={0.2} max={2} onChange={value => onChange({ ...settings, [selection.key]: value })} />
                    )}
                    {selection.kind === "type" && (
                        <>
                            <SettingRow label="速度" value={profile.speedMultiplier} min={0.1} max={5} onChange={speedMultiplier => onUpdateProfile(selection.type, { speedMultiplier })} />
                            <SettingRow label="縦幅" value={profile.verticalSpread} min={0.1} max={5} onChange={verticalSpread => onUpdateProfile(selection.type, { verticalSpread })} />
                            <SettingRow label="旋回" value={profile.turnStrength} min={0.1} max={5} onChange={turnStrength => onUpdateProfile(selection.type, { turnStrength })} />
                            <SettingRow label="尾振り" value={profile.tailBeat} min={0.1} max={5} onChange={tailBeat => onUpdateProfile(selection.type, { tailBeat })} />
                            <SettingRow label="滑走" value={profile.glide} min={0.1} max={5} onChange={glide => onUpdateProfile(selection.type, { glide })} />
                        </>
                    )}
                    {selection.kind === "custom" && (
                        <>
                            <label className="grid gap-1.5 text-xs font-bold text-slate-600">名前<Input value={customName} onChange={event => setCustomName(event.target.value)} /></label>
                            <label className="grid gap-1.5 text-xs font-bold text-slate-600">コード<Textarea value={customCode} onChange={event => setCustomCode(event.target.value)} spellCheck={false} className="min-h-[260px] font-mono text-xs" /></label>
                            <div className="flex justify-between gap-2">
                                <Button variant="outline" onClick={() => onDeleteCustom(selection.id)}>削除</Button>
                                <Button onClick={() => onSaveCustom({ id: selection.id, name: customName.trim() || "カスタム", code: customCode })} className="gap-1.5"><Save className="h-4 w-4" />保存</Button>
                            </div>
                        </>
                    )}
                    {selection.kind === "type" && (
                        <Button variant="outline" onClick={() => {
                            const next = { ...(settings.typeProfiles ?? {}) };
                            delete next[selection.type];
                            onChange({ ...settings, typeProfiles: next });
                        }} className="w-fit gap-1.5"><RotateCcw className="h-4 w-4" />リセット</Button>
                    )}
                </div>
            </div>
        </div>
    </div>;
}

export function MotionPreview({ mode, large = false }: { mode: string; large?: boolean }) {
    const height = large ? "h-48" : "h-24";
    const fishClass = mode === "anchor" ? "animate-none" : mode === "jellyfish" || mode === "float" ? "animate-[motionFloat_2.8s_ease-in-out_infinite]" : mode === "turn" || mode === "shark" ? "animate-[motionArc_3.4s_ease-in-out_infinite]" : "animate-[motionCruise_2.6s_ease-in-out_infinite]";
    return <div className={`${height} relative overflow-hidden rounded-md border border-slate-200 bg-gradient-to-b from-cyan-50 to-sky-100`}>
        <style>{`@keyframes motionCruise{0%{transform:translate(12%,45%) scaleX(1)}48%{transform:translate(72%,40%) scaleX(1)}52%{transform:translate(72%,40%) scaleX(-1)}100%{transform:translate(12%,55%) scaleX(-1)}}@keyframes motionFloat{0%,100%{transform:translate(45%,58%) rotate(-4deg)}50%{transform:translate(58%,28%) rotate(5deg)}}@keyframes motionArc{0%{transform:translate(14%,62%) rotate(-12deg)}50%{transform:translate(70%,28%) rotate(14deg)}100%{transform:translate(16%,64%) rotate(-12deg)}}`}</style>
        <div className={`absolute left-0 top-0 text-3xl ${large ? "text-5xl" : ""} ${fishClass}`}>{mode === "jellyfish" ? "◎" : mode === "squid" ? "◇" : mode === "anchor" ? "◆" : "><>"}</div>
    </div>;
}

function SettingRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
    return <div>
        <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500"><span>{label}</span><span className="font-mono text-slate-700">x{value.toFixed(2)}</span></div>
        <Slider value={[value]} min={min} max={max} step={0.05} onValueChange={next => onChange(next[0] ?? 1)} />
    </div>;
}

function normalizedCustomPresets(settings: MotionSettings): MotionCustomPreset[] {
    if (settings.customPresets?.length) return settings.customPresets;
    return settings.customCode ? [{ id: "custom_default", name: "カスタム 1", code: settings.customCode }] : [];
}
