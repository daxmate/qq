# 🎯 千千单词练习（三年级升四年级词汇）

给千千做的本地单词练习网页：463 个 PEP 3-4 年级核心词汇，每个词配例句和 CosyVoice 真人音色发音。

## 快速开始

```bash
./start.sh        # 或双击
# 自动打开 http://localhost:8765
```

## 练习模式

| 模式 | 说明 |
|------|------|
| 📖 学习 | 看单词+释义+例句，点卡片翻面，自动朗读 |
| ✍️ 词义 | 看英文回忆中文，点卡片看答案 |
| 🔤 拼写 | 看中文输入英文，自动判分 |
| 📝 例句 | 例句挖空，填入目标词 |
| 🔁 复习错词 | 只出之前做错的词 |

- 做错的词自动记入错词本（localStorage），随时复习
- 右上角可开关发音/音效

## 项目结构

```
qianqian-vocab-web/
├── index.html          # 页面
├── css/style.css       # 样式
├── js/app.js           # 逻辑
├── data/words.json     # 词表+例句+音频路径
├── audio/              # 单词/例句发音 (w_000.mp3 / s_000.mp3)
└── scripts/            # 生成脚本（可重新生成数据/音频）
```

## 重新生成音频

```bash
~/codes/cosyvoice-mlx/venv/bin/python scripts/gen_audio.py
# 断点续跑：已存在的 mp3 自动跳过
```

音色来自 `~/codes/cosyvoice-mlx/ref_audio_real.wav`（温暖女声），换音色即换该文件。

## 词表来源

人教版 PEP 3-4 年级核心词汇 463 个，例句全部人工编写（简单句、一般现在时、4 年级词汇量），挖空测试自动处理复数/三单等变形。
