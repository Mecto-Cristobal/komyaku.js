// mykomyaku.js（サイト設定）
(function(){
  // デフォルト設定（軽め＆かわいめ）
  KomyakuBanner.init({
    pulseSpeed: 10,     // 3が標準（4でより滑らか）
    stepLevel: 5,      // 3が標準（2でおっとり）
    margin: 6,
    decisionEvery: 12, // 反転はたまに
    collidePx: 44,
    maxEntities: 12    // 増殖の上限
  });

  // 初期3匹（下辺から右向き）。添付の色味に合わせた3タイプ。
  const start=60, gap=120;
  KomyakuBanner.spawn({ color:"#E52A2A", eye:"#1E4FB7", edge:"bottom", dir:+1, pos:start + gap*0 });
  KomyakuBanner.spawn({ color:"#1E4FB7", eye:"#1E4FB7", edge:"bottom", dir:+1, pos:start + gap*1 });
  KomyakuBanner.spawn({ color:"#BDC3C7", eye:"#1E4FB7", edge:"bottom", dir:+1, pos:start + gap*2 });

  // “ぬるぬる感”のためにごく小さなテンポゆらぎ（負荷極小）
  const J=()=> (Math.random()*0.12 - 0.06); // ±6%
  setInterval(()=>{
    for(const k of KomyakuBanner._all){
      // フレーム間隔を微調整（1〜5は守る）
      const raw = k.pulseSpeed + J();
      k.pulseSpeed = Math.min(5, Math.max(1, Math.round(raw)));
    }
  }, 1800);
})();