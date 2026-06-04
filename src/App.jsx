import { useState, useEffect, useRef, useCallback } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ComposedChart, ReferenceLine, Line } from "recharts";

/* ══ INDICATORS ══════════════════════════════════════════ */
const calcSMA = (a, n) => a.map((_, i) => i < n-1 ? null : a.slice(i-n+1,i+1).reduce((x,y)=>x+y,0)/n);
function calcEMA(a, n){ const k=2/(n+1),o=[]; for(let i=0;i<a.length;i++) o.push(i===0?a[0]:a[i]*k+o[i-1]*(1-k)); return o; }
function calcRSI(c,n=14){
  if(c.length<n+1) return c.map(()=>50);
  const g=[],l=[];
  for(let i=1;i<c.length;i++){const d=c[i]-c[i-1];g.push(d>0?d:0);l.push(d<0?-d:0);}
  let ag=g.slice(0,n).reduce((a,b)=>a+b)/n,al=l.slice(0,n).reduce((a,b)=>a+b)/n;
  const o=new Array(n).fill(null); o.push(100-100/(1+ag/Math.max(al,1e-10)));
  for(let i=n;i<g.length;i++){ag=(ag*(n-1)+g[i])/n;al=(al*(n-1)+l[i])/n;o.push(100-100/(1+ag/Math.max(al,1e-10)));}
  return o;
}
function calcMACD(c,f=12,s=26,sig=9){
  const fe=calcEMA(c,f),se=calcEMA(c,s),line=fe.map((v,i)=>v-se[i]),signal=calcEMA(line,sig);
  return{line,signal,hist:line.map((v,i)=>v-signal[i])};
}
function calcBB(c,n=20,m=2){
  const sm=calcSMA(c,n);
  return c.map((_,i)=>{if(i<n-1||sm[i]===null)return{upper:null,mid:null,lower:null};const sl=c.slice(i-n+1,i+1),std=Math.sqrt(sl.reduce((a,v)=>a+(v-sm[i])**2,0)/n);return{upper:sm[i]+m*std,mid:sm[i],lower:sm[i]-m*std};});
}

