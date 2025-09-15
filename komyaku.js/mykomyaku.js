// mykomyaku.js — ランダム初期配置 & 挙動パッチ統合版
(function(){
  const REVERSE = false; // trueなら全体反転
  const FRAME_WEIGHTS = [0.14,0.22,0.36,0.14,0.14]; // 伸び>接地>戻り

  // ===== ユーティリティ =====
  const ready = (fn)=>{
    if (document.readyState==="complete"||document.readyState==="interactive") fn();
    else document.addEventListener("DOMContentLoaded",fn,{once:true});
  };
  const randInt=(a,b)=>a+Math.floor(Math.random()*(b-a+1));

  // ===== Komyaku準備 =====
  function ensureBanner(cb, tries=0){
    if(window.KomyakuBanner && KomyakuBanner.spawn){ cb(); }
    else if(tries<300){ requestAnimationFrame(()=>ensureBanner(cb,tries+1)); }
  }

  // ===== パッチ処理 =====
  function patchKomyaku(k){
    // 前進制御をフレーム重みベースに
    /*if(!k.__advanceOriginal){
      k.__advanceOriginal = k._advance;
      k._advance = function(dist){
        if(dist==null) return; // サイクル境界はスキップ
        const dir = (this.dir>0?1:-1) * (REVERSE?-1:1);
        this.pos += dir*(dist);
      };
    }*/
    // 目線補正＆フレームごと微小前進
    if(!k.__applyEyeBody){
      k.__applyEyeBody = k._applyEyeBody;
      k._applyEyeBody = function(){
        this.__applyEyeBody();
        // 黒目を進行方向へ微移動
        const cx=parseFloat(this.sprite.sclera.getAttribute("cx"));
        this.sprite.iris.setAttribute("cx",String(cx+(this.dir>0?1:-1)));
        // 微小前進
        this._lastFrame=this._lastFrame??this.frame;
        const prev=this._lastFrame;
        const w=FRAME_WEIGHTS[this.frame]||0;
        if(!(prev===4 && this.frame===0)){
          this._advance(this.speedPx()*w);
        }
        this._lastFrame=this.frame;
      };
    }
    // 接地flipとREVERSE回転補正
    if(!k.__applyTransform){
      k.__applyTransform = k._applyTransform;
      k._applyTransform = function(){
        this.__applyTransform();
        const g=this.sprite.g;
        let tf=g.getAttribute("transform")||"";
        const needsFlip=(this.edge==="top"||this.edge==="left");
        if(needsFlip && !tf.includes(" scale(1,-1) ")){
          tf=tf.replace(" translate(-24,-18)"," scale(1,-1) translate(-24,-18)");
        }else if(!needsFlip && tf.includes(" scale(1,-1) ")){
          tf=tf.replace(" scale(1,-1)","");
        }
        if(REVERSE){
          tf=tf.replace(/rotate\((-?\d+(?:\.\d*)?)\)/,
            (m,deg)=>`rotate(${parseFloat(deg)+180})`);
        }
        g.setAttribute("transform",tf);
      };
    }
  }

  // ===== 初期化 =====
  ready(()=>ensureBanner(()=>{
    KomyakuBanner.init({
      pulseSpeed:5,
      stepLevel:4,
      margin:6,
      marginRightExtra:2, // 右辺広め
      collidePx:44,
      maxEntities:12,
      decisionEvery:12
    });

    // --- 初期3匹をランダムに下辺配置 ---
    function randomPositions(count,min,max,gap){
      const out=[]; let guard=0;
      while(out.length<count && guard<500){
        guard++;
        const p=randInt(min,max);
        if(out.every(q=>Math.abs(q-p)>=gap)) out.push(p);
      }
      return out.sort((a,b)=>a-b);
    }
    const PAD=60;
    const minX=PAD, maxX=Math.max(PAD+60,innerWidth-PAD);
    const positions=randomPositions(3,minX,maxX,120);

    const palette=[
      { color:"#E52A2A", eye:"#1E4FB7" },
      { color:"#1E4FB7", eye:"#1E4FB7" },
      { color:"#BDC3C7", eye:"#1E4FB7" },
    ];
    const cwPattern=[true,false,true];
    for(let i=0;i<3;i++){
      const tone=palette[i%palette.length];
      const k=KomyakuBanner.spawn({
        color:tone.color, eye:tone.eye,
        edge:"bottom", pos:positions[i],
        clockwise:cwPattern[i], dir:+1
      });
      if(k) patchKomyaku(k);
    }

    // 今後のspawnも自動パッチ
    const _spawn=KomyakuBanner.spawn;
    KomyakuBanner.spawn=function(o){
      const k=_spawn.call(KomyakuBanner,o);
      if(k) patchKomyaku(k);
      return k;
    };

    // 微小テンポゆらぎ
    setInterval(()=>{
      for(const k of KomyakuBanner._all){
        if(!k) continue;
        const raw=k.pulseSpeed+(Math.random()<0.5?-1:+1);
        k.pulseSpeed=Math.min(5,Math.max(1,raw));
      }
    },1800);
  }));
})();