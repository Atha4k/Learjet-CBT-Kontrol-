#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
batch_make_mp3.py
- captions_in/captions copy.json içinden slide metinlerini alır
- macOS "say" ile aiff üretir
- ffmpeg ile mp3_out içine s01, s02, s11, s91, s150, s200 formatında mp3 yazar

Kabul edilen captions json formatları:

1) Dict/Object:
{
  "s02": { "title": "...", "en": "...", "caption_en": "...", "tr": "..." },
  "s03": { ... }
}

2) Liste/Array:
[
  { "id": "s02", "title": "...", "en": "...", "caption_en": "...", "tr": "..." },
  { "id": "s03", ... }
]

ÖNEMLİ:
- SADECE 'caption_en' ve 'en' okunur (öncelik caption_en).
- Title/text/caption/tr vs fallback YOK.
- Metin yoksa slide atlanır.
"""

import argparse
import json
import re
import shutil
import subprocess
from pathlib import Path


# ---------- helpers ----------

def parse_sid_num(sid: str):
    """'s01' -> 1, 's200' -> 200; değilse None"""
    m = re.match(r"^s(\d+)$", sid.strip(), flags=re.IGNORECASE)
    if not m:
        return None
    return int(m.group(1))


def sort_key_sid(sid: str):
    """s01, s02, s10 gibi id'leri sayısal sıraya koyar."""
    n = parse_sid_num(sid)
    if n is None:
        return (1, sid.lower())
    return (0, n)


def sid_out(n: int) -> str:
    """
    İSTENEN İSİMLENDİRME:
    1-9 => s01..s09
    10+ => s10..s200
    """
    if n < 10:
        return f"s0{n}"
    return f"s{n}"


def sid_candidates(n: int):
    """
    captions dosyasında anahtar bazen farklı gelebilir.
    Biz çıktı olarak s01/s10... üreteceğiz ama ararken şunları da deneriz:
    - s01 / s1
    - s001 (bazı exportlar)
    - s0001 (olursa)
    """
    base = sid_out(n)          # s01 or s10
    return [
        base,
        f"s{n}",               # s1, s10
        f"s{n:02d}",           # s01..s09, s10.. (s10 değişmez ama dursun)
        f"s{n:03d}",           # s001
        f"s{n:04d}",           # s0001
    ]


def load_captions_any(path: Path):
    """
    captions json hem LISTE hem DICT formatında gelebilir.
    Çıkış:
      slides: {"s01": {...}, "s02": {...}} (anahtarlar json'daki gibi)
    """
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    slides = {}

    if isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            sid = item.get("id") or item.get("sid") or item.get("slide")
            if not sid:
                continue
            slides[str(sid)] = item

    elif isinstance(raw, dict):
        for sid, item in raw.items():
            if not isinstance(item, dict):
                continue
            item = dict(item)
            item.setdefault("id", str(sid))
            slides[str(sid)] = item
    else:
        raise ValueError("❌ captions json list ([]) veya dict ({}) formatında olmalı")

    if not slides:
        raise ValueError("❌ captions json içinde hiç slide bulunamadı (id/s01 gibi anahtar yok)")

    return slides


def which_or_fail(cmd: str):
    p = shutil.which(cmd)
    if not p:
        print(f"❌ Gerekli komut bulunamadı: {cmd}")
        print("   macOS 'say' ve ffmpeg kurulu olmalı.")
        raise SystemExit(1)
    return p


def safe_text(x):
    if x is None:
        return ""
    return str(x).strip()


def build_text_en_only(item: dict) -> str:
    """
    SADECE English metin:
    - 'caption_en' öncelikli
    - yoksa 'en'
    - başka hiçbir şeye düşmez
    """
    return safe_text(item.get("caption_en")) or safe_text(item.get("en"))


def run(cmd_list):
    subprocess.run(
        cmd_list,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )


# ---------- main ----------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--captions",
        default="captions_in/captions copy.json",
        help="captions json path (default: captions_in/captions copy.json)"
    )
    parser.add_argument("--out", default="mp3_out", help="output folder")
    parser.add_argument("--tmp", default="_tmp_audio", help="temp folder")
    parser.add_argument("--max", type=int, default=200, help="en fazla hangi slide'a kadar üretilecek (default 200)")
    parser.add_argument("--voice", default="", help="macOS say voice name (optional)")
    parser.add_argument("--bitrate", default="192k", help="mp3 bitrate (e.g., 128k, 192k)")
    parser.add_argument("--force", action="store_true", help="overwrite existing mp3s")
    args = parser.parse_args()

    captions_path = Path(args.captions)
    out_dir = Path(args.out)
    tmp_dir = Path(args.tmp)

    if not captions_path.exists():
        print(f"❌ Bulunamadı: {captions_path}")
        raise SystemExit(1)

    say_bin = which_or_fail("say")
    ffmpeg_bin = which_or_fail("ffmpeg")

    try:
        slides = load_captions_any(captions_path)
    except Exception as e:
        print(str(e))
        raise SystemExit(1)

    out_dir.mkdir(parents=True, exist_ok=True)
    tmp_dir.mkdir(parents=True, exist_ok=True)

    made = 0
    skipped_empty = 0
    skipped_exists = 0
    missing_in_json = 0

    for n in range(1, args.max + 1):
        out_sid = sid_out(n)  # ÇIKTI ADI: s01, s10, s150...
        item = None
        used_key = None

        for k in sid_candidates(n):
            if k in slides:
                item = slides[k]
                used_key = k
                break

        if item is None:
            missing_in_json += 1
            print(f"⚠️  {out_sid}: captions içinde yok -> atlandı")
            continue

        text = build_text_en_only(item)
        if not text:
            skipped_empty += 1
            print(f"⚠️  {out_sid}: EN metin yok (caption_en/en boş) -> atlandı (key:{used_key})")
            continue

        mp3_path = out_dir / f"{out_sid}.mp3"
        if mp3_path.exists() and not args.force:
            skipped_exists += 1
            print(f"⏭️  {mp3_path.name} zaten var (atlandı)  --force ile üstüne yaz")
            continue

        aiff_path = tmp_dir / f"{out_sid}.aiff"

        say_cmd = [say_bin]
        if args.voice:
            say_cmd += ["-v", args.voice]
        say_cmd += ["-o", str(aiff_path), text]

        ff_cmd = [
            ffmpeg_bin, "-y",
            "-i", str(aiff_path),
            "-codec:a", "libmp3lame",
            "-b:a", args.bitrate,
            str(mp3_path),
        ]

        try:
            run(say_cmd)
            run(ff_cmd)
            made += 1
            print(f"✅ {mp3_path.name}  (from:{used_key})")
        except subprocess.CalledProcessError:
            print(f"❌ Hata: {out_sid} üretilemedi. (say/ffmpeg)")
            try:
                if aiff_path.exists():
                    aiff_path.unlink()
            except Exception:
                pass

    print("\n🎧 BİTTİ")
    print(f"  ✅ üretilen: {made}")
    print(f"  ⚠️  json'da yok: {missing_in_json}")
    print(f"  ⚠️  metin boş: {skipped_empty}")
    print(f"  ⏭️  zaten vardı: {skipped_exists}")
    print(f"📁 Output: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
