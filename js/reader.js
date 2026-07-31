/* 📚 千千原版书阅读器
 * - 书架：EPUB 存 IndexedDB（浏览器本地，离线可用）
 * - 阅读：epub.js 渲染，翻页/目录/字体大小/进度记忆
 * - 生词本：选中文本加入，导出文本文件
 */
(() => {
  'use strict';

  // ── IndexedDB ──
  const DB_NAME = 'qq_reader';
  const DB_VER = 1;
  let db = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('books')) {
          d.createObjectStore('books', { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('progress')) {
          d.createObjectStore('progress', { keyPath: 'bookId' });
        }
        if (!d.objectStoreNames.contains('wordbook')) {
          d.createObjectStore('wordbook', { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode = 'readonly') {
    return db.transaction(store, mode).objectStore(store);
  }
  function dbGet(store, key) {
    return new Promise((res, rej) => {
      const r = tx(store).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function dbGetAll(store) {
    return new Promise((res, rej) => {
      const r = tx(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function dbPut(store, val) {
    return new Promise((res, rej) => {
      const r = tx(store, 'readwrite').put(val);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function dbDelete(store, key) {
    return new Promise((res, rej) => {
      const r = tx(store, 'readwrite').delete(key);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  // ── 状态 ──
  let currentBook = null;    // {id, title, fileName, size, addedAt}
  let book = null;           // epub.js 实例
  let rendition = null;      // epub.js rendition
  let fontLevel = 0;         // -1 / 0 / 1
  let pendingWord = null;    // {word, sentence, bookTitle}

  const $ = (id) => document.getElementById(id);
  const shelfView = $('shelfView');
  const readerView = $('readerView');
  const shelfGrid = $('shelfGrid');
  const shelfEmpty = $('shelfEmpty');
  const fileInput = $('fileInput');
  const readerTitle = $('readerTitle');
  const readerBody = $('readerBody');
  const epubView = $('epubView');
  const tocDrawer = $('tocDrawer');
  const tocList = $('tocList');
  const fontDrawer = $('fontDrawer');
  const wordPopup = $('wordPopup');
  const popupWord = $('popupWord');
  const popupSentence = $('popupSentence');
  const wordbookModal = $('wordbookModal');
  const wordbookList = $('wordbookList');

  const FONT_SIZES = { '-1': '14px', '0': '18px', '1': '22px' };

  // ── 书架 ──
  async function renderShelf() {
    const books = await dbGetAll('books');
    shelfEmpty.classList.toggle('hidden', books.length > 0);
    shelfGrid.innerHTML = '';
    books.sort((a, b) => b.addedAt - a.addedAt);
    books.forEach(b => {
      const card = document.createElement('div');
      card.className = 'shelf-card';
      const title = document.createElement('div');
      title.className = 'shelf-card-title';
      title.textContent = b.title || b.fileName;
      const meta = document.createElement('div');
      meta.className = 'shelf-card-meta';
      meta.textContent = `${(b.size / 1024 / 1024).toFixed(1)} MB`;
      const del = document.createElement('button');
      del.className = 'shelf-card-del';
      del.textContent = '🗑️';
      del.title = '删除';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`删除《${b.title || b.fileName}》？`)) return;
        await dbDelete('books', b.id);
        await dbDelete('progress', b.id);
        renderShelf();
      });
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(del);
      card.addEventListener('click', () => openBook(b));
      shelfGrid.appendChild(card);
    });
  }

  async function addBook(file) {
    if (!file || !file.name.toLowerCase().endsWith('.epub')) {
      alert('请选择 .epub 文件');
      return;
    }
    const buf = await file.arrayBuffer();
    const id = 'b' + Date.now();
    const rec = {
      id,
      fileName: file.name,
      title: file.name.replace(/\.epub$/i, ''),
      data: buf,
      size: file.size,
      addedAt: Date.now(),
    };
    await dbPut('books', rec);
    renderShelf();
  }

  // ── 打开书 ──
  async function openBook(rec) {
    currentBook = rec;
    readerTitle.textContent = rec.title || rec.fileName;
    shelfView.classList.add('hidden');
    readerView.classList.remove('hidden');
    readerBody.classList.remove('hidden');

    book = ePub(rec.data);
    rendition = book.renderTo(epubView, { width: '100%', height: '100%', flow: 'paginated', spread: 'none', swipe: true, allowScriptedContent: true, allowPopups: true });

    rendition.themes.fontSize(FONT_SIZES[fontLevel]);

    // 选词处理：桌面端 epub.js selected 事件（双击）
    rendition.on('selected', (cfiRange, contents) => {
      handleSelection(cfiRange, contents);
    });

    // 选词处理：移动端长按选词（selectionchange 兑底）
    let selTimer = null;
    const bindSelection = (contents) => {
      try {
        const doc = contents.document;
        doc.addEventListener('selectionchange', () => {
          try {
            const sel = contents.window.getSelection();
            if (!sel || sel.isCollapsed) return;
            const text = sel.toString().trim();
            if (!text) return;
            clearTimeout(selTimer);
            selTimer = setTimeout(() => {
              // 取第一个单词
              const words = text.split(/\s+/).filter(Boolean);
              const word = words[0].replace(/[^A-Za-z']/g, '');
              if (!word) return;
              // 取整句上下文
              let sentence = '';
              try {
                let node = sel.anchorNode;
                let p = node;
                while (p && p !== doc.body && !/^P$|^DIV$|^LI$/.test(p.tagName)) p = p.parentNode;
                if (p && p.textContent) {
                  sentence = p.textContent.trim().replace(/\s+/g, ' ');
                  if (sentence.length > 200) sentence = sentence.slice(0, 200) + '…';
                }
              } catch (e) {}
              pendingWord = { word, sentence, bookTitle: currentBook ? currentBook.title : '' };
              popupWord.textContent = word;
              popupSentence.textContent = sentence || '（无上下文）';
              wordPopup.classList.remove('hidden');
            }, 400);
          } catch (e) {}
        });
      } catch (e) {}
    };
    rendition.on('rendered', (section, view) => {
      try {
        if (view && view.contents) bindSelection(view.contents);
      } catch (e) {}
    });

    try {
      await rendition.display();
    } catch (e) {
      alert('这本书打不开，可能格式有问题：' + e.message);
      backToShelf();
      return;
    }

    // 恢复进度
    const prog = await dbGet('progress', rec.id);
    if (prog && prog.location) {
      try { await rendition.display(prog.location); } catch (e) {}
    }

    rendition.on('relocated', (location) => {
      if (!location || !location.start) return;
      dbPut('progress', { bookId: rec.id, location: location.start.cfi, updatedAt: Date.now() });
    });
  }

  function backToShelf() {
    try { if (rendition) rendition.destroy(); } catch (e) {}
    book = null; rendition = null; currentBook = null;
    readerView.classList.add('hidden');
    shelfView.classList.remove('hidden');
    renderShelf();
  }

  // ── 选词 ──
  function handleSelection(cfiRange, contents) {
    // 获取选中文本
    let selText = '';
    try {
      selText = contents.window.getSelection().toString().trim();
    } catch (e) {}
    if (!selText) return;

    // 取第一个单词（去标点）
    const words = selText.split(/\s+/).filter(Boolean);
    const word = words[0].replace(/[^A-Za-z']/g, '');
    if (!word) return;

    // 从当前内容里取整句作为上下文
    let sentence = '';
    try {
      const doc = contents.document;
      const sel = contents.window.getSelection();
      let node = sel.anchorNode;
      // 向上找段落
      let p = node;
      while (p && p !== doc.body && !/^P$|^DIV$|^LI$/.test(p.tagName)) p = p.parentNode;
      if (p && p.textContent) {
        sentence = p.textContent.trim().replace(/\s+/g, ' ');
        if (sentence.length > 200) sentence = sentence.slice(0, 200) + '…';
      }
    } catch (e) {}

    pendingWord = { word, sentence, bookTitle: currentBook ? currentBook.title : '' };
    popupWord.textContent = word;
    popupSentence.textContent = sentence || '（无上下文）';
    // 定位弹窗到选中位置附近
    wordPopup.classList.remove('hidden');
  }

  $('popupAdd').addEventListener('click', async () => {
    if (!pendingWord) return;
    // 去重：同词 + 同书不重复加
    const wb = await dbGetAll('wordbook');
    const dup = wb.find(w => w.word.toLowerCase() === pendingWord.word.toLowerCase() && w.bookTitle === pendingWord.bookTitle);
    if (dup) {
      alert('这个词已经在这本书的生词本里啦');
    } else {
      await dbPut('wordbook', {
        ...pendingWord,
        addedAt: Date.now(),
      });
      alert(`✅ 已加入生词本：${pendingWord.word}`);
    }
    wordPopup.classList.add('hidden');
    pendingWord = null;
  });
  $('popupClose').addEventListener('click', () => {
    wordPopup.classList.add('hidden');
    pendingWord = null;
  });

  // ── 目录 ──
  $('tocBtn').addEventListener('click', async () => {
    tocDrawer.classList.remove('hidden');
    const nav = book && book.navigation;
    if (!nav || !nav.toc || !nav.toc.length) {
      tocList.innerHTML = '<p class="hint">这本书没有目录</p>';
      return;
    }
    tocList.innerHTML = '';
    nav.toc.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'toc-item';
      btn.textContent = item.label.trim();
      btn.addEventListener('click', async () => {
        tocDrawer.classList.add('hidden');
        try { await rendition.display(item.href); } catch (e) {}
      });
      tocList.appendChild(btn);
    });
  });
  $('tocClose').addEventListener('click', () => tocDrawer.classList.add('hidden'));

  // ── 字体 ──
  $('fontBtn').addEventListener('click', () => fontDrawer.classList.remove('hidden'));
  $('fontClose').addEventListener('click', () => fontDrawer.classList.add('hidden'));
  document.querySelectorAll('.btn-font').forEach(btn => {
    btn.addEventListener('click', () => {
      fontLevel = Math.max(-1, Math.min(1, fontLevel + Number(btn.dataset.size)));
      if (rendition) rendition.themes.fontSize(FONT_SIZES[fontLevel]);
    });
  });

  // ── 生词本 ──
  async function renderWordbook() {
    const wb = await dbGetAll('wordbook');
    wordbookList.innerHTML = '';
    if (!wb.length) {
      wordbookList.innerHTML = '<p class="hint">生词本是空的，阅读时选中单词即可加入</p>';
      return;
    }
    wb.sort((a, b) => b.addedAt - a.addedAt);
    wb.forEach(w => {
      const row = document.createElement('div');
      row.className = 'wb-row';
      const info = document.createElement('div');
      info.className = 'wb-info';
      const wd = document.createElement('div');
      wd.className = 'wb-word';
      wd.textContent = w.word;
      const st = document.createElement('div');
      st.className = 'wb-sent';
      st.textContent = (w.bookTitle ? `《${w.bookTitle}》` : '') + ' ' + (w.sentence || '');
      const del = document.createElement('button');
      del.className = 'btn-mini-del';
      del.textContent = '删';
      del.addEventListener('click', async () => {
        await dbDelete('wordbook', w.id);
        renderWordbook();
      });
      info.appendChild(wd);
      info.appendChild(st);
      row.appendChild(info);
      row.appendChild(del);
      wordbookList.appendChild(row);
    });
  }
  function openWordbook() {
    renderWordbook();
    wordbookModal.classList.remove('hidden');
  }
  $('shelfWordbookBtn').addEventListener('click', openWordbook);
  $('readerWordbookBtn').addEventListener('click', openWordbook);
  $('wbClose').addEventListener('click', () => wordbookModal.classList.add('hidden'));

  // 导出
  $('wbExport').addEventListener('click', async () => {
    const wb = await dbGetAll('wordbook');
    if (!wb.length) { alert('生词本是空的'); return; }
    const lines = wb.map(w => {
      const book = w.bookTitle ? `《${w.bookTitle}》` : '';
      return `${w.word}\t${book}\t${w.sentence || ''}`;
    });
    const text = `# 千千生词本 ${new Date().toISOString().slice(0, 10)}\n# 格式：单词\t书名\t原句\n${lines.join('\n')}\n`;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `千千生词本_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── 键盘翻页 + 屏幕按钮 ──
  $('pgPrev').addEventListener('click', () => { if (rendition) rendition.prev(); });
  $('pgNext').addEventListener('click', () => { if (rendition) rendition.next(); });
  document.addEventListener('keydown', (e) => {
    if (!rendition) return;
    if (wordPopup.classList.contains('hidden') === false) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); rendition.next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); rendition.prev(); }
  });

  // ── 事件 ──
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await addBook(file);
    e.target.value = '';
  });
  $('backBtn').addEventListener('click', backToShelf);

  // ── 初始化 ──
  openDb().then(() => renderShelf()).catch(err => {
    shelfEmpty.classList.remove('hidden');
    shelfEmpty.querySelector('p').textContent = '浏览器不支持 IndexedDB，无法使用书架';
  });

})();
