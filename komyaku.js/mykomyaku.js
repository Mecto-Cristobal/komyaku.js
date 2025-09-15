// mykomyaku.js — サイト側カスタム設定と軽い挙動パッチ統合
// ここは“利用者が編集する想定”のファイルです。
// komyaku.js 本体の挙動は変えずに、視線の微調整や初期配置、テンポ揺らぎ等を加えます。
(function () {
  'use strict';

  // true で全体の進行向きを 180° 反転（見た目だけ）
  const REVERSE = false;
  // アニメの 5 フレームそれぞれに対して、1周期あたり前進の“配分”を与える
  // （0..1 の比率。合計は 1 でなくても OK）
  const FRAME_WEIGHTS = [0.14, 0.22, 0.36, 0.14, 0.14]; // 伸び>接地>戻り

  // DOM 準備
  const ready = (fn) => {
    if (document.readyState === 'complete' || document.readyState === 'interactive') fn();
    else document.addEventListener('DOMContentLoaded', fn, { once: true });
  };
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  // 本体がグローバルに生えるまで待つ
  function ensureBanner(cb, tries = 0) {
    if (window.KomyakuBanner && window.KomyakuBanner.spawn) { cb(); }
    else if (tries < 300) { requestAnimationFrame(() => ensureBanner(cb, tries + 1)); }
  }

  // 個体ごとに軽いパッチを当てる（描画は維持、細部だけ調整）
  function patchKomyaku(k) {
    // 目線の微調整＆フレームごとの微小前進（“脈打ち感”の補助）
    if (!k.__applyEyeBody) {
      k.__applyEyeBody = k._applyEyeBody;
      k._applyEyeBody = function () {
        this.__applyEyeBody();
        // 黒目を進行方向っぽく 1px ずらす（this.dir は利用者が spawn に与える任意のフラグ）
        const cx = parseFloat(this.sprite.sclera.getAttribute('cx'));
        this.sprite.iris.setAttribute('cx', String(cx + (this.dir > 0 ? 1 : -1)));
        // 微小前進（recoil→normal の区切りでの本進行は本体側に任せる）
        this._lastFrame = this._lastFrame ?? this.frame;
        const prev = this._lastFrame;
        const w = FRAME_WEIGHTS[this.frame] || 0;
        if (!(prev === 4 && this.frame === 0)) {
          this._advance(this.speedPx() * w);
        }
        this._lastFrame = this.frame;
      };
    }

    // 上辺・左辺での見た目 flip と、REVERSE 指定時の見た目 180° 回転
    if (!k.__applyTransform) {
      k.__applyTransform = k._applyTransform;
      k._applyTransform = function () {
        this.__applyTransform();
        const g = this.sprite.g;
        let tf = g.getAttribute('transform') || '';
        const needsFlip = (this.edge === 'top' || this.edge === 'left');
        if (needsFlip && !tf.includes(' scale(1,-1) ')) {
          tf = tf.replace(' translate(-24,-18)', ' scale(1,-1) translate(-24,-18)');
        } else if (!needsFlip && tf.includes(' scale(1,-1) ')) {
          tf = tf.replace(' scale(1,-1)', '');
        }
        if (REVERSE) {
          tf = tf.replace(/rotate\((-?\d+(?:\.\d*)?)\)/, (m, deg) => `rotate(${parseFloat(deg) + 180})`);
        }
        g.setAttribute('transform', tf);
      };
    }
  }

  // 初期化：パラメータ調整と初期スポーン
  ready(() => ensureBanner(() => {
    window.KomyakuBanner.init({
      pulseSpeed: 5,
      stepLevel: 4,
      margin: 6,
      marginRightExtra: 2, // 右辺広め
      collidePx: 44,
      maxEntities: 12,
      decisionEvery: 12 // 互換保持：本体側では未使用でも可
    });

    // 下辺に 3 匹をランダム間隔で配置（一定の間隔を確保）
    function randomPositions(count, min, max, gap) {
      const out = []; let guard = 0;
      while (out.length < count && guard < 500) {
        guard++;
        const p = randInt(min, max);
        if (out.every(q => Math.abs(q - p) >= gap)) out.push(p);
      }
      return out.sort((a, b) => a - b);
    }

    const PAD = 60;
    const minX = PAD;
    const maxX = Math.max(PAD + 60, innerWidth - PAD);
    const positions = randomPositions(3, minX, maxX, 120);

    const palette = [
      { color: '#E52A2A', eye: '#1E4FB7' },
      { color: '#1E4FB7', eye: '#1E4FB7' },
      { color: '#BDC3C7', eye: '#1E4FB7' },
    ];
    const cwPattern = [true, false, true];
    for (let i = 0; i < 3; i++) {
      const tone = palette[i % palette.length];
      const k = window.KomyakuBanner.spawn({
        color: tone.color,
        eye: tone.eye,
        edge: 'bottom',
        pos: positions[i],
        clockwise: cwPattern[i],
        // 任意フィールド：視線の微調整用フラグ（正/負のみ使用）
        dir: +1,
      });
      if (k) patchKomyaku(k);
    }

    // 以後の spawn にも自動でパッチを適用
    const _spawn = window.KomyakuBanner.spawn;
    window.KomyakuBanner.spawn = function (o) {
      const k = _spawn.call(window.KomyakuBanner, o);
      if (k) patchKomyaku(k);
      return k;
    };

    // 全体のテンポに軽いゆらぎを与える（1.8 秒ごと）
    setInterval(() => {
      for (const k of window.KomyakuBanner._all) {
        if (!k) continue;
        const raw = k.pulseSpeed + (Math.random() < 0.5 ? -1 : +1);
        k.pulseSpeed = Math.min(5, Math.max(1, raw));
      }
    }, 1800);
  }));
})();
