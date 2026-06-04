import type { GalleryEntry } from "./types";

export function FishGallerySection({
    entries,
    onSelect,
}: {
    entries: GalleryEntry[];
    onSelect: (entry: GalleryEntry) => void;
}) {
    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-bold text-slate-700 mb-3">テンプレートギャラリー (クリックで放流)</h3>
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-3 overflow-y-auto max-h-48 p-2 bg-slate-50 rounded-lg border border-slate-100">
                {entries.length > 0 ? entries.map((entry, idx) => (
                    <div
                        key={idx}
                        onClick={() => onSelect(entry)}
                        className="flex flex-col gap-1.5 aspect-square bg-white rounded cursor-pointer border border-transparent hover:border-emerald-500 hover:shadow-md transition-all p-1"
                    >
                        <div className="flex-1 overflow-hidden flex items-center justify-center">
                            <img src={entry.url} alt={`gallery-${idx}`} className="max-w-full max-h-full object-contain" loading="lazy" />
                        </div>
                    </div>
                )) : (
                    <div className="col-span-full text-xs text-slate-400 text-center py-4">テンプレートが見つかりません<br /><code className="text-[10px]">/server/src/public/images</code></div>
                )}
            </div>
        </div>
    );
}
