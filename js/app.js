/* 千千单词练习 - 间隔记忆主逻辑
 * 流程：待学区 → 学习 → 待考①(隔1天) → 待考②(隔3天) → 待考③(隔7天) → 毕业
 * 答错回到待考①重新开始。
 */
(() => {
  'use strict';

  const MODES = {
    learn: { label: '学习' },
    box1:  { label: '待考①' },
    box2:  { label: '待考②' },
    box3:  { label: '待考③' },
  };

  // 各待考区的间隔天数（进入该区后几天考）
  const BOX_INTERVALS = { 1: 1, 2: 3, 3: 7 };
  const SRS_KEY = 'qq_srs_v2';

  // ── 状态 ──
  let words = [];            // 全部词
  let queue = [];            // 当前练习队列
  let idx = 0;
  let mode = 'learn';
  let flipped = false;
  let soundOn = localStorage.getItem('qq_sound') !== 'off';
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
  const learnArea = $('learnArea');
  const learnDoneBtn = $('learnDoneBtn');
  const quizArea = $('quizArea');
  const knowBtn = $('knowBtn');
  const dontKnowBtn = $('dontKnowBtn');
  const resultPanel = $('resultPanel');
  const resultTitle = $('resultTitle');
  const resultText = $('resultText');
  const restartBtn = $('restartBtn');
  const cardArea = document.querySelector('.card-area');
  const stLearn = $('stLearn');
  const stBox1 = $('stBox1');
  const stBox2 = $('stBox2');
  const stBox3 = $('stBox3');
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
  function defaultSrs() {
    return {
      learning: [],   // 待学区（未学过的词 id）
      box1: {},       // id -> 考试日期 'YYYY-MM-DD'
      box2: {},
      box3: {},
      done: [],       // 毕业
      daily: 10,      // 每天学习新词数
      todayLearn: [], // 今天分配的学习队列
      lastDate: null, // 上次分配日期
    };
  }
  function loadSrs() {
    try {
      const raw = localStorage.getItem(SRS_KEY);
      srs = raw ? JSON.parse(raw) : null;
    } catch (e) { srs = null; }
    if (!srs) srs = defaultSrs();
  }
  function saveSrs() {
    localStorage.setItem(SRS_KEY, JSON.stringify(srs));
  }

  function dueCount(box) {
    const t = todayStr();
    return Object.values(box).filter(d => d <= t).length;
  }
  function dueIds(box) {
    const t = todayStr();
    return Object.entries(box).filter(([, d]) => d <= t).map(([id]) => Number(id));
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
      // 今日待学（还没学完的）
      const todo = srs.todayLearn.filter(id => srs.learning.includes(id));
      return todo.map(id => words[id]).filter(Boolean);
    }
    // 待考区：到期词
    const box = srs['box' + mode.slice(3)];
    const ids = dueIds(box);
    return ids.map(id => words[id]).filter(Boolean);
  }

  function updateStatusBar() {
    const n = (ids) => ids.length;
    stLearn.innerHTML = `📖 待学 <b>${n(srs.learning)}</b>`;
    stBox1.innerHTML = `① <b>${dueCount(srs.box1)}</b>`;
    stBox2.innerHTML = `② <b>${dueCount(srs.box2)}</b>`;
    stBox3.innerHTML = `③ <b>${dueCount(srs.box3)}</b>`;
    stDone.innerHTML = `✅ <b>${n(srs.done)}</b>`;
    // 待考按钮：无到期内容则禁用
    document.querySelectorAll('.mode-btn').forEach(btn => {
      if (btn.dataset.mode.startsWith('box')) {
        const bn = btn.dataset.mode.slice(3);
        btn.disabled = dueCount(srs['box' + bn]) === 0;
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
    flipBtn.classList.remove('hidden');
    nextBtn.classList.remove('hidden');

    cardWord.textContent = w.en;
    cardCn.textContent = w.cn;
    cardSentText.textContent = w.sent;
    cardCnSent.textContent = w.cn_sent;

    const isQuiz = mode.startsWith('box');
    // 学习模式：直接显示全部（学新词）
    if (mode === 'learn') {
      cardWord.textContent = w.en;
      cardCn.classList.remove('hidden');
      cardSent.classList.toggle('hidden', !w.sent);
      cardCnSent.classList.toggle('hidden', !w.cn_sent);
      learnArea.classList.remove('hidden');
      flipBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
    } else {
      // 待考模式：看英文想中文，隐藏答案
      cardWord.textContent = w.en;
      cardCn.classList.add('hidden');
      cardSent.classList.add('hidden');
      cardCnSent.classList.add('hidden');
      quizArea.classList.remove('hidden');
      flipBtn.textContent = '👁️ 显示答案';
    }
    card.classList.add('pop');
    setTimeout(() => card.classList.remove('pop'), 250);
    setTimeout(playWord, 150);
  }

  function markLearn() {
    const w = queue[idx];
    if (!w) return;
    // 从待学区移除 → 进待考①（明天考）
    srs.learning = srs.learning.filter(id => id !== w.id);
    srs.box1[w.id] = addDaysStr(todayStr(), BOX_INTERVALS[1]);
    srs.todayLearn = srs.todayLearn.filter(id => id !== w.id);
    saveSrs();
    beep(true);
    updateStatusBar();
    next();
  }

  function markAnswer(ok) {
    const w = queue[idx];
    if (!w) return;
    const boxN = Number(mode.slice(3));
    const box = srs['box' + boxN];
    delete box[w.id];
    const t = todayStr();
    if (ok) {
      if (boxN >= 3) {
        // 毕业
        srs.done.push(w.id);
      } else {
        // 升下一区
        srs['box' + (boxN + 1)][w.id] = addDaysStr(t, BOX_INTERVALS[boxN + 1]);
      }
      beep(true);
    } else {
      // 答错回待考①，明天重考
      srs.box1[w.id] = addDaysStr(t, BOX_INTERVALS[1]);
      beep(false);
    }
    saveSrs();
    updateStatusBar();
  }

  function showResult() {
    cardArea.classList.add('hidden');
    learnArea.classList.add('hidden');
    quizArea.classList.add('hidden');
    flipBtn.classList.add('hidden');
    nextBtn.classList.add('hidden');
    resultPanel.classList.remove('hidden');
    updateStatusBar();
    if (mode === 'learn') {
      const left = srs.todayLearn.filter(id => srs.learning.includes(id)).length;
      resultTitle.textContent = left ? '📖 今天的新词学完了！' : '🎉 今日学习任务完成！';
      resultText.textContent = `已学 ${srs.daily - left} 个（今日共 ${Math.min(srs.daily, srs.todayLearn.length + left)} 个）。` +
        (dueCount(srs.box1) ? ` 待考①有 ${dueCount(srs.box1)} 个词到期，去考一考吧！` : ' 明天记得来考试哦！');
    } else {
      const boxN = Number(mode.slice(3));
      const left = dueCount(srs['box' + boxN]);
      resultTitle.textContent = '🎉 本区考试完成！';
      resultText.textContent = `本次共考 ${queue.length} 个词。` +
        (left ? ` 还有 ${left} 个到期待考。` : '') +
        (dueCount(srs.box1) ? ` 待考①有 ${dueCount(srs.box1)} 个到期。` : ' 明天再来吧！');
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
      flipBtn.classList.add('hidden');
      nextBtn.classList.add('hidden');
      resultPanel.classList.remove('hidden');
      if (mode === 'learn') {
        resultTitle.textContent = '📖 今天的新词学完了！';
        resultText.textContent = `待学区还剩 ${srs.learning.length} 个词，明天继续。`;
      } else {
        const boxN = Number(mode.slice(3));
        resultTitle.textContent = '⏰ 该区暂无到期考试';
        const nxt = dueCount(srs.box1) ? `待考①有 ${dueCount(srs.box1)} 个到期。` : '明天再来吧！';
        resultText.textContent = `待考${'①②③'[boxN - 1]}区还没有到期的词。${nxt}`;
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
    if (mode.startsWith('box')) {
      cardWord.textContent = flipped ? w.en : w.en;
      cardCn.classList.toggle('hidden', !flipped);
      cardSent.classList.toggle('hidden', !flipped || !w.sent);
      cardCnSent.classList.toggle('hidden', !flipped || !w.cn_sent);
      flipBtn.textContent = flipped ? '🙈 隐藏答案' : '👁️ 显示答案';
    } else {
      cardCn.classList.toggle('hidden', flipped);
      cardSent.classList.toggle('hidden', flipped || !w.sent);
      cardCnSent.classList.toggle('hidden', flipped || !w.cn_sent);
    }
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
    if (mode.startsWith('box') && !flipped) {
      flip(); playWord();
    }
  });
  cardWord.addEventListener('click', playWord);
  sentSoundBtn.addEventListener('click', (e) => { e.stopPropagation(); playSentence(); });
  flipBtn.addEventListener('click', flip);
  nextBtn.addEventListener('click', next);
  learnDoneBtn.addEventListener('click', markLearn);
  knowBtn.addEventListener('click', () => { markAnswer(true); setTimeout(next, 400); });
  dontKnowBtn.addEventListener('click', () => { markAnswer(false); showAnswer(); setTimeout(next, 1600); });

  function showAnswer() {
    const w = queue[idx];
    if (!w) return;
    cardCn.classList.remove('hidden');
    cardSent.classList.remove('hidden');
    cardCnSent.classList.remove('hidden');
    playWord();
  }

  restartBtn.addEventListener('click', restart);

  // 设置
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    dailyInput.value = srs.daily;
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
      if (!srs.learning.length && !srs.done.length && !Object.keys(srs.box1).length) {
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
