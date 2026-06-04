import { useEffect, useState } from "react";
import type { PendingFish, WsServerMessage } from "@aquarium/shared";
import { createWsClient } from "../shared/useWs";
import { Gallery } from "./Gallery";
import { Editor } from "./Editor";
import { api } from "../shared/api";

type Page = "gallery" | "editor";

// WS接続（新着魚のリアルタイム通知受信用）
const ws = createWsClient("controller");

export default function App(): React.ReactElement {
    const [page, setPage] = useState<Page>("gallery");
    const [selectedFish, setSelectedFish] = useState<PendingFish | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);

    // サーバーから fish_added が届いたらギャラリーを自動更新
    useEffect(() => ws.onMessage((msg: WsServerMessage) => {
        if (msg.event === "fish_added") setRefreshKey((k) => k + 1);
    }), []);

    const cancelEditing = async (): Promise<void> => {
        if (selectedFish) {
            await api.request("/api/pending/unlock", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ fishId: selectedFish.id }),
            });
        }
        setPage("gallery");
        setSelectedFish(null);
    };

    if (page === "editor" && selectedFish) {
        return (
            <Editor
                fish={selectedFish}
                onReleased={() => { setPage("gallery"); setSelectedFish(null); }}
                onCancel={() => void cancelEditing()}
            />
        );
    }

    return (
        <Gallery
            key={refreshKey}
            onSelect={(fish) => { setSelectedFish(fish); setPage("editor"); }}
        />
    );
}
