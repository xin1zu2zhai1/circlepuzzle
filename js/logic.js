// 回転、クリア判定、完成形の生成、スクランブル、最短手数の探索、PRNG、URL の読み書き。
// すべて DOM に依存しない純粋な関数（PRNG は呼び出し側が渡す状態を持つ関数）。

import {
  COPIES,
  GROUPS,
  GROUPS_OF_TRIANGLE,
  MAX_NUM,
  RING,
  SQUARES,
  TRI_COUNT,
} from './board.js';

// ---------------------------------------------------------------- モードと難易度

/** 回転モード。step は 1 ステップでずらす量 k の大きさ */
export const MODES = {
  45: { key: '45', label: '45°', step: 1 },
  90: { key: '90', label: '90°', step: 2 },
};
export const DEFAULT_MODE = '45';

/** 最短手数を確かめられる上限。これを超える問題は作らない */
export const MAX_VERIFIED_MOVES = 6;

/** 難易度は最短手数の範囲で決める（min〜max 手） */
export const DIFFICULTIES = [
  { key: 'easy', label: 'やさしい', min: 1, max: 2 },
  { key: 'normal', label: 'ふつう', min: 3, max: 3 },
  { key: 'hard', label: 'むずかしい', min: 4, max: 4 },
  { key: 'oni', label: '鬼', min: 5, max: 6 },
];
/** ランダム配置（45°モードのみ）。最短手数は調べない */
export const RANDOM_PLACEMENT = { key: 'random', label: 'ランダム配置', min: null, max: null };
export const DEFAULT_DIFFICULTY = 'normal';

export function isMode(mode) {
  return Object.prototype.hasOwnProperty.call(MODES, mode);
}

export function stepOf(mode) {
  if (!isMode(mode)) throw new Error(`unknown mode: ${mode}`);
  return MODES[mode].step;
}

export function findDifficulty(key) {
  if (key === RANDOM_PLACEMENT.key) return RANDOM_PLACEMENT;
  return DIFFICULTIES.find((d) => d.key === key) ?? null;
}

/** 最短手数から難易度を決める（共有 URL 用）。どの範囲にも入らなければ null */
export function difficultyFromShortest(shortest) {
  if (!Number.isInteger(shortest)) return null;
  return DIFFICULTIES.find((d) => shortest >= d.min && shortest <= d.max) ?? null;
}

/** 難易度の手数の表記（例：「1〜2手」「3手」） */
export function difficultyRangeLabel(diff) {
  if (diff.min == null) return '';
  return diff.min === diff.max ? `${diff.min}手` : `${diff.min}〜${diff.max}手`;
}

// ---------------------------------------------------------------- PRNG

/** シード付き PRNG（mulberry32）。[0, 1) の数を返す関数を返す */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, n) {
  return Math.floor(rng() * n);
}

export function shuffle(array, rng) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const VALUES = Array.from({ length: MAX_NUM }, (_, i) => i + 1);

// ---------------------------------------------------------------- 回転

/**
 * 正方形 squareIndex を k だけ回した盤面を返す（元の配列は変えない）。
 * next[seq[(i+k) mod 8]] = cur[seq[i]]。正方形に含まれない三角形はそのまま。
 */
export function rotate(board, squareIndex, k) {
  const seq = SQUARES[squareIndex].seq;
  const n = seq.length;
  const shift = ((k % n) + n) % n;
  const next = board.slice();
  for (let i = 0; i < n; i++) next[seq[(i + shift) % n]] = board[seq[i]];
  return next;
}

/** 回転で数字がどの三角形からどの三角形へ移るか（アニメーション用） */
export function rotationMap(squareIndex, k) {
  const seq = SQUARES[squareIndex].seq;
  const n = seq.length;
  const shift = ((k % n) + n) % n;
  return seq.map((from, i) => ({ from, to: seq[(i + shift) % n] }));
}

/** 1 手 = { square, dir }（dir は時計回り +1、反時計回り −1）。k = dir × step */
export function moveToK(move, mode) {
  return move.dir * stepOf(mode);
}

export function applyMove(board, move, mode) {
  return rotate(board, move.square, moveToK(move, mode));
}

export function applyMoves(board, moves, mode) {
  return moves.reduce((b, m) => applyMove(b, m, mode), board);
}

/** 手順を逆にたどる手順（逆順・逆向き） */
export function invertMoves(moves) {
  return moves
    .slice()
    .reverse()
    .map((m) => ({ square: m.square, dir: -m.dir }));
}

/** 2 つの正方形が三角形を共有しない（＝回す順番を入れ替えても結果が同じ）か */
const SQUARES_DISJOINT = SQUARES.map((a) =>
  SQUARES.map((b) => a !== b && !a.seq.some((id) => b.seq.includes(id))),
);
export function squaresCommute(a, b) {
  return SQUARES_DISJOINT[a][b];
}

/** 1 手として選べる手の一覧（正方形 × 向き） */
export const ALL_MOVES = SQUARES.flatMap((s) => [
  { square: s.index, dir: 1 },
  { square: s.index, dir: -1 },
]);

