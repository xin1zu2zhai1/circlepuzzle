import test from 'node:test';
import assert from 'node:assert/strict';

import { COLS, GROUPS, ROWS, SQUARES, TRIANGLES, TRI_COUNT } from '../js/board.js';
import {
  ALL_MOVES,
  DIFFICULTIES,
  applyMoves,
  decodePuzzle,
  difficultyFromShortest,
  duplicateGroups,
  encodePuzzle,
  findShortestSolution,
  generatePuzzle,
  generateSolved,
  invertMoves,
  isSolved,
  mulberry32,
  randomMoves,
  rotate,
  squaresCommute,
  stepOf,
  validateBoard,
} from '../js/logic.js';

// 仕様書「テストケース」のデータ（Python で検算済み）
const SOLVED = [2, 1, 3, 4, 6, 5, 7, 8, 8, 7, 5, 6, 4, 3, 1, 2, 6, 5, 7, 8, 2, 1, 3, 4, 4, 3, 1, 2, 8, 7, 5, 6];
const INIT = [2, 1, 3, 4, 2, 1, 3, 4, 8, 7, 5, 6, 8, 7, 5, 6, 2, 1, 3, 4, 2, 1, 3, 4, 8, 7, 5, 6, 8, 7, 5, 6];

function randomBoard(rng) {
  return Array.from({ length: TRI_COUNT }, () => 1 + Math.floor(rng() * 8));
}

test('盤面定義：仕様書の 13 グループと一致する', () => {
  assert.deepEqual(
    SQUARES.map((s) => s.center),
    [[1, 1], [3, 1], [1, 3], [3, 3], [2, 2]],
  );
  assert.deepEqual(
    SQUARES.map((s) => s.seq),
    [
      [1, 0, 2, 3, 10, 11, 9, 8],
      [5, 4, 6, 7, 14, 15, 13, 12],
      [17, 16, 18, 19, 26, 27, 25, 24],
      [21, 20, 22, 23, 30, 31, 29, 28],
      [11, 10, 12, 13, 20, 21, 19, 18],
    ],
  );
  assert.deepEqual(ROWS, [
    [0, 1, 2, 3, 4, 5, 6, 7],
    [8, 9, 10, 11, 12, 13, 14, 15],
    [16, 17, 18, 19, 20, 21, 22, 23],
    [24, 25, 26, 27, 28, 29, 30, 31],
  ]);
  assert.deepEqual(COLS, [
    [0, 1, 8, 9, 16, 17, 24, 25],
    [2, 3, 10, 11, 18, 19, 26, 27],
    [4, 5, 12, 13, 20, 21, 28, 29],
    [6, 7, 14, 15, 22, 23, 30, 31],
  ]);
  assert.equal(GROUPS.length, 13);
});

test('盤面定義：三角形の頂点が仕様書の表どおり', () => {
  // (0,0) は「＼」：U = 左上・右上・右下、L = 左上・左下・右下
  assert.deepEqual(TRIANGLES[0].vertices, [[0, 0], [1, 0], [1, 1]]);
  assert.deepEqual(TRIANGLES[1].vertices, [[0, 0], [0, 1], [1, 1]]);
  // (0,1) は「／」：U = 左上・右上・左下、L = 右上・右下・左下
  assert.deepEqual(TRIANGLES[2].vertices, [[1, 0], [2, 0], [1, 1]]);
  assert.deepEqual(TRIANGLES[3].vertices, [[2, 0], [2, 1], [1, 1]]);
  // S0〜S3 は 32 枚を重なりなく分ける
  const covered = SQUARES.slice(0, 4).flatMap((s) => s.seq).sort((a, b) => a - b);
  assert.deepEqual(covered, Array.from({ length: 32 }, (_, i) => i));
});

test('1. isSolved(SOLVED) は true', () => {
  assert.equal(isSolved(SOLVED), true);
});

test('2. isSolved(INIT) は false。ただし S4 は 6,5,8,7,2,1,4,3 で重複なし', () => {
  assert.equal(isSolved(INIT), false);
  assert.deepEqual(SQUARES[4].seq.map((id) => INIT[id]), [6, 5, 8, 7, 2, 1, 4, 3]);
  assert.equal(duplicateGroups(INIT).square[4], false);
});

test('3. INIT で S1 を +4、S2 を +4 回すと SOLVED と一致', () => {
  assert.deepEqual(rotate(rotate(INIT, 1, 4), 2, 4), SOLVED);
});

