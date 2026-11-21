// SVG 描画、入力、アニメーション、画面更新。

import { COLS, ROWS, SIZE, SQUARES, TRIANGLES } from './board.js';
import {
  DEFAULT_DIFFICULTY,
  DEFAULT_MODE,
  DIFFICULTIES,
  MODES,
  RANDOM_PLACEMENT,
  applyMove,
  decodePuzzle,
  difficultyFromGenMoves,
  duplicateGroups,
  encodePuzzle,
  findDifficulty,
  generatePuzzle,
  isMode,
  isSolved,
  moveToK,
  rotationMap,
} from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 描画上のマスの一辺（SVG のユーザー単位） */
const S = 100;
const MARGIN = 20;
const ANIM_MS = 200;
/** ハンドルのタップ領域の最小半径（CSS px）。直径 44px 以上にする */
const MIN_HIT_RADIUS_PX = 23;
const STORAGE_KEY = 'kaiten-nanpure/v1';
const DIR_NAME = { 1: '時計回り', [-1]: '反時計回り' };

// ---------------------------------------------------------------- 保存

const storage = {
  load() {
    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  },
  save(data) {
    try {
      globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // 保存できない環境でもそのまま遊べるようにする
    }
  },
};

function loadSettings(raw = {}) {
  const mode = isMode(raw.mode) ? raw.mode : DEFAULT_MODE;
  let difficulty = findDifficulty(raw.difficulty) ? raw.difficulty : DEFAULT_DIFFICULTY;
  if (difficulty === RANDOM_PLACEMENT.key && mode !== '45') difficulty = DEFAULT_DIFFICULTY;
  return {
    dir: raw.dir === -1 ? -1 : 1,
    showDuplicates: raw.showDuplicates !== false,
    colorNumbers: raw.colorNumbers === true,
    mode,
    difficulty,
  };
}

function loadBests(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, rec] of Object.entries(raw)) {
    if (!rec || typeof rec !== 'object') continue;
    const r = {};
    if (Number.isFinite(rec.moves)) r.moves = rec.moves;
    if (Number.isFinite(rec.time)) r.time = rec.time;
    out[key] = r;
  }
  return out;
}

// ---------------------------------------------------------------- 小さな道具