/* ══ CUSTOM STRATEGY EVALUATOR ═══════════════════════════ */
function getIndVal(candles,id,params){
  if(!candles||candles.length<5) return null;
  const c=candles.map(x=>x.close),n=c.length-1;
  switch(id){
    case"RSI":return calcRSI(c,params.period||14)[n];
    case"MACD_LINE":return calcMACD(c).line[n];
    case"MACD_HIST":return calcMACD(c).hist[n];
    case"BB_UPPER":return calcBB(c,params.period||20)[n]?.upper;
    case"BB_LOWER":return calcBB(c,params.period||20)[n]?.lower;
    case"EMA":return calcEMA(c,params.period||9)[n];
    case"SMA":return calcSMA(c,params.period||20)[n];
    case"PRICE":return c[n];
    case"VOLUME":return candles[n].volume;
    default:return null;
  }
}
function evalCond(candles,cond){
  const curr=getIndVal(candles,cond.indicator,cond),prev=getIndVal(candles.slice(0,-1),cond.indicator,cond);
  if(curr===null||curr===undefined) return false;
  switch(cond.operator){
    case">":return curr>cond.value; case"<":return curr<cond.value;
    case">=":return curr>=cond.value; case"<=":return curr<=cond.value;
    case"CROSSES_ABOVE":return prev!==null&&prev<=cond.value&&curr>cond.value;
    case"CROSSES_BELOW":return prev!==null&&prev>=cond.value&&curr<cond.value;
    default:return false;
  }
}
function runCustomStrat(candles,buyConds,sellConds,buyLogic,sellLogic){
  if(!candles||candles.length<30) return"HOLD";
  const bRes=buyConds.map(c=>evalCond(candles,c)),sRes=sellConds.map(c=>evalCond(candles,c));
  const buy=buyLogic==="AND"?bRes.every(Boolean):bRes.some(Boolean);
  const sell=sellLogic==="AND"?sRes.every(Boolean):sRes.some(Boolean);
  return buy?"BUY":sell?"SELL":"HOLD";
}/* ══ STRATEGIES ══════════════════════════════════════════ */
const STRATS={
  RSI_MACD:{id:"RSI_MACD",label:"RSI + MACD",icon:"⚡",color:"#d97706",desc:"Momentum confluence: RSI extreme + MACD crossover",defaults:{rsiLen:14,oversold:30,overbought:70,fast:12,slow:26,sigLen:9},
    run(c,cfg){if(c.length<40)return"HOLD";const cl=c.map(x=>x.close),r=calcRSI(cl,cfg.rsiLen),{line,signal}=calcMACD(cl,cfg.fast,cfg.slow,cfg.sigLen),n=cl.length-1;if(r[n]<cfg.oversold&&line[n-1]<signal[n-1]&&line[n]>signal[n])return"BUY";if(r[n]>cfg.overbought&&line[n-1]>signal[n-1]&&line[n]<signal[n])return"SELL";return"HOLD";}},
  MA_CROSS:{id:"MA_CROSS",label:"MA Crossover",icon:"📈",color:"#16a34a",desc:"Golden/Death cross: Fast EMA crosses Slow EMA",defaults:{fastLen:9,slowLen:21},
    run(c,cfg){if(c.length<cfg.slowLen+2)return"HOLD";const cl=c.map(x=>x.close),f=calcEMA(cl,cfg.fastLen),s=calcEMA(cl,cfg.slowLen),n=cl.length-1;if(f[n-1]<=s[n-1]&&f[n]>s[n])return"BUY";if(f[n-1]>=s[n-1]&&f[n]<s[n])return"SELL";return"HOLD";}},
  BOLLINGER:{id:"BOLLINGER",label:"Bollinger Bands",icon:"🎯",color:"#7c3aed",desc:"Mean reversion: Buy lower band, Sell upper band",defaults:{period:20,stdDev:2},
    run(c,cfg){if(c.length<cfg.period+2)return"HOLD";const cl=c.map(x=>x.close),bb=calcBB(cl,cfg.period,cfg.stdDev),n=cl.length-1;if(!bb[n].lower||!bb[n-1].lower)return"HOLD";if(cl[n-1]<=bb[n-1].lower&&cl[n]>bb[n].lower)return"BUY";if(cl[n-1]>=bb[n-1].upper&&cl[n]<bb[n].upper)return"SELL";return"HOLD";}},
  GRID:{id:"GRID",label:"Grid Trading",icon:"⊞",color:"#0284c7",desc:"Fixed % grid: buy dips, sell pumps within range",defaults:{gridPct:1.5,levels:5},
    run(c,cfg,st){if(!st?.gridCenter||c.length<2)return"HOLD";const p=c[c.length-1].close,pv=c[c.length-2].close;for(let i=1;i<=cfg.levels;i++){if(pv>st.gridCenter*(1-i*cfg.gridPct/100)&&p<=st.gridCenter*(1-i*cfg.gridPct/100))return"BUY";if(pv<st.gridCenter*(1+i*cfg.gridPct/100)&&p>=st.gridCenter*(1+i*cfg.gridPct/100))return"SELL";}return"HOLD";}},
  DCA:{id:"DCA",label:"DCA",icon:"💰",color:"#ea580c",desc:"Dollar Cost Averaging: buy at regular intervals",defaults:{intervalMin:60,buyAmount:100},
    run(c,cfg,st){return(Date.now()-(st?.lastDCA||0))>=cfg.intervalMin*60000?"BUY":"HOLD";}},
  SCALP:{id:"SCALP",label:"Scalping",icon:"🔥",color:"#dc2626",desc:"Short-term RSI extremes for micro-profit captures",defaults:{rsiLen:7,oversold:25,overbought:75},
    run(c,cfg){if(c.length<10)return"HOLD";const r=calcRSI(c.map(x=>x.close),cfg.rsiLen),l=r[r.length-1];return l<cfg.oversold?"BUY":l>cfg.overbought?"SELL":"HOLD";}},
  CUSTOM:{id:"CUSTOM",label:"Custom",icon:"🔧",color:"#7c3aed",desc:"User-defined conditions from Strategy Builder",defaults:{},
    run(c,cfg){return runCustomStrat(c,cfg.buyConds||[],cfg.sellConds||[],cfg.buyLogic||"AND",cfg.sellLogic||"OR");}},
};

