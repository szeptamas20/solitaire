/* Klondike Solitaire — no ads, offline. Plain JS, no dependencies. */
(() => {
  'use strict';

  // ---------- Constants ----------
  const VS = '︎'; // text presentation, stops iOS from drawing suits as emoji
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRed = (s) => s === 1 || s === 2;
  const KEY_GAME = 'klondike.game.v1';
  const KEY_SETTINGS = 'klondike.settings.v1';
  const KEY_STATS = 'klondike.stats.v1';
  const MAX_SAVED_HISTORY = 300;

  // ---------- Storage helpers ----------
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / full */ }
    },
  };

  const settings = Object.assign({ draw: 1, side: 'left', theme: 'auto' }, store.get(KEY_SETTINGS, {}));
  const stats = Object.assign(
    { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: null, bestMoves: null },
    store.get(KEY_STATS, {})
  );

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const board = $('board');
  const elMoves = $('moves');
  const elTime = $('time');
  const btnUndo = $('btn-undo');

  // ---------- State ----------
  // Card: { s: suit 0-3, r: rank 1-13, u: faceUp }
  let S = null;         // { stock, waste, found[4], tab[7], draw, moves, elapsed, counted, won, initial }
  let history = [];     // JSON snapshots for undo
  let L = null;         // layout metrics
  const cardEls = [];   // index = s*13 + r-1
  const slots = {};     // slot elements
  let autoFinishing = false;
  let busy = false;     // during win animation

  const cid = (c) => c.s * 13 + c.r - 1;

  function freshDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ s, r, u: false });
    // Fisher–Yates with crypto randomness when available
    const rnd = (n) => {
      if (window.crypto && crypto.getRandomValues) {
        const a = new Uint32Array(1);
        crypto.getRandomValues(a);
        return a[0] % n;
      }
      return Math.floor(Math.random() * n);
    };
    for (let i = d.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function dealFrom(deck) {
    const tab = [[], [], [], [], [], [], []];
    let k = 0;
    for (let i = 0; i < 7; i++) {
      for (let j = i; j < 7; j++) {
        const c = { ...deck[k++] };
        c.u = j === i;
        tab[j].push(c);
      }
    }
    const stock = deck.slice(k).map((c) => ({ ...c, u: false }));
    return { stock, waste: [], found: [[], [], [], []], tab };
  }

  function piles() {
    return { stock: S.stock, waste: S.waste, found: S.found, tab: S.tab };
  }

  function newGame(deck) {
    // Abandoning a started game breaks the win streak
    if (S && S.counted && !S.won) { stats.streak = 0; store.set(KEY_STATS, stats); }
    const d = deck || freshDeck();
    S = Object.assign(dealFrom(d), {
      draw: settings.draw,
      moves: 0,
      elapsed: 0,
      counted: false,
      won: false,
      initial: d.map((c) => ({ s: c.s, r: c.r })),
    });
    history = [];
    autoFinishing = false;
    stopTimer();
    hideOverlay('win');
    render(true);
    save();
  }

  function restartDeal() {
    if (!S) return;
    const initial = S.initial;
    const draw = S.draw;
    const counted = S.counted;
    S = Object.assign(dealFrom(initial.map((c) => ({ ...c, u: false }))), {
      draw, moves: 0, elapsed: 0, counted, won: false, initial,
    });
    history = [];
    autoFinishing = false;
    stopTimer();
    hideOverlay('win');
    render(true);
    save();
  }

  function snapshot() {
    return JSON.stringify({ ...piles(), moves: S.moves });
  }

  function pushHistory() {
    history.push(snapshot());
  }

  function undo() {
    if (!history.length || autoFinishing || busy || S.won) return;
    const snap = JSON.parse(history.pop());
    Object.assign(S, snap);
    render();
    save();
  }

  function save() {
    store.set(KEY_GAME, { S, history: history.slice(-MAX_SAVED_HISTORY) });
  }

  // ---------- Rules ----------
  const top = (arr) => arr[arr.length - 1];

  function canOnTab(card, col) {
    const t = top(S.tab[col]);
    if (!t) return card.r === 13;
    return t.u && isRed(t.s) !== isRed(card.s) && t.r === card.r + 1;
  }

  function canOnFound(card, f) {
    const t = top(S.found[f]);
    if (!t) return card.r === 1;
    return t.s === card.s && t.r === card.r - 1;
  }

  function foundFor(card) {
    // Prefer the foundation that already holds this suit, else first empty for an Ace
    for (let f = 0; f < 4; f++) {
      const t = top(S.found[f]);
      if (t && t.s === card.s) return canOnFound(card, f) ? f : -1;
    }
    if (card.r === 1) for (let f = 0; f < 4; f++) if (!S.found[f].length) return f;
    return -1;
  }

  function pileArr(p) {
    if (p.type === 'tab') return S.tab[p.i];
    if (p.type === 'found') return S.found[p.i];
    return S[p.type];
  }

  function locate(id) {
    const chk = (arr, type, i) => {
      for (let k = 0; k < arr.length; k++) if (cid(arr[k]) === id) return { type, i, idx: k };
      return null;
    };
    let r = chk(S.stock, 'stock', 0) || chk(S.waste, 'waste', 0);
    if (r) return r;
    for (let i = 0; i < 4; i++) if ((r = chk(S.found[i], 'found', i))) return r;
    for (let i = 0; i < 7; i++) if ((r = chk(S.tab[i], 'tab', i))) return r;
    return null;
  }

  // Validate and apply a move of the cards from `from` (starting at idx) onto `to`.
  function tryMove(from, to) {
    if (from.type === to.type && from.i === to.i) return false;
    const src = pileArr(from);
    const moving = src.slice(from.idx);
    if (!moving.length || !moving[0].u) return false;
    if (to.type === 'found') {
      if (moving.length !== 1 || !canOnFound(moving[0], to.i)) return false;
    } else if (to.type === 'tab') {
      if (!canOnTab(moving[0], to.i)) return false;
    } else return false;

    pushHistory();
    src.splice(from.idx);
    pileArr(to).push(...moving);
    if (from.type === 'tab') {
      const t = top(src);
      if (t && !t.u) t.u = true;
    }
    afterMove();
    return true;
  }

  function drawStock() {
    if (autoFinishing || busy || S.won) return;
    if (!S.stock.length && !S.waste.length) return;
    pushHistory();
    if (!S.stock.length) {
      S.stock = S.waste.reverse().map((c) => ({ ...c, u: false }));
      S.waste = [];
    } else {
      const n = Math.min(S.draw, S.stock.length);
      for (let k = 0; k < n; k++) {
        const c = S.stock.pop();
        c.u = true;
        S.waste.push(c);
      }
    }
    afterMove();
  }

  function afterMove() {
    S.moves++;
    if (!S.counted) {
      S.counted = true;
      stats.played++;
      store.set(KEY_STATS, stats);
    }
    startTimer();
    render();
    save();
    if (isWon()) return onWin();
    maybeAutoFinish();
  }

  const isWon = () => S.found.every((f) => f.length === 13);

  function canAutoFinish() {
    return !S.stock.length && !S.waste.length && S.tab.every((col) => col.every((c) => c.u));
  }

  function maybeAutoFinish() {
    if (autoFinishing || !canAutoFinish() || isWon()) return;
    autoFinishing = true;
    const step = () => {
      if (isWon()) { autoFinishing = false; return onWin(); }
      // Move the lowest card that can go up
      let best = null;
      for (let i = 0; i < 7; i++) {
        const c = top(S.tab[i]);
        if (!c) continue;
        const f = foundFor(c);
        if (f >= 0 && (!best || c.r < best.c.r)) best = { c, i, f };
      }
      if (!best) { autoFinishing = false; return; }
      pushHistory();
      S.found[best.f].push(S.tab[best.i].pop());
      S.moves++;
      render();
      save();
      setTimeout(step, 70);
    };
    setTimeout(step, 150);
  }

  // Tap: send a card (or run) to the best legal place
  function autoMove(loc) {
    const src = pileArr(loc);
    const card = src[loc.idx];
    const isTop = loc.idx === src.length - 1;
    if (isTop && loc.type !== 'found') {
      const f = foundFor(card);
      if (f >= 0) return tryMove(loc, { type: 'found', i: f });
    }
    // Tableau targets, scanning from the column after the source so repeated taps cycle.
    const start = loc.type === 'tab' ? loc.i + 1 : 0;
    let emptyTarget = -1;
    for (let k = 0; k < 7; k++) {
      const i = (start + k) % 7;
      if (loc.type === 'tab' && i === loc.i) continue;
      if (!canOnTab(card, i)) continue;
      if (!S.tab[i].length) {
        // Don't shuffle a King that already heads a column into another empty column
        if (loc.type === 'tab' && loc.idx === 0) continue;
        if (emptyTarget < 0) emptyTarget = i;
        continue;
      }
      return tryMove(loc, { type: 'tab', i });
    }
    if (emptyTarget >= 0) return tryMove(loc, { type: 'tab', i: emptyTarget });
    return false;
  }

  // ---------- Hints ----------
  function findHint() {
    const moves = [];
    const consider = (loc) => {
      const src = pileArr(loc);
      const card = src[loc.idx];
      const isTop = loc.idx === src.length - 1;
      if (isTop && loc.type !== 'found') {
        const f = foundFor(card);
        if (f >= 0) moves.push({ loc, to: { type: 'found', i: f }, score: 100 - card.r });
      }
      for (let i = 0; i < 7; i++) {
        if (loc.type === 'tab' && i === loc.i) continue;
        if (!canOnTab(card, i)) continue;
        let score = 0;
        if (loc.type === 'waste') score = 40;
        if (loc.type === 'found') score = 0; // only as a last resort; skip
        if (loc.type === 'tab') {
          const below = src[loc.idx - 1];
          if (loc.idx === 0) { if (!S.tab[i].length) continue; score = 50; } // empties a column
          else if (!below.u) score = 70; // reveals a card
          else continue; // shuffling between equivalent spots
        }
        if (loc.type === 'found') continue;
        moves.push({ loc, to: { type: 'tab', i }, score });
      }
    };
    if (S.waste.length) consider({ type: 'waste', i: 0, idx: S.waste.length - 1 });
    for (let i = 0; i < 7; i++) {
      const col = S.tab[i];
      for (let k = 0; k < col.length; k++) if (col[k].u) consider({ type: 'tab', i, idx: k });
    }
    moves.sort((a, b) => b.score - a.score);
    return moves[0] || null;
  }

  function showHint() {
    if (autoFinishing || busy || S.won) return;
    clearHints();
    const m = findHint();
    if (m) {
      const run = pileArr(m.loc).slice(m.loc.idx);
      run.forEach((c) => cardEls[cid(c)].classList.add('hint'));
      const dest = pileArr(m.to);
      if (dest.length) cardEls[cid(top(dest))].classList.add('hint');
      else (m.to.type === 'found' ? slots.found[m.to.i] : slots.tab[m.to.i]).classList.add('hint');
    } else if (S.stock.length || S.waste.length) {
      if (S.stock.length) cardEls[cid(top(S.stock))].classList.add('hint');
      else slots.stock.classList.add('hint');
      toast(S.stock.length ? 'Draw from the deck' : 'Turn the deck over');
    } else {
      toast('No moves left. Try Undo or a new game.');
    }
    setTimeout(clearHints, 1600);
  }

  function clearHints() {
    board.querySelectorAll('.hint').forEach((el) => el.classList.remove('hint'));
  }

  // ---------- Timer ----------
  let tStart = null;
  let tInterval = null;
  function startTimer() {
    if (tStart !== null || S.won || document.hidden) return;
    tStart = performance.now();
    tInterval = setInterval(updateHud, 1000);
  }
  function stopTimer() {
    if (tStart !== null) {
      S.elapsed += performance.now() - tStart;
      tStart = null;
    }
    clearInterval(tInterval);
    tInterval = null;
  }
  const elapsedMs = () => S.elapsed + (tStart !== null ? performance.now() - tStart : 0);
  const fmtTime = (ms) => {
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  function updateHud() {
    elMoves.textContent = S.moves;
    elTime.textContent = fmtTime(elapsedMs());
    btnUndo.disabled = !history.length || S.won;
  }

  document.addEventListener('visibilitychange', () => {
    if (!S) return;
    if (document.hidden) { stopTimer(); save(); }
    else if (S.moves > 0 && !S.won) startTimer();
  });
  window.addEventListener('pagehide', () => { if (S) { stopTimer(); save(); } });

  // ---------- Layout & rendering ----------
  function buildDom() {
    const mk = (cls) => { const d = document.createElement('div'); d.className = 'slot ' + cls; board.appendChild(d); return d; };
    slots.stock = mk('stock');
    slots.waste = mk('waste');
    slots.found = [0, 1, 2, 3].map(() => mk('found'));
    slots.tab = [0, 1, 2, 3, 4, 5, 6].map(() => mk('tab'));

    for (let s = 0; s < 4; s++) {
      for (let r = 1; r <= 13; r++) {
        const el = document.createElement('div');
        el.className = 'card' + (isRed(s) ? ' red' : '');
        el.dataset.id = s * 13 + r - 1;
        const court = r > 10 ? ' court' : '';
        const center = r > 10 ? RANKS[r] : SUITS[s] + VS;
        el.innerHTML =
          `<div class="face"><span class="rk">${RANKS[r]}</span><span class="st">${SUITS[s]}${VS}</span>` +
          `<span class="big${court}">${center}</span></div><div class="back"></div>`;
        el.setAttribute('aria-label', `${RANKS[r]} of ${['spades', 'hearts', 'diamonds', 'clubs'][s]}`);
        cardEls[s * 13 + r - 1] = el;
        board.appendChild(el);
      }
    }
  }

  function computeLayout() {
    const W = board.clientWidth;
    const H = board.clientHeight;
    const pad = 6;
    const gap = W < 500 ? 5 : 9;
    let cw = (W - 2 * pad - 6 * gap) / 7;
    cw = Math.min(cw, (H - 2 * pad) / (1.4 * 3.1), 120);
    cw = Math.floor(cw);
    const ch = Math.round(cw * 1.4);
    const left = Math.round((W - (7 * cw + 6 * gap)) / 2);
    const colX = (i) => left + i * (cw + gap);
    const topY = pad;
    const tabY = topY + ch + Math.max(10, gap * 2);
    const right = settings.side === 'right';
    L = {
      W, H, cw, ch, gap, pad, tabY, colX,
      stockX: colX(right ? 6 : 0),
      wasteX: colX(right ? 5 : 1),
      fanDir: right ? -1 : 1,
      foundX: (i) => colX(right ? i : 3 + i),
      topY,
    };
    board.style.setProperty('--cw', cw + 'px');
    board.style.setProperty('--ch', ch + 'px');
  }

  function place(el, x, y, z) {
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    el.style.zIndex = z;
    el._x = x;
    el._y = y;
  }

  function placeSlot(el, x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.width = L.cw + 'px';
    el.style.height = L.ch + 'px';
  }

  function tabOffsets(col) {
    const down = L.ch * 0.14;
    const up = L.ch * 0.27;
    const offs = [];
    let y = 0;
    for (let k = 0; k < col.length; k++) {
      offs.push(y);
      y += col[k].u ? up : down;
    }
    const last = offs.length ? offs[offs.length - 1] : 0;
    const avail = L.H - L.tabY - L.ch - L.pad;
    if (last > avail && last > 0) {
      const f = avail / last;
      for (let k = 0; k < offs.length; k++) offs[k] *= f;
    }
    return offs;
  }

  function render(instant) {
    if (instant) board.classList.add('no-anim');
    computeLayout();

    placeSlot(slots.stock, L.stockX, L.topY);
    slots.stock.classList.toggle('dead', !S.stock.length && !S.waste.length);
    placeSlot(slots.waste, L.wasteX, L.topY);
    slots.waste.style.visibility = 'hidden';
    for (let i = 0; i < 4; i++) placeSlot(slots.found[i], L.foundX(i), L.topY);
    for (let i = 0; i < 7; i++) placeSlot(slots.tab[i], L.colX(i), L.tabY);

    const setUp = (c) => cardEls[cid(c)].classList.toggle('up', c.u);

    S.stock.forEach((c, k) => { setUp(c); place(cardEls[cid(c)], L.stockX, L.topY, 10 + k); });

    // Draw 3 fans the last three cards. The top card is always the rightmost so the
    // corner ranks of the cards underneath stay visible. With the deck on the right,
    // the fan grows leftward into the empty column instead.
    const wn = S.waste.length;
    const fanStep = L.cw * 0.3;
    const shown = Math.min(3, wn);
    S.waste.forEach((c, k) => {
      setUp(c);
      let x = L.wasteX;
      if (S.draw === 3 && shown > 1) {
        const pos = Math.max(0, k - (wn - shown)); // 0..shown-1
        x += L.fanDir > 0 ? pos * fanStep : -(shown - 1 - pos) * fanStep;
      }
      place(cardEls[cid(c)], x, L.topY, 100 + k);
    });

    S.found.forEach((f, i) => f.forEach((c, k) => {
      setUp(c);
      place(cardEls[cid(c)], L.foundX(i), L.topY, 200 + k);
    }));

    S.tab.forEach((col, i) => {
      const offs = tabOffsets(col);
      col.forEach((c, k) => {
        setUp(c);
        place(cardEls[cid(c)], L.colX(i), L.tabY + offs[k], 300 + k);
      });
    });

    updateHud();
    if (instant) {
      void board.offsetHeight; // flush
      requestAnimationFrame(() => board.classList.remove('no-anim'));
    }
  }

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => S && !busy && render(true), 60);
  });

  // ---------- Input (pointer drag + tap) ----------
  let drag = null;

  board.addEventListener('pointerdown', (e) => {
    if (autoFinishing || busy || S.won || drag) return;
    clearHints();
    const cardEl = e.target.closest('.card');
    if (!cardEl) {
      if (e.target.closest('.slot.stock')) drawStock();
      return;
    }
    const id = +cardEl.dataset.id;
    const loc = locate(id);
    if (!loc) return;
    if (loc.type === 'stock') { drawStock(); return; }
    const src = pileArr(loc);
    if (!src[loc.idx].u) return;
    if (loc.type !== 'tab' && loc.idx !== src.length - 1) return;

    const els = src.slice(loc.idx).map((c) => cardEls[cid(c)]);
    drag = {
      loc, els, pid: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      base: els.map((el) => [el._x, el._y]),
      moved: false,
    };
    try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  board.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.moved = true;
      drag.els.forEach((el, k) => { el.classList.add('dragging'); el.style.zIndex = 1000 + k; });
    }
    drag.els.forEach((el, k) => {
      el.style.transform = `translate3d(${drag.base[k][0] + dx}px, ${drag.base[k][1] + dy}px, 0)`;
    });
    drag.dx = dx;
    drag.dy = dy;
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag;
    drag = null;
    d.els.forEach((el) => el.classList.remove('dragging'));
    if (!d.moved) {
      if (e.type === 'pointerup' && !autoMove(d.loc)) shake(d.els[0]);
      return;
    }
    if (e.type === 'pointercancel') { render(); return; }
    // Find the best drop target by overlap with the lead card
    const x = d.base[0][0] + d.dx;
    const y = d.base[0][1] + d.dy;
    const targets = [];
    if (d.els.length === 1) for (let i = 0; i < 4; i++) targets.push({ type: 'found', i, x: L.foundX(i), y: L.topY, h: L.ch });
    for (let i = 0; i < 7; i++) {
      const col = S.tab[i];
      const lastEl = col.length ? cardEls[cid(top(col))] : null;
      const ty = L.tabY;
      const bottom = lastEl ? lastEl._y + L.ch : ty + L.ch;
      targets.push({ type: 'tab', i, x: L.colX(i), y: ty, h: bottom - ty });
    }
    let best = null;
    let bestArea = 0;
    for (const t of targets) {
      const ox = Math.max(0, Math.min(x + L.cw, t.x + L.cw) - Math.max(x, t.x));
      const oy = Math.max(0, Math.min(y + L.ch, t.y + t.h) - Math.max(y, t.y));
      const area = ox * oy;
      if (area > bestArea) {
        const ok = t.type === 'found' ? canOnFound(pileArr(d.loc)[d.loc.idx], t.i) : canOnTab(pileArr(d.loc)[d.loc.idx], t.i);
        if (ok) { best = t; bestArea = area; }
      }
    }
    if (!best || !tryMove(d.loc, { type: best.type, i: best.i })) render();
  };
  board.addEventListener('pointerup', endDrag);
  board.addEventListener('pointercancel', endDrag);

  function shake(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), 300);
  }

  // ---------- Win ----------
  function onWin() {
    if (S.won) return;
    S.won = true;
    stopTimer();
    const ms = S.elapsed;
    stats.won++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    if (stats.bestTime === null || ms < stats.bestTime) stats.bestTime = ms;
    if (stats.bestMoves === null || S.moves < stats.bestMoves) stats.bestMoves = S.moves;
    store.set(KEY_STATS, stats);
    save();
    updateHud();

    busy = true;
    const els = cardEls.slice();
    els.forEach((el, k) => {
      setTimeout(() => {
        el.classList.add('flying');
        const x = Math.random() * (L.W - L.cw);
        const y = L.H + L.ch * (1 + Math.random());
        const rot = (Math.random() - 0.5) * 720;
        el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${rot}deg)`;
      }, 300 + k * 28);
    });
    setTimeout(() => {
      els.forEach((el) => el.classList.remove('flying'));
      busy = false;
      $('win-text').textContent = `Time ${fmtTime(ms)} · ${S.moves} moves`;
      showOverlay('win');
    }, 300 + els.length * 28 + 1100);
  }

  // ---------- Overlays, settings, stats ----------
  function showOverlay(id) { $(id).hidden = false; }
  function hideOverlay(id) { $(id).hidden = true; }

  let toastT = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2000);
  }

  function applyTheme() {
    if (settings.theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
    const dark = settings.theme === 'dark' ||
      (settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').content = dark ? '#12201c' : '#17594a';
  }

  function syncSettingsUi() {
    document.querySelectorAll('.seg').forEach((seg) => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(settings[key]) === b.dataset.value));
    });
    $('draw-note').textContent = settings.draw !== S.draw ? 'Applies from the next game' : '';
  }

  function renderStats() {
    const pct = stats.played ? Math.round((stats.won / stats.played) * 100) + '%' : '–';
    const cells = [
      [stats.played, 'Played'],
      [stats.won, 'Won'],
      [pct, 'Win rate'],
      [stats.streak, 'Streak'],
      [stats.bestTime === null ? '–' : fmtTime(stats.bestTime), 'Best time'],
      [stats.bestMoves === null ? '–' : stats.bestMoves, 'Fewest moves'],
    ];
    $('stats').innerHTML = cells.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  }

  function openMenu() {
    syncSettingsUi();
    renderStats();
    showOverlay('sheet');
  }

  document.querySelectorAll('.seg').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.setting;
      settings[key] = key === 'draw' ? +b.dataset.value : b.dataset.value;
      store.set(KEY_SETTINGS, settings);
      if (key === 'theme') applyTheme();
      if (key === 'side') render();
      if (key === 'draw' && S.moves === 0 && !S.won) { S.draw = settings.draw; render(); save(); }
      syncSettingsUi();
    });
  });

  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.closest('[data-close]')) ov.hidden = true;
    });
  });

  let askAction = null;
  function ask(text, okLabel, action) {
    $('ask-text').textContent = text;
    $('ask-ok').textContent = okLabel;
    askAction = action;
    showOverlay('ask');
  }
  $('ask-ok').addEventListener('click', () => {
    hideOverlay('ask');
    const a = askAction;
    askAction = null;
    if (a) a();
  });

  const confirmNew = () => {
    if (S.moves > 0 && !S.won) ask('Start a new game? This one will count as a loss.', 'New game', () => newGame());
    else newGame();
  };
  $('btn-new').addEventListener('click', () => { if (!busy) confirmNew(); });
  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', showHint);
  $('btn-menu').addEventListener('click', () => { if (!busy) openMenu(); });
  $('m-new').addEventListener('click', () => { hideOverlay('sheet'); confirmNew(); });
  $('m-restart').addEventListener('click', () => { hideOverlay('sheet'); restartDeal(); });
  $('win-new').addEventListener('click', () => newGame());
  $('m-reset-stats').addEventListener('click', () => {
    ask('Reset all statistics?', 'Reset', () => {
      Object.assign(stats, { played: 0, won: 0, streak: 0, bestStreak: 0, bestTime: null, bestMoves: null });
      store.set(KEY_STATS, stats);
      renderStats();
    });
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

  // ---------- Boot ----------
  applyTheme();
  buildDom();
  const saved = store.get(KEY_GAME, null);
  if (saved && saved.S && saved.S.tab && saved.S.initial) {
    S = saved.S;
    history = saved.history || [];
    render(true);
    if (S.won) newGame();
  } else {
    newGame();
  }

  // Testing hook: ?test=nearwin sets up a board that auto-finishes after one move
  if (/[?&]test=nearwin/.test(location.search)) {
    S.found = [0, 1, 2, 3].map((s) => Array.from({ length: 11 }, (_, k) => ({ s, r: k + 1, u: true })));
    S.tab = [0, 1, 2, 3].map((s) => [{ s, r: 13, u: true }, { s: (s + 1) % 4, r: 12, u: true }]);
    S.tab.push([], [], []);
    S.stock = [];
    S.waste = [];
    S.moves = 0;
    S.won = false;
    history = [];
    render(true);
  }
})();
