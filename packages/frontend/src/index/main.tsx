import React from "react";
import { createRoot } from "react-dom/client";
import "../styles/global.css";
import { Layers, MonitorPlay, Smartphone, Locate, Info } from "lucide-react";

function PortalApp() {
    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-slate-800 font-sans">
            <div className="max-w-4xl w-full bg-white rounded-3xl shadow-xl overflow-hidden flex flex-col md:flex-row">
                {/* Left side: hero / info */}
                <div className="md:w-1/2 bg-sky-500 p-10 text-white flex flex-col justify-center relative overflow-hidden">
                    <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-sky-400 rounded-full opacity-50 blur-3xl" />
                    <div className="relative z-10">
                        <h1 className="text-4xl font-extrabold mb-4 flex items-center gap-3">
                            <span className="text-5xl">🐡</span> Aquarium
                        </h1>
                        <p className="text-sky-100 mb-6 leading-relaxed">
                            複数デバイスの画面を統合して1つの巨大なデジタル水槽を作り出すシステムです。スマートフォンからのインタラクティブな参加や、管理画面からのリアルタイムなレイアウト同期が可能です。
                        </p>
                        <div className="bg-sky-600/50 backdrop-blur rounded-xl p-4 text-sm text-sky-50">
                            <strong>System Status:</strong> 稼働中<br />
                            WebSocketおよび画像認識エンジンと連携しています。
                        </div>
                    </div>
                </div>

                {/* Right side: App Links */}
                <div className="md:w-1/2 p-10 flex flex-col justify-center">
                    <h2 className="text-xl font-bold mb-6 text-slate-700">アプリケーション一覧</h2>

                    <div className="flex flex-col gap-4">
                        <a href="/manage" className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-sky-300 hover:bg-sky-50 transition-all cursor-pointer shadow-sm hover:shadow-md">
                            <div className="p-3 rounded-lg bg-sky-100 text-sky-600 group-hover:scale-110 transition-transform">
                                <Layers className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 group-hover:text-sky-700">Manage Console</h3>
                                <p className="text-sm text-slate-500 mt-1">管理画面。各ディスプレイの配置や結合、通信レートの調整を行います。</p>
                            </div>
                        </a>

                        <a href="/display" className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition-all cursor-pointer shadow-sm hover:shadow-md">
                            <div className="p-3 rounded-lg bg-indigo-100 text-indigo-600 group-hover:scale-110 transition-transform">
                                <MonitorPlay className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 group-hover:text-indigo-700">Display Client</h3>
                                <p className="text-sm text-slate-500 mt-1">水槽を描画する表示用クライアント。フルスクリーンで起動してください。</p>
                            </div>
                        </a>

                        <a href="/guest" className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 transition-all cursor-pointer shadow-sm hover:shadow-md">
                            <div className="p-3 rounded-lg bg-emerald-100 text-emerald-600 group-hover:scale-110 transition-transform">
                                <Smartphone className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 group-hover:text-emerald-700">Guest App</h3>
                                <p className="text-sm text-slate-500 mt-1">来場者用アプリ。描いた絵をスキャンして水槽へ放流できます。</p>
                            </div>
                        </a>

                        <a href="/controller" className="group flex items-start gap-4 p-4 rounded-xl border border-slate-200 hover:border-pink-300 hover:bg-pink-50 transition-all cursor-pointer shadow-sm hover:shadow-md">
                            <div className="p-3 rounded-lg bg-pink-100 text-pink-600 group-hover:scale-110 transition-transform">
                                <Locate className="w-6 h-6" />
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 group-hover:text-pink-700">Controller</h3>
                                <p className="text-sm text-slate-500 mt-1">操作用端末（iPad等）。魚の承認待ちリストや詳細設定を管理します。</p>
                            </div>
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

const rootEl = document.getElementById("root");
if (rootEl) {
    createRoot(rootEl).render(<PortalApp />);
}
