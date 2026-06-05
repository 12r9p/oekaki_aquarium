import type { FishType } from "@aquarium/shared";

export interface LibraryEntry {
    filename: string;
    imageUrl: string;
    meta: {
        version: number;
        author: string;
        type: FishType;
        speed: number;
        scale: number;
        pinnedLayerId: number | null;
        tags: string[];
    };
}

export type GalleryEntry = { url: string; meta?: LibraryEntry["meta"] };
