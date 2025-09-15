/*! Komyaku EdgeCrawler v3.1
 * 画面の四辺を“脈打ちながら”巡回するマスコット。
 * - 右回り/左回りの固定モード（角では必ず隣の辺へ）
 * - 初期スポーンは外部 mykomyaku.js から行う想定
 * - ステップが長くても角を安全に繰り越し（テレポなし）
 * - 再会（同じ辺でのニアミス）にデバウンスを導入
 * - 右辺だけ margin を少し大きくする調整
 */
(function () {
  'use strict';

  // 汎用ユーティリティ
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const uid = (() => { let i = 0; return () => `k${++i}`; })();

  // 動作パラメータ（init で上書き可能）
  const DEFAULTS = {
    pulseSpeed: 3,                 // 1..5: アニメのテンポ（速いほど小さい間隔）
    stepLevel: 3,                  // 1..5: 1周期で進む距離の目安
    margin: 5,                     // 画面端からの基本オフセット
    marginRightExtra: 2,           // 右辺のみ追加オフセット
    collidePx: 40,                 // 同じ辺での“再会”とみなす距離
    maxEntities: 12,               // 同時表示の上限
    encounterCooldownMs: 500,      // 再会後に再判定しない最短時間
    encounterRearmDistFactor: 1.6, // 再開までに必要な離隔（しきい値×係数）
    reverse: false,                // 見た目上 180° 反転
    frameWeights: null,            // [w0..w4] を与えると各フレームで微小前進
    // 参考 SVG のモーションをオプションで反映
    motionKeyTimes: [0, 0.2, 0.5, 0.8, 1],
    motionTranslateY: [0, 2, -1, 1, 0],        // px
    motionScaleX: [1, 1.05, 0.95, 1.02, 1],    // 無指定で 1
    motionScaleY: [1, 0.92, 1.06, 0.98, 1],
    motionEnabled: true,
    // まばたき設定
    blinkEnabled: true,
    blinkEveryMsRange: [1400, 2600], // 次の瞬きまでのランダム範囲
    blinkDurMs: 120,                 // 目を細める時間
  };

  // 画面全体にかぶせる SVG レイヤーを用意
  const svgNS = 'http://www.w3.org/2000/svg';
  const stage = document.createElementNS(svgNS, 'svg');
  stage.setAttribute('width', '100%');
  stage.setAttribute('height', '100%');
  stage.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
  function attachStage() {
    if (document.body && !stage.isConnected) {
      stage.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
      document.body.appendChild(stage);
    } else if (!stage.isConnected) {
      requestAnimationFrame(attachStage);
    }
  }
  attachStage();

  // 5フレーム分のボディ形状（右向き基準）と目の位置
  const BODY = [
    'M22,2c6,0 12,5 14,10c3,7 -2,18 -12,20c-10,2 -18,-3 -20,-11C2,13 10,2 22,2z',
    'M22,2c7,0 15,4 19,9c3,4 1,9 -3,11c-3,2 -8,1 -12,3c-7,3 -17,1 -20,-5C3,12 12,3 22,2z',
    'M22,2c8,0 18,5 22,10c3,4 1,9 -4,12c-4,2 -8,1 -12,3c-7,3 -18,2 -21,-4C4,13 13,3 22,2z',
    'M8,20c5,-5 14,-6 22,-2c6,3 13,3 16,6c2,3 -1,7 -9,8c-11,2 -21,2 -27,-2c-6,-3 -4,-9 -2,-10z',
    'M20,4c6,-1 12,3 14,7c3,6 -2,15 -11,17c-9,2 -17,-2 -19,-9c-2,-7 6,-14 16,-15z',
  ];
  const EYE = [
    { cx: 34, cy: 16 },
    { cx: 40, cy: 14 },
    { cx: 44, cy: 14 },
    { cx: 31, cy: 18 },
    { cx: 33, cy: 16 },
  ];

  // 1匹ぶんの SVG を生成
  function makeSprite(fillColor, eyeColor) {
    const g = document.createElementNS(svgNS, 'g');
    const body = document.createElementNS(svgNS, 'path');
    const sclera = document.createElementNS(svgNS, 'ellipse');
    const iris = document.createElementNS(svgNS, 'ellipse');
    body.setAttribute('fill', fillColor);
    body.setAttribute('d', BODY[0]);
    sclera.setAttribute('fill', '#fff');
    sclera.setAttribute('rx', 4.8);
    sclera.setAttribute('ry', 3.6);
    iris.setAttribute('fill', eyeColor);
    iris.setAttribute('rx', 2.2);
    iris.setAttribute('ry', 1.8);
    g.append(body, sclera, iris);
    return { g, body, sclera, iris };
  }

  // 便宜的なヘルパ（現在辺の長さ）
  const edgeLen = (edge) => (edge === 'top' || edge === 'bottom') ? innerWidth : innerHeight;

  // 個体クラス
  class Komyaku {
    constructor(o) {
      this.id = uid();
      this.color = o.color;
      this.eye = o.eye;
      this.stepLevel = clamp(o.stepLevel ?? DEFAULTS.stepLevel, 1, 5);
      this.pulseSpeed = clamp(o.pulseSpeed ?? DEFAULTS.pulseSpeed, 1, 5);
      this.edge = o.edge ?? 'bottom';
      this.pos = o.pos ?? 0; // 現在の辺上の位置（px）
      this.clockwise = (o.clockwise !== false); // 省略時は右回り
      this.frame = 0; // 0..4
      this.accum = 0; // 前回 tick からの経過時間（ms）
      this.dir = (o.dir ?? +1) >= 0 ? +1 : -1; // 視線/微小前進のヒント（+1/-1）
      this.timeMs = 0; // ランタイムの蓄積（まばたき判定等に使用）
      // まばたきの初期スケジュール（少しバラけさせる）
      const [bmin, bmax] = DEFAULTS.blinkEveryMsRange;
      this._blinkUntil = 0;
      this._blinkNextAt = Math.random() * (bmax - bmin) + bmin;

      // 再会デバウンス用のメモ
      this.coolWith = null; // 直近で判定した相手の id
      this.coolUntil = 0;   // 再会判定を再開できる時刻（ms）
      this.rearmDist = DEFAULTS.collidePx * DEFAULTS.encounterRearmDistFactor;

      // 見た目
      this.sprite = makeSprite(this.color, this.eye);
      stage.appendChild(this.sprite.g);
      this._applyEyeBody();
      this._applyTransform();
    }

    // ステップ距離とテンポ（定義済み段階から選択）
    speedPx() { return [12, 19, 24, 35, 50][this.stepLevel - 1]; }
    pulseMs() { return [420, 340, 280, 230, 190][this.pulseSpeed - 1]; }

    // 現在の辺と回り方向から進行符号（+/-）を得る
    dirSign() {
      if (this.edge === 'top') return this.clockwise ? +1 : -1;
      if (this.edge === 'right') return this.clockwise ? +1 : -1;
      if (this.edge === 'bottom') return this.clockwise ? -1 : +1;
      if (this.edge === 'left') return this.clockwise ? -1 : +1;
    }

    // 描画上の向き（deg）— 常に進行方向を向く
    headingDeg() {
      const d = this.dirSign();
      switch (this.edge) {
        case 'top': return d > 0 ? 0 : 180;
        case 'right': return d > 0 ? 90 : -90;
        case 'bottom': return d > 0 ? 0 : 180;
        case 'left': return d > 0 ? 90 : -90;
      }
    }

    // 現在辺・位置から画面上の x/y を得る
    xy() {
      const m = DEFAULTS.margin;
      const w = innerWidth;
      const h = innerHeight;
      const mr = m + DEFAULTS.marginRightExtra;
      switch (this.edge) {
        case 'top': return { x: this.pos, y: m };
        case 'right': return { x: w - mr, y: this.pos };
        case 'bottom': return { x: this.pos, y: h - m };
        case 'left': return { x: m, y: this.pos };
      }
    }

    // 表示位置・角度の更新
    _applyTransform() {
      const { x, y } = this.xy();
      let rot = this.headingDeg();
      if (DEFAULTS.reverse) rot += 180; // 全体反転
      const s = 0.9; // ベーススケール

      // 参考アニメっぽい微小モーション（縦バウンス＋スクウォッシュ）
      let ty = 0, sxm = 1, sym = 1;
      if (DEFAULTS.motionEnabled) {
        const t = this._cycleRatio(); // 0..1（5フレームで 1 周）
        ty = interp1(DEFAULTS.motionKeyTimes, DEFAULTS.motionTranslateY, t) || 0;
        sxm = interp1(DEFAULTS.motionKeyTimes, DEFAULTS.motionScaleX, t) || 1;
        sym = interp1(DEFAULTS.motionKeyTimes, DEFAULTS.motionScaleY, t) || 1;
      }

      // 上辺・左辺では“足場が内側”に見えるように Y スケールを反転
      const needsFlip = (this.edge === 'top' || this.edge === 'left');
      const sx = s * sxm;
      const sy = s * sym * (needsFlip ? -1 : 1);
      this.sprite.g.setAttribute('transform', `translate(${x},${y + ty}) rotate(${rot}) scale(${sx},${sy}) translate(-24,-18)`);
    }

    // ボディ形状と目の描画更新
    _applyEyeBody() {
      this.sprite.body.setAttribute('d', BODY[this.frame]);
      const p = EYE[this.frame];
      // 目の中心位置
      this.sprite.sclera.setAttribute('cx', p.cx);
      this.sprite.sclera.setAttribute('cy', p.cy);
      // 進行方向っぽく黒目を 1px シフト
      this.sprite.iris.setAttribute('cx', p.cx + (this.dir > 0 ? 1 : -1));
      this.sprite.iris.setAttribute('cy', p.cy);
      // まばたき表現（楕円の縦半径を一時的に小さく）
      if (DEFAULTS.blinkEnabled && this.timeMs < this._blinkUntil) {
        this.sprite.sclera.setAttribute('ry', 1.0);
        this.sprite.iris.setAttribute('ry', 0.3);
      } else {
        this.sprite.sclera.setAttribute('ry', 3.6);
        this.sprite.iris.setAttribute('ry', 1.8);
      }
      this.sprite.body.setAttribute('fill', this.color);
      this.sprite.iris.setAttribute('fill', this.eye);
    }

    // 1フレーム経過処理（アニメ進行と必要に応じて前進）
    tick(dt) {
      this.timeMs += dt;
      this.accum += dt;
      // まばたきスケジュール
      if (DEFAULTS.blinkEnabled) {
        if (this.timeMs >= this._blinkNextAt && this.timeMs >= this._blinkUntil) {
          this._blinkUntil = this.timeMs + DEFAULTS.blinkDurMs;
          const [bmin, bmax] = DEFAULTS.blinkEveryMsRange;
          this._blinkNextAt = this.timeMs + DEFAULTS.blinkDurMs + (Math.random() * (bmax - bmin) + bmin);
        }
      }
      if (this.accum >= this.pulseMs()) {
        this.accum = 0;
        const prev = this.frame;
        this.frame = (this.frame + 1) % 5;
        this._applyEyeBody();
        // recoil(4) → normal(0) の切替で本前進
        if (prev === 4 && this.frame === 0) {
          this._advance();
        } else if (Array.isArray(DEFAULTS.frameWeights)) {
          // 各フレームでの微小前進（オプション）
          const w = DEFAULTS.frameWeights[this.frame] || 0;
          if (w) this._advanceBy(this.speedPx() * w * this.dirSign());
        }
      }
      this._applyTransform();
    }

    // 角の手前で分割しながら安全に移動する
    _advance() {
      let remaining = this.speedPx() * this.dirSign();
      while (Math.abs(remaining) > 0.0001) {
        const len = edgeLen(this.edge);
        const towardEnd = (remaining > 0); // 現在の辺の正方向終端へ向かうか
        const distToEdge = towardEnd ? (len - this.pos) : (0 - this.pos);

        // 残りが端まで届かない→辺の中で完結
        if (Math.abs(remaining) <= Math.abs(distToEdge)) {
          this.pos += remaining;
          remaining = 0;
        } else {
          // 端まで移動し、残りを次の辺に繰り越す
          this.pos += distToEdge;
          remaining -= distToEdge;
          this._turnToNextEdge(towardEnd);
        }
        // 新しい辺の範囲にクランプ
        this.pos = clamp(this.pos, 0, edgeLen(this.edge));
      }
    }

    // 指定距離だけ“いまの辺に沿って”前進（角は安全に繰り越し）
    _advanceBy(distance) {
      let remaining = distance;
      while (Math.abs(remaining) > 0.0001) {
        const len = edgeLen(this.edge);
        const towardEnd = (remaining > 0);
        const distToEdge = towardEnd ? (len - this.pos) : (0 - this.pos);
        if (Math.abs(remaining) <= Math.abs(distToEdge)) {
          this.pos += remaining;
          remaining = 0;
        } else {
          this.pos += distToEdge;
          remaining -= distToEdge;
          this._turnToNextEdge(towardEnd);
        }
        this.pos = clamp(this.pos, 0, edgeLen(this.edge));
      }
    }

    // 隣の辺へ遷移（回転方向に固定）。対応点に“寄せる”だけで座標変換は xy() 側に任せる
    _turnToNextEdge(/* towardEnd 無しでも挙動は同じ：引数は互換保持 */) {
      const cw = this.clockwise;
      const cur = this.edge;
      const w = innerWidth;
      const h = innerHeight;
      const m = DEFAULTS.margin;
      const mr = m + DEFAULTS.marginRightExtra;

      if (cw) {
        if (cur === 'top') { this.edge = 'right'; this.pos = m; }
        else if (cur === 'right') { this.edge = 'bottom'; this.pos = w - m; }
        else if (cur === 'bottom') { this.edge = 'left'; this.pos = h - m; }
        else if (cur === 'left') { this.edge = 'top'; this.pos = m; }
      } else {
        if (cur === 'top') { this.edge = 'left'; this.pos = m; }
        else if (cur === 'left') { this.edge = 'bottom'; this.pos = m; }
        else if (cur === 'bottom') { this.edge = 'right'; this.pos = h - m; }
        else if (cur === 'right') { this.edge = 'top'; this.pos = w - m; }
      }
      // pos は新しい「辺上の位置」（x か y のどちらか）
    }
  }
  // 5フレームを一巡とみなした 0..1 の比率
  Komyaku.prototype._cycleRatio = function () {
    const local = Math.min(1, Math.max(0, this.accum / this.pulseMs()));
    return (this.frame + local) / 5;
  };

  // 0..1 の比率でキータイム補間（線形）
  function interp1(times, values, t) {
    if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length || !times.length) return null;
    if (t <= times[0]) return values[0];
    if (t >= times[times.length - 1]) return values[values.length - 1];
    for (let i = 0; i < times.length - 1; i++) {
      const t0 = times[i], t1 = times[i + 1];
      if (t >= t0 && t <= t1) {
        const v0 = values[i], v1 = values[i + 1];
        const r = (t - t0) / Math.max(1e-6, (t1 - t0));
        return v0 + (v1 - v0) * r;
      }
    }
    return values[values.length - 1];
  }

  // 再会（同じ辺で近づいたとき）の処理。ペアごとにデバウンス
  function tryEncounter(a, b, nowMs) {
    if (a.edge !== b.edge) return;
    const dist = Math.abs(a.pos - b.pos);
    const hit = dist < DEFAULTS.collidePx;
    if (!hit) return;

    const pairA = a.coolWith === b.id;
    const pairB = b.coolWith === a.id;
    const stillCooling = (pairA && nowMs < a.coolUntil) || (pairB && nowMs < b.coolUntil);
    const notYetRearmed = (pairA || pairB) && dist < Math.max(a.rearmDist, b.rearmDist);
    if (stillCooling || notYetRearmed) return;

    // ランダムに分岐：すれ違い / 融合 / 増殖
    const r = randInt(0, 9); // 0..2:すれ違い 3..4:融合 5..9:増殖
    if (r < 3) {
      a.pos += (a.dirSign?.() ?? 0) * 8;
      b.pos += (b.dirSign?.() ?? 0) * 8;
    } else if (r < 5) {
      // 融合（b を消して色だけ反映）
      a.color = Math.random() < 0.5 ? a.color : b.color;
      try { stage.removeChild(b.sprite.g); } catch {}
      const arr = window.KomyakuBanner._all; const i = arr.indexOf(b); if (i > -1) arr.splice(i, 1);
    } else {
      // 増殖（上限確認）
      if (window.KomyakuBanner._all.length < DEFAULTS.maxEntities) {
        const nb = new Komyaku({
          color: Math.random() < 0.5 ? a.color : b.color,
          eye: a.eye,
          edge: a.edge,
          clockwise: Math.random() < 0.5 ? a.clockwise : b.clockwise,
          pos: (a.pos + b.pos) / 2,
          stepLevel: Math.random() < 0.5 ? a.stepLevel : b.stepLevel,
          pulseSpeed: Math.random() < 0.5 ? a.pulseSpeed : b.pulseSpeed,
        });
        window.KomyakuBanner._all.push(nb);
      }
    }

    // クールダウン開始（両者）
    const cd = DEFAULTS.encounterCooldownMs;
    a.coolWith = b.id; b.coolWith = a.id;
    a.coolUntil = nowMs + cd; b.coolUntil = nowMs + cd;
  }

  // メインループ（描画・再会チェック）
  let last = performance.now();
  function loop(now) {
    const dt = now - last; last = now;
    const list = window.KomyakuBanner._all;
    for (const k of list) k.tick(dt);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        tryEncounter(list[i], list[j], now);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // 簡易 API（グローバル）
  window.KomyakuBanner = {
    _all: [],
    init(opts = {}) { Object.assign(DEFAULTS, opts); return this; },
    spawn(o) {
      if (this._all.length >= DEFAULTS.maxEntities) return null;
      const k = new Komyaku(o); this._all.push(k); return k;
    },
    count() { return this._all.length; },
  };

  // 画面サイズ変化に追従
  addEventListener('resize', () => {
    if (stage.isConnected) stage.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    for (const k of window.KomyakuBanner._all) {
      const len = (k.edge === 'top' || k.edge === 'bottom') ? innerWidth : innerHeight;
      k.pos = clamp(k.pos, 0, len);
    }
  });
})();
