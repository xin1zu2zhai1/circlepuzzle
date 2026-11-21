// 盤面定義：三角形の頂点、正方形 S0〜S4、横列・縦列の ID リスト。
// DOM に依存しない。盤面の大きさと数字の範囲はここの定数にまとめる（v1 は 4×4 と 1〜8 に固定）。

/** 盤面の一辺のマス数 */
export const SIZE = 4;
/** 数字の最大値（1〜MAX_NUM を使う） */
export const MAX_NUM = 8;
/** 各数字の個数 */
export const COPIES = (SIZE * SIZE * 2) / MAX_NUM;
/** 三角形の枚数 */
export const TRI_COUNT = SIZE * SIZE * 2;
/** 正方形 1 つに含まれる三角形の枚数（回転の 1 周） */
export const RING = 8;

/** 三角形 ID：id = (r×SIZE + c)×2 + h（h は U=0、L=1） */
export function triId(r, c, h) {
  return (r * SIZE + c) * 2 + h;
}

/** マス (r, c) の対角線の向き。r+c が偶数なら「＼」、奇数なら「／」 */
export function diagonalOf(r, c) {
  return (r + c) % 2 === 0 ? '\\' : '/';
}

// 格子点は [x, y]（x が右、y が下）。マス (r, c) の左上は [c, r]。
function cellCorners(r, c) {
  return {
    TL: [c, r],
    TR: [c + 1, r],
    BR: [c + 1, r + 1],
    BL: [c, r + 1],
  };
}

function triangleVertices(r, c, h) {
  const k = cellCorners(r, c);
  if (diagonalOf(r, c) === '\\') {
    return h === 0 ? [k.TL, k.TR, k.BR] : [k.TL, k.BL, k.BR];
  }
  return h === 0 ? [k.TL, k.TR, k.BL] : [k.TR, k.BR, k.BL];
}

/**
 * 三角形の一覧。index が三角形 ID。
 * vertices と centroid はマス単位の座標（一辺 s で描くときは s を掛ける）。
 */
export const TRIANGLES = (() => {
  const list = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      for (let h = 0; h < 2; h++) {
        const vertices = triangleVertices(r, c, h);
        const centroid = [
          (vertices[0][0] + vertices[1][0] + vertices[2][0]) / 3,
          (vertices[0][1] + vertices[1][1] + vertices[2][1]) / 3,
        ];
        list.push({ id: triId(r, c, h), r, c, h, vertices, centroid });
      }
    }
  }
  return list;
})();

const SQUARE_LABELS_4 = ['左上', '右上', '左下', '右下', '中央'];

/**
 * 回転の中心：x+y が偶数の内側の格子点。
 * 並びは「x, y とも奇数の点（行優先）」→「x, y とも偶数の点（行優先）」。
 * 4×4 では S0 (1,1)、S1 (3,1)、S2 (1,3)、S3 (3,3)、S4 (2,2)。
 */
function rotationCenters() {
  const odd = [];
  const even = [];
  for (let y = 1; y < SIZE; y++) {
    for (let x = 1; x < SIZE; x++) {
      if ((x + y) % 2 !== 0) continue;
      (x % 2 === 1 ? odd : even).push([x, y]);
    }
  }
  return [...odd, ...even];
}

/**
 * 中心を頂点に持つ 8 枚の三角形を、時計回りに並べる。
 * 先頭は「左辺の中点と左上の角にはさまれた三角形」。
 * 画面座標は y が下向きなので、重心の角度 atan2(dy, dx) の昇順が時計回りになる。
 */
function squareSequence([cx, cy]) {
  const members = TRIANGLES.filter((t) =>
    t.vertices.some(([x, y]) => x === cx && y === cy),
  );
  return members
    .map((t) => ({
      id: t.id,
      angle: Math.atan2(t.centroid[1] - cy, t.centroid[0] - cx),
    }))
    .sort((a, b) => a.angle - b.angle)
    .map((m) => m.id);
}

/** 正方形 S0〜S4：center は格子点、seq は時計回り順の三角形 ID */
export const SQUARES = rotationCenters().map((center, index) => ({
  index,
  name: `S${index}`,
  label: SIZE === 4 ? SQUARE_LABELS_4[index] : `正方形${index + 1}`,
  center,
  seq: squareSequence(center),
}));

/** 横列 R0〜：ID 順 */
export const ROWS = Array.from({ length: SIZE }, (_, r) => {
  const ids = [];
  for (let c = 0; c < SIZE; c++) ids.push(triId(r, c, 0), triId(r, c, 1));
  return ids;
});

/** 縦列 C0〜：上から順 */
export const COLS = Array.from({ length: SIZE }, (_, c) => {
  const ids = [];
  for (let r = 0; r < SIZE; r++) ids.push(triId(r, c, 0), triId(r, c, 1));
  return ids;
});

/** 判定に使う全グループ（S0〜S4、R0〜R3、C0〜C3 の 13 個） */
export const GROUPS = [
  ...SQUARES.map((s) => ({ kind: 'square', index: s.index, name: s.name, ids: s.seq })),
  ...ROWS.map((ids, i) => ({ kind: 'row', index: i, name: `R${i}`, ids })),
  ...COLS.map((ids, i) => ({ kind: 'col', index: i, name: `C${i}`, ids })),
];

/** 三角形 ID ごとに、属するグループの index（GROUPS の添字）一覧 */
export const GROUPS_OF_TRIANGLE = (() => {
  const map = Array.from({ length: TRI_COUNT }, () => []);
  GROUPS.forEach((g, gi) => g.ids.forEach((id) => map[id].push(gi)));
  return map;
})();
