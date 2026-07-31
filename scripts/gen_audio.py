#!/usr/bin/env python3
"""批量生成千千词汇发音 — 单词 + 例句（CosyVoice3 MLX）
- 单进程单次加载模型，循环生成，避免重复加载开销
- 生成 wav 后转 mp3（24kHz 单声道 ~32kbps），减小体积
- 支持断点续跑（已存在的 mp3 跳过）
"""
import json, os, sys, time, shutil, tempfile, subprocess

PROJECT = os.path.expanduser("~/codes/qianqian-vocab-web")
DATA = "/Users/dax/.openclaw/coding/qianqian-words-data.json"
AUDIO_DIR = os.path.join(PROJECT, "audio")

os.environ.setdefault("S3_TOKENIZER_LOCAL", os.path.expanduser("~/.omlx/models/mlx-community/S3TokenizerV3"))
MODEL = os.path.expanduser("~/.omlx/models/mlx-community/Fun-CosyVoice3-0.5B-2512-4bit")
REF = os.path.expanduser("~/codes/cosyvoice-mlx/ref_audio_real.wav")
REF_TXT = open(os.path.expanduser("~/codes/cosyvoice-mlx/ref_audio_real.txt"), encoding="utf-8").read().strip()
if not REF_TXT.startswith("You are a helpful assistant"):
    REF_TXT = "You are a helpful assistant.<|endofprompt|>" + REF_TXT

INSTRUCT = "请用温暖亲切、清晰、语速稍慢的语气朗读，适合儿童学习"

def to_mp3(wav_path, mp3_path):
    subprocess.run([
        "ffmpeg", "-y", "-loglevel", "error", "-i", wav_path,
        "-ac", "1", "-ar", "24000", "-b:a", "48k", mp3_path,
    ], check=True)

def synth(text, out_wav):
    with tempfile.TemporaryDirectory(prefix="cv3_") as tmp:
        old = os.getcwd()
        os.chdir(tmp)
        try:
            from mlx_audio.tts.generate import generate_audio
            generate_audio(
                text=text, model=MODEL, ref_audio=REF, ref_text=REF_TXT,
                instruct=INSTRUCT, file_prefix="out",
                audio_format="wav", lang_code="zh", speed=1.0, verbose=False,
            )
        finally:
            os.chdir(old)
        wavs = sorted(f for f in os.listdir(tmp) if f.endswith(".wav"))
        if not wavs:
            raise RuntimeError("no audio generated")
        shutil.copyfile(os.path.join(tmp, wavs[0]), out_wav)

def main():
    with open(DATA, encoding="utf-8") as f:
        data = json.load(f)
    words = data["words"]
    os.makedirs(AUDIO_DIR, exist_ok=True)

    # 待生成列表
    todo = []
    for w in words:
        wp = os.path.join(AUDIO_DIR, os.path.basename(w["word_audio"]))
        sp = os.path.join(AUDIO_DIR, os.path.basename(w["sent_audio"]))
        if not os.path.exists(wp):
            todo.append((wp, w["en"]))
        if w["sent"] and not os.path.exists(sp):
            todo.append((sp, w["sent"]))
    total = len(todo)
    print(f"待生成: {total} 个音频（已存在的跳过）", flush=True)

    t0 = time.time()
    done = 0
    tmp_wav = "/tmp/cv3_tmp.wav"
    for i, (mp3_path, text) in enumerate(todo):
        t1 = time.time()
        try:
            synth(text, tmp_wav)
            to_mp3(tmp_wav, mp3_path)
            os.remove(tmp_wav)
        except Exception as e:
            print(f"❌ [{i}/{total}] 失败: {text!r} → {e}", flush=True)
            continue
        done += 1
        if done % 20 == 0 or done == total:
            avg = (time.time() - t0) / done
            eta = avg * (total - done)
            print(f"⏳ {done}/{total} 用时 {time.time()-t0:.0f}s 平均 {avg:.1f}s/个 预计还需 {eta/60:.0f}min", flush=True)
    print(f"✅ 完成 {done}/{total}，总耗时 {(time.time()-t0)/60:.1f} 分钟", flush=True)

if __name__ == "__main__":
    main()
