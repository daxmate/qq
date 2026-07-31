/* 千千单词练习 - 间隔记忆 v2
 * 待学区 → 学习 → 词义待考(连续通过3次解锁拼写) → 拼写待考(连续通过3次解锁例句) → 例句待考(连续通过3次毕业)
 * 词义/拼写区长期保留，间隔按 Anki 风格翻倍：1→3→7→15→31→63 天
 * 答错清零重来；每个考区可「完全掌握」移出（可恢复）
 */
(() => {
  'use strict';

  const MODES = {
    learn:    { label: '学习' },
    meaning:  { label: '词义待考' },
    spell:    { label: '拼写待考' },
    sentence: { label: '例句待考' },
  };

  // Anki 风格间隔序列（通过次数 → 下次间隔天数）：1, 3, 7, 15, 31, 63, 127...
  function nextInterval(streak) {
    return Math.pow(2, streak + 1) - 1;
  }
  const PASS_COUNT_TO_UNLOCK = 3;   // 连续通过 3 次解锁下一考区 / 毕业

  const SRS_KEY = 'qq_srs_v2';

  // ── 状态 ──
  let words = [];            // 全部词
  let queue = [];            // 当前练习队列
  let idx = 0;
  let mode = 'learn';
  let flipped = false;
  let soundOn = localStorage.getItem('qq_sound') !== 'off';
  let autoSent = localStorage.getItem('qq_auto_sent') !== 'off';   // 学习时自动连播例句，默认开
  let srs = null;            // 间隔记忆数据

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
  const settingsBtn = $('settingsBtn');
  const settingsPanel = $('settingsPanel');
  const dailyInput = $('dailyInput');
  const dailySave = $('dailySave');
  const autoSentToggle = $('autoSentToggle');
  const learnArea = $('learnArea');
  const learnDoneBtn = $('learnDoneBtn');
  const quizArea = $('quizArea');
  const knowBtn = $('knowBtn');
  const dontKnowBtn = $('dontKnowBtn');
  const spellArea = $('spellArea');
  const spellInput = $('spellInput');
  const spellCheck = $('spellCheck');
  const spellFeedback = $('spellFeedback');
  const sentenceArea = $('sentenceArea');
  const blankSentence = $('blankSentence');
  const sentenceInput = $('sentenceInput');
  const sentenceCheck = $('sentenceCheck');
  const sentenceFeedback = $('sentenceFeedback');
  const masterArea = $('masterArea');
  const masterBtn = $('masterBtn');
  const restoreArea = $('restoreArea');
  const restoreBtn = $('restoreBtn');
  const restoreList = $('restoreList');
  const resultPanel = $('resultPanel');
  const resultTitle = $('resultTitle');
  const resultText = $('resultText');
  const restartBtn = $('restartBtn');
  const cardArea = document.querySelector('.card-area');
  const stLearn = $('stLearn');
  const stMeaning = $('stMeaning');
  const stSpell = $('stSpell');
  const stSentence = $('stSentence');
  const stDone = $('stDone');

  const audioCache = {};
  let audioCtx = null;
  let lastAudio = null;

  // ── 日期工具 ──
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function addDaysStr(s, n) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  // ── 间隔记忆数据 ──
  // srs = {
  //   learning: [id],             待学区
  //   meaning:  { id: {streak, due} },
  //   spell:    { id: {streak, due} },
  //   sentence: { id: {streak, due} },
  //   removed:  { meaning: [id], spell: [id], sentence: [id] },  已移出（可恢复）
  //   done: [id],                 毕业
  //   daily: 10,
  //   todayLearn: [id],           今天分配的学习队列
  //   lastDate: 'YYYY-MM-DD',
  // }
  const BOXES = ['meaning', 'spell', 'sentence'];
  function defaultSrs() {
    return {
      learning: [],
      meaning: {}, spell: {}, sentence: {},
      removed: { meaning: [], spell: [], sentence: [] },
      done: [],
      daily: 10,
      todayLearn: [],
      lastDate: null,
    };
  }
  function loadSrs() {
    try {
      const raw = localStorage.getItem(SRS_KEY);
      srs = raw ? JSON.parse(raw) : null;
    } catch (e) { srs = null; }
    if (!srs || !srs.removed) srs = defaultSrs();
  }
  function saveSrs() {
    localStorage.setItem(SRS_KEY, JSON.stringify(srs));
  }

  function boxDueCount(boxName) {
    const box = srs[boxName];
    const t = todayStr();
    return Object.values(box).filter(r => r.due <= t).length;
  }
  function boxDueIds(boxName) {
    const box = srs[boxName];
    const t = todayStr();
    return Object.entries(box).filter(([, r]) => r.due <= t).map(([id]) => Number(id));
  }

  // 每天分配新词：首次打开时从待学区取 daily 个
  function assignToday() {
    const t = todayStr();
    if (srs.lastDate === t) return;
    srs.lastDate = t;
    const n = Math.min(srs.daily, srs.learning.length);
    srs.todayLearn = srs.learning.slice(0, n);
    saveSrs();
  }

  // ── 音频 ──
  function getAudio(url) {
    if (!audioCache[url]) audioCache[url] = new Audio(url);
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

  // ── 队列构建 ──
  function buildQueue() {
    if (mode === 'learn') {
      const todo = srs.todayLearn.filter(id => srs.learning.includes(id));
      return todo.map(id => words[id]).filter(Boolean);
    }
    // 考区：到期词
    const ids = boxDueIds(mode);
    return ids.map(id => words[id]).filter(Boolean);
  }

  function updateStatusBar() {
    stLearn.innerHTML = `📖 待学 <b>${srs.learning.length}</b>`;
    stMeaning.innerHTML = `词义 <b>${boxDueCount('meaning')}</b>`;
    stSpell.innerHTML = `拼写 <b>${boxDueCount('spell')}</b>`;
    stSentence.innerHTML = `例句 <b>${boxDueCount('sentence')}</b>`;
    stDone.innerHTML = `✅ <b>${srs.done.length}</b>`;
    // 考区按钮：无到期内容且无已移出 → 禁用
    document.querySelectorAll('.mode-btn').forEach(btn => {
      const m = btn.dataset.mode;
      if (BOXES.includes(m)) {
        const hasDue = boxDueCount(m) > 0;
        const hasRemoved = srs.removed[m].length > 0;
        btn.disabled = !hasDue && !hasRemoved;
        // 显示到期数量
        const n = boxDueCount(m);
        const label = MODES[m].label;
        btn.textContent = hasDue ? `${label} (${n})` : (hasRemoved ? `${label} (已移出${srs.removed[m].length})` : label);
      }
    });
  }

  // ── 渲染 ──
  function render() {
    const w = queue[idx];
    if (!w) { showResult(); return; }
    flipped = false;
    progressText.textContent = `${idx + 1} / ${queue.length}`;

    cardArea.classList.remove('hidden');
    resultPanel.classList.add('hidden');
    learnArea.classList.add('hidden');
    quizArea.classList.add('hidden');
    spellArea.classList.add('hidden');
    sentenceArea.classList.add('hidden');
    masterArea.classList.add('hidden');
    restoreArea.classList.add('hidden');
    restoreList.classList.add('hidden');
    spellFeedback.classList.add('hidden');
    sentenceFeedback.classList.add('hidden');
    spellInput.value = '';
    sentenceInput.value = '';
    flipBtn.classList.remove('hidden');
    nextBtn.classList.remove('hidden');

    cardWord.textContent = w.en;
    cardCn.textContent = w.cn;
    cardSentText.textContent = w.sent;
    cardCnSent.textContent = w.cn_sent;

    if (mode === 'learn') {
      // 学习模式：全展示，点「学会了」
      cardWord.textContent = w.en;
      cardCn.classList.remove('hidden');
      cardSent.classList.toggle('hidden', !w.sent);
      cardCnSent.classList.toggle('hidden', !w.cn_sent);
      learnArea.classList.remove('hidden');
      flipBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
    } else if (mode === 'meaning') {
      // 词义：看英文想中文，隐藏答案
      cardWord.textContent = w.en;
      cardCn.classList.add('hidden');
      cardSent.classList.add('hidden');
      cardCnSent.classList.add('hidden');
      quizArea.classList.remove('hidden');
      masterArea.classList.remove('hidden');
      flipBtn.textContent = '👁️ 显示答案';
    } else if (mode === 'spell') {
      // 拼写：看中文写英文，隐藏英文
      cardWord.textContent = '________';
      cardCn.classList.remove('hidden');       // 中文是题目
      cardSent.classList.add('hidden');
      cardCnSent.classList.add('hidden');
      spellArea.classList.remove('hidden');
      masterArea.classList.remove('hidden');
      spellInput.focus();
      flipBtn.textContent = '👁️ 显示答案';
    } else if (mode === 'sentence') {
      // 例句：挖空填词
      cardWord.textContent = '________';
      cardCn.classList.remove('hidden');       // 中文提示
      cardSent.classList.add('hidden');
      cardCnSent.classList.add('hidden');
      sentenceArea.classList.remove('hidden');
      masterArea.classList.remove('hidden');
      renderBlank();
      sentenceInput.focus();
      flipBtn.textContent = '👁️ 显示答案';
    }
    card.classList.add('pop');
    setTimeout(() => card.classList.remove('pop'), 250);
    if (mode === 'learn' || mode === 'meaning') setTimeout(playWord, 150);
    if (mode === 'learn' && autoSent) {
      // 学习模式：播完单词后自动连播例句
      setTimeout(() => { if (autoSent && mode === 'learn') playSentence(); }, 1800);
    }
    if (mode === 'sentence') setTimeout(playSentence, 300);
  }

  function renderBlank() {
    const w = queue[idx];
    if (!w || !w.sent) return;
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

  // ── 核心：通过/答错 ──
  function markResult(ok) {
    const w = queue[idx];
    if (!w) return;
    const boxName = mode;
    const box = srs[boxName];
    const rec = box[w.id] || { streak: 0, due: todayStr() };
    const t = todayStr();

    if (ok) {
      rec.streak += 1;
      if (rec.streak >= PASS_COUNT_TO_UNLOCK) {
        if (boxName === 'sentence') {
          // 例句区：毕业
          delete box[w.id];
          srs.done.push(w.id);
        } else {
          // 词义/拼写：解锁下一考区（下一区从 streak=0 开始），本区继续保留、间隔继续拉长
          const nextBox = boxName === 'meaning' ? 'spell' : 'sentence';
          if (!srs[nextBox][w.id]) {
            srs[nextBox][w.id] = { streak: 0, due: addDaysStr(t, nextInterval(0)) };
          }
          rec.due = addDaysStr(t, nextInterval(rec.streak));
          box[w.id] = rec;
        }
      } else {
        // 还没满 3 次：本区间隔拉长
        rec.due = addDaysStr(t, nextInterval(rec.streak));
        box[w.id] = rec;
      }
      beep(true);
    } else {
      // 答错：清零重来，明天考
      rec.streak = 0;
      rec.due = addDaysStr(t, nextInterval(0));
      box[w.id] = rec;
      beep(false);
    }
    saveSrs();
    updateStatusBar();
  }

  function markLearn() {
    const w = queue[idx];
    if (!w) return;
    srs.learning = srs.learning.filter(id => id !== w.id);
    srs.meaning[w.id] = { streak: 0, due: addDaysStr(todayStr(), nextInterval(0)) };
    saveSrs();
    beep(true);
    updateStatusBar();
    next();
  }

  // 完全掌握：从当前考区移出（可恢复）
  function markMastered() {
    const w = queue[idx];
    if (!w) return;
    if (!BOXES.includes(mode)) return;
    const box = srs[mode];
    if (box[w.id]) {
      delete box[w.id];
      if (!srs.removed[mode].includes(w.id)) srs.removed[mode].push(w.id);
      saveSrs();
      updateStatusBar();
      showResult();
    }
  }

  // 恢复：把已移出的词加回当前考区（从明天开始重新考核）
  function restoreWord(id, boxName) {
    srs.removed[boxName] = srs.removed[boxName].filter(x => x !== id);
    srs[boxName][id] = { streak: 0, due: addDaysStr(todayStr(), nextInterval(0)) };
    saveSrs();
    updateStatusBar();
    renderRestoreList();
  }
  function renderRestoreList() {
    if (!BOXES.includes(mode)) return;
    const ids = srs.removed[mode];
    if (!ids.length) {
      restoreList.classList.add('hidden');
      return;
    }
    restoreList.classList.remove('hidden');
    restoreList.innerHTML = '';
    ids.forEach(id => {
      const w = words[id];
      if (!w) return;
      const row = document.createElement('div');
      row.className = 'restore-row';
      const info = document.createElement('span');
      info.textContent = `${w.en} ${w.cn}`;
      const btn = document.createElement('button');
      btn.textContent = '加回';
      btn.className = 'btn-mini';
      btn.addEventListener('click', () => restoreWord(id, mode));
      row.appendChild(info);
      row.appendChild(btn);
      restoreList.appendChild(row);
    });
  }

  function showResult() {
    cardArea.classList.add('hidden');
    learnArea.classList.add('hidden');
    quizArea.classList.add('hidden');
    spellArea.classList.add('hidden');
    sentenceArea.classList.add('hidden');
    masterArea.classList.add('hidden');
    flipBtn.classList.add('hidden');
    nextBtn.classList.add('hidden');
    resultPanel.classList.remove('hidden');
    updateStatusBar();

    if (mode === 'learn') {
      // todayLearn 保留今日分配记录；已学 = 今日总数 - 还没学的
      const left = srs.todayLearn.filter(id => srs.learning.includes(id)).length;
      const total = srs.todayLearn.length;
      const learned = total - left;
      resultTitle.textContent = left ? '📖 今天的新词学完了！' : '🎉 今日学习任务完成！';
      resultText.textContent = `已学 ${learned} 个（今日共 ${total} 个）。` +
        (boxDueCount('meaning') ? ` 词义待考有 ${boxDueCount('meaning')} 个词到期，去考一考吧！` : ' 明天记得来考试哦！');
    } else {
      const left = boxDueCount(mode);
      resultTitle.textContent = '🎉 本区考试完成！';
      resultText.textContent = `本次共考 ${queue.length} 个词。` +
        (left ? ` 还有 ${left} 个到期待考。` : '') +
        (boxDueCount('meaning') ? ` 词义待考有 ${boxDueCount('meaning')} 个到期。` : ' 明天再来吧！');
    }
  }

  function next() {
    if (idx < queue.length - 1) {
      idx++;
      render();
    } else {
      showResult();
    }
  }

  function restart() {
    idx = 0;
    queue = buildQueue();
    if (!queue.length) {
      // 没有可学/可考的内容
      cardArea.classList.add('hidden');
      learnArea.classList.add('hidden');
      quizArea.classList.add('hidden');
      spellArea.classList.add('hidden');
      sentenceArea.classList.add('hidden');
      masterArea.classList.add('hidden');
      flipBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
      resultPanel.classList.remove('hidden');
      if (mode === 'learn') {
        resultTitle.textContent = '📖 今天的新词学完了！';
        resultText.textContent = `待学区还剩 ${srs.learning.length} 个词，明天继续。`;
      } else {
        resultTitle.textContent = '⏰ 该区暂无到期考试';
        const nxt = boxDueCount('meaning') ? `词义待考有 ${boxDueCount('meaning')} 个到期。` : '明天再来吧！';
        resultText.textContent = `${MODES[mode].label}区还没有到期的词。${nxt}`;
      }
      // 有已移出的词时，显示恢复入口
      if (BOXES.includes(mode) && srs.removed[mode].length) {
        restoreArea.classList.remove('hidden');
        renderRestoreList();
        resultText.textContent += `（有 ${srs.removed[mode].length} 个已移出的词可恢复）`;
      }
      updateStatusBar();
      return;
    }
    render();
  }

  function flip() {
    const w = queue[idx];
    if (!w) return;
    flipped = !flipped;
    if (mode === 'meaning' || mode === 'spell' || mode === 'sentence') {
      cardWord.textContent = flipped ? w.en : (mode === 'meaning' ? w.en : '________');
      cardCn.classList.toggle('hidden', mode === 'meaning' ? !flipped : false);
      cardSent.classList.toggle('hidden', !flipped || !w.sent);
      cardCnSent.classList.toggle('hidden', !flipped || !w.cn_sent);
      flipBtn.textContent = flipped ? '🙈 隐藏答案' : '👁️ 显示答案';
    } else {
      cardCn.classList.toggle('hidden', flipped);
      cardSent.classList.toggle('hidden', flipped || !w.sent);
      cardCnSent.classList.toggle('hidden', flipped || !w.cn_sent);
    }
  }

  function showAnswer() {
    const w = queue[idx];
    if (!w) return;
    cardWord.textContent = w.en;
    cardCn.classList.remove('hidden');
    cardSent.classList.remove('hidden');
    cardCnSent.classList.remove('hidden');
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
    if ((mode === 'meaning' || mode === 'spell' || mode === 'sentence') && !flipped) {
      flip(); playWord();
    }
  });
  cardWord.addEventListener('click', playWord);
  sentSoundBtn.addEventListener('click', (e) => { e.stopPropagation(); playSentence(); });
  flipBtn.addEventListener('click', flip);
  nextBtn.addEventListener('click', next);
  learnDoneBtn.addEventListener('click', markLearn);
  knowBtn.addEventListener('click', () => { markResult(true); showAnswer(); setTimeout(next, 900); });
  dontKnowBtn.addEventListener('click', () => { markResult(false); showAnswer(); setTimeout(next, 1600); });
  spellCheck.addEventListener('click', checkSpell);
  sentenceCheck.addEventListener('click', checkSentence);
  masterBtn.addEventListener('click', markMastered);
  restoreBtn.addEventListener('click', () => {
    restoreList.classList.toggle('hidden');
    renderRestoreList();
  });

  function checkSpell() {
    const w = queue[idx];
    if (!w) return;
    const ans = spellInput.value.trim().toLowerCase();
    const correct = w.en.toLowerCase();
    const ok = ans === correct || ans === correct.replace(/ /g, '');
    if (ans === '') return;
    if (ok) {
      showFeedback(spellFeedback, true, '✅ 正确！');
      markResult(true);
      showAnswer();
      setTimeout(next, 900);
    } else {
      showFeedback(spellFeedback, false, `❌ 不对，正确答案是 ${w.en}`);
      markResult(false);
      showAnswer();
      setTimeout(() => {
        spellFeedback.classList.add('hidden');
        spellInput.value = '';
        spellInput.focus();
      }, 1600);
    }
  }

  function checkSentence() {
    const w = queue[idx];
    if (!w) return;
    const ans = sentenceInput.value.trim().toLowerCase();
    if (ans === '') return;
    const correct = w.en.toLowerCase();
    const ok = ans === correct;
    if (ok) {
      showFeedback(sentenceFeedback, true, '✅ 正确！');
      markResult(true);
      showAnswer();
      setTimeout(next, 900);
    } else {
      showFeedback(sentenceFeedback, false, `❌ 不对，应该是 ${w.en}`);
      markResult(false);
      showAnswer();
      setTimeout(() => {
        sentenceFeedback.classList.add('hidden');
        sentenceInput.value = '';
        sentenceInput.focus();
      }, 1600);
    }
  }

  function showFeedback(el, ok, text) {
    el.textContent = text;
    el.className = 'feedback ' + (ok ? 'ok' : 'fail');
    el.classList.remove('hidden');
  }

  restartBtn.addEventListener('click', restart);

  // 设置
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    dailyInput.value = srs.daily;
    autoSentToggle.checked = autoSent;
  });
  dailySave.addEventListener('click', () => {
    const v = parseInt(dailyInput.value, 10);
    if (v >= 1 && v <= 100) {
      srs.daily = v;
      saveSrs();
      settingsPanel.classList.add('hidden');
      updateStatusBar();
    }
  });
  autoSentToggle.addEventListener('change', () => {
    autoSent = autoSentToggle.checked;
    localStorage.setItem('qq_auto_sent', autoSent ? 'on' : 'off');
  });

  // 音效
  soundToggle.addEventListener('click', () => {
    soundOn = !soundOn;
    localStorage.setItem('qq_sound', soundOn ? 'on' : 'off');
    soundToggle.textContent = soundOn ? '🔊' : '🔇';
    soundToggle.classList.toggle('off', !soundOn);
  });

  // 键盘
  document.addEventListener('keydown', (e) => {
    if (e.target === dailyInput) return;
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

  // ── 初始化 ──
  soundToggle.textContent = soundOn ? '🔊' : '🔇';
  soundToggle.classList.toggle('off', !soundOn);

  fetch('data/words.json')
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => {
      words = data.words;
      loadSrs();
      // 首次使用：全部词进待学区
      if (!srs.learning.length && !srs.done.length && !Object.keys(srs.meaning).length && !Object.keys(srs.spell).length && !Object.keys(srs.sentence).length) {
        srs.learning = words.map(w => w.id);
        saveSrs();
      }
      assignToday();
      updateStatusBar();
      restart();
    })
    .catch(err => {
      cardWord.textContent = '加载失败';
      cardCn.textContent = '请确认 data/words.json 存在，并用本地服务器打开（python3 -m http.server）';
    });

})();
