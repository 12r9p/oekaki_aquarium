import React from "react";
import type { DisplayClientInfo, ActiveFish, PendingFish } from "@aquarium/shared";
import { CircleGauge, Fish, Layers, Settings, Send, Waves, Menu, X } from "lucide-react";

export type ManagePage = "dashboard" | "layout" | "fish" | "pending" | "motion" | "settings";

interface ToolbarProps {
    displays: DisplayClientInfo[];
    activeFish: ActiveFish[];
    pendingFish: PendingFish[];
    connected: boolean;
    tab: ManagePage;
    setTab: (t: ManagePage) => void;
}

export function Toolbar({
    displays, activeFish, pendingFish, connected,
    tab, setTab
}: ToolbarProps): React.ReactElement {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
    const openButtonRef = React.useRef<HTMLButtonElement>(null);
    const closeButtonRef = React.useRef<HTMLButtonElement>(null);
    const drawerRef = React.useRef<HTMLElement>(null);
    const isFirstRender = React.useRef(true);

    React.useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (isMobileMenuOpen) {
            const timer = setTimeout(() => {
                closeButtonRef.current?.focus();
            }, 0);
            return () => clearTimeout(timer);
        } else {
            openButtonRef.current?.focus();
        }
    }, [isMobileMenuOpen]);

    React.useEffect(() => {
        if (!isMobileMenuOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setIsMobileMenuOpen(false);
                return;
            }

            if (e.key === "Tab") {
                if (!drawerRef.current) return;
                const focusableElements = drawerRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusableElements.length === 0) return;
                const firstElement = focusableElements[0] as HTMLElement;
                const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        lastElement.focus();
                        e.preventDefault();
                    } else if (document.activeElement && !drawerRef.current.contains(document.activeElement)) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        firstElement.focus();
                        e.preventDefault();
                    } else if (document.activeElement && !drawerRef.current.contains(document.activeElement)) {
                        firstElement.focus();
                        e.preventDefault();
                    }
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [isMobileMenuOpen]);

    return (
        <>
            {/* Top Bar for Mobile/Tablet */}
            <div className="flex h-16 w-full items-center justify-between border-b border-slate-800 bg-slate-950 px-4 text-slate-200 lg:hidden flex-shrink-0">
                <button
                    ref={openButtonRef}
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                    aria-label="メニューを開く"
                >
                    <Menu className="h-6 w-6" />
                </button>
                <div className="flex items-center gap-3">
                    <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                    <div className="text-left">
                        <div className="text-sm font-bold text-white leading-tight">お絵かき水族館</div>
                        <div className="text-[10px] font-medium text-slate-400 leading-none">運用管理</div>
                    </div>
                </div>
                <div className={`flex items-center gap-1.5 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                    <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                </div>
            </div>

            {/* Permanent Sidebar for Desktop */}
            <aside className="hidden lg:flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-950 text-slate-200">
                <div className="flex h-16 items-center gap-3 border-b border-slate-800 px-5">
                    <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                    <div>
                        <div className="text-sm font-bold text-white">お絵かき水族館</div>
                        <div className="text-[10px] font-medium text-slate-400">運用管理</div>
                    </div>
                </div>
                <nav className="flex flex-1 flex-col gap-1 p-3">
                    {([
                        ["dashboard", "ステータス", CircleGauge],
                        ["fish", "魚", Fish],
                        ["pending", "承認待ち", Send],
                        ["layout", "水槽レイアウト", Layers],
                        ["motion", "魚の動き", Waves],
                        ["settings", "設定", Settings],
                    ] as const).map(([value, label, Icon]) => (
                        <button key={value} onClick={() => setTab(value)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${tab === value ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"}`}>
                            <Icon className="h-4 w-4" />
                            <span className="flex-1">{label}</span>
                            {value === "pending" && pendingFish.length > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">{pendingFish.length}</span>}
                        </button>
                    ))}
                </nav>
                <div className="border-t border-slate-800 p-4">
                    <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{displays.length}</div><div className="text-[10px] text-slate-400">端末</div></div>
                        <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{activeFish.length}</div><div className="text-[10px] text-slate-400">魚</div></div>
                    </div>
                    <div className={`mt-3 flex items-center gap-2 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                        <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                        {connected ? "サーバー接続中" : "サーバー切断中"}
                    </div>
                </div>
            </aside>

            {/* Mobile/Tablet Drawer Menu Overlay */}
            {isMobileMenuOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="fixed inset-0 z-40 bg-black/60 lg:hidden"
                    />
                    {/* Drawer Content */}
                    <aside
                        ref={drawerRef}
                        role="dialog"
                        aria-modal="true"
                        aria-label="メニュー"
                        className="fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-slate-950 text-slate-200 lg:hidden"
                    >
                        <div className="flex h-16 items-center justify-between border-b border-slate-800 px-5">
                            <div className="flex items-center gap-3">
                                <div className="h-3 w-3 rounded-full bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.75)]" />
                                <div>
                                    <div className="text-sm font-bold text-white">お絵かき水族館</div>
                                    <div className="text-[10px] font-medium text-slate-400">運用管理</div>
                                </div>
                            </div>
                            <button
                                ref={closeButtonRef}
                                onClick={() => setIsMobileMenuOpen(false)}
                                className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-900 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                                aria-label="メニューを閉じる"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <nav className="flex flex-1 flex-col gap-1 p-3">
                            {([
                                ["dashboard", "ステータス", CircleGauge],
                                ["fish", "魚", Fish],
                                ["pending", "承認待ち", Send],
                                ["layout", "水槽レイアウト", Layers],
                                ["motion", "魚の動き", Waves],
                                ["settings", "設定", Settings],
                            ] as const).map(([value, label, Icon]) => (
                                <button
                                    key={value}
                                    onClick={() => {
                                        setTab(value);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold transition-colors ${tab === value ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-slate-900 hover:text-white"}`}
                                >
                                    <Icon className="h-4 w-4" />
                                    <span className="flex-1">{label}</span>
                                    {value === "pending" && pendingFish.length > 0 && <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">{pendingFish.length}</span>}
                                </button>
                            ))}
                        </nav>
                        <div className="border-t border-slate-800 p-4">
                            <div className="grid grid-cols-2 gap-2 text-center">
                                <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{displays.length}</div><div className="text-[10px] text-slate-400">端末</div></div>
                                <div className="rounded-lg bg-slate-900 p-2"><div className="text-lg font-bold text-white">{activeFish.length}</div><div className="text-[10px] text-slate-400">魚</div></div>
                            </div>
                            <div className={`mt-3 flex items-center gap-2 text-xs font-bold ${connected ? "text-emerald-400" : "text-rose-400"}`}>
                                <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-rose-400"}`} />
                                {connected ? "サーバー接続中" : "サーバー切断中"}
                            </div>
                        </div>
                    </aside>
                </>
            )}
        </>
    );
}