test('4. INIT で S0 を +1 回すと ID 0〜11 が 1,8,2,3,2,1,3,4,7,6,4,5 になる', () => {
  const next = rotate(INIT, 0, 1);
  assert.deepEqual(next.slice(0, 12), [1, 8, 2, 3, 2, 1, 3, 4, 7, 6, 4, 5]);
  assert.deepEqual(next.slice(12), INIT.slice(12));
});

test('5. +k の後に −k で元に戻る。+1 を 8 回、+2 を 4 回でも元に戻る', () => {
  const rng = mulberry32(12345);
  for (let trial = 0; trial < 200; trial++) {
    const board = randomBoard(rng);
    for (let sq = 0; sq < SQUARES.length; sq++) {
      for (const k of [1, -1, 2, -2, 3, 4]) {
        assert.deepEqual(rotate(rotate(board, sq, k), sq, -k), board);
      }
      let b8 = board;
      for (let i = 0; i < 8; i++) b8 = rotate(b8, sq, 1);
      assert.deepEqual(b8, board);
      let b4 = board;
      for (let i = 0; i < 4; i++) b4 = rotate(b4, sq, 2);
      assert.deepEqual(b4, board);
    }
  }
});

test('6. 生成 1,000 回：各数字 4 個ずつ、出題時は未クリア、逆にたどるとクリア', () => {
  const settings = [];
  for (const mode of ['45', '90']) {
    for (const difficulty of ['easy', 'normal', 'hard', 'oni']) settings.push({ mode, difficulty });
  }
  settings.push({ mode: '45', difficulty: 'random' });

  for (let i = 0; i < 1000; i++) {
    const { mode, difficulty } = settings[i % settings.length];
    const p = generatePuzzle({ mode, difficulty, seed: i + 1 });
    assert.equal(validateBoard(p.board), null);
    assert.equal(isSolved(p.board), false);
    if (difficulty === 'random') {
      assert.equal(p.shortest, null);
      continue;
    }
    assert.equal(isSolved(p.solved), true);
    assert.equal(p.scramble.length, p.shortest);
    const back = applyMoves(p.board, invertMoves(p.scramble), mode);
    assert.deepEqual(back, p.solved);
  }
});

test('6d. 生成した問題の最短手数は難易度の範囲内で、それより短くは解けない', () => {
  for (const mode of ['45', '90']) {
    for (const diff of DIFFICULTIES) {
      const seen = new Set();
      for (let seed = 1; seed <= 40; seed++) {
        const p = generatePuzzle({ mode, difficulty: diff.key, seed });
        assert.ok(p.shortest >= diff.min && p.shortest <= diff.max, `${mode} ${diff.key}: ${p.shortest}`);
        assert.equal(findShortestSolution(p.board, mode, p.shortest - 1), null);
        const path = findShortestSolution(p.board, mode, p.shortest);
        assert.equal(path.length, p.shortest);
        assert.equal(isSolved(applyMoves(p.board, path, mode)), true);
        assert.equal(difficultyFromShortest(p.shortest).key, diff.key);
        seen.add(p.shortest);
      }
      // 範囲が 2 手以上ある難易度では、どの手数も出題される
      for (let n = diff.min; n <= diff.max; n++) assert.ok(seen.has(n), `${mode} ${diff.key} never gives ${n}`);
    }
  }
});

test('6b. スクランブルは直前の手を打ち消さず、同じ手を半周より長く続けず、四隅は番号順', () => {
  const rng = mulberry32(7);
  for (const [mode, maxRun] of [['45', 4], ['90', 2]]) {
    const moves = randomMoves(5000, mode, rng);
    let run = 1;
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1];
      const b = moves[i];
      assert.ok(!(a.square === b.square && a.dir === -b.dir), 'cancelling move');
      assert.ok(!(squaresCommute(a.square, b.square) && b.square < a.square), 'unsorted corner moves');
      run = a.square === b.square && a.dir === b.dir ? run + 1 : 1;
      assert.ok(run <= maxRun, `run of ${run} in ${mode}° mode`);
    }
  }
  // 重ならないのは四隅の正方形どうしだけ
  for (let a = 0; a < 5; a++) {
    for (let b = 0; b < 5; b++) assert.equal(squaresCommute(a, b), a !== b && a < 4 && b < 4);
  }
});

test('6c. 完成形の生成は毎回クリア状態になる', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const board = generateSolved(mulberry32(seed));
    assert.equal(validateBoard(board), null);
    assert.equal(isSolved(board), true);
  }
});