// ---------------------------------------------------------------- 判定

/** グループごとに 1〜8 がちょうど 1 回ずつ入っているか（GROUPS と同じ並び） */
export function groupStatus(board) {
  return GROUPS.map((g) => groupComplete(board, g.ids));
}

function groupComplete(board, ids) {
  let seen = 0;
  for (const id of ids) {
    const v = board[id];
    if (!(v >= 1 && v <= MAX_NUM)) return false;
    const bit = 1 << v;
    if (seen & bit) return false;
    seen |= bit;
  }
  return true;
}

/** 13 グループすべてに 1〜8 がちょうど 1 回ずつ入っていればクリア */
export function isSolved(board) {
  for (const g of GROUPS) if (!groupComplete(board, g.ids)) return false;
  return true;
}

/** 重複があるグループを種類ごとに返す（true = 重複あり） */
export function duplicateGroups(board) {
  const status = groupStatus(board);
  const out = { square: [], row: [], col: [] };
  GROUPS.forEach((g, i) => {
    out[g.kind][g.index] = !status[i];
  });
  return out;
}

/** 盤面が「長さ 32、各要素 1〜8、各数字 4 個ずつ」か。問題なければ null、あれば理由 */
export function validateBoard(board) {
  if (!Array.isArray(board) || board.length !== TRI_COUNT) {
    return `数字が${TRI_COUNT}個ではありません`;
  }
  const counts = new Array(MAX_NUM + 1).fill(0);
  for (const v of board) {
    if (!Number.isInteger(v) || v < 1 || v > MAX_NUM) {
      return `1〜${MAX_NUM}以外の数字が含まれています`;
    }
    counts[v]++;
  }
  if (counts.slice(1).some((n) => n !== COPIES)) {
    return `各数字が${COPIES}個ずつではありません`;
  }
  return null;
}

// ---------------------------------------------------------------- 最短手数

/**
 * 盤面から、いずれかのクリア状態までの最短手順を幅優先探索で求める。
 * maxDepth 手以内に見つからなければ null。見つかれば手順（配列）を返す（クリア済みなら []）。
 * 完成形は複数あるので、目標は「13 グループの条件を満たす盤面」すべて。
 * 最後の深さの盤面は記録せず判定だけするので、記録する盤面は maxDepth−1 手までになる。
 */
export function findShortestSolution(board, mode, maxDepth = MAX_VERIFIED_MOVES) {
  if (isSolved(board)) return [];
  const step = stepOf(mode);
  const seen = new Set([board.join('')]);
  let frontier = [{ board, move: null, prev: null }];

  const pathOf = (node, last) => {
    const path = [last];
    for (let n = node; n.move; n = n.prev) path.push(n.move);
    return path.reverse();
  };

  for (let depth = 1; depth <= maxDepth; depth++) {
    const isLast = depth === maxDepth;
    const next = [];
    for (const node of frontier) {
      for (const move of ALL_MOVES) {
        // 直前の手を打ち消す手は、1 つ前の盤面（調べ済み）に戻るだけなので調べない。
        // 入れ替えても同じになる並びは、盤面の重複チェックで除かれる。
        const prev = node.move;
        if (prev && prev.square === move.square && prev.dir === -move.dir) continue;
        const b = rotate(node.board, move.square, move.dir * step);
        if (isSolved(b)) return pathOf(node, move);
        if (isLast) continue;
        const key = b.join('');
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ board: b, move, prev: node });
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return null;
}

/** 最短手数（maxDepth 手以内に解けなければ null） */
export function shortestMoves(board, mode, maxDepth = MAX_VERIFIED_MOVES) {
  return findShortestSolution(board, mode, maxDepth)?.length ?? null;
}

// ---------------------------------------------------------------- 生成

/**
 * 完成形を 1 つ作る。32 枚に数字を入れるバックトラッキングで、
 * 候補の数字を試す順をシャッフルし、13 グループで重複が出たら戻る。
 */
export function generateSolved(rng) {
  const board = new Array(TRI_COUNT).fill(0);
  const used = new Array(GROUPS.length).fill(0);

  function fill(id) {
    if (id === TRI_COUNT) return true;
    const groups = GROUPS_OF_TRIANGLE[id];
    let mask = 0;
    for (const g of groups) mask |= used[g];
    for (const v of shuffle(VALUES, rng)) {
      const bit = 1 << v;
      if (mask & bit) continue;
      board[id] = v;
      for (const g of groups) used[g] |= bit;
      if (fill(id + 1)) return true;
      for (const g of groups) used[g] &= ~bit;
    }
    board[id] = 0;
    return false;
  }

  if (!fill(0)) throw new Error('no solved board found');
  return board;
}

/**
 * ランダムな手順を n 手作る。
 * - 直前の手を打ち消す手（同じ正方形の逆向き）は選ばない
 * - 同じ正方形を同じ向きに、半周（45°なら 4 回、90°なら 2 回）を超えて続けない
 *   （それ以上は反対向きの方が短いため）
 * - 重ならない正方形どうし（四隅の 4 つ）が続くときは番号の小さい順にする。
 *   順番を入れ替えて手が打ち消し合うのを防ぐ（例：左上→右下→左上の逆 は 右下の 1 手と同じ）
 */
export function randomMoves(n, mode, rng) {
  const maxRun = RING / stepOf(mode) / 2;
  const moves = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const prev = moves[moves.length - 1];
    const options = ALL_MOVES.filter((m) => {
      if (!prev) return true;
      if (prev.square === m.square) {
        if (prev.dir === -m.dir) return false;
        if (prev.dir === m.dir && run >= maxRun) return false;
      }
      if (squaresCommute(prev.square, m.square) && m.square < prev.square) return false;
      return true;
    });
    const move = options[randomInt(rng, options.length)];
    run = prev && prev.square === move.square && prev.dir === move.dir ? run + 1 : 1;
    moves.push(move);
  }
  return moves;
}

