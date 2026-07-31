#!/usr/bin/env python3
"""批量生成千千词汇发音 — 单词 + 例句（edge-tts，微软英语母语女声）
- 音色: en-US-JennyNeural，语速 -10%（适合儿童）
- 并发 6 个，速度远快于 CosyVoice
- 覆盖旧音频（换音色必须全部重新生成）
"""
import asyncio, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor

import edge_tts

PROJECT = os.path.expanduser("~/codes/qianqian-vocab-web")
DATA = os.path.join(PROJECT, "data", "words.json")
AUDIO_DIR = os.path.join(PROJECT, "audio")

VOICE = "en-US-JennyNeural"
RATE = "-10%"   # 稍慢，适合儿童
CONCURRENCY = 6


def synth_one(text: str, mp3_path: str) -> None:
    """同步包装：edge-tts 每个音频 1-2s"""
    async def _run():
        com = edge_tts.Communicate(text, VOICE, rate=RATE)
        await com.save(mp3_path)
    asyncio.run(_run())


def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    words = data["words"]
    os.makedirs(AUDIO_DIR, exist_ok=True)

    todo = []  # (mp3_path, text)
    for w in words:
        wp = os.path.join(AUDIO_DIR, os.path.basename(w["word_audio"]))
        sp = os.path.join(AUDIO_DIR, os.path.basename(w["sent_audio"]))
        todo.append((wp, w["en"]))
        if w.get("sent"):
            todo.append((sp, w["sent"]))

    total = len(todo)
    print(f"待生成: {total} 个音频（覆盖旧音色）", flush=True)

    t0 = time.time()
    done = 0
    fails = []

    def worker(item):
        mp3_path, text = item
        try:
            synth_one(text, mp3_path)
            return None
        except Exception as e:
            return (text, str(e))

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        for i, err in enumerate(ex.map(worker, todo)):
            done += 1
            if err:
                fails.append(err)
                print(f"❌ 失败: {err[0]!r} → {err[1]}", flush=True)
            if done % 100 == 0 or done == total:
                avg = (time.time() - t0) / done
                eta = avg * (total - done)
                print(f"⏳ {done}/{total} 用时 {time.time()-t0:.0f}s 平均 {avg:.1f}s/个 预计还需 {eta:.0f}s", flush=True)

    print(f"✅ 完成 {done}/{total}，失败 {len(fails)}，总耗时 {(time.time()-t0):.0f}s", flush=True)
    if fails:
        print("失败列表:", fails, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
