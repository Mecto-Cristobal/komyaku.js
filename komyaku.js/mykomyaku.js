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

  // 最低表示数（赤/青/白）。例: {red:1, blue:1, white:1}
  const MIN_SPECIES = { red: 1, blue: 1, white: 1 };

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

  // パッチ類は本体に統合済み（REVERSE/FRAME_WEIGHTS は init で指定）

  // 初期化：パラメータ調整と初期スポーン
  ready(() => ensureBanner(() => {
    window.KomyakuBanner.init({
      pulseSpeed: 5,
      stepLevel: 2,
      margin: 6,
      marginRightExtra: 2, // 右辺広め
      collidePx: 44,
      maxEntities: 12,
      decisionEvery: 12, // 互換保持：本体側では未使用でも可
      reverse: REVERSE,
      frameWeights: FRAME_WEIGHTS,
      motionEnabled: true,
      motionTranslateY: [0, 3, -2, 1.5, 0],
      motionScaleX: [1, 1.07, 0.93, 1.03, 1],
      motionScaleY: [1, 0.90, 1.08, 0.97, 1],
      smoothAdvance: false,
      blinkEnabled: true,
      spontaneousSplitEnabled: true,
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
      { color: '#E52A2A', eye: '#1E4FB7', key: 'red' },
      { color: '#1E4FB7', eye: '#1E4FB7', key: 'blue' },
      { color: '#BDC3C7', eye: '#1E4FB7', key: 'white' },
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
    }
    // 最低表示数を維持するループ
    function normalizeHex(s){ return String(s||'').trim().toLowerCase(); }
    function countSpecies(){
      const counts = { red:0, blue:0, white:0 };
      for (const k of window.KomyakuBanner._all){
        const c = normalizeHex(k.color);
        if (c === '#e52a2a') counts.red++;
        else if (c === '#1e4fb7') counts.blue++;
        else if (c === '#bdc3c7' || c === '#ffffff' || c === '#fff') counts.white++;
      }
      return counts;
    }
    function ensureMinimumSpecies(){
      const counts = countSpecies();
      const edge = 'bottom';
      const base = 80; const gap = Math.max(100, innerWidth/8);
      const colorsMap = {
        red: { color:'#E52A2A', eye:'#1E4FB7' },
        blue:{ color:'#1E4FB7', eye:'#1E4FB7' },
        white:{ color:'#BDC3C7', eye:'#1E4FB7' },
      };
      ['red','blue','white'].forEach((key, idx)=>{
        const need = Math.max(0, (MIN_SPECIES[key]||0) - (counts[key]||0));
        for(let i=0;i<need;i++){
          const pos = base + (idx * gap) + Math.random()*60;
          window.KomyakuBanner.spawn({
            color: colorsMap[key].color,
            eye: colorsMap[key].eye,
            edge, pos: Math.min(Math.max(60, pos), innerWidth-60),
            clockwise: Math.random()<0.5,
            dir: +1,
          });
        }
      });
    }
    setInterval(ensureMinimumSpecies, 2500);
    // 以後の spawn は本体のオプションで反映されます

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
