import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";

interface FishImageCacheEntry {
    img: HTMLImageElement;
    loaded: boolean;
    retryAfter: number;
}

/** 魚と背景の画像キャッシュ。失敗時は一定時間後に再試行する。 */
const fishImageCache = new Map<string, FishImageCacheEntry>();

export function useCanvasImageCache(
    rafRef: MutableRefObject<number | null>,
    drawRef: MutableRefObject<() => void>,
) {
    const layerImageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

    const loadFishImage = useCallback((url: string): HTMLImageElement | null => {
        const cached = fishImageCache.get(url);
        if (cached?.loaded) return cached.img;
        if (cached && Date.now() < cached.retryAfter) return null;

        const img = new Image();
        img.crossOrigin = "anonymous";
        fishImageCache.set(url, { img, loaded: false, retryAfter: Number.POSITIVE_INFINITY });
        img.onload = () => {
            fishImageCache.set(url, { img, loaded: true, retryAfter: 0 });
            window.dispatchEvent(new Event("aquarium_frame"));
        };
        img.onerror = () => {
            fishImageCache.set(url, { img, loaded: false, retryAfter: Date.now() + 2_000 });
        };
        img.src = url;
        return null;
    }, []);

    const loadLayerImage = useCallback((url: string): HTMLImageElement => {
        let img = layerImageCacheRef.current.get(url);
        if (!img) {
            img = new Image();
            img.crossOrigin = "anonymous";
            img.src = url;
            img.onload = () => {
                if (rafRef.current) requestAnimationFrame(drawRef.current);
            };
            layerImageCacheRef.current.set(url, img);
        }
        return img;
    }, [drawRef, rafRef]);

    return { loadFishImage, loadLayerImage };
}