/** 1〜8 を 4 個ずつシャッフルした配置（クリア状態になったら引き直す） */
export function randomPlacement(rng) {
  const base = [];
  for (const v of VALUES) for (let i = 0; i < COPIES; i++) base.push(v);
  let board;
  do {
    board = shuffle(base, rng);
  } while (isSolved(board));
  return board;
}

/** 新しいシード（32 ビット） */
export function newSeed() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0];
  }
  return Math.floor(Math.random() * 2 ** 32) >>> 0;
}

/**
 * 問題を作る。同じ seed・mode・difficulty からは同じ問題ができる。
 * 戻り値：{ mode, difficulty, seed, board, shortest, solved, scramble }
 * - shortest：最短手数（ランダム配置は null）。生成時に探索で確かめた値
 * - solved：崩す前の完成形（ランダム配置は null）
 * - scramble：崩すのに使った手順。長さは shortest と同じ（ランダム配置は空）
 *
 * 目標の手数 t を難易度の範囲から選び、完成形を t 手崩す。
 * t−1 手以内で解けてしまう配置（手が打ち消し合ったもの）は捨てて作り直すので、
 * 出題される問題の最短手数はちょうど t になる。
 */
export function generatePuzzle({ mode = DEFAULT_MODE, difficulty = DEFAULT_DIFFICULTY, seed } = {}) {
  if (!isMode(mode)) throw new Error(`unknown mode: ${mode}`);
  const diff = findDifficulty(difficulty);
  if (!diff) throw new Error(`unknown difficulty: ${difficulty}`);
  const s = seed === undefined ? newSeed() : seed >>> 0;
  const rng = mulberry32(s);

  if (diff.key === RANDOM_PLACEMENT.key) {
    if (mode !== '45') throw new Error('random placement is only available in 45° mode');
    return {
      mode,
      difficulty: diff.key,
      seed: s,
      board: randomPlacement(rng),
      shortest: null,
      solved: null,
      scramble: [],
    };
  }

  const solved = generateSolved(rng);
  for (;;) {
    const target = diff.min + randomInt(rng, diff.max - diff.min + 1);
    const scramble = randomMoves(target, mode, rng);
    const board = applyMoves(solved, scramble, mode);
    if (findShortestSolution(board, mode, target - 1) !== null) continue;
    return { mode, difficulty: diff.key, seed: s, board, shortest: target, solved, scramble };
  }
}

// ---------------------------------------------------------------- 共有 URL

/** 共有 URL のクエリ部分：m=45&s=<32桁>&p=<最短手数>（ランダム配置は p=0） */
export function encodePuzzle({ mode, board, shortest }) {
  return `m=${mode}&s=${board.join('')}&p=${shortest ?? 0}`;
}

/**
 * 共有 URL のクエリを読む。
 * - クエリに m・s・p がどれもなければ null（共有された問題ではない）
 * - 正しければ { ok: true, puzzle: { mode, board, p } }（p は URL に書かれた手数。なければ 0）
 * - 誤りがあれば { ok: false, error }
 * 最短手数は URL の値を信用せず、読み込んだ側で findShortestSolution を使って確かめる。
 */
export function decodePuzzle(search) {
  const params = new URLSearchParams(search);
  if (!params.has('m') && !params.has('s') && !params.has('p')) return null;

  const mode = params.get('m') ?? DEFAULT_MODE;
  if (!isMode(mode)) return { ok: false, error: 'モードの指定が正しくありません' };

  const s = (params.get('s') ?? '').trim();
  if (s.length !== TRI_COUNT) return { ok: false, error: `数字が${TRI_COUNT}個ではありません` };
  if (!/^[0-9]+$/.test(s)) return { ok: false, error: '数字以外の文字が含まれています' };
  const board = Array.from(s, Number);
  const boardError = validateBoard(board);
  if (boardError) return { ok: false, error: boardError };

  let p = 0;
  if (params.has('p')) {
    const raw = params.get('p').trim();
    if (!/^[0-9]{1,4}$/.test(raw)) return { ok: false, error: '手数の指定が正しくありません' };
    p = Number(raw);
  }

  return { ok: true, puzzle: { mode, board, p } };
}
