// 回転、クリア判定、完成形の生成、スクランブル、PRNG、URL の読み書き。
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

/** 難易度と作成手数 N（仮の値。遊んでみて調整する） */
export const DIFFICULTIES = [
  { key: 'easy', label: 'やさしい', moves: 3 },
  { key: 'normal', label: 'ふつう', moves: 6 },
  { key: 'hard', label: 'むずかしい', moves: 10 },
  { key: 'oni', label: '鬼', moves: 16 },
];
/** ランダム配置（45°モードのみ）。作成手数はない */
export const RANDOM_PLACEMENT = { key: 'random', label: 'ランダム配置', moves: 0 };
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

/** 作成手数から難易度を推定する（共有 URL 用）。一致しなければ null */
export function difficultyFromGenMoves(genMoves) {
  if (genMoves === 0) return RANDOM_PLACEMENT;
  return DIFFICULTIES.find((d) => d.moves === genMoves) ?? null;
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

// ---------------------------------------------------------------- 判定

/** グループごとに 1〜8 がちょうど 1 回ずつ入っているか（GROUPS と同じ並び） */
export function groupStatus(board) {
  return GROUPS.map((g) => {
    let seen = 0;
    for (const id of g.ids) {
      const v = board[id];
      if (!(v >= 1 && v <= MAX_NUM)) return false;
      const bit = 1 << v;
      if (seen & bit) return false;
      seen |= bit;
    }
    return true;
  });
}

/** 13 グループすべてに 1〜8 がちょうど 1 回ずつ入っていればクリア */
export function isSolved(board) {
  return groupStatus(board).every(Boolean);
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
 */
export function randomMoves(n, mode, rng) {
  const maxRun = RING / stepOf(mode) / 2;
  const moves = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const prev = moves[moves.length - 1];
    const options = [];
    for (let square = 0; square < SQUARES.length; square++) {
      for (const dir of [1, -1]) {
        if (prev && prev.square === square) {
          if (prev.dir === -dir) continue;
          if (prev.dir === dir && run >= maxRun) continue;
        }
        options.push({ square, dir });
      }
    }
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
 * 戻り値：{ mode, difficulty, seed, board, genMoves, solved, scramble }
 * - genMoves：作成手数 N（ランダム配置は 0）
 * - solved：崩す前の完成形（ランダム配置は null）
 * - scramble：崩すのに使った手順（ランダム配置は空）
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
      genMoves: 0,
      solved: null,
      scramble: [],
    };
  }

  const solved = generateSolved(rng);
  let scramble;
  let board;
  do {
    scramble = randomMoves(diff.moves, mode, rng);
    board = applyMoves(solved, scramble, mode);
  } while (isSolved(board));
  return { mode, difficulty: diff.key, seed: s, board, genMoves: diff.moves, solved, scramble };
}

// ---------------------------------------------------------------- 共有 URL

/** 共有 URL のクエリ部分：m=45&s=<32桁>&p=<作成手数> */
export function encodePuzzle({ mode, board, genMoves }) {
  return `m=${mode}&s=${board.join('')}&p=${genMoves ?? 0}`;
}

/**
 * 共有 URL のクエリを読む。
 * - クエリに m・s・p がどれもなければ null（共有された問題ではない）
 * - 正しければ { ok: true, puzzle: { mode, board, genMoves } }
 * - 誤りがあれば { ok: false, error }
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

  let genMoves = 0;
  if (params.has('p')) {
    const p = params.get('p').trim();
    if (!/^[0-9]{1,4}$/.test(p)) return { ok: false, error: '作成手数の指定が正しくありません' };
    genMoves = Number(p);
  }

  return { ok: true, puzzle: { mode, board, genMoves } };
}
