# komyaku.js

## 概要
画面の四辺を“脈打ちながら”巡回する小さなマスコットです。見た目や動きは `komyaku.js`（本体）で提供し、サイトごとの初期配置や微調整は `mykomyaku.js` で行う構成にしています。

同梱ファイル:
- `komyaku.js`: 本体（グローバル `window.KomyakuBanner` を提供）
- `mykomyaku.js`: 利用者が編集するカスタム設定・軽い挙動パッチ

## 使い方
HTML に読み込むだけで動きます（`mykomyaku.js` で初期スポーン）。

例:（自前ホスト）
```html
<script src="/src/js/komyaku.js/komyaku.js"></script>
<script src="/src/js/komyaku.js/mykomyaku.js"></script>
```

例:（配布元を直リンク）
```html
<script src="https://mecto.jp/src/js/komyaku.js/komyaku.js"></script>
<script src="https://mecto.jp/src/js/komyaku.js/mykomyaku.js"></script>
```

## API（本体）
グローバルに `window.KomyakuBanner` が生えます。

- `KomyakuBanner.init(opts)`
  - 既定値を上書きします。戻り値は `KomyakuBanner`。
  - 主なオプション: `pulseSpeed(1..5)`, `stepLevel(1..5)`, `margin`, `marginRightExtra`, `collidePx`, `maxEntities`。
- `KomyakuBanner.spawn(options)`
  - 1 匹生成して返します（上限到達時は `null`）。
  - 主な `options`:
    - `color: string` 本体色（例 `#E52A2A`）
    - `eye: string` 目の色
    - `edge: 'top'|'right'|'bottom'|'left'` 開始辺
    - `pos: number` 辺上の位置（px）
    - `clockwise: boolean` 右回り（`true`）/左回り（`false`）
    - `stepLevel: 1..5` 歩幅の段階
    - `pulseSpeed: 1..5` テンポの段階
    - 任意: `dir: +1|-1` 視線微調整用のヒント（`mykomyaku.js` のみが参照）
- `KomyakuBanner.count()`
  - 画面上の匹数を返します。

## カスタマイズ（mykomyaku.js の編集）
`mykomyaku.js` は「利用者が自由に触る」前提のファイルです。以下に実例をいくつか示します。

1) 色と目の色・回転方向を変える
```js
const k = KomyakuBanner.spawn({
  color: '#FF8C00', eye: '#222',
  edge: 'bottom', pos: 200,
  clockwise: false, // 左回り
  dir: -1           // 視線の微調整（mykomyaku.js 内だけで使用）
});
```

2) 固定配置で複数スポーン（下辺に等間隔）
```js
const base = 80, gap = 140, n = 4;
for (let i = 0; i < n; i++) {
  KomyakuBanner.spawn({
    color: ['#E52A2A','#1E4FB7','#BDC3C7','#2ECC71'][i%4],
    eye: '#1E4FB7', edge: 'bottom', pos: base + i * gap,
    clockwise: i % 2 === 0, dir: +1
  });
}
```

3) テンポ・歩幅・当たり判定をまとめて調整
```js
KomyakuBanner.init({
  pulseSpeed: 4, // 速め
  stepLevel: 3,  // 普通
  collidePx: 36, // ニアミス距離を少し狭め
});
```

4) 途中で増やす（一定時間後に追加スポーン）
```js
setTimeout(() => {
  const r = Math.max(40, Math.min(innerWidth-40, Math.random()*innerWidth));
  KomyakuBanner.spawn({ color: '#2ECC71', eye: '#0B3D91', edge: 'top', pos: r, clockwise: true });
}, 3000);
```

5) 全体の見た目を 180° 反転（REVERSE）
```js
// mykomyaku.js 内の先頭近くにある REVERSE を true にします。
const REVERSE = true; // ← 反転
```

6) フレーム配分で“脈打ち感”を変える
```js
// mykomyaku.js 内の FRAME_WEIGHTS を編集（5 要素、合計 1 でなくても OK）
const FRAME_WEIGHTS = [0.10, 0.25, 0.40, 0.15, 0.10];
```

7) 上辺スタート／右辺スタートの例
```js
KomyakuBanner.spawn({ color: '#fff', eye: '#333', edge: 'top', pos: 120, clockwise: true });
KomyakuBanner.spawn({ color: '#333', eye: '#fff', edge: 'right', pos: 200, clockwise: false });
```

補足:
- `mykomyaku.js` は本体の内部実装に軽いパッチを当てていますが、見た目や基本挙動は変えません。
- `dir` は任意のサイン（+1/-1）で、視線の微調整だけに使われます。

## 開発メモ
- このディレクトリ（`src/js/komyaku.js/`）を、このコンポーネントの「トップ（ルート）」とみなす運用に合わせて README をここへ移動しました。
- もしこのフォルダ単体で独立リポにしたい場合は、Git のサブディレクトリを別リポ化する（subtree/sparse-checkout 等）運用を検討してください。
  - 例: 新規リポにこのフォルダの内容だけをコピーして運用する、など。

## ライセンス/注意
- サイトへの直リンク運用時は、配布元の変更に依存します。安定運用したい場合は自前ホストを推奨します。
- 画面サイズが変わると自動で追従します（`resize` 監視）。
