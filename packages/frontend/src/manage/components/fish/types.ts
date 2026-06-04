export interface LibraryEntry {
    filename: string;
    imageUrl: string;
    meta: {
        version: number;
        author: string;
        type: "swimmer" | "looper" | "anchor";
        speed: number;
        scale: number;
        pinnedLayerId: number | null;
        tags: string[];
    };
}

export type GalleryEntry = { url: string; meta?: LibraryEntry["meta"] };
