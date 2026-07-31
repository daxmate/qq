#!/usr/bin/env python3
"""合并千千词表 + 例句 → 网页数据 words.json"""
import json, sys, os

sys.path.insert(0, "/Users/dax/.openclaw/coding")
from qianqian_examples import EXAMPLES

with open("/Users/dax/.openclaw/coding/qianqian_words.json", encoding="utf-8") as f:
    pairs = json.load(f)  # [(en, cn), ...]

# 分类信息（用于网页筛选）——按词表顺序的类别切分
# 由于词表是打乱的，这里不强行分类；网页提供全部/随机两种模式即可
words = []
for idx, (en, cn) in enumerate(pairs):
    sent, cn_sent = EXAMPLES.get(en, ("", ""))
    words.append({
        "id": idx,
        "en": en,
        "cn": cn,
        "sent": sent,
        "cn_sent": cn_sent,
        "word_audio": f"audio/w_{idx:03d}.mp3",
        "sent_audio": f"audio/s_{idx:03d}.mp3",
    })

out = "/Users/dax/.openclaw/coding/qianqian-words-data.json"
with open(out, "w", encoding="utf-8") as f:
    json.dump({"total": len(words), "words": words}, f, ensure_ascii=False, indent=1)
print(f"✅ {out} — {len(words)} 词")
