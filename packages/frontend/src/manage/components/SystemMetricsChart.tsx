import type { SystemMetricSample } from "@aquarium/shared";

export function SystemMetricsChart({ samples }: { samples: SystemMetricSample[] }) {
    const width = 900;
    const height = 220;
    const pad = 32;
    const maxFish = Math.max(10, ...samples.map(sample => sample.fishCount));
    const maxCommunication = Math.max(100, ...samples.map(sample => sample.monitorCommunicationMs));
    const maxCalculation = Math.max(20, ...samples.map(sample => sample.fishCalculationMs));
    const maxMemoryBytes = Math.max(512 * 1024 * 1024, ...samples.map(sample => sample.memoryRss || 0));
    
    const points = (key: keyof SystemMetricSample, max: number) => samples.map((sample, index) => {
        const x = pad + (index / Math.max(1, samples.length - 1)) * (width - pad * 2);
        const y = height - pad - (Number(sample[key] || 0) / max) * (height - pad * 2);
        return `${x},${y}`;
    }).join(" ");
    const limitY = height - pad - (16.67 / maxCalculation) * (height - pad * 2);

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="font-bold text-slate-900">システム稼働状況</h2>
                    <p className="mt-1 text-xs text-slate-500">直近約12秒。魚計算が赤い点線を超えると60fpsを維持できません。</p>
                </div>
                <div className="flex gap-4 text-[10px] font-bold">
                    <span className="text-sky-600">モニター通信</span><span className="text-emerald-600">魚の量</span><span className="text-violet-600">魚計算時間</span><span className="text-amber-500">メモリ使用量</span>
                </div>
            </div>
            <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-56 w-full rounded-lg bg-slate-50">
                {[0, 1, 2, 3, 4].map(line => <line key={line} x1={pad} x2={width - pad} y1={pad + line * (height - pad * 2) / 4} y2={pad + line * (height - pad * 2) / 4} stroke="#e2e8f0" />)}
                <line x1={pad} x2={width - pad} y1={limitY} y2={limitY} stroke="#ef4444" strokeWidth="2" strokeDasharray="7 5" />
                <text x={width - pad - 4} y={Math.max(12, limitY - 5)} textAnchor="end" fontSize="10" fill="#dc2626">1/60秒 = 16.67ms</text>
                {samples.length > 1 && <>
                    <polyline points={points("monitorCommunicationMs", maxCommunication)} fill="none" stroke="#0284c7" strokeWidth="2" />
                    <polyline points={points("fishCount", maxFish)} fill="none" stroke="#10b981" strokeWidth="2" />
                    <polyline points={points("fishCalculationMs", maxCalculation)} fill="none" stroke="#7c3aed" strokeWidth="2.5" />
                    <polyline points={points("memoryRss", maxMemoryBytes)} fill="none" stroke="#f59e0b" strokeWidth="2" />
                </>}
            </svg>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 text-xs">
                <MetricValue label="モニター通信" value={`${samples.at(-1)?.monitorCommunicationMs.toFixed(0) ?? 0}ms`} />
                <MetricValue label="表示中の魚" value={`${samples.at(-1)?.fishCount ?? 0}匹`} />
                <MetricValue label="魚計算時間" value={`${samples.at(-1)?.fishCalculationMs.toFixed(2) ?? "0.00"}ms`} alert={(samples.at(-1)?.fishCalculationMs ?? 0) > 16.67} />
                <MetricValue label="メモリ使用量" value={samples.at(-1)?.memoryRss ? `${Math.round((samples.at(-1)?.memoryRss || 0) / (1024 * 1024))} MB` : "-- MB"} />
            </div>
        </section>
    );
}

function MetricValue({ label, value, alert = false }: { label: string; value: string; alert?: boolean }) {
    return <div className={`rounded-lg p-3 ${alert ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-700"}`}><div className="text-[10px] font-bold text-slate-400">{label}</div><div className="mt-1 font-mono text-lg font-bold">{value}</div></div>;
}
