#!/usr/bin/env python3
"""
scanner/main.py
スキャン画像を監視し、背景を自動除去してサーバーへアップロードするスクリプト。

使い方:
  1. pip install -r requirements.txt
  2. python main.py
  3. scanner/input/ フォルダに JPEG を保存すると自動処理される
"""

import sys
import time
import os
from pathlib import Path
from io import BytesIO
import requests
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileCreatedEvent
from rembg import remove
from PIL import Image

# ============================================================
# 設定: 環境変数でオーバーライド可能
# ============================================================
SERVER_URL = os.environ.get("SERVER_URL", "http://localhost:3000")
INPUT_DIR = Path(os.environ.get("INPUT_DIR", "scanner/input"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "scanner/output"))
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff"}


def process_image(src_path: Path) -> None:
    """
    1. rembg で背景除去
    2. PNG として OUTPUT_DIR に保存
    3. サーバーの POST /api/scan へアップロード
    """
    print(f"[Scanner] Processing: {src_path.name}")

    try:
        # 画像を読み込む
        with open(src_path, "rb") as f:
            input_bytes = f.read()

        # U-2-Net モデルで背景を除去（初回は自動ダウンロード）
        output_bytes = remove(input_bytes)

        # PIL で開いてサイズを確認・正規化
        img = Image.open(BytesIO(output_bytes)).convert("RGBA")

        # 長辺を 1024px に収める（大きすぎると通信コストが上がる）
        max_size = 1024
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
            print(f"[Scanner] Resized to: {img.size}")

        # OUTPUT_DIR に保存
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out_filename = src_path.stem + "_processed.png"
        out_path = OUTPUT_DIR / out_filename

        png_bytes = BytesIO()
        img.save(png_bytes, format="PNG")
        png_bytes.seek(0)

        with open(out_path, "wb") as f:
            f.write(png_bytes.read())

        print(f"[Scanner] Saved: {out_path}")

        # サーバーへアップロード
        png_bytes.seek(0)
        response = requests.post(
            f"{SERVER_URL}/api/scan",
            files={"image": (out_filename, png_bytes, "image/png")},
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        print(f"[Scanner] Uploaded! Fish ID: {result['fish']['id']}")

    except requests.exceptions.ConnectionError:
        print(f"[Scanner] ERROR: Cannot connect to server at {SERVER_URL}. Is it running?")
    except Exception as e:
        print(f"[Scanner] ERROR processing {src_path.name}: {e}", file=sys.stderr)


class ImageHandler(FileSystemEventHandler):
    """INPUT_DIR に新しいファイルが保存されたときに process_image を呼ぶ"""

    def on_created(self, event: FileCreatedEvent) -> None:  # type: ignore[override]
        if event.is_directory:
            return

        path = Path(event.src_path)
        if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            return

        # ファイルの書き込みが完了するまで少し待つ
        time.sleep(0.5)
        process_image(path)


def main() -> None:
    INPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"[Scanner] Watching directory: {INPUT_DIR.resolve()}")
    print(f"[Scanner] Server URL: {SERVER_URL}")
    print(f"[Scanner] Supported: {', '.join(SUPPORTED_EXTENSIONS)}")
    print("[Scanner] Ready. Place scan images in the input folder.")

    handler = ImageHandler()
    observer = Observer()
    observer.schedule(handler, str(INPUT_DIR), recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[Scanner] Stopping...")
        observer.stop()

    observer.join()
    print("[Scanner] Done.")


if __name__ == "__main__":
    main()
