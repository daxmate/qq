#!/usr/bin/env python3
"""重新生成单词音频 — edge-tts (Jenny 女声)
CosyVoice 读孤立英文单词成功率低（生成大量静音），
改用微软 edge-tts 神经语音，英文发音标准、稳定、速度快。

只处理单词 (w_*.mp3)；例句 (s_*.mp3) 由 CosyVoice 生成且已验证正常。
"""
import asyncio, json, os, sys

import edge_tts

PROJECT = os.path.expanduser("~/codes/qianqian-vocab-web")
DATA = os.path.join(PROJECT, "data", "words.json")
AUDIO_DIR = os.path.join(PROJECT, "audio")
VOICE = "en-US-JennyNeural"
RATE = "-10%"   # 稍慢，适合学习跟读
SEM_LIMIT = 4   # 并发数

async def gen_one(word, out_path):
    """生成单个单词音频（写入 tmp 再改名，避免半成品）"""
    tmp = out_path + ".tmp"
    try:
        tts = edge_tts.Communicate(word, VOICE, rate=RATE)
        await tts.save(tmp)
        os.replace(tmp, out_path)
        return True
    except Exception as e:
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except Exception:
            pass
        print(f"  ⚠️ 失败: {word!r} → {e}", flush=True)
        return False

async def main():
    with open(DATA, encoding="utf-8") as f:
        words = json.load(f)["words"]

    todo = []
    for w in words:
        path = os.path.join(AUDIO_DIR, os.path.basename(w["word_audio"]))
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            todo.append((w["en"], path))

    # 删除已知的空音频（5421 字节 = CosyVoice 静音产物）
    removed = 0
    for w in words:
        path = os.path.join(AUDIO_DIR, os.path.basename(w["word_audio"]))
        if os.path.exists(path) and os.path.getsize(path) <= 6000:
            os.remove(path)
            removed += 1
    print(f"清理空音频: {removed} 个", flush=True)

    # 重新收集待生成（清理后）
    todo = []
    for w in words:
        path = os.path.join(AUDIO_DIR, os.path.basename(w["word_audio"]))
        if not os.path.exists(path):
            todo.append((w["en"], path))

    total = len(todo)
    print(f"待生成单词: {total} 个（edge-tts {VOICE}）", flush=True)

    sem = asyncio.Semaphore(SEM_LIMIT)

    async def worker(en, path):
        async with sem:
            return await gen_one(en, path)

    ok = 0
    for i in range(0, total, 20):
        batch = todo[i:i+20]
        results = await asyncio.gather(*(worker(en, p) for en, p in batch))
        ok += sum(1 for r in results if r)
        print(f"⏳ {min(i+20, total)}/{total} 完成", flush=True)

    print(f"✅ 完成: {ok}/{total}", flush=True)

if __name__ == "__main__":
    asyncio.run(main())
