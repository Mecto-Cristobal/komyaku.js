// mykomyaku.js – こみゃく挙動パッチとサイト設定
(function(){
  const REVERSE = true; // 進行方向を全体で反転
  // デフォルト設定（少しゆっくり・滑らか寄り）
  KomyakuBanner.init({
    pulseSpeed: 5,     // 1(遅) .. 5(速)
    stepLevel: 4,      // 1(小) .. 5(大)
    margin: 6,
    decisionEvery: 12, // 反転はたまに
    collidePx: 44,
    maxEntities: 12
  });

  // --- こみゃく挙動パッチ（向き/接地/這い配分） ---
  const EDGES = ["top","right","bottom","left"];
  const nextEdge=(edge,turn)=>{ const i=EDGES.indexOf(edge); return EDGES[(i+(turn>0?1:-1)+4)%4]; };
  const edgeLen = e => (e==="top"||e==="bottom")? innerWidth : innerHeight;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const FRAME_WEIGHTS = [0.14, 0.22, 0.36, 0.14, 0.14]; // 伸び>接地>戻り

  function microAdvance(k, dist){
    const len=edgeLen(k.edge);
    const dirSign = (k.dir>0?1:-1) * (REVERSE ? -1 : 1);
    const step=(dist ?? k.speedPx())*dirSign;
    let np=k.pos+step;
    if(np<0){
      const overflow=-np; k.edge=nextEdge(k.edge,-1);
      const nlen=edgeLen(k.edge);
      np=(k.dir>0)?(nlen-overflow):overflow;
    }else if(np>len){
      const overflow=np-len; k.edge=nextEdge(k.edge,+1);
      const nlen=edgeLen(k.edge);
      np=(k.dir>0)?overflow:(nlen-overflow);
    }
    k.pos = clamp(np,0,edgeLen(k.edge));
  }

  function patchKomyaku(k){
    // 押し戻し→通常の大きな前進を抑止し、フレーム配分で前進させる
    if(!k.__advanceOriginal){
      k.__advanceOriginal = k._advance;
      k._advance = function(dist){
        // 内部から距離指定なしで呼ばれる場合（サイクル境界）を無効化
        if(dist == null){ return; }
        return microAdvance(this, dist);
      };
    }

    // 目線を常に進行方向へ & 這い配分で微小前進
    if(!k.__applyEyeBody){
      k.__applyEyeBody = k._applyEyeBody;
      k._applyEyeBody = function(){
        this.__applyEyeBody();
        // 黒目を「前」（現在の回転の前方）へ微移動。
        // 回転はREVERSE時に180度加算するため、オフセットはdir基準でOK。
        const cx = parseFloat(this.sprite.sclera.getAttribute("cx"));
        this.sprite.iris.setAttribute("cx", String(cx + (this.dir>0 ? 1 : -1)));

        // 這い配分による微小前進（4→0のフレームはスキップ＝内部前進は抑止済）
        this._lastFrame = this._lastFrame ?? this.frame;
        const prev = this._lastFrame;
        const w = FRAME_WEIGHTS[this.frame] || 0;
        if(!(prev===4 && this.frame===0)){
          this._advance(this.speedPx()*w);
        }
        this._lastFrame = this.frame;
      };
    }

    // 接地面の上下補正（上辺/左辺で上下反転）
    if(!k.__applyTransform){
      k.__applyTransform = k._applyTransform;
      k._applyTransform = function(){
        this.__applyTransform();
        const g=this.sprite.g;
        let tf=g.getAttribute("transform")||"";
        const needsFlip = (this.edge==="top" || this.edge==="left");
        // translate(..) rotate(..) scale(s) translate(-24,-18)
        if(needsFlip && !tf.includes(" scale(1,-1) ")){
          tf = tf.replace(" translate(-24,-18)", " scale(1,-1) translate(-24,-18)");
        }else if(!needsFlip && tf.includes(" scale(1,-1) ")){
          tf = tf.replace(" scale(1,-1)", "");
        }
        // 進行方向反転時は見た目の向きも180度回す
        if(REVERSE){
          tf = tf.replace(/rotate\((-?\d+(?:\.\d*)?)\)/, (m,deg)=>`rotate(${(parseFloat(deg)+180)})`);
        }
        g.setAttribute("transform", tf);
      };
    }
  }

  // 初期3匹（下辺スタート・右向き）
  const start=60, gap=120;
  KomyakuBanner.spawn({ color:"#E52A2A", eye:"#1E4FB7", edge:"bottom", dir:+1, pos:start + gap*0 });
  KomyakuBanner.spawn({ color:"#1E4FB7", eye:"#1E4FB7", edge:"bottom", dir:+1, pos:start + gap*1 });
  KomyakuBanner.spawn({ color:"#BDC3C7", eye:"#1E4FB7", edge:"bottom", dir:+1, pos:start + gap*2 });

  // 生成済/今後の個体にパッチを適用
  for(const k of KomyakuBanner._all) patchKomyaku(k);
  const _spawn = KomyakuBanner.spawn;
  KomyakuBanner.spawn = function(o){ const k=_spawn.call(KomyakuBanner,o)||null; if(k) patchKomyaku(k); return k; };

  // ごく小さなテンポゆらぎ（±6%）
  const J=()=> (Math.random()*0.12 - 0.06); // ±6%
  setInterval(()=>{
    for(const k of KomyakuBanner._all){
      const raw = k.pulseSpeed + J();
      k.pulseSpeed = Math.min(5, Math.max(1, Math.round(raw)));
    }
  }, 1800);
})();