function svgEl(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

function htmlEl(name, attrs = {}, parent = null, text = null) {
  const e = document.createElement(name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function pathOf(vertices, scale = S) {
  return `${vertices
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x * scale} ${y * scale}`)
    .join(' ')} Z`;
}

const r2 = (v) => Math.round(v * 100) / 100;

/** 時計回りの回転矢印（円弧 + 矢じり）。反時計回りは左右反転して使う */
function rotationIcon(parent, radius) {
  const a0 = (-40 * Math.PI) / 180;
  const a1 = (230 * Math.PI) / 180;
  const p = (a) => [radius * Math.cos(a), radius * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const t = [-Math.sin(a1), Math.cos(a1)];
  const n = [Math.cos(a1), Math.sin(a1)];
  const head = radius * 0.62;
  const tip = [x1 + t[0] * head, y1 + t[1] * head];
  const b1 = [x1 + n[0] * head * 0.78, y1 + n[1] * head * 0.78];
  const b2 = [x1 - n[0] * head * 0.78, y1 - n[1] * head * 0.78];
  svgEl(
    'path',
    { class: 'rot-arc', d: `M${r2(x0)} ${r2(y0)} A${radius} ${radius} 0 1 1 ${r2(x1)} ${r2(y1)}` },
    parent,
  );
  svgEl(
    'path',
    { class: 'rot-head', d: `M${r2(tip[0])} ${r2(tip[1])} L${r2(b1[0])} ${r2(b1[1])} L${r2(b2[0])} ${r2(b2[1])} Z` },
    parent,
  );
}

export function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

async function copyText(text) {
  try {
    if (navigator.clipboard && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 下の方法を試す
  }
  try {
    const ta = htmlEl('textarea', { readonly: '' }, document.body);
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 盤面の SVG

function buildBoard(svg) {
  const W = SIZE * S;
  svg.setAttribute('viewBox', `${-MARGIN} ${-MARGIN} ${W + 2 * MARGIN} ${W + 2 * MARGIN}`);
  svg.replaceChildren();

  const gTris = svgEl('g', { class: 'tris' }, svg);
  const tris = TRIANGLES.map((t) => svgEl('path', { class: 'tri', d: pathOf(t.vertices) }, gTris));

  const gGrid = svgEl('g', { class: 'grid', 'aria-hidden': 'true' }, svg);
  for (const sq of SQUARES) {
    // 四隅の正方形どうしの境目は太線、中央の正方形は点線で示す
    const [cx, cy] = sq.center;
    if (cx % 2 === 0) {
      svgEl('rect', { class: 'center-square', x: (cx - 1) * S, y: (cy - 1) * S, width: 2 * S, height: 2 * S }, gGrid);
    }
  }
  for (let i = 2; i < SIZE; i += 2) {
    svgEl('line', { class: 'major', x1: i * S, y1: 0, x2: i * S, y2: W }, gGrid);
    svgEl('line', { class: 'major', x1: 0, y1: i * S, x2: W, y2: i * S }, gGrid);
  }
  svgEl('rect', { class: 'border', x: 0, y: 0, width: W, height: W, rx: 4 }, gGrid);

  const outline = svgEl('rect', { class: 'sq-outline', width: 2 * S, height: 2 * S, rx: 4 }, svg);

  const gInd = svgEl('g', { class: 'indicators', 'aria-hidden': 'true' }, svg);
  const rowInd = ROWS.map((_, r) =>
    svgEl('rect', { class: 'ind', x: -15, y: r * S + 14, width: 7, height: S - 28, rx: 3.5 }, gInd),
  );
  const colInd = COLS.map((_, c) =>
    svgEl('rect', { class: 'ind', x: c * S + 14, y: -15, width: S - 28, height: 7, rx: 3.5 }, gInd),
  );

  const gTok = svgEl('g', { class: 'tokens' }, svg);
  const tokens = TRIANGLES.map((t) =>
    svgEl('text', { class: 'tok', x: r2(t.centroid[0] * S), y: r2(t.centroid[1] * S), dy: '0.35em' }, gTok),
  );

  const gHandles = svgEl('g', { class: 'handles' }, svg);
  const handles = SQUARES.map((sq) => {
    const g = svgEl(
      'g',
      {
        class: 'handle',
        role: 'button',
        tabindex: 0,
        transform: `translate(${sq.center[0] * S} ${sq.center[1] * S})`,
      },
      gHandles,
    );
    const hit = svgEl('circle', { class: 'hit', r: 30 }, g);
    svgEl('circle', { class: 'knob', r: 17 }, g);
    const icon = svgEl('g', { class: 'rot' }, g);
    rotationIcon(icon, 8);
    return { g, hit, icon };
  });

  return { svg, tris, tokens, outline, rowInd, colInd, handles };
}

function buildHelpDiagram(svg) {
  const s = 50;
  const W = SIZE * s;
  svg.setAttribute('viewBox', `-6 -6 ${W + 12} ${W + 12}`);
  svg.classList.add('help-diagram');
  svg.replaceChildren();
  for (const t of TRIANGLES) svgEl('path', { class: 'cell', d: pathOf(t.vertices, s) }, svg);
  SQUARES.forEach((sq) => {
    const [cx, cy] = sq.center;
    svgEl(
      'rect',
      {
        class: `q q${sq.index}`,
        x: (cx - 1) * s + (sq.index < 4 ? 3 : 0),
        y: (cy - 1) * s + (sq.index < 4 ? 3 : 0),
        width: 2 * s - (sq.index < 4 ? 6 : 0),
        height: 2 * s - (sq.index < 4 ? 6 : 0),
        rx: 4,
        'fill-opacity': sq.index < 4 ? 0.55 : 0,
      },
      svg,
    );
  });
  for (const t of TRIANGLES) {
    const [a, , c] = t.vertices;
    if (t.h === 0) svgEl('line', { class: 'diag', x1: a[0] * s, y1: a[1] * s, x2: c[0] * s, y2: c[1] * s }, svg);
  }
  for (const sq of SQUARES) {
    svgEl('circle', { class: 'hub', cx: sq.center[0] * s, cy: sq.center[1] * s, r: 6 }, svg);
  }
}

// ---------------------------------------------------------------- アプリ本体

export function createApp() {
  const $ = (id) => document.getElementById(id);
  const saved = storage.load();
  const settings = loadSettings(saved.settings);
  const bests = loadBests(saved.bests);
  const persist = () => storage.save({ settings, bests });

  const el = {
    board: $('board'),
    moves: $('st-moves'),
    time: $('st-time'),
    gen: $('st-gen'),
    mode: $('st-mode'),
    diff: $('st-diff'),
    notice: $('notice'),
    undo: $('btn-undo'),
    redo: $('btn-redo'),
    reset: $('btn-reset'),
    newBtn: $('btn-new'),
    share: $('btn-share'),
    dirCw: $('dir-cw'),
    dirCcw: $('dir-ccw'),
    help: $('btn-help'),
    settingsBtn: $('btn-settings'),
    dlgNew: $('dlg-new'),
    dlgHelp: $('dlg-help'),
    dlgSettings: $('dlg-settings'),
    dlgClear: $('dlg-clear'),
    modeChoices: $('mode-choices'),
    diffChoices: $('diff-choices'),
    optDups: $('opt-dups'),
    optColors: $('opt-colors'),
    recordsBody: $('records-body'),
    clearMoves: $('clear-moves'),
    clearTime: $('clear-time'),
    clearWithin: $('clear-within'),
    clearBest: $('clear-best'),
    toast: $('toast'),
  };

  const view = buildBoard(el.board);
  buildHelpDiagram($('help-diagram'));
  for (const g of document.querySelectorAll('.segmented .rot-icon')) rotationIcon(g, 7);

  const state = {
    mode: DEFAULT_MODE,
    difficulty: DEFAULT_DIFFICULTY,
    genMoves: 0,
    initial: [],
    board: [],
    history: [],
    cursor: 0,
    solved: false,
    busy: false,
  };

  // ------------------------------------------------------------ タイマー

  const timer = {
    acc: 0,
    since: null,
    running: false,
    restart() {
      this.acc = 0;
      this.since = null;
      this.running = true;
      if (!document.hidden) this.since = performance.now();
    },
    stop() {
      this.pause();
      this.running = false;
    },
    pause() {
      if (this.since != null) {
        this.acc += performance.now() - this.since;
        this.since = null;
      }
    },
    resume() {
      if (this.running && this.since == null) this.since = performance.now();
    },
    elapsed() {
      return this.acc + (this.since != null ? performance.now() - this.since : 0);
    },
  };

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) timer.pause();
    else timer.resume();
  });
  setInterval(() => {
    el.time.textContent = formatTime(timer.elapsed());
  }, 250);

  // ------------------------------------------------------------ 画面更新

  function difficultyLabel() {
    return findDifficulty(state.difficulty)?.label ?? '共有された問題';
  }

  function renderBoard() {
    const dups = duplicateGroups(state.board);
    state.board.forEach((v, id) => {
      view.tokens[id].textContent = String(v);
      view.tris[id].setAttribute('class', `tri v${v}`);
    });
    view.rowInd.forEach((e, i) => e.setAttribute('class', `ind ${dups.row[i] ? 'bad' : 'ok'}`));
    view.colInd.forEach((e, i) => e.setAttribute('class', `ind ${dups.col[i] ? 'bad' : 'ok'}`));
    view.handles.forEach((h, i) => {
      h.g.classList.toggle('bad', dups.square[i]);
      h.g.classList.toggle('ok', !dups.square[i]);
    });
  }

  function renderStatus() {
    el.moves.textContent = String(state.cursor);
    el.time.textContent = formatTime(timer.elapsed());
    el.gen.textContent = state.genMoves > 0 ? String(state.genMoves) : '—';
    el.mode.textContent = `${MODES[state.mode].label}モード`;
    el.diff.textContent = difficultyLabel();
    el.undo.disabled = state.solved || state.cursor === 0;
    el.redo.disabled = state.solved || state.cursor >= state.history.length;
    el.reset.disabled = !state.solved && state.cursor === 0 && state.history.length === 0;
    el.board.classList.toggle('locked', state.solved);
  }

  function renderAids() {
    el.board.classList.toggle('aid-dups', settings.showDuplicates);
    el.board.classList.toggle('aid-colors', settings.colorNumbers);
    el.optDups.checked = settings.showDuplicates;
    el.optColors.checked = settings.colorNumbers;
  }

  function renderDirection() {
    el.dirCw.setAttribute('aria-pressed', String(settings.dir === 1));
    el.dirCcw.setAttribute('aria-pressed', String(settings.dir === -1));
    view.handles.forEach((h, i) => {
      h.icon.setAttribute('transform', settings.dir === 1 ? '' : 'scale(-1 1)');
      h.g.setAttribute('aria-label', `${SQUARES[i].label}の正方形を${DIR_NAME[settings.dir]}に回す`);
    });
  }

  function render() {
    renderBoard();
    renderStatus();
  }

  // ------------------------------------------------------------ 通知

  let toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  function showNotice(message, kind = 'info') {
    el.notice.textContent = message;
    el.notice.className = `notice ${kind}`;
    el.notice.hidden = false;
  }

  function hideNotice() {
    el.notice.hidden = true;
    el.notice.textContent = '';
  }

  // ------------------------------------------------------------ ハイライト

  let highlighted = null;
  function setHighlight(index) {
    highlighted = index;
    view.handles.forEach((h, i) => h.g.classList.toggle('active', i === index));
    if (index == null) {
      view.outline.classList.remove('on');
      return;
    }
    const [cx, cy] = SQUARES[index].center;
    view.outline.setAttribute('x', String((cx - 1) * S));
    view.outline.setAttribute('y', String((cy - 1) * S));
    view.outline.classList.add('on');
  }
  function clearHighlight(index) {
    if (highlighted === index) setHighlight(null);
  }

  // ------------------------------------------------------------ アニメーション

  /** 数字を、移り先の三角形の重心へ、回転の中心のまわりの円弧に沿って動かす */
  function animateRotation(square, k) {
    if (prefersReducedMotion() || document.hidden) return Promise.resolve();
    const [cx, cy] = SQUARES[square].center.map((v) => v * S);
    const items = rotationMap(square, k).map(({ from, to }) => {
      const [qx, qy] = TRIANGLES[from].centroid.map((v) => v * S);
      const [px, py] = TRIANGLES[to].centroid.map((v) => v * S);
      const a0 = Math.atan2(qy - cy, qx - cx);
      const a1 = Math.atan2(py - cy, px - cx);
      let delta = a1 - a0;
      if (k > 0) while (delta <= 0) delta += 2 * Math.PI;
      else while (delta >= 0) delta -= 2 * Math.PI;
      return { el: view.tokens[to], px, py, a1, delta, radius: Math.hypot(px - cx, py - cy) };
    });

    const place = (e) => {
      for (const it of items) {
        const a = it.a1 - it.delta * (1 - e);
        const x = cx + it.radius * Math.cos(a) - it.px;
        const y = cy + it.radius * Math.sin(a) - it.py;
        it.el.setAttribute('transform', `translate(${r2(x)} ${r2(y)})`);
      }
    };
    const finish = () => items.forEach((it) => it.el.removeAttribute('transform'));

    place(0);
    return new Promise((resolve) => {
      const start = performance.now();
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        finish();
        resolve();
      };
      const frame = (now) => {
        if (done) return;
        const t = Math.min(1, (now - start) / ANIM_MS);
        place(easeInOutCubic(t));
        if (t < 1) requestAnimationFrame(frame);
        else end();
      };
      requestAnimationFrame(frame);
      // タブが隠れて requestAnimationFrame が止まっても入力が止まらないようにする
      setTimeout(end, ANIM_MS + 250);
    });
  }

  // ------------------------------------------------------------ 操作

  function performMove(move) {
    const k = moveToK(move, state.mode);
    state.board = applyMove(state.board, move, state.mode);
    const solvedNow = isSolved(state.board);
    if (solvedNow) {
      state.solved = true;
      timer.stop();
    }
    render();
    state.busy = true;
    animateRotation(move.square, k).then(() => {
      state.busy = false;
      if (solvedNow) onSolved();
    });
  }

  function rotateSquare(square, dir) {
    if (state.busy || state.solved) return;
    state.history.length = state.cursor;
    state.history.push({ square, dir });
    state.cursor++;
    performMove({ square, dir });
  }

  function undo() {
    if (state.busy || state.solved || state.cursor === 0) return;
    const m = state.history[--state.cursor];
    performMove({ square: m.square, dir: -m.dir });
  }

  function redo() {
    if (state.busy || state.solved || state.cursor >= state.history.length) return;
    const m = state.history[state.cursor++];
    performMove(m);
  }

  function reset() {
    if (state.busy) return;
    const wasSolved = state.solved;
    state.board = state.initial.slice();
    state.history = [];
    state.cursor = 0;
    state.solved = false;
    el.board.classList.remove('solved');
    // クリア後のリセットは「もう一度遊ぶ」なので時間も 0 から測り直す
    if (wasSolved) timer.restart();
    render();
  }

  function recordKey() {
    return state.difficulty ? `${state.mode}:${state.difficulty}` : null;
  }

  function onSolved() {
    const moves = state.cursor;
    const time = timer.elapsed();
    let improved = false;
    const key = recordKey();
    if (key) {
      const rec = bests[key] ?? {};
      if (rec.moves == null || moves < rec.moves) {
        rec.moves = moves;
        improved = true;
      }
      if (rec.time == null || time < rec.time) {
        rec.time = time;
        improved = true;
      }
      bests[key] = rec;
      persist();
    }

    el.board.classList.add('solved');
    el.clearMoves.textContent = `${moves}手`;
    el.clearTime.textContent = formatTime(time);
    const within = state.genMoves > 0 && moves <= state.genMoves;
    el.clearWithin.hidden = !within;
    el.clearWithin.textContent = within ? `作成手数（${state.genMoves}手）以内でクリアしました。` : '';
    el.clearBest.hidden = !improved;
    el.clearBest.textContent = improved ? `ベスト記録を更新しました（${MODES[state.mode].label}・${difficultyLabel()}）` : '';
    openDialog(el.dlgClear);
  }

  // ------------------------------------------------------------ 問題の読み込み

  function loadPuzzle({ mode, board, genMoves, difficulty }) {
    state.mode = mode;
    state.difficulty = difficulty;
    state.genMoves = genMoves;
    state.initial = board.slice();
    state.board = board.slice();
    state.history = [];
    state.cursor = 0;
    state.solved = false;
    state.busy = false;
    el.board.classList.remove('solved');
    timer.restart();
    render();
  }

  function clearSharedQuery() {
    if (!globalThis.location?.search) return;
    try {
      const url = new URL(globalThis.location.href);
      url.search = '';
      globalThis.history.replaceState(null, '', url);
    } catch {
      // 変えられなくても遊ぶのに支障はない
    }
  }

  function newPuzzle(mode = settings.mode, difficulty = settings.difficulty) {
    let diff = difficulty;
    if (diff === RANDOM_PLACEMENT.key && mode !== '45') diff = DEFAULT_DIFFICULTY;
    const p = generatePuzzle({ mode, difficulty: diff });
    loadPuzzle({ mode, board: p.board, genMoves: p.genMoves, difficulty: p.difficulty });
    clearSharedQuery();
    hideNotice();
  }

  function loadFromQuery(search) {
    const result = decodePuzzle(search);
    if (result === null) {
      newPuzzle();
      return;
    }
    if (!result.ok) {
      newPuzzle();
      showNotice(`共有URLの問題を読み込めませんでした（${result.error}）。新しい問題を出しました。`, 'error');
      return;
    }
    const { mode, board, genMoves } = result.puzzle;
    let difficulty = difficultyFromGenMoves(genMoves)?.key ?? null;
    if (difficulty === RANDOM_PLACEMENT.key && mode !== '45') difficulty = null;
    loadPuzzle({ mode, board, genMoves, difficulty });
    if (mode === '90') {
      showNotice('共有URLから読み込んだ90°モードの配置です。解けることは保証されません。', 'warn');
    } else {
      hideNotice();
    }
  }

  async function share() {
    const url = new URL(globalThis.location.href);
    url.search = `?${encodePuzzle({ mode: state.mode, board: state.initial, genMoves: state.genMoves })}`;
    url.hash = '';
    const text = url.toString();
    if (await copyText(text)) toast('問題のURLをコピーしました');
    else globalThis.prompt('このURLをコピーしてください', text);
  }

  // ------------------------------------------------------------ ダイアログ

  function openDialog(dlg) {
    for (const d of document.querySelectorAll('dialog[open]')) if (d !== dlg) d.close();
    // Esc で閉じたときに前回の returnValue が残らないようにする
    dlg.returnValue = '';
    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }
  }

  for (const dlg of document.querySelectorAll('dialog')) {
    // 背景をタップしたら閉じる
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close('cancel');
    });
  }

  function buildChoices() {
    for (const m of Object.values(MODES)) {
      const label = htmlEl('label', { class: 'choice' }, el.modeChoices);
      htmlEl('input', { type: 'radio', name: 'mode', value: m.key }, label);
      const span = htmlEl('span', {}, label);
      htmlEl('span', { class: 'name' }, span, m.label);
      htmlEl('span', { class: 'sub' }, span, m.key === '45' ? '1回で数字が隣の三角形へ移る（既定）' : '1回で正方形が90°回る');
    }
    for (const d of [...DIFFICULTIES, RANDOM_PLACEMENT]) {
      const label = htmlEl('label', { class: 'choice' }, el.diffChoices);
      htmlEl('input', { type: 'radio', name: 'difficulty', value: d.key }, label);
      const span = htmlEl('span', {}, label);
      htmlEl('span', { class: 'name' }, span, d.label);
      htmlEl(
        'span',
        { class: 'sub' },
        span,
        d.key === RANDOM_PLACEMENT.key ? '1〜8を4個ずつ並べるだけ（45°モードのみ）' : `作成手数 ${d.moves}手`,
      );
    }
  }

  function syncRandomAvailability() {
    const form = el.dlgNew.querySelector('form');
    const mode = form.elements.mode.value;
    const random = form.querySelector(`input[name="difficulty"][value="${RANDOM_PLACEMENT.key}"]`);
    random.disabled = mode !== '45';
    if (random.disabled && random.checked) {
      form.querySelector(`input[name="difficulty"][value="${DEFAULT_DIFFICULTY}"]`).checked = true;
    }
  }

  function openNewDialog() {
    const form = el.dlgNew.querySelector('form');
    form.elements.mode.value = settings.mode;
    form.elements.difficulty.value = settings.difficulty;
    syncRandomAvailability();
    openDialog(el.dlgNew);
  }

  function renderRecords() {
    el.recordsBody.replaceChildren();
    for (const d of [...DIFFICULTIES, RANDOM_PLACEMENT]) {
      const tr = htmlEl('tr', {}, el.recordsBody);
      htmlEl('th', { scope: 'row' }, tr, d.label);
      for (const mode of Object.keys(MODES)) {
        const rec = bests[`${mode}:${d.key}`];
        if (d.key === RANDOM_PLACEMENT.key && mode !== '45') {
          htmlEl('td', { class: 'empty' }, tr, '—');
        } else if (rec && (rec.moves != null || rec.time != null)) {
          const parts = [];
          if (rec.moves != null) parts.push(`${rec.moves}手`);
          if (rec.time != null) parts.push(formatTime(rec.time));
          htmlEl('td', {}, tr, parts.join(' / '));
        } else {
          htmlEl('td', { class: 'empty' }, tr, '記録なし');
        }
      }
    }
  }

  // ------------------------------------------------------------ イベント

  view.handles.forEach((h, i) => {
    h.g.addEventListener('click', (e) => {
      e.preventDefault();
      rotateSquare(i, settings.dir);
    });
    h.g.addEventListener('contextmenu', (e) => {
      // PC の右クリックは逆向き
      e.preventDefault();
      rotateSquare(i, -settings.dir);
    });
    h.g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        rotateSquare(i, e.shiftKey ? -settings.dir : settings.dir);
      }
    });
    h.g.addEventListener('pointerenter', () => setHighlight(i));
    h.g.addEventListener('pointerdown', () => setHighlight(i));
    h.g.addEventListener('pointerleave', () => clearHighlight(i));
    h.g.addEventListener('pointercancel', () => clearHighlight(i));
    h.g.addEventListener('focus', () => setHighlight(i));
    h.g.addEventListener('blur', () => clearHighlight(i));
  });

  // タップ領域を画面上で直径 44px 以上に保つ
  const fitHitAreas = () => {
    const width = el.board.getBoundingClientRect().width;
    if (!width) return;
    const unitsPerPx = (SIZE * S + 2 * MARGIN) / width;
    const r = Math.min(52, Math.max(30, MIN_HIT_RADIUS_PX * unitsPerPx));
    view.handles.forEach((h) => h.hit.setAttribute('r', String(r2(r))));
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitHitAreas).observe(el.board);
  else globalThis.addEventListener('resize', fitHitAreas);

  el.dirCw.addEventListener('click', () => {
    settings.dir = 1;
    persist();
    renderDirection();
  });
  el.dirCcw.addEventListener('click', () => {
    settings.dir = -1;
    persist();
    renderDirection();
  });

  el.undo.addEventListener('click', undo);
  el.redo.addEventListener('click', redo);
  el.reset.addEventListener('click', reset);
  el.share.addEventListener('click', share);
  el.newBtn.addEventListener('click', openNewDialog);
  el.help.addEventListener('click', () => openDialog(el.dlgHelp));
  el.settingsBtn.addEventListener('click', () => {
    renderRecords();
    openDialog(el.dlgSettings);
  });

  el.dlgNew.querySelector('form').addEventListener('change', syncRandomAvailability);
  el.dlgNew.addEventListener('close', () => {
    if (el.dlgNew.returnValue !== 'ok') return;
    const form = el.dlgNew.querySelector('form');
    settings.mode = form.elements.mode.value;
    settings.difficulty = form.elements.difficulty.value;
    persist();
    newPuzzle(settings.mode, settings.difficulty);
  });

  el.dlgClear.addEventListener('close', () => {
    if (el.dlgClear.returnValue === 'new') openNewDialog();
  });

  el.optDups.addEventListener('change', () => {
    settings.showDuplicates = el.optDups.checked;
    persist();
    renderAids();
  });
  el.optColors.addEventListener('change', () => {
    settings.colorNumbers = el.optColors.checked;
    persist();
    renderAids();
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      redo();
    }
  });

  buildChoices();
  renderAids();
  renderDirection();

  return {
    start(search = globalThis.location?.search ?? '') {
      loadFromQuery(search);
      fitHitAreas();
    },
    newPuzzle,
  };
}