test('7. 同じシードと設定からは同じ問題ができる', () => {
  for (const opts of [
    { mode: '45', difficulty: 'normal', seed: 42 },
    { mode: '90', difficulty: 'oni', seed: 2026 },
    { mode: '45', difficulty: 'random', seed: 99 },
  ]) {
    assert.deepEqual(generatePuzzle(opts), generatePuzzle(opts));
  }
  const a = generatePuzzle({ mode: '45', difficulty: 'hard', seed: 1 });
  const b = generatePuzzle({ mode: '45', difficulty: 'hard', seed: 2 });
  assert.notDeepEqual(a.board, b.board);
  assert.throws(() => generatePuzzle({ mode: '90', difficulty: 'random', seed: 1 }));
});

test('8. 共有 URL：書き出して読み込むと一致し、不正な値は拒否する', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const mode = seed % 2 ? '45' : '90';
    const p = generatePuzzle({ mode, difficulty: 'hard', seed });
    const query = encodePuzzle(p);
    assert.match(query, /^m=(45|90)&s=[1-8]{32}&p=4$/);
    const r = decodePuzzle(`?${query}`);
    assert.equal(r.ok, true);
    assert.deepEqual(r.puzzle, { mode, board: p.board, p: 4 });
  }
  const random = generatePuzzle({ mode: '45', difficulty: 'random', seed: 3 });
  assert.match(encodePuzzle(random), /&p=0$/);

  const good = INIT.join('');
  assert.equal(decodePuzzle(''), null);
  assert.equal(decodePuzzle('?foo=1'), null);
  assert.equal(decodePuzzle(`?m=45&s=${good}&p=3`).ok, true);
  // 桁数違い
  assert.equal(decodePuzzle(`?m=45&s=${good.slice(1)}&p=3`).ok, false);
  assert.equal(decodePuzzle(`?m=45&s=${good}1&p=3`).ok, false);
  // 0 や 9 の混入
  assert.equal(decodePuzzle(`?m=45&s=0${good.slice(1)}&p=3`).ok, false);
  assert.equal(decodePuzzle(`?m=45&s=9${good.slice(1)}&p=3`).ok, false);
  assert.equal(decodePuzzle(`?m=45&s=a${good.slice(1)}&p=3`).ok, false);
  // 個数の偏り
  assert.equal(decodePuzzle(`?m=45&s=1${good.slice(1)}&p=3`).ok, false);
  assert.equal(decodePuzzle(`?m=45&s=${'12345678'.repeat(3)}11111111&p=3`).ok, false);
  // モードと手数の誤り
  assert.equal(decodePuzzle(`?m=60&s=${good}&p=3`).ok, false);
  assert.equal(decodePuzzle(`?m=45&s=${good}&p=-1`).ok, false);
  assert.equal(decodePuzzle(`?m=45&s=${good}&p=x`).ok, false);
});

/** 総当たり（重複除去なし）で、limit 手以内の最短手数を求める。見つからなければ null */
function bruteForceShortest(board, mode, limit) {
  if (isSolved(board)) return 0;
  const step = stepOf(mode);
  let layer = [board];
  for (let d = 1; d <= limit; d++) {
    const next = [];
    for (const b of layer) {
      for (const m of ALL_MOVES) {
        const nb = rotate(b, m.square, m.dir * step);
        if (isSolved(nb)) return d;
        next.push(nb);
      }
    }
    layer = next;
  }
  return null;
}

test('9. 最短手数の探索は総当たりと一致し、返す手順で実際にクリアできる', () => {
  for (const mode of ['45', '90']) {
    const rng = mulberry32(mode === '45' ? 11 : 22);
    for (let i = 0; i < 40; i++) {
      const solved = generateSolved(rng);
      const n = 1 + (i % 4);
      // 打ち消しや入れ替えも起こるように、生成用の制限なしで崩す
      const moves = Array.from({ length: n }, () => ALL_MOVES[Math.floor(rng() * ALL_MOVES.length)]);
      const board = applyMoves(solved, moves, mode);
      const expected = bruteForceShortest(board, mode, 4);
      const path = findShortestSolution(board, mode, 4);
      assert.equal(path?.length ?? null, expected);
      if (path) assert.equal(isSolved(applyMoves(board, path, mode)), true);
    }
  }
  // 手書き図：90°モードでは S1 と S2 を 180° ずつ（計 4 手）で完成する
  const path90 = findShortestSolution(INIT, '90', 6);
  assert.ok(path90.length <= 4);
  assert.equal(isSolved(applyMoves(INIT, path90, '90')), true);
  // 45°モードでは 8 手かかるので、4 手以内には解けない
  assert.equal(findShortestSolution(INIT, '45', 4), null);
  // クリア済みの盤面は 0 手
  assert.deepEqual(findShortestSolution(SOLVED, '45', 6), []);
});
