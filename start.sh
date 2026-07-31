#!/bin/bash
# 千千单词练习 - 一键启动
# 双击运行，或终端执行: ./start.sh
cd "$(dirname "$0")"

# 检查音频是否生成完
TOTAL=$(python3 -c "import json; print(json.load(open('data/words.json'))['total']*2)")
DONE=$(ls audio/*.mp3 2>/dev/null | wc -l | tr -d ' ')
if [ "$DONE" -lt "$TOTAL" ]; then
  echo "⚠️  音频还在生成中（$DONE/$TOTAL），网页可以打开但部分发音不可用"
else
  echo "✅ 音频已全部就绪（$DONE 个）"
fi

echo "🌐 启动本地服务: http://localhost:8765"
open "http://localhost:8765"
python3 -m http.server 8765
