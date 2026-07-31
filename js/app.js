/* 千千单词练习 - 主逻辑 */
(() => {
  'use strict';

  const MODES = {
    browse:   { label: '学习' },
    meaning:  { label: '词义' },
    spell:    { label: '拼写' },
    sentence: { label: '例句' },
    review:   { label: '复习错词' },
  };

  // ── 状态 ──
  let words = [];            // 全部词
  let queue = [];            // 当前练习队列
  let idx = 0;
  let mode = 'browse';
  let flipped = false;
  let soundOn = localStorage.getItem('qq_sound') !== 'off';
  let sessionStats = { seen: 0, wrong: [] };  // 本次练习统计
  let knownIds = new Set(JSON.parse(localStorage.getItem('qq_known') || '[]'));
  let unknownIds = new Set(JSON.parse(localStorage.getItem('qq_unknown') || '[]'));

  // ── DOM ──
  const $ = (id) => document.getElementById(id);
  const card = $('card');
  const cardWord = $('cardWord');
  const cardCn = $('cardCn');
  const cardSent = $('cardSent');
  const cardSentText = $('cardSentText');
  const cardCnSent = $('cardCnSent');
  const sentSoundBtn = $('sentSoundBtn');
  const flipBtn = $('flipBtn');
  const nextBtn = $('nextBtn');
  const progressText = $('progressText');
  const soundToggle = $('soundToggle');
  const spellArea = $('spellArea');
  const spellInput = $('spellInput');
  const spellCheck = $('spellCheck');
  const spellFeedback = $('spellFeedback');
  const sentenceArea = $('sentenceArea');
  const blankSentence = $('blankSentence');
  const sentenceInput = $('sentenceInput');
  const sentenceCheck = $('sentenceCheck');
  const sentenceFeedback = $('sentenceFeedback');
  const resultPanel = $('resultPanel');
  const resultText = $('resultText');
  const restartBtn = $('restartBtn');
  const cardArea = document.querySelector('.card-area');

  const audioCache = {};
  let audioCtx = null;
  let lastAudio = null;

  // ── 音频 ──
  function getAudio(url) {
    if (!audioCache[url]) {
      audioCache[url] = new Audio(url);
    }
    return audioCache[url];
  }

  function playSound(url) {
    if (!soundOn || !url) return;
    if (lastAudio) { lastAudio.pause(); lastAudio.currentTime = 0; }
    const a = getAudio(url);
    a.play().catch(() => {});
    lastAudio = a;
  }

  function playWord() {
    const w = queue[idx];
    if (!w) return;
    playSound(w.word_audio);
  }

  function playSentence() {
    const w = queue[idx];
    if (!w) return;
    playSound(w.sent_audio);
  }

  // 简单提示音（正确/错误）
  function beep(ok) {
    if (!soundOn) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.value = ok ? 660 : 220;
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
      osc.start(); osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {}
  }

  // ── 队列 ──
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function buildQueue() {
    let pool;
    if (mode === 'review') {
      pool = words.filter(w => unknownIds.has(w.id));
      if (!pool.length) pool = words.filter(w => !knownIds.has(w.id));
      if (!pool.length) pool = words.slice();
    } else if (mode === 'browse') {
      pool = words.slice();
    } else {
      // 练习模式：优先出题没标记过的，其次错的，最后随机
      const notSeen = words.filter(w => !knownIds.has(w.id) && !unknownIds.has(w.id));
      const unknown = words.filter(w => unknownIds.has(w.id));
      const rest = words.filter(w => knownIds.has(w.id) && !unknownIds.has(w.id));
      pool = [...shuffle(notSeen), ...shuffle(unknown), ...shuffle(rest)];
    }
    return pool;
  }

  // ── 渲染 ──
  function render() {
    const w = queue[idx];
    if (!w) return;
    flipped = false;
    progressText.textContent = `${idx + 1} / ${queue.length}`;

    // 重置各区域
    cardArea.classList.remove('hidden');
    resultPanel.classList.add('hidden');
    spellArea.classList.add('hidden');
    sentenceArea.classList.add('hidden');
    spellFeedback.classList.add('hidden');
    sentenceFeedback.classList.add('hidden');
    spellInput.value = '';
    sentenceInput.value = '';

    cardWord.textContent = w.en;
    cardCn.textContent = w.cn;
    cardSentText.textContent = w.sent;
    cardCnSent.textContent = w.cn_sent;

    // 答题模式（拼写/例句）：隐藏英文原词，防止照着抄
    const isSpell = mode === 'spell';
    const isSentence = mode === 'sentence';
    const quiz = isSpell || isSentence;
    if (quiz) cardWord.textContent = '________';

    // 各模式下中文/例句的默认显隐：
    //   browse/review: 全显示
    //   meaning:       显示英文，隐藏中文+例句（考词义）
    //   spell:         显示中文（提示），隐藏例句（例句含答案）
    //   sentence:      显示中文（提示），挖空例句在 blankSentence 中显示
    cardCn.classList.toggle('hidden', mode === 'meaning');
    cardSent.classList.toggle('hidden', mode === 'meaning' || quiz || !w.sent);
    cardCnSent.classList.toggle('hidden', mode === 'meaning' || quiz || !w.cn_sent);

    if (mode === 'spell') {
      spellArea.classList.remove('hidden');
      spellInput.focus();
    } else if (mode === 'sentence') {
      sentenceArea.classList.remove('hidden');
      renderBlank();
      sentenceInput.focus();
    }

    flipBtn.textContent = quiz ? '👁️ 显示答案' : '👁️ 隐藏答案';
    nextBtn.textContent = '下一个 ➡️';
    nextBtn.disabled = false;
    card.classList.add('pop');
    setTimeout(() => card.classList.remove('pop'), 250);

    // 学习/词义模式自动读单词
    if (mode === 'browse' || mode === 'meaning') {
      setTimeout(playWord, 150);
    }
  }

  function renderBlank() {
    const w = queue[idx];
    if (!w || !w.sent) return;
    // 用正则把目标词（含变形）替换为下划线
    const word = w.en;
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re = new RegExp('\\b' + esc + '\\b', 'i');
    let m = w.sent.match(re);
    if (!m) re = new RegExp('\\b' + esc + '(s|es|ing|ed)?\\b', 'i');
    const parts = w.sent.split(re);
    blankSentence.innerHTML = '';
    parts.forEach((part, i) => {
      if (part) blankSentence.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) {
        const b = document.createElement('span');
        b.className = 'blank';
        b.textContent = '______';
        blankSentence.appendChild(b);
      }
    });
  }

  function markAnswer(ok) {
    const w = queue[idx];
    if (!w) return;
    sessionStats.seen++;
    if (ok) {
      knownIds.add(w.id); unknownIds.delete(w.id);
      beep(true);
    } else {
      unknownIds.add(w.id); knownIds.delete(w.id);
      sessionStats.wrong.push(w);
      beep(false);
    }
    localStorage.setItem('qq_known', JSON.stringify([...knownIds]));
    localStorage.setItem('qq_unknown', JSON.stringify([...unknownIds]));
  }

  function showFeedback(el, ok, text) {
    el.textContent = text;
    el.className = 'feedback ' + (ok ? 'ok' : 'fail');
    el.classList.remove('hidden');
  }

  // ── 操作 ──
  function flip() {
    const w = queue[idx];
    if (!w) return;
    flipped = !flipped;
    const isSpell = mode === 'spell';
    const isSentence = mode === 'sentence';
    const quiz = isSpell || isSentence;

    if (quiz) {
      // 答题模式：翻面显示答案（英文原词 + 完整例句）
      cardWord.textContent = flipped ? w.en : '________';
      cardCn.classList.remove('hidden');
      cardSent.classList.toggle('hidden', !flipped);
      cardCnSent.classList.toggle('hidden', !flipped);
    } else {
      // 学习/词义/复习：英文始终显示，flip 切换中文+例句
      const hideByDefault = (mode === 'meaning');
      cardCn.classList.toggle('hidden', hideByDefault ? !flipped : flipped);
      cardSent.classList.toggle('hidden', (hideByDefault ? !flipped : flipped) || !w.sent);
      cardCnSent.classList.toggle('hidden', (hideByDefault ? !flipped : flipped) || !w.cn_sent);
    }
    flipBtn.textContent = flipped ? '🙈 隐藏答案' : '👁️ 显示答案';
  }

  function next() {
    if (idx < queue.length - 1) {
      idx++;
      render();
    } else {
      showResult();
    }
  }

  function showResult() {
    const wrong = sessionStats.wrong;
    cardArea.classList.add('hidden');
    resultPanel.classList.remove('hidden');
    const rate = queue.length ? Math.round((1 - wrong.length / queue.length) * 100) : 100;
    resultText.textContent = `共练习 ${sessionStats.seen} 个，答对 ${sessionStats.seen - wrong.length} 个，正确率 ${rate}%。` +
      (wrong.length ? ` 做错的 ${wrong.length} 个已加入错词本，可点"复习错词"。` : ' 全对，太棒了！🎉');
  }

  function restart() {
    sessionStats = { seen: 0, wrong: [] };
    idx = 0;
    queue = buildQueue();
    resultPanel.classList.add('hidden');
    cardArea.classList.remove('hidden');
    render();
  }

  // ── 事件绑定 ──
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      restart();
    });
  });

  card.addEventListener('click', (e) => {
    if (e.target.closest('.mini-sound')) return;
    // 词义模式：点击卡片即显示答案并朗读
    if (mode === 'meaning' && !flipped) {
      flip(); playWord();
    } else if (mode === 'browse') {
      flip();
    }
  });
  cardWord.addEventListener('click', playWord);
  sentSoundBtn.addEventListener('click', (e) => { e.stopPropagation(); playSentence(); });
  flipBtn.addEventListener('click', flip);
  nextBtn.addEventListener('click', next);

  // 键盘：回车下一个，空格听发音
  document.addEventListener('keydown', (e) => {
    if (e.target === spellInput || e.target === sentenceInput) {
      if (e.key === 'Enter') {
        if (mode === 'spell') checkSpell();
        else if (mode === 'sentence') checkSentence();
      }
      return;
    }
    if (e.key === 'Enter') next();
    if (e.key === ' ') { e.preventDefault(); playWord(); }
  });

  // 拼写检查
  spellCheck.addEventListener('click', checkSpell);
  function checkSpell() {
    const w = queue[idx];
    if (!w) return;
    const ans = spellInput.value.trim().toLowerCase();
    const correct = w.en.toLowerCase();
    const ok = ans === correct || ans === correct.replace(/ /g, '');
    if (ans === '') return;
    if (ok) {
      showFeedback(spellFeedback, true, '✅ 正确！');
      cardCn.classList.remove('hidden');
      cardSent.classList.remove('hidden');
      cardCnSent.classList.remove('hidden');
      markAnswer(true);
      setTimeout(next, 900);
    } else {
      showFeedback(spellFeedback, false, `❌ 不对，正确答案是 ${w.en}`);
      cardCn.classList.remove('hidden');
      markAnswer(false);
      setTimeout(() => {
        spellFeedback.classList.add('hidden');
        spellInput.value = '';
        spellInput.focus();
      }, 1400);
    }
  }

  // 例句挖空检查
  sentenceCheck.addEventListener('click', checkSentence);
  function checkSentence() {
    const w = queue[idx];
    if (!w) return;
    const ans = sentenceInput.value.trim().toLowerCase();
    if (ans === '') return;
    const correct = w.en.toLowerCase();
    const ok = ans === correct;
    if (ok) {
      showFeedback(sentenceFeedback, true, '✅ 正确！');
      fillBlank();
      markAnswer(true);
      setTimeout(next, 900);
    } else {
      showFeedback(sentenceFeedback, false, `❌ 不对，应该是 ${w.en}`);
      fillBlank();
      markAnswer(false);
      setTimeout(() => {
        sentenceFeedback.classList.add('hidden');
        sentenceInput.value = '';
        sentenceInput.focus();
      }, 1400);
    }
  }

  function fillBlank() {
    const w = queue[idx];
    const blanks = blankSentence.querySelectorAll('.blank');
    blanks.forEach(b => { b.textContent = w.en; b.classList.add('filled'); });
  }

  // 音效开关
  soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('qq_sound', soundOn ? 'on' : 'off');
    soundToggle.textContent = soundOn ? '🔊' : '🔇';
    soundToggle.classList.toggle('off', !soundOn);
  });

  restartBtn.addEventListener('click', restart);

  // ── 初始化 ──
  soundToggle.textContent = soundOn ? '🔊' : '🔇';
  soundToggle.classList.toggle('off', !soundOn);

  fetch('data/words.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => {
      words = data.words;
      queue = buildQueue();
      render();
    })
    .catch(err => {
      cardWord.textContent = '加载失败';
      cardCn.textContent = '请确认 data/words.json 存在，并用本地服务器打开（python3 -m http.server）';
    });

})();