/* ══ BACKTEST ENGINE ═════════════════════════════════════ */
function runBacktest(candles,stratId,stratCfg,riskCfg,initBal=10000,tradeAmt=1000){
  let bal=initBal,pos={qty:0,avgPrice:0,hwm:0};
  const trades=[],equity=[{t:"Start",v:initBal}];
  const strat=STRATS[stratId];if(!strat||candles.length<60)return null;
  for(let i=55;i<candles.length;i++){
    const price=candles[i].close,date=new Date(candles[i].time).toLocaleDateString("en",{month:"short",day:"numeric"});
    if(pos.qty>1e-8){const pct=(price-pos.avgPrice)/pos.avgPrice*100;if(price>pos.hwm)pos.hwm=price;
      let ex=null;if(riskCfg.sl&&pct<=-riskCfg.sl)ex="SL";else if(riskCfg.tp&&pct>=riskCfg.tp)ex="TP";else if(riskCfg.trail&&pos.hwm>pos.avgPrice&&(price-pos.hwm)/pos.hwm*100<=-riskCfg.trail)ex="TRAIL";
      if(ex){const pnl=(price-pos.avgPrice)*pos.qty;bal+=pos.qty*price;trades.push({side:"SELL",reason:ex,price,date,pnl});pos={qty:0,avgPrice:0,hwm:0};equity.push({t:date,v:+bal.toFixed(2)});continue;}}
    const signal=strat.run(candles.slice(0,i+1),{...strat.defaults,...stratCfg},{});
    if(signal==="BUY"&&pos.qty<1e-8&&bal>10){const sp=Math.min(tradeAmt,bal*0.95),qty=sp/price;bal-=sp;pos={qty,avgPrice:price,hwm:price};trades.push({side:"BUY",reason:"SIG",price,date,pnl:0});}
    else if(signal==="SELL"&&pos.qty>1e-8){const pnl=(price-pos.avgPrice)*pos.qty;bal+=pos.qty*price;trades.push({side:"SELL",reason:"SIG",price,date,pnl});pos={qty:0,avgPrice:0,hwm:0};}
    equity.push({t:date,v:+((bal+pos.qty*price).toFixed(2))});
  }
  const finalEq=bal+pos.qty*candles[candles.length-1].close,ret=(finalEq-initBal)/initBal*100;
  const sells=trades.filter(t=>t.side==="SELL"&&t.pnl!==0),winRate=sells.length?sells.filter(t=>t.pnl>0).length/sells.length*100:0;
  let peak=initBal,maxDD=0;equity.forEach(p=>{if(p.v>peak)peak=p.v;const dd=(peak-p.v)/peak*100;if(dd>maxDD)maxDD=dd;});
  const rets=equity.slice(1).map((p,i)=>(p.v-equity[i].v)/Math.max(equity[i].v,1));
  const meanR=rets.reduce((a,b)=>a+b,0)/rets.length,stdR=Math.sqrt(rets.reduce((a,r)=>a+(r-meanR)**2,0)/Math.max(rets.length,1));
  const downR=rets.filter(r=>r<0),downStd=Math.sqrt(downR.reduce((a,r)=>a+r**2,0)/Math.max(downR.length,1));
  return{equity,trades,finalEq,ret,winRate,maxDD,sharpe:stdR>0?meanR/stdR*Math.sqrt(365):0,sortino:downStd>0?meanR/downStd*Math.sqrt(365):0,tradeCount:sells.length};
}/* ══ API UTILS ═══════════════════════════════════════════ */
const CRYPTO_SYMS=["BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT","DOGEUSDT"];
const INTERVALS=["1m","5m","15m","1h","4h","1d"];
const EXCHANGES=["Binance","Coinbase","Kraken","OKX","Bybit"];
const MONO="'JetBrains Mono','Fira Code','Courier New',monospace";

