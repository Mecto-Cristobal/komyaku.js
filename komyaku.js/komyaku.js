/*! Komyaku Edge Crawler v2.1
 * 概要:
 * - 端に吸着して這う（浮き/瞬間移動なし）
 * - 角はオーバーランを次辺へ繰り越して曲がる
 * - 5フレーム: normal→stretch1→stretch2→ground→recoil（recoil→normalの瞬間だけ前進）
 * - 目は常に進行方向を向く（辺×dirで回転）
 * - rAFループで軽量・ぬるぬる、deferで並行読み込み
 * - 再会: すれ違い/融合/増殖（maxEntities厳守）
 */
(function () {
  // --- helpers ---
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const randInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
  const pick=a=>a[Math.floor(Math.random()*a.length)];
  const uid=(()=>{let i=0;return()=>`k${++i}`})();

  const DEFAULTS = {
    pulseSpeed: 3,     // 1..5 フレーム周期（小さいほど遅い）
    stepLevel: 3,      // 1..5 前進距離
    margin: 5,         // 端との間隔(px)
    decisionEvery: 10, // 脈動n回ごとに「0続行/1反転」
    collidePx: 40,     // 再会の当たり判定
    maxEntities: 12,   // 上限
  };

  // --- stage（body未用意ならrAFで待機して添付） ---
  const stage = document.createElementNS("http://www.w3.org/2000/svg","svg");
  stage.setAttribute("class","komyaku-stage");
  stage.setAttribute("width","100%"); stage.setAttribute("height","100%");
  stage.style.cssText="position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:layout;will-change:transform";
  function attachStage(){
    if(document.body && !stage.isConnected){
      stage.setAttribute("viewBox",`0 0 ${innerWidth} ${innerHeight}`);
      document.body.appendChild(stage);
    }else if(!stage.isConnected){ requestAnimationFrame(attachStage); }
  }
  attachStage();

  // --- 5フレーム形状 & 目の相対位置（進行方向=右想定、回転で向きを合わせる） ---
  const BODY = [
    "M22,2c6,0 12,5 14,10c3,7 -2,18 -12,20c-10,2 -18,-3 -20,-11C2,13 10,2 22,2z", // normal
    "M22,2c7,0 15,4 19,9c3,4 1,9 -3,11c-3,2 -8,1 -12,3c-7,3 -17,1 -20,-5C3,12 12,3 22,2z", // stretch1
    "M22,2c8,0 18,5 22,10c3,4 1,9 -4,12c-4,2 -8,1 -12,3c-7,3 -18,2 -21,-4C4,13 13,3 22,2z", // stretch2
    "M8,20c5,-5 14,-6 22,-2c6,3 13,3 16,6c2,3 -1,7 -9,8c-11,2 -21,2 -27,-2c-6,-3 -4,-9 -2,-10z", // ground
    "M20,4c6,-1 12,3 14,7c3,6 -2,15 -11,17c-9,2 -17,-2 -19,-9c-2,-7 6,-14 16,-15z" // recoil
  ];
  const EYE = [
    {cx:34,cy:16},{cx:40,cy:14},{cx:44,cy:14},{cx:31,cy:18},{cx:33,cy:16}
  ];

  function makeSprite(color, eyeColor){
    const g = document.createElementNS(stage.namespaceURI,"g");
    const body   = document.createElementNS(stage.namespaceURI,"path");
    const sclera = document.createElementNS(stage.namespaceURI,"ellipse");
    const iris   = document.createElementNS(stage.namespaceURI,"ellipse");
    body.setAttribute("fill", color);
    body.setAttribute("d", BODY[0]);
    sclera.setAttribute("fill","#fff"); sclera.setAttribute("rx",4.8); sclera.setAttribute("ry",3.6);
    iris.setAttribute("fill", eyeColor); iris.setAttribute("rx",2.2); iris.setAttribute("ry",1.8);
    g.append(body, sclera, iris);
    return { g, body, sclera, iris };
  }

  const EDGES=["top","right","bottom","left"];
  const edgeLen = e => (e==="top"||e==="bottom")? innerWidth : innerHeight;
  const nextEdge=(edge,turn)=>{ const i=EDGES.indexOf(edge); return EDGES[(i+(turn>0?1:-1)+4)%4]; };

  class Komyaku {
    constructor(o){
      this.id = uid();
      this.color = o.color; this.eye = o.eye;
      this.stepLevel = clamp(o.stepLevel ?? DEFAULTS.stepLevel,1,5);
      this.pulseSpeed= clamp(o.pulseSpeed?? DEFAULTS.pulseSpeed,1,5);
      this.edge = o.edge ?? "bottom";  // 下辺スタート
      this.dir  = o.dir ?? +1;         // 辺に沿った向き（符号のみ）
      this.pos  = o.pos ?? 0;          // 辺上の位置(px)
      this.frame = 0;                  // 0..4
      this.accum = 0;                  // 経過時間
      this.pulses = 0;
      this.locked = false;

      this.sprite = makeSprite(this.color, this.eye);
      stage.appendChild(this.sprite.g);
      this._applyEyeBody();
      this._applyTransform(true);
    }
    speedPx(){ return [10,17,23,34,50][this.stepLevel-1]; }
    pulseMs(){ return [420,340,280,230,190][this.pulseSpeed-1]; }

    xy(){
      const m=DEFAULTS.margin, w=innerWidth, h=innerHeight;
      switch(this.edge){
        case "top":    return {x:this.pos, y:m};
        case "right":  return {x:w-m,     y:this.pos};
        case "bottom": return {x:this.pos, y:h-m};
        case "left":   return {x:m,       y:this.pos};
      }
    }
    headingDeg(){
      switch(this.edge){
        case "top":    return this.dir>0?   0:180;
        case "right":  return this.dir>0?  90:-90;
        case "bottom": return this.dir>0 ?   0 : 180;
        case "left":   return this.dir>0 ?  90 : -90;
      }
    }
    _applyTransform(){
      const {x,y}=this.xy();
      const rot=this.headingDeg();
      const s=0.9;
      // 接地(frame===3)は端へスナップ、他は微小吸着
      const m=DEFAULTS.margin, w=innerWidth, h=innerHeight, attract=0.6;
      let tx=x, ty=y;
      switch(this.edge){
        case "top":    ty = (this.frame===3)? m : Math.min(ty, m+attract); break;
        case "bottom": ty = (this.frame===3)? h-m : Math.max(ty, h-m-attract); break;
        case "left":   tx = (this.frame===3)? m : Math.min(tx, m+attract); break;
        case "right":  tx = (this.frame===3)? w-m : Math.max(tx, w-m-attract); break;
      }
      this.sprite.g.setAttribute("transform",
        `translate(${tx},${ty}) rotate(${rot}) scale(${s}) translate(-24,-18)`);
    }
    _applyEyeBody(){
      this.sprite.body.setAttribute("d", BODY[this.frame]);
      const p = EYE[this.frame];
      this.sprite.sclera.setAttribute("cx", p.cx);
      this.sprite.sclera.setAttribute("cy", p.cy);
      this.sprite.iris.setAttribute("cx", p.cx+1);
      this.sprite.iris.setAttribute("cy", p.cy);
      this.sprite.body.setAttribute("fill", this.color);
      this.sprite.iris.setAttribute("fill", this.eye);
    }

    // rAFから呼ばれる
    tick(dt){
      this.accum += dt;
      if(this.accum >= this.pulseMs()){
        this.accum = 0;
        const prev = this.frame;
        this.frame = (this.frame + 1) % 5;
        this._applyEyeBody();

        // recoil→normal の瞬間だけ前進
        if(prev===4 && this.frame===0){
          this._advance();
          this.pulses++;
          if(this.pulses % DEFAULTS.decisionEvery === 0) this._maybeFlip();
        }
      }
      this._applyTransform();
    }

    _advance(){
      const len=edgeLen(this.edge);
      const step=this.speedPx()*(this.dir>0?1:-1);
      let np=this.pos+step;

      // 角を越えた分は次辺へ繰り越し（浮き/瞬間移動なし）
      if(np<0){
        const overflow=-np;
        this.edge=nextEdge(this.edge,-1);
        const nlen=edgeLen(this.edge);
        np=(this.dir>0)?(nlen-overflow):overflow;
      }else if(np>len){
        const overflow=np-len;
        this.edge=nextEdge(this.edge,+1);
        const nlen=edgeLen(this.edge);
        np=(this.dir>0)?overflow:(nlen-overflow);
      }
      this.pos = clamp(np,0,edgeLen(this.edge));
    }
    _maybeFlip(){ if(randInt(0,1)===1) this.dir*=-1; }
  }

  // --- 再会（同一辺でのみ） ---
  function encounter(a,b){
    if(a.locked||b.locked) return;
    if(a.edge!==b.edge) return;
    if(Math.abs(a.pos-b.pos) >= DEFAULTS.collidePx) return;

    a.locked=b.locked=true;
    const o=randInt(0,2); // 0:すれ違い 1:融合 2:増える
    if(o===0){
      a.pos += a.dir*6; b.pos += b.dir*6;
    }else if(o===1){
      const winner=pick([a,b]), loser=(winner===a?b:a);
      winner.color=pick([a.color,b.color]);
      try{ stage.removeChild(loser.sprite.g); }catch{}
      const arr=window.KomyakuBanner._all; const i=arr.indexOf(loser); if(i>-1) arr.splice(i,1);
    }else{
      if(window.KomyakuBanner._all.length < DEFAULTS.maxEntities){
        const nb=new Komyaku({
          color:pick([a.color,b.color]),
          eye:a.eye, edge:a.edge, dir:a.dir,
          pos:(a.pos+b.pos)/2,
          stepLevel:pick([a.stepLevel,b.stepLevel]),
          pulseSpeed:pick([a.pulseSpeed,b.pulseSpeed]),
        });
        window.KomyakuBanner._all.push(nb);
      }
    }
    setTimeout(()=>{a.locked=b.locked=false;},280);
  }

  // --- メインループ（rAF） ---
  let last=performance.now();
  function loop(now){
    const dt=now-last; last=now;
    const list=window.KomyakuBanner._all;
    if(list.length){
      for(const k of list) k.tick(dt);
      for(let i=0;i<list.length;i++) for(let j=i+1;j<list.length;j++) encounter(list[i],list[j]);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // --- API ---
  window.KomyakuBanner={
    _all:[],
    init(opts={}){ Object.assign(DEFAULTS,opts); return this; },
    spawn(o){
      if(this._all.length>=DEFAULTS.maxEntities) return null;
      const k=new Komyaku(o); this._all.push(k); return k;
    },
    count(){ return this._all.length; }
  };

  // リサイズ補正
  addEventListener("resize",()=>{
    if(stage.isConnected) stage.setAttribute("viewBox",`0 0 ${innerWidth} ${innerHeight}`);
    for(const k of window.KomyakuBanner._all){
      k.pos=clamp(k.pos,0,edgeLen(k.edge));
    }
  });
})();
