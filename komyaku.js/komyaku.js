/*! Komyaku EdgeCrawler v3.1
 * - 右回り/左回りモード（角は必ず次の辺へ・ランダムなし）
 * - 初期ポップは外部(mykomyaku.js)から
 * - 角オーバーランの逐次繰り越し（長距離でもテレポしない）
 * - 再会デバウンス（離れるまで再判定なし）
 * - 右辺 margin を少し大きく
 */
(function(){
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  const randInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));
  const uid=(()=>{let i=0;return()=>`k${++i}`})();

  const DEFAULTS={
    pulseSpeed:3,          // 1..5: フレーム間隔
    stepLevel:3,           // 1..5: 前進距離
    margin:5,              // 基本マージン
    marginRightExtra:2,    // 右辺だけ+2px
    collidePx:40,          // 再会しきい値
    maxEntities:12,        // 増えすぎ防止
    encounterCooldownMs:500,      // 再会後の最低クールダウン
    encounterRearmDistFactor:1.6, // しきい値×係数以上離れるまで判定抑止
  };

  // ---- SVG stage ----
  const svgNS="http://www.w3.org/2000/svg";
  const stage=document.createElementNS(svgNS,"svg");
  stage.setAttribute("width","100%"); stage.setAttribute("height","100%");
  stage.style.cssText="position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  function attach(){ if(document.body && !stage.isConnected){ stage.setAttribute("viewBox",`0 0 ${innerWidth} ${innerHeight}`); document.body.appendChild(stage); } else if(!stage.isConnected){ requestAnimationFrame(attach); } }
  attach();

  // ---- 5フレーム形状（右向き基準）----
  const BODY=[
    "M22,2c6,0 12,5 14,10c3,7 -2,18 -12,20c-10,2 -18,-3 -20,-11C2,13 10,2 22,2z",
    "M22,2c7,0 15,4 19,9c3,4 1,9 -3,11c-3,2 -8,1 -12,3c-7,3 -17,1 -20,-5C3,12 12,3 22,2z",
    "M22,2c8,0 18,5 22,10c3,4 1,9 -4,12c-4,2 -8,1 -12,3c-7,3 -18,2 -21,-4C4,13 13,3 22,2z",
    "M8,20c5,-5 14,-6 22,-2c6,3 13,3 16,6c2,3 -1,7 -9,8c-11,2 -21,2 -27,-2c-6,-3 -4,-9 -2,-10z",
    "M20,4c6,-1 12,3 14,7c3,6 -2,15 -11,17c-9,2 -17,-2 -19,-9c-2,-7 6,-14 16,-15z"
  ];
  const EYE=[
    {cx:34,cy:16},{cx:40,cy:14},{cx:44,cy:14},{cx:31,cy:18},{cx:33,cy:16}
  ];

  function makeSprite(color,eyeColor){
    const g=document.createElementNS(svgNS,"g");
    const body=document.createElementNS(svgNS,"path");
    const sclera=document.createElementNS(svgNS,"ellipse");
    const iris=document.createElementNS(svgNS,"ellipse");
    body.setAttribute("fill",color);
    body.setAttribute("d",BODY[0]);
    sclera.setAttribute("fill","#fff"); sclera.setAttribute("rx",4.8); sclera.setAttribute("ry",3.6);
    iris.setAttribute("fill",eyeColor); iris.setAttribute("rx",2.2); iris.setAttribute("ry",1.8);
    g.append(body,sclera,iris);
    return {g,body,sclera,iris};
  }

  const EDGES=["top","right","bottom","left"];
  const edgeLen=e=>(e==="top"||e==="bottom")?innerWidth:innerHeight;

  class Komyaku{
    constructor(o){
      this.id=uid();
      this.color=o.color; this.eye=o.eye;
      this.stepLevel=clamp(o.stepLevel??DEFAULTS.stepLevel,1,5);
      this.pulseSpeed=clamp(o.pulseSpeed??DEFAULTS.pulseSpeed,1,5);
      this.edge=o.edge??"bottom";
      this.pos=o.pos??0;
      this.clockwise = (o.clockwise!==false); // デフォ右回り
      this.frame=0; this.accum=0;

      // 再会デバウンス用
      this.coolWith=null;      // 直近に判定した相手ID
      this.coolUntil=0;        // 時刻（ms）
      this.rearmDist=DEFAULTS.collidePx*DEFAULTS.encounterRearmDistFactor;

      this.sprite=makeSprite(this.color,this.eye);
      stage.appendChild(this.sprite.g);
      this._applyEyeBody(); this._applyTransform(true);
    }
    speedPx(){ return [12,19,24,35,50][this.stepLevel-1]; }
    pulseMs(){ return [420,340,280,230,190][this.pulseSpeed-1]; }

    // 回り方向から辺ごとの進行符号を決定
    dirSign(){
      if(this.edge==="top")    return this.clockwise?+1:-1;
      if(this.edge==="right")  return this.clockwise?+1:-1;
      if(this.edge==="bottom") return this.clockwise?-1:+1;
      if(this.edge==="left")   return this.clockwise?-1:+1;
    }
    // 回転角（常に進行方向）
    headingDeg(){
      const d=this.dirSign();
      switch(this.edge){
        case "top":    return d>0?0:180;
        case "right":  return d>0?90:-90;
        case "bottom": return d>0?0:180;
        case "left":   return d>0?90:-90;
      }
    }

    xy(){
      const m=DEFAULTS.margin, w=innerWidth, h=innerHeight, mr=m+DEFAULTS.marginRightExtra;
      switch(this.edge){
        case "top":    return {x:this.pos, y:m};
        case "right":  return {x:w-mr,     y:this.pos};
        case "bottom": return {x:this.pos, y:h-m};
        case "left":   return {x:m,        y:this.pos};
      }
    }

    _applyTransform(){
      const {x,y}=this.xy(), rot=this.headingDeg(), s=0.9;
      // 接地(frame===3)で端にスナップ、他フレームは微小吸着は不要（座標系で吸着済）
      this.sprite.g.setAttribute("transform",`translate(${x},${y}) rotate(${rot}) scale(${s}) translate(-24,-18)`);
    }
    _applyEyeBody(){
      this.sprite.body.setAttribute("d",BODY[this.frame]);
      const p=EYE[this.frame];
      this.sprite.sclera.setAttribute("cx",p.cx); this.sprite.sclera.setAttribute("cy",p.cy);
      this.sprite.iris.setAttribute("cx",p.cx+1); this.sprite.iris.setAttribute("cy",p.cy);
      this.sprite.body.setAttribute("fill",this.color);
      this.sprite.iris.setAttribute("fill",this.eye);
    }

    tick(dt){
      this.accum+=dt;
      if(this.accum>=this.pulseMs()){
        this.accum=0;
        const prev=this.frame;
        this.frame=(this.frame+1)%5;
        this._applyEyeBody();
        // 進むのは recoil -> normal への切替瞬間のみ
        if(prev===4 && this.frame===0) this._advance();
      }
      this._applyTransform();
    }

    // —— 角の安全な繰り越し（長いステップでも多段で処理）——
    _advance(){
      let remaining=this.speedPx()*this.dirSign();
      while(Math.abs(remaining)>0.0001){
        const len=edgeLen(this.edge);
        const towardEnd = (remaining>0); // 辺の正方向終端へ進むか
        const distToEdge = towardEnd ? (len - this.pos) : (0 - this.pos);
        // まだ辺の中で完結
        if(Math.abs(remaining) <= Math.abs(distToEdge)){
          this.pos += remaining;
          remaining = 0;
        }else{
          // 端まで移動
          this.pos += distToEdge;
          remaining -= distToEdge;
          // 隣の辺へ遷移（回り方向に固定）
          this._turnToNextEdge(towardEnd);
        }
        // 範囲補正
        this.pos = clamp(this.pos, 0, edgeLen(this.edge));
      }
    }

    _turnToNextEdge(towardEnd){
      // towardEnd は「現在の辺で正方向終端に到達したか」
      // 右回り: top→right→bottom→left→top
      // 左回り: top→left→bottom→right→top
      const cw=this.clockwise;
      const cur=this.edge;
      const w=innerWidth, h=innerHeight;
      const m=DEFAULTS.margin, mr=m+DEFAULTS.marginRightExtra;

      if(cw){
        if(cur==="top"){ this.edge="right"; this.pos = m; }          // x=w-mr → y=m から右辺へ
        else if(cur==="right"){ this.edge="bottom"; this.pos = w-m; }
        else if(cur==="bottom"){ this.edge="left"; this.pos = h-m; }
        else if(cur==="left"){ this.edge="top"; this.pos = m; }
      }else{
        if(cur==="top"){ this.edge="left"; this.pos = m; }
        else if(cur==="left"){ this.edge="bottom"; this.pos = m; }
        else if(cur==="bottom"){ this.edge="right"; this.pos = h-m; }
        else if(cur==="right"){ this.edge="top"; this.pos = w-m; }
      }
      // pos は新しい「辺上の位置」なので、x/y変換は xy() 側で行う
      // ここでは 端の“対応点”に寄せるため、上記のように適切な値をセット
    }
  }

  // —— 再会判定（デバウンスつき）——
  function tryEncounter(a,b,nowMs){
    if(a.edge!==b.edge) return;
    const dist=Math.abs(a.pos-b.pos);
    const hit = dist < DEFAULTS.collidePx;

    // 直近ペアが離れてない間は再判定しない
    const pairA=a.coolWith===b.id, pairB=b.coolWith===a.id;
    const stillCooling = (pairA && nowMs < a.coolUntil) || (pairB && nowMs < b.coolUntil);
    const notYetRearmed = (pairA || pairB) && dist < Math.max(a.rearmDist,b.rearmDist);

    if(!hit) return; // 当たってない

    if(stillCooling || notYetRearmed) return; // クール中 or まだ離れてない

    // —— ここで初めて再会処理 ——（結果はランダム）
    const r=randInt(0,9); // 0,1,2:すれ違い 3,4:融合 5,6,7,8,9:増える
    if(r<3){
      a.pos += a.dirSign?.()??0 * 8;
      b.pos += b.dirSign?.()??0 * 8;
    }else if(r<5){
      // 融合（bを消してaの色に混ぜるか、どちらかの色）
      a.color = Math.random()<0.5 ? a.color : b.color;
      try{ stage.removeChild(b.sprite.g);}catch{}
      const arr=window.KomyakuBanner._all; const i=arr.indexOf(b); if(i>-1) arr.splice(i,1);
    }else if(r>4){
      // 増殖：上限確認
      if(window.KomyakuBanner._all.length < DEFAULTS.maxEntities){
        const nb=new Komyaku({
          color: Math.random()<0.5 ? a.color : b.color,
          eye: a.eye, edge:a.edge,
          clockwise: Math.random()<0.5 ? a.clockwise : b.clockwise,
          pos:(a.pos+b.pos)/2,
          stepLevel: Math.random()<0.5 ? a.stepLevel : b.stepLevel,
          pulseSpeed: Math.random()<0.5 ? a.pulseSpeed : b.pulseSpeed,
        });
        window.KomyakuBanner._all.push(nb);
      }
    }
    // デバウンス開始
    const cd=DEFAULTS.encounterCooldownMs;
    a.coolWith=b.id; b.coolWith=a.id;
    a.coolUntil=nowMs+cd; b.coolUntil=nowMs+cd;
  }

  // —— ループ —— 
  let last=performance.now();
  function loop(now){
    const dt=now-last; last=now;
    const list=window.KomyakuBanner._all;
    for(const k of list) k.tick(dt);
    // 再会チェック
    for(let i=0;i<list.length;i++){
      for(let j=i+1;j<list.length;j++){
        tryEncounter(list[i],list[j], now);
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // —— API —— 
  window.KomyakuBanner={
    _all:[],
    init(opts={}){ Object.assign(DEFAULTS,opts); return this; },
    spawn(o){
      if(this._all.length>=DEFAULTS.maxEntities) return null;
      const k=new Komyaku(o); this._all.push(k); return k;
    },
    count(){ return this._all.length; }
  };

  addEventListener("resize",()=>{
    if(stage.isConnected) stage.setAttribute("viewBox",`0 0 ${innerWidth} ${innerHeight}`);
    for(const k of window.KomyakuBanner._all){
      k.pos=clamp(k.pos,0,(k.edge==="top"||k.edge==="bottom")?innerWidth:innerHeight);
    }
  });
})();