const fmt=(n,d=2)=>typeof n==="number"?n.toFixed(d):"—";
const fmtUSD=n=>{if(n==null||isNaN(n))return"—";const a=Math.abs(n);if(a>=1e6)return`$${(n/1e6).toFixed(2)}M`;if(a>=1e3)return`$${(n/1e3).toFixed(2)}K`;return`$${n.toFixed(a<1?4:2)}`;};
const fmtPct=n=>`${n>=0?"+":""}${fmt(n)}%`;
const tsStr=ts=>new Date(ts).toLocaleTimeString("en",{hour12:false});
const short=s=>s.replace("USDT","");
const dateKey=ts=>{const d=new Date(ts);return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;};

async function loadKlines(sym,interval="1h",limit=150){
  try{const r=await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`);const d=await r.json();if(!Array.isArray(d))return[];return d.map(k=>({time:k[0],open:+k[1],high:+k[2],low:+k[3],close:+k[4],volume:+k[5]}));}catch{return[];}
}
async function hmacSHA256(secret,msg){
  const enc=new TextEncoder(),key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,enc.encode(msg));return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function placeBinanceOrder(apiKey,secret,symbol,side,quoteQty){
  try{const ts=Date.now(),params=`symbol=${symbol}&side=${side}&type=MARKET&quoteOrderQty=${quoteQty}&timestamp=${ts}`,sig=await hmacSHA256(secret,params),r=await fetch(`https://api.binance.com/api/v3/order?${params}&signature=${sig}`,{method:"POST",headers:{"X-MBX-APIKEY":apiKey,"Content-Type":"application/x-www-form-urlencoded"}});return await r.json();}catch(e){return{error:e.message};}
}
async function getBinanceBalance(apiKey,secret){
  try{const ts=Date.now(),params=`timestamp=${ts}`,sig=await hmacSHA256(secret,params),r=await fetch(`https://api.binance.com/api/v3/account?${params}&signature=${sig}`,{headers:{"X-MBX-APIKEY":apiKey}});const d=await r.json();return d.balances?d.balances.filter(b=>parseFloat(b.free)>0):null;}catch{return null;}
}
async function loadFearGreed(){try{const r=await fetch("https://api.alternative.me/fng/?limit=7");const d=await r.json();return d.data;}catch{return null;}}
async function loadCryptoNews(){try{const r=await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest");const d=await r.json();return d.Data?.slice(0,20)||[];}catch{return[];}}
async function loadForexRates(){try{const r=await fetch("https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY,AUD,CHF,CAD,NZD");const d=await r.json();return d.rates;}catch{return null;}}
function checkRisk(bot,position,price){
  if(!bot.risk||!position||position.qty<1e-8)return null;const{sl,tp,trail}=bot.risk;
  const pct=(price-position.avgPrice)/position.avgPrice*100;
  if(sl&&pct<=-sl)return"SL";if(tp&&pct>=tp)return"TP";
  if(trail&&position.hwm>position.avgPrice&&(price-position.hwm)/position.hwm*100<=-trail)return"TRAIL";
  return null;
}

/* ══ LIGHT DESIGN TOKENS ═════════════════════════════════ */
const C={
  bg:"#ffffff", surface:"#f8fafc", surface2:"#f1f5f9", surface3:"#e8eef5",
  border:"#e2e8f0", borderHi:"#cbd5e1",
  text:"#0f172a", muted:"#94a3b8", mutedHi:"#64748b",
  amber:"#b45309", amberBg:"#fffbeb", amberBorder:"#fde68a",
  cyan:"#0284c7", cyanBg:"#e0f2fe", cyanBorder:"#bae6fd",
  green:"#16a34a", greenBg:"#dcfce7", greenBorder:"#86efac",
  red:"#dc2626", redBg:"#fee2e2", redBorder:"#fca5a5",
  purple:"#7c3aed", purpleBg:"#ede9fe", purpleBorder:"#c4b5fd",
  orange:"#ea580c", orangeBg:"#fff7ed",
  shadow:"0 1px 3px rgba(0,0,0,0.08),0 1px 2px rgba(0,0,0,0.04)",
  shadowMd:"0 4px 6px -1px rgba(0,0,0,0.07),0 2px 4px -1px rgba(0,0,0,0.04)",
};
const cs=(x={})=>({background:C.bg,border:`1px solid ${C.border}`,borderRadius:8,padding:16,boxShadow:C.shadow,...x});
const bgs=(col,bg)=>({background:bg||col+"15",color:col,border:`1px solid ${col}30`,borderRadius:4,padding:"2px 8px",fontSize:10,letterSpacing:"0.06em",textTransform:"uppercase",display:"inline-flex",alignItems:"center",gap:3,fontWeight:600});
const bs=(col=C.amber,v="solid")=>({background:v==="solid"?col:"transparent",color:v==="solid"?"#fff":col,border:`1px solid ${v==="solid"?col:col}`,borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11,letterSpacing:"0.04em",fontFamily:MONO,fontWeight:600,transition:"all 0.12s"});
const is={background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,color:C.text,padding:"7px 11px",fontFamily:MONO,fontSize:11,outline:"none",width:"100%",boxSizing:"border-box",boxShadow:"inset 0 1px 2px rgba(0,0,0,0.04)"};
const ls={color:C.mutedHi,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",display:"block",marginBottom:4,fontWeight:600};
const TH={borderBottom:`1px solid ${C.border}`,padding:"8px 12px",textAlign:"left",color:C.mutedHi,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:600,background:C.surface,whiteSpace:"nowrap"};
const TD={borderBottom:`1px solid ${C.border}`,padding:"7px 12px",color:C.text,fontSize:11};
/* ══ SVG CANDLESTICK CHART ENGINE ════════════════════════ */
function CandleChart({candles,height=280,overlay="none",showVolume=true,trades=[]}){
  const ref=useRef(null);
  const [w,setW]=useState(700);
  useEffect(()=>{if(!ref.current)return;const ro=new ResizeObserver(e=>setW(e[0].contentRect.width));ro.observe(ref.current);return()=>ro.disconnect();},[]);
  if(!candles||candles.length<2)return<div ref={ref} style={{height,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:12,background:C.surface,borderRadius:6}}>Loading chart…</div>;

  const PAD={t:12,r:8,b:30,l:68};
  const totalH=showVolume?height:height;
  const priceH=showVolume?totalH*0.75:totalH-PAD.t-PAD.b;
  const volH=showVolume?totalH*0.18:0;
  const gap=showVolume?8:0;

  const cW=w-PAD.l-PAD.r;
  const highs=candles.map(d=>d.high),lows=candles.map(d=>d.low);
  const maxP=Math.max(...highs)*1.001,minP=Math.min(...lows)*0.999,pRange=maxP-minP||1;

  // overlay calculations
  const closes=candles.map(d=>d.close);
  const ema9=overlay==="EMA"?calcEMA(closes,9):[];
  const ema21=overlay==="EMA"?calcEMA(closes,21):[];
  const bb=overlay==="BB"?calcBB(closes,20):[];
  const rsi=calcRSI(closes);

  const xOf=i=>PAD.l+(i+0.5)*cW/candles.length;
  const yOf=p=>PAD.t+(1-(p-minP)/pRange)*priceH;
  const bW=Math.max(1.5,Math.min(14,cW/candles.length*0.65));

  const maxVol=Math.max(...candles.map(d=>d.volume));
  const yVol=v=>PAD.t+priceH+gap+volH*(1-v/maxVol);

  // price grid
  const gridLevels=5;
  const gridPrices=Array.from({length:gridLevels},(_,i)=>minP+(pRange*i)/(gridLevels-1));

  // x-axis label step
  const labelStep=Math.max(1,Math.floor(candles.length/8));

  // polyline for EMA / BB mid
  const pts=(arr)=>arr.map((v,i)=>v!=null?`${xOf(i)},${yOf(v)}`:null).filter(Boolean).join(" ");

  return(
    <div ref={ref} style={{width:"100%",position:"relative"}}>
      <svg width={w} height={totalH} style={{display:"block",userSelect:"none"}}>
        {/* Price grid lines */}
        {gridPrices.map((p,i)=>(
          <g key={i}>
            <line x1={PAD.l} y1={yOf(p)} x2={w-PAD.r} y2={yOf(p)} stroke={C.border} strokeWidth={0.8}/>
            <text x={PAD.l-6} y={yOf(p)+4} textAnchor="end" fontSize={9} fill={C.mutedHi} fontFamily={MONO}>
              {p>=1000?`${(p/1000).toFixed(1)}K`:p.toFixed(p<1?4:2)}
            </text>
          </g>
        ))}

        {/* BB overlay */}
        {overlay==="BB"&&bb.map((b,i)=>b.upper&&i>0&&bb[i-1].upper?(
          <g key={i}>
            <line x1={xOf(i-1)} y1={yOf(bb[i-1].upper)} x2={xOf(i)} y2={yOf(b.upper)} stroke={C.purple} strokeWidth={1} strokeDasharray="3 2" opacity={0.7}/>
            <line x1={xOf(i-1)} y1={yOf(bb[i-1].mid)}   x2={xOf(i)} y2={yOf(b.mid)}   stroke={C.purple} strokeWidth={0.8} opacity={0.4}/>
            <line x1={xOf(i-1)} y1={yOf(bb[i-1].lower)} x2={xOf(i)} y2={yOf(b.lower)} stroke={C.purple} strokeWidth={1} strokeDasharray="3 2" opacity={0.7}/>
          </g>
        ):null)}

        {/* EMA lines */}
        {overlay==="EMA"&&ema9.length>0&&(
          <>
            <polyline points={pts(ema9)} fill="none" stroke={C.green} strokeWidth={1.5} opacity={0.9}/>
            <polyline points={pts(ema21)} fill="none" stroke={C.orange} strokeWidth={1.5} opacity={0.9}/>
          </>
        )}

        {/* Candles */}
        {candles.map((d,i)=>{
          const isGreen=d.close>=d.open;
          const fill=isGreen?C.green:C.red;
          const x=xOf(i);
          const bodyTop=yOf(Math.max(d.open,d.close));
          const bodyBot=yOf(Math.min(d.open,d.close));
          const bodyH=Math.max(1,bodyBot-bodyTop);
          return(
            <g key={i}>
              <line x1={x} y1={yOf(d.high)} x2={x} y2={yOf(d.low)} stroke={fill} strokeWidth={1}/>
              <rect x={x-bW/2} y={bodyTop} width={bW} height={bodyH} fill={fill} rx={1}
                fillOpacity={isGreen?0.92:0.88}
                stroke={fill} strokeWidth={0.5}/>
            </g>
          );
        })}
        {/* Volume bars */}
        {showVolume&&candles.map((d,i)=>{
          const h=d.volume/maxVol*volH;
          const y=yVol(d.volume);
          const isGreen=d.close>=d.open;
          return <rect key={i} x={xOf(i)-bW/2} y={y} width={bW} height={h} fill={isGreen?C.green:C.red} fillOpacity={0.5}/>;
        })}

        {/* Trades markers */}
        {trades.map((t,i)=>{
          const idx=candles.findIndex(c=>new Date(c.time).toLocaleDateString("en",{month:"short",day:"numeric"})===t.date);
          if(idx<0)return null;
          const x=xOf(idx),y=yOf(candles[idx].close);
          return(
            <g key={i}>
              <circle cx={x} cy={y} r={5} fill={t.side==="BUY"?C.green:C.red} stroke="#fff" strokeWidth={1.2}/>
            </g>
          );
        })}

        {/* X-axis labels */}
        {candles.map((d,i)=>i%labelStep===0&&(
          <text key={i} x={xOf(i)} y={PAD.t+priceH+gap+volH+14} textAnchor="middle" fontSize={9} fill={C.mutedHi} fontFamily={MONO}>
            {new Date(d.time).toLocaleDateString("en",{month:"short",day:"numeric"})}
          </text>
        ))}
      </svg>
    </div>
  );
              }
