import { useState, useEffect, useRef, useCallback } from "react";
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ComposedChart, ReferenceLine, Line } from "recharts";
import { SpeedInsights } from "@vercel/speed-insights/react";

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
}

/* ══ STRATEGIES ══════════════════════════════════════════ */
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
}

/* ══ API UTILS ═══════════════════════════════════════════ */
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

        {/* Trade markers */}
        {trades.map((t,i)=>{
          const ci=candles.findIndex(c=>Math.abs(c.time-t.timestamp)<3600000);
          if(ci<0)return null;
          const x=xOf(ci),isBuy=t.side==="BUY";
          const y=isBuy?yOf(candles[ci].low)-8:yOf(candles[ci].high)+16;
          return(
            <g key={i}>
              <circle cx={x} cy={y} r={5} fill={isBuy?C.green:C.red} opacity={0.85}/>
              <text x={x} y={y+(isBuy?-8:16)} textAnchor="middle" fontSize={8} fill={isBuy?C.green:C.red} fontFamily={MONO} fontWeight="bold">{isBuy?"B":"S"}</text>
            </g>
          );
        })}

        {/* Volume bars */}
        {showVolume&&candles.map((d,i)=>{
          const isGreen=d.close>=d.open;
          const x=xOf(i);
          const volTop=yVol(d.volume);
          const volBotY=PAD.t+priceH+gap+volH;
          return(<rect key={i} x={x-bW/2} y={volTop} width={bW} height={Math.max(1,volBotY-volTop)} fill={isGreen?C.green:C.red} fillOpacity={0.35} rx={0.5}/>);
        })}
        {showVolume&&<text x={PAD.l-6} y={PAD.t+priceH+gap+volH/2+4} textAnchor="end" fontSize={8} fill={C.muted} fontFamily={MONO}>VOL</text>}

        {/* X-axis labels */}
        {candles.map((d,i)=>{
          if(i%labelStep!==0)return null;
          return(<text key={i} x={xOf(i)} y={totalH-4} textAnchor="middle" fontSize={9} fill={C.muted} fontFamily={MONO}>
            {new Date(d.time).toLocaleDateString("en",{month:"short",day:"numeric"})}
          </text>);
        })}
      </svg>
    </div>
  );
}

/* RSI strip (separate SVG) */
function RSIStrip({candles,height=70}){
  const ref=useRef(null);const[w,setW]=useState(700);
  useEffect(()=>{if(!ref.current)return;const ro=new ResizeObserver(e=>setW(e[0].contentRect.width));ro.observe(ref.current);return()=>ro.disconnect();},[]);
  if(!candles||candles.length<15)return null;
  const PAD={t:4,r:8,b:18,l:68};
  const cW=w-PAD.l-PAD.r,cH=height-PAD.t-PAD.b;
  const rsi=calcRSI(candles.map(d=>d.close));
  const xOf=i=>PAD.l+(i+0.5)*cW/candles.length;
  const yOf=v=>PAD.t+(1-(v/100))*cH;
  const pts=rsi.map((v,i)=>v!=null?`${xOf(i)},${yOf(v)}`:null).filter(Boolean).join(" ");
  return(
    <div ref={ref} style={{width:"100%"}}>
      <svg width={w} height={height} style={{display:"block"}}>
        <text x={PAD.l-6} y={PAD.t+cH/2+4} textAnchor="end" fontSize={9} fill={C.mutedHi} fontFamily={MONO}>RSI</text>
        {/* grid */}
        <line x1={PAD.l} y1={yOf(70)} x2={w-PAD.r} y2={yOf(70)} stroke={C.red} strokeWidth={0.6} strokeDasharray="3 2" opacity={0.5}/>
        <line x1={PAD.l} y1={yOf(50)} x2={w-PAD.r} y2={yOf(50)} stroke={C.border} strokeWidth={0.6}/>
        <line x1={PAD.l} y1={yOf(30)} x2={w-PAD.r} y2={yOf(30)} stroke={C.green} strokeWidth={0.6} strokeDasharray="3 2" opacity={0.5}/>
        <text x={PAD.l-6} y={yOf(70)+4} textAnchor="end" fontSize={8} fill={C.red} fontFamily={MONO}>70</text>
        <text x={PAD.l-6} y={yOf(30)+4} textAnchor="end" fontSize={8} fill={C.green} fontFamily={MONO}>30</text>
        {/* RSI line */}
        <polyline points={pts} fill="none" stroke={C.cyan} strokeWidth={1.5} opacity={0.9}/>
        {/* overbought/oversold fill */}
        {rsi.map((v,i)=>{if(!v)return null;const col=v>70?C.red:v<30?C.green:null;if(!col)return null;return<rect key={i} x={xOf(i)-2} y={v>70?yOf(v):yOf(30)} width={4} height={v>70?yOf(70)-yOf(v):yOf(v)-yOf(30)} fill={col} opacity={0.15}/>;})}
      </svg>
    </div>
  );
}

/* ══ MICRO COMPONENTS ════════════════════════════════════ */
function Sig({s}){const col=s==="BUY"?C.green:s==="SELL"?C.red:C.muted;return<span style={bgs(col)}>{s==="BUY"?"▲":s==="SELL"?"▼":"·"} {s}</span>;}
function Stat({label,value,sub,color=C.amber,lg,bg}){return(
  <div style={{...cs(),background:bg||C.bg}}>
    <div style={{color:C.mutedHi,fontSize:10,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:8,fontWeight:600}}>{label}</div>
    <div style={{color,fontSize:lg?26:18,fontWeight:800,letterSpacing:"-0.03em",lineHeight:1}}>{value}</div>
    {sub&&<div style={{color:C.muted,fontSize:10,marginTop:5}}>{sub}</div>}
  </div>
);}

/* ══ DASHBOARD ═══════════════════════════════════════════ */
function Dashboard({portfolio,prices,trades,bots,priceDir}){
  const equity=portfolio.balance+Object.entries(portfolio.positions).reduce((s,[sym,pos])=>s+pos.qty*(prices[sym]?.price||0),0);
  const sells=trades.filter(t=>t.pnl!=null&&t.side==="SELL");
  const winRate=sells.length?(sells.filter(t=>t.pnl>0).length/sells.length*100).toFixed(1):"0.0";
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
      <Stat label="Total Equity" value={fmtUSD(equity)} sub="Paper account" lg bg={C.amberBg}/>
      <Stat label="Cash Balance" value={fmtUSD(portfolio.balance)} color={C.cyan} bg={C.cyanBg}/>
      <Stat label="Realized P&L" value={fmtUSD(portfolio.totalPnL)} color={portfolio.totalPnL>=0?C.green:C.red} bg={portfolio.totalPnL>=0?C.greenBg:C.redBg}/>
      <Stat label="Win Rate" value={`${winRate}%`} sub={`${sells.length} closed`} color={C.purple} bg={C.purpleBg}/>
      <Stat label="Active Bots" value={bots.filter(b=>b.active).length} sub={`of ${bots.length}`} color={C.orange} bg={C.orangeBg}/>
      <Stat label="Total Trades" value={trades.length} color={C.mutedHi}/>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:14}}>
      {/* Live prices */}
      <div style={cs()}>
        <div style={{color:C.text,fontSize:11,fontWeight:700,letterSpacing:"0.04em",marginBottom:12,display:"flex",gap:6,alignItems:"center"}}>
          <span style={{width:7,height:7,borderRadius:"50%",background:C.green,display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>Live Prices
        </div>
        {CRYPTO_SYMS.map(sym=>{const p=prices[sym],chg=p?.change24h,dir=priceDir[sym],col=chg>=0?C.green:C.red;return(
          <div key={sym} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
            <span style={{color:C.text,fontWeight:700,minWidth:48,fontSize:12}}>{short(sym)}</span>
            <span style={{color:dir==="up"?C.green:dir==="down"?C.red:C.text,transition:"color 0.35s",fontWeight:700,fontVariantNumeric:"tabular-nums",fontSize:12}}>
              {p?.price?fmtUSD(p.price):"…"}
            </span>
            <span style={{color:col,fontSize:10,minWidth:56,textAlign:"right"}}>{chg!=null?fmtPct(chg):"—"}</span>
            <span style={{fontSize:11,color:dir==="up"?C.green:dir==="down"?C.red:C.muted,marginLeft:4}}>{dir==="up"?"▲":dir==="down"?"▼":"—"}</span>
          </div>
        );})}
      </div>
      {/* Recent trades */}
      <div style={cs()}>
        <div style={{color:C.text,fontSize:11,fontWeight:700,marginBottom:12}}>Recent Activity</div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Time","Pair","Side","Price","Amount","P&L","Strategy","Exit"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>
            {trades.slice(0,10).map(t=>(<tr key={t.id} style={{background:t.side==="BUY"?`${C.green}05`:`${C.red}05`}}>
              <td style={{...TD,color:C.muted}}>{tsStr(t.timestamp)}</td>
              <td style={{...TD,fontWeight:700}}>{short(t.symbol)}</td>
              <td style={TD}><Sig s={t.side}/></td>
              <td style={TD}>{fmtUSD(t.price)}</td>
              <td style={TD}>{fmtUSD(t.amount)}</td>
              <td style={{...TD,color:t.pnl>0?C.green:t.pnl<0?C.red:C.muted,fontWeight:t.pnl?700:400}}>{t.pnl!=null?fmtUSD(t.pnl):"—"}</td>
              <td style={{...TD,color:STRATS[t.strategy]?.color||C.purple,fontSize:10}}>{STRATS[t.strategy]?.icon} {STRATS[t.strategy]?.label||t.strategy}</td>
              <td style={{...TD,fontSize:10,color:t.exitReason==="SL"?C.red:t.exitReason==="TP"?C.green:t.exitReason==="TRAIL"?C.orange:C.muted}}>{t.exitReason||"SIG"}</td>
            </tr>))}
            {!trades.length&&<tr><td colSpan={8} style={{...TD,textAlign:"center",color:C.muted,padding:28}}>No trades yet — start a bot to begin</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
    {/* Positions */}
    <div style={cs()}>
      <div style={{color:C.text,fontSize:11,fontWeight:700,marginBottom:12}}>Open Positions</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Symbol","Qty","Avg Entry","Current","Unreal. P&L","P&L %","HWM","SL","TP"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {Object.entries(portfolio.positions).filter(([,p])=>p.qty>1e-8).map(([sym,pos])=>{
            const curr=prices[sym]?.price||pos.avgPrice,upnl=(curr-pos.avgPrice)*pos.qty,upct=(curr-pos.avgPrice)/pos.avgPrice*100;
            const bot=bots.find(b=>b.symbol===sym&&b.active);
            return(<tr key={sym} style={{background:upnl>=0?`${C.green}05`:`${C.red}05`}}>
              <td style={{...TD,fontWeight:700}}>{short(sym)}</td>
              <td style={TD}>{pos.qty.toFixed(6)}</td><td style={TD}>{fmtUSD(pos.avgPrice)}</td><td style={TD}>{fmtUSD(curr)}</td>
              <td style={{...TD,color:upnl>=0?C.green:C.red,fontWeight:700}}>{fmtUSD(upnl)}</td>
              <td style={{...TD,color:upct>=0?C.green:C.red}}>{fmtPct(upct)}</td>
              <td style={{...TD,color:C.mutedHi}}>{pos.hwm?fmtUSD(pos.hwm):"—"}</td>
              <td style={{...TD,color:C.red}}>{bot?.risk?.sl?fmtUSD(pos.avgPrice*(1-bot.risk.sl/100)):"—"}</td>
              <td style={{...TD,color:C.green}}>{bot?.risk?.tp?fmtUSD(pos.avgPrice*(1+bot.risk.tp/100)):"—"}</td>
            </tr>);
          })}
          {Object.values(portfolio.positions).every(p=>p.qty<1e-8)&&<tr><td colSpan={9} style={{...TD,textAlign:"center",color:C.muted,padding:20}}>No open positions</td></tr>}
        </tbody>
      </table>
    </div>
  </div>);
}

/* ══ BOT MANAGER ════════════════════════════════════════ */
function BotManager({bots,onAdd,onToggle,onRemove,onUpdateRisk,prices,trades}){
  const [showForm,setSF]=useState(false);
  const [form,setForm]=useState({strategy:"RSI_MACD",symbol:"BTCUSDT",interval:"1h",amount:100});
  const [expandRisk,setER]=useState({});const[riskEdit,setRE]=useState({});
  const bt=id=>trades.filter(t=>t.botId===id);const pnl=id=>bt(id).reduce((s,t)=>s+(t.pnl||0),0);
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:13,fontWeight:700,color:C.text}}>Bot Manager <span style={{color:C.muted,fontWeight:400,fontSize:11}}>— {bots.filter(b=>b.active).length} active / {bots.length} total</span></div>
      <button style={bs(C.green)} onClick={()=>setSF(p=>!p)}>+ New Bot</button>
    </div>
    {showForm&&(<div style={cs({border:`1px solid ${C.greenBorder}`,background:C.greenBg+"44"})}>
      <div style={{fontWeight:700,fontSize:12,marginBottom:14,color:C.text}}>Create New Bot</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12}}>
        {[{lbl:"Strategy",key:"strategy",type:"select",opts:Object.values(STRATS).map(s=>({v:s.id,l:`${s.icon} ${s.label}`}))},
          {lbl:"Symbol",key:"symbol",type:"select",opts:CRYPTO_SYMS.map(s=>({v:s,l:s}))},
          {lbl:"Interval",key:"interval",type:"select",opts:INTERVALS.map(i=>({v:i,l:i}))},
          {lbl:"Trade Amount (USDT)",key:"amount",type:"number"}].map(f=>(
          <div key={f.key}><label style={ls}>{f.lbl}</label>
            {f.type==="select"?<select style={is} value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:e.target.value}))}>{f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
            :<input style={is} type="number" value={form[f.key]} onChange={e=>setForm(p=>({...p,[f.key]:+e.target.value}))}/>}
          </div>
        ))}
      </div>
      {STRATS[form.strategy]&&<div style={{marginTop:10,color:C.mutedHi,fontSize:11,padding:"8px 12px",background:C.surface,borderRadius:6,borderLeft:`3px solid ${STRATS[form.strategy].color}`}}>{STRATS[form.strategy].desc}</div>}
      <div style={{display:"flex",gap:8,marginTop:14}}>
        <button style={bs(C.green)} onClick={()=>{onAdd(form);setSF(false);}}>Create Bot</button>
        <button style={bs(C.red,"outline")} onClick={()=>setSF(false)}>Cancel</button>
      </div>
    </div>)}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))",gap:12}}>
      {bots.map(bot=>{
        const st=STRATS[bot.strategy],p=pnl(bot.id),tc=bt(bot.id).length,price=prices[bot.symbol]?.price,isR=expandRisk[bot.id],risk=riskEdit[bot.id]||bot.risk||{sl:2,tp:4,trail:1.5};
        return(<div key={bot.id} style={{...cs(),border:`1px solid ${bot.active?st?.color+"55":C.border}`,position:"relative",overflow:"hidden"}}>
          {bot.active&&<div style={{position:"absolute",top:0,left:0,right:0,height:3,background:`linear-gradient(90deg,transparent,${st?.color},transparent)`,animation:"scan 2.5s linear infinite"}}/>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
            <div style={{display:"flex",gap:10,alignItems:"center"}}>
              <div style={{width:36,height:36,borderRadius:8,background:st?.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>{st?.icon}</div>
              <div><div style={{color:st?.color,fontWeight:800,fontSize:13}}>{st?.label}</div><div style={{color:C.muted,fontSize:10,marginTop:1}}>{bot.symbol} · {bot.interval} · ${bot.amount}/trade</div></div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button style={{...bs(bot.active?C.red:C.green),padding:"5px 12px",fontSize:10}} onClick={()=>onToggle(bot.id)}>{bot.active?"■ Stop":"▶ Run"}</button>
              <button style={{...bs(C.muted,"outline"),padding:"5px 8px"}} onClick={()=>onRemove(bot.id)}>✕</button>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
            {[{l:"Trades",v:tc,c:C.cyan},{l:"P&L",v:fmtUSD(p),c:p>=0?C.green:C.red},{l:"Wins",v:bt(bot.id).filter(t=>t.pnl>0).length,c:C.green},{l:"Signal",v:bot.lastSignal||"—",c:C.mutedHi}].map(({l,v,c})=>(
              <div key={l} style={{background:C.surface,borderRadius:6,padding:"8px 10px"}}><div style={{color:C.muted,fontSize:9,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:3}}>{l}</div><div style={{color:c,fontSize:13,fontWeight:700}}>{v}</div></div>
            ))}
          </div>
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",marginBottom:isR?10:0}} onClick={()=>setER(p=>({...p,[bot.id]:!p[bot.id]}))}>
              <span style={{color:C.mutedHi,fontSize:10,fontWeight:600}}>⚙ Risk Management</span>
              <span style={{color:C.muted,fontSize:10}}>SL {risk.sl}% · TP {risk.tp}% · Trail {risk.trail}% {isR?"▲":"▼"}</span>
            </div>
            {isR&&(<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[{lbl:"Stop Loss %",key:"sl"},{lbl:"Take Profit %",key:"tp"},{lbl:"Trailing %",key:"trail"}].map(f=>(
                <div key={f.key}><label style={{...ls,marginBottom:2}}>{f.lbl}</label>
                  <input style={{...is,padding:"4px 8px"}} type="number" step="0.5" min="0" value={risk[f.key]} onChange={e=>setRE(p=>({...p,[bot.id]:{...risk,[f.key]:+e.target.value}}))}/>
                </div>
              ))}
              <div style={{gridColumn:"1/-1",display:"flex",gap:6}}>
                <button style={{...bs(C.cyan),padding:"4px 12px",fontSize:9}} onClick={()=>{onUpdateRisk(bot.id,risk);setER(p=>({...p,[bot.id]:false}));}}>Apply</button>
                <button style={{...bs(C.muted,"outline"),padding:"4px 12px",fontSize:9}} onClick={()=>setER(p=>({...p,[bot.id]:false}))}>Close</button>
              </div>
            </div>)}
          </div>
          <div style={{marginTop:10,display:"flex",justifyContent:"space-between",color:C.muted,fontSize:10}}>
            <span>Price: <span style={{color:C.text,fontWeight:600}}>{price?fmtUSD(price):"…"}</span></span>
            {bot.active&&<span style={{color:C.green,fontWeight:600,display:"flex",alignItems:"center",gap:4}}><span style={{width:6,height:6,borderRadius:"50%",background:C.green,display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>Live</span>}
          </div>
        </div>);
      })}
      {!bots.length&&<div style={{...cs(),textAlign:"center",color:C.muted,padding:48,gridColumn:"1/-1"}}><div style={{fontSize:32,marginBottom:10}}>🤖</div>No bots deployed. Create one above.</div>}
    </div>
  </div>);
}

/* ══ CHART VIEW — Live Candlestick + Price Feed ══════════ */
function ChartView({prices,allCandles}){
  const [sym,setSym]=useState("BTCUSDT");
  const [iv,setIv]=useState("1h");
  const [overlay,setOv]=useState("none");
  const [candles,setCandles]=useState([]);
  const [feed,setFeed]=useState([]);
  const [loading,setLoading]=useState(false);
  const wsRef=useRef(null);

  useEffect(()=>{
    setLoading(true);
    loadKlines(sym,iv,120).then(raw=>{if(raw.length)setCandles(raw);setLoading(false);});
    if(wsRef.current)wsRef.current.close();
    try{
      const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${sym.toLowerCase()}@kline_${iv}`);
      ws.onmessage=e=>{
        try{
          const{k}=JSON.parse(e.data);
          const newCandle={time:k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
          const isGreen=+k.c>=+k.o;
          setFeed(f=>[{price:+k.c,dir:isGreen?"up":"down",open:+k.o,time:Date.now()},...f.slice(0,49)]);
          setCandles(prev=>{
            if(!prev.length)return prev;
            const last=prev[prev.length-1];
            if(last.time===newCandle.time){
              const updated={...last,high:Math.max(last.high,newCandle.high),low:Math.min(last.low,newCandle.low),close:newCandle.close,volume:newCandle.volume};
              return[...prev.slice(0,-1),updated];
            }
            if(k.x)return[...prev.slice(-119),newCandle];
            return prev;
          });
        }catch{}
      };
      wsRef.current=ws;
    }catch{}
    return()=>wsRef.current?.close();
  },[sym,iv]);

  const p=prices[sym]?.price,chg=prices[sym]?.change24h;
  const lastCandle=candles[candles.length-1];
  const isGreenLast=lastCandle&&lastCandle.close>=lastCandle.open;

  return(
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:12}}>
      {/* Controls */}
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <select style={{...is,width:"auto",minWidth:130}} value={sym} onChange={e=>setSym(e.target.value)}>
          {CRYPTO_SYMS.map(s=><option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{display:"flex",gap:3,background:C.surface,borderRadius:6,padding:3,border:`1px solid ${C.border}`}}>
          {INTERVALS.map(i=>(
            <button key={i} style={{...bs(i===iv?C.amber:C.muted,i===iv?"solid":"outline"),padding:"3px 10px",border:"none",borderRadius:4,background:i===iv?C.amber:"transparent",color:i===iv?"#fff":C.mutedHi,fontSize:10}} onClick={()=>setIv(i)}>{i}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:3,background:C.surface,borderRadius:6,padding:3,border:`1px solid ${C.border}`}}>
          {["none","BB","EMA"].map(o=>(
            <button key={o} style={{...bs(o===overlay?C.purple:C.muted,o===overlay?"solid":"outline"),padding:"3px 10px",border:"none",borderRadius:4,background:o===overlay?C.purple:"transparent",color:o===overlay?"#fff":C.mutedHi,fontSize:10}} onClick={()=>setOv(o)}>{o==="none"?"Clean":o}</button>
          ))}
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:12}}>
          {p&&<span style={{fontSize:22,fontWeight:900,color:isGreenLast?C.green:C.red,letterSpacing:"-0.03em"}}>{fmtUSD(p)}</span>}
          {chg!=null&&<span style={{...bgs(chg>=0?C.green:C.red),fontSize:11}}>{fmtPct(chg)}</span>}
          <span style={{...bgs(C.green),fontSize:9}}><span style={{width:6,height:6,background:C.green,borderRadius:"50%",display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>LIVE</span>
        </div>
      </div>

      {/* OHLC summary bar */}
      {lastCandle&&(
        <div style={{display:"flex",gap:20,padding:"8px 14px",background:isGreenLast?C.greenBg:C.redBg,borderRadius:6,border:`1px solid ${isGreenLast?C.greenBorder:C.redBorder}`,fontSize:11}}>
          {[["O",lastCandle.open],[" H",lastCandle.high],["L",lastCandle.low],["C",lastCandle.close],["Vol",(lastCandle.volume/1e6).toFixed(2)+"M"]].map(([l,v])=>(
            <span key={l}><span style={{color:C.muted,marginRight:4}}>{l}</span><span style={{fontWeight:700,color:C.text}}>{l==="Vol"?v:fmtUSD(v)}</span></span>
          ))}
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 180px",gap:12}}>
        {/* Charts column */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {loading?(
            <div style={{...cs(),textAlign:"center",padding:80,color:C.muted}}>
              <div style={{fontSize:28,marginBottom:8}}>📊</div>Loading chart data from Binance…
            </div>
          ):(
            <>
              <div style={{...cs(),padding:"14px 12px 8px"}}>
                <div style={{color:C.mutedHi,fontSize:10,fontWeight:600,letterSpacing:"0.06em",marginBottom:8,textTransform:"uppercase"}}>
                  {sym} · {iv} · Candlestick {overlay!=="none"&&`+ ${overlay}`}
                </div>
                <CandleChart candles={candles} height={300} overlay={overlay} showVolume={true}/>
              </div>
              <div style={{...cs(),padding:"12px 12px 6px"}}>
                <div style={{color:C.mutedHi,fontSize:10,fontWeight:600,letterSpacing:"0.06em",marginBottom:4,textTransform:"uppercase"}}>RSI (14)</div>
                <RSIStrip candles={candles} height={72}/>
              </div>
            </>
          )}
        </div>

        {/* Live price action feed */}
        <div style={{...cs(),padding:12,display:"flex",flexDirection:"column",gap:0}}>
          <div style={{fontWeight:700,fontSize:11,color:C.text,marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:C.green,display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>
            Tick Feed
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:3,overflowY:"auto",maxHeight:420}}>
            {feed.length===0&&<div style={{color:C.muted,fontSize:11,textAlign:"center",padding:24}}>Waiting for ticks…</div>}
            {feed.map((t,i)=>(
              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 8px",background:t.dir==="up"?C.greenBg:C.redBg,borderRadius:4,border:`1px solid ${t.dir==="up"?C.greenBorder:C.redBorder}`,fontSize:10}}>
                <span style={{color:C.muted,fontSize:9}}>{tsStr(t.time)}</span>
                <span style={{color:t.dir==="up"?C.green:C.red,fontWeight:700,fontVariantNumeric:"tabular-nums"}}>{fmtUSD(t.price)}</span>
                <span style={{color:t.dir==="up"?C.green:C.red,fontWeight:700}}>{t.dir==="up"?"▲":"▼"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══ LIVE CHARTS — Multi-symbol candlestick grid ═════════ */
const CHART_MARKETS={
  crypto:[
    {sym:"BTCUSDT",label:"Bitcoin",  tag:"BTC",  color:C?.amber||"#d97706"},
    {sym:"ETHUSDT",label:"Ethereum", tag:"ETH",  color:"#7c3aed"},
    {sym:"BNBUSDT",label:"BNB",      tag:"BNB",  color:"#d97706"},
    {sym:"SOLUSDT",label:"Solana",   tag:"SOL",  color:"#9945ff"},
    {sym:"XRPUSDT",label:"XRP",      tag:"XRP",  color:"#0284c7"},
    {sym:"DOGEUSDT",label:"Dogecoin",tag:"DOGE", color:"#ca8a04"},
    {sym:"ADAUSDT",label:"Cardano",  tag:"ADA",  color:"#0033ad"},
    {sym:"AVAXUSDT",label:"Avalanche",tag:"AVAX",color:"#dc2626"},
  ],
  stocks:[
    {sym:"NASDAQ:NVDA",label:"NVIDIA",     tag:"NVDA", color:"#16a34a",tv:true},
    {sym:"NASDAQ:AAPL",label:"Apple",      tag:"AAPL", color:"#64748b",tv:true},
    {sym:"NASDAQ:MSFT",label:"Microsoft",  tag:"MSFT", color:"#0284c7",tv:true},
    {sym:"NASDAQ:META",label:"Meta",       tag:"META", color:"#1877f2",tv:true},
    {sym:"NASDAQ:GOOGL",label:"Alphabet",  tag:"GOOGL",color:"#4285f4",tv:true},
    {sym:"NASDAQ:TSLA",label:"Tesla",      tag:"TSLA", color:"#dc2626",tv:true},
    {sym:"AMEX:SPY",  label:"S&P 500 ETF",tag:"SPY",  color:"#16a34a",tv:true},
    {sym:"NASDAQ:QQQ",label:"QQQ ETF",    tag:"QQQ",  color:"#0284c7",tv:true},
  ],
  forex:[
    {sym:"FX:EURUSD",label:"EUR/USD",tag:"EUR/USD",color:"#3b82f6",tv:true},
    {sym:"FX:GBPUSD",label:"GBP/USD",tag:"GBP/USD",color:"#dc2626",tv:true},
    {sym:"FX:USDJPY",label:"USD/JPY",tag:"USD/JPY",color:"#d97706",tv:true},
    {sym:"FX:AUDUSD",label:"AUD/USD",tag:"AUD/USD",color:"#16a34a",tv:true},
    {sym:"FX:USDCHF",label:"USD/CHF",tag:"USD/CHF",color:"#7c3aed",tv:true},
    {sym:"FX:USDCAD",label:"USD/CAD",tag:"USD/CAD",color:"#ea580c",tv:true},
    {sym:"OANDA:XAUUSD",label:"Gold",tag:"XAU/USD",color:"#ca8a04",tv:true},
    {sym:"OANDA:XAGUSD",label:"Silver",tag:"XAG/USD",color:"#94a3b8",tv:true},
  ],
};

/* Mini live candle card — fetches its own data */
function MiniCandleCard({item,onClick}){
  const [candles,setCandles]=useState([]);
  const [price,setPrice]=useState(null);
  const [chg,setChg]=useState(null);
  const wsRef=useRef(null);
  const loaded=useRef(false);

  useEffect(()=>{
    if(item.tv)return; // TradingView items handled differently
    if(loaded.current)return;
    loaded.current=true;
    loadKlines(item.sym,"1h",60).then(raw=>{
      if(raw.length){
        setCandles(raw);
        const last=raw[raw.length-1],first=raw[0];
        setPrice(last.close);
        setChg((last.close-first.close)/first.close*100);
      }
    });
    try{
      const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${item.sym.toLowerCase()}@kline_1h`);
      ws.onmessage=e=>{
        try{
          const{k}=JSON.parse(e.data);
          setPrice(+k.c);
          setCandles(prev=>{
            if(!prev.length)return prev;
            const nc={time:k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};
            const last=prev[prev.length-1];
            if(last.time===nc.time)return[...prev.slice(0,-1),{...last,high:Math.max(last.high,nc.high),low:Math.min(last.low,nc.low),close:nc.close,volume:nc.volume}];
            if(k.x)return[...prev.slice(-59),nc];
            return prev;
          });
        }catch{}
      };
      wsRef.current=ws;
    }catch{}
    return()=>wsRef.current?.close();
  },[item.sym]);

  const lastC=candles[candles.length-1];
  const isGreen=lastC&&lastC.close>=lastC.open;

  return(
    <div onClick={onClick} style={{...cs(),cursor:"pointer",transition:"box-shadow 0.2s,border-color 0.2s",borderColor:C.border}}
      onMouseEnter={e=>{e.currentTarget.style.boxShadow=C.shadowMd;e.currentTarget.style.borderColor=item.color+"88";}}
      onMouseLeave={e=>{e.currentTarget.style.boxShadow=C.shadow;e.currentTarget.style.borderColor=C.border;}}>
      {/* Card header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <div style={{width:28,height:28,borderRadius:6,background:item.color+"18",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:900,color:item.color}}>{item.tag.slice(0,3)}</div>
          <div>
            <div style={{fontWeight:800,fontSize:12,color:C.text}}>{item.tag}</div>
            <div style={{color:C.muted,fontSize:10}}>{item.label}</div>
          </div>
        </div>
        <div style={{textAlign:"right"}}>
          {price&&<div style={{fontWeight:800,fontSize:13,color:isGreen?C.green:C.red}}>{fmtUSD(price)}</div>}
          {chg!=null&&<div style={{...bgs(chg>=0?C.green:C.red),fontSize:9,marginTop:2}}>{fmtPct(chg)}</div>}
        </div>
      </div>
      {/* Mini candlestick chart */}
      {candles.length>5?(
        <CandleChart candles={candles.slice(-40)} height={110} overlay="none" showVolume={false}/>
      ):(
        <div style={{height:110,display:"flex",alignItems:"center",justifyContent:"center",color:C.muted,fontSize:11,background:C.surface,borderRadius:6}}>
          {item.tv?"TradingView data":"Loading…"}
        </div>
      )}
      <div style={{marginTop:6,fontSize:9,color:C.muted,textAlign:"right"}}>click to expand · 1H</div>
    </div>
  );
}

/* TradingView full chart for stocks/forex */
function TVFullChart({item,onClose}){
  const ref=useRef(null);
  useEffect(()=>{
    if(!ref.current)return;
    ref.current.innerHTML="";
    const wd=document.createElement("div");wd.className="tradingview-widget-container__widget";wd.style.height="100%";wd.style.width="100%";
    ref.current.appendChild(wd);
    const sc=document.createElement("script");sc.type="text/javascript";
    sc.src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";sc.async=true;
    sc.innerHTML=JSON.stringify({autosize:true,symbol:item.sym,interval:"D",timezone:"Etc/UTC",theme:"light",style:"1",locale:"en",allow_symbol_change:false,hide_top_toolbar:false,save_image:false,calendar:false,support_host:"https://www.tradingview.com"});
    ref.current.appendChild(sc);
  },[item.sym]);
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(255,255,255,0.97)",zIndex:999,display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:C.bg,borderBottom:`1px solid ${C.border}`,boxShadow:C.shadow,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:item.color}}/>
          <span style={{fontWeight:900,fontSize:16,color:C.text}}>{item.tag}</span>
          <span style={{color:C.muted,fontSize:13}}>{item.label}</span>
          <span style={{...bgs(C.green),fontSize:9}}><span style={{width:6,height:6,background:C.green,borderRadius:"50%",display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>LIVE</span>
        </div>
        <button style={bs(C.red,"outline")} onClick={onClose}>✕ Close</button>
      </div>
      <div ref={ref} className="tradingview-widget-container" style={{flex:1,width:"100%",minHeight:0}}/>
    </div>
  );
}

/* Expanded full candle chart for crypto */
function CryptoFullChart({item,onClose,prices}){
  const [candles,setCandles]=useState([]);const[iv,setIv]=useState("1h");const[ov,setOv]=useState("none");
  const wsRef=useRef(null);const p=prices[item.sym]?.price,chg=prices[item.sym]?.change24h;
  useEffect(()=>{
    loadKlines(item.sym,iv,150).then(raw=>{if(raw.length)setCandles(raw);});
    if(wsRef.current)wsRef.current.close();
    try{
      const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${item.sym.toLowerCase()}@kline_${iv}`);
      ws.onmessage=e=>{try{const{k}=JSON.parse(e.data);const nc={time:k.t,open:+k.o,high:+k.h,low:+k.l,close:+k.c,volume:+k.v};setCandles(prev=>{if(!prev.length)return prev;const last=prev[prev.length-1];if(last.time===nc.time)return[...prev.slice(0,-1),{...last,high:Math.max(last.high,nc.high),low:Math.min(last.low,nc.low),close:nc.close,volume:nc.volume}];if(k.x)return[...prev.slice(-149),nc];return prev;});}catch{}};
      wsRef.current=ws;
    }catch{}
    return()=>wsRef.current?.close();
  },[item.sym,iv]);
  const lastC=candles[candles.length-1],isG=lastC&&lastC.close>=lastC.open;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(255,255,255,0.97)",zIndex:999,display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 20px",background:C.bg,borderBottom:`1px solid ${C.border}`,boxShadow:C.shadow,flexShrink:0,flexWrap:"wrap",gap:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:12,height:12,borderRadius:"50%",background:item.color}}/>
          <span style={{fontWeight:900,fontSize:16,color:C.text}}>{item.tag}</span>
          <span style={{color:C.muted}}>{item.label}</span>
          {p&&<span style={{fontWeight:900,fontSize:20,color:isG?C.green:C.red}}>{fmtUSD(p)}</span>}
          {chg!=null&&<span style={bgs(chg>=0?C.green:C.red)}>{fmtPct(chg)}</span>}
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",gap:2,background:C.surface,borderRadius:6,padding:3,border:`1px solid ${C.border}`}}>
            {INTERVALS.map(i=><button key={i} style={{background:i===iv?C.amber:"transparent",color:i===iv?"#fff":C.mutedHi,border:"none",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontSize:10,fontFamily:MONO}} onClick={()=>setIv(i)}>{i}</button>)}
          </div>
          <div style={{display:"flex",gap:2,background:C.surface,borderRadius:6,padding:3,border:`1px solid ${C.border}`}}>
            {["none","BB","EMA"].map(o=><button key={o} style={{background:o===ov?C.purple:"transparent",color:o===ov?"#fff":C.mutedHi,border:"none",borderRadius:4,padding:"3px 9px",cursor:"pointer",fontSize:10,fontFamily:MONO}} onClick={()=>setOv(o)}>{o==="none"?"Clean":o}</button>)}
          </div>
          <button style={bs(C.red,"outline")} onClick={onClose}>✕ Close</button>
        </div>
      </div>
      <div style={{flex:1,overflow:"auto",padding:20,display:"flex",flexDirection:"column",gap:10}}>
        <div style={cs({padding:"14px 12px 10px"})}>
          <CandleChart candles={candles} height={420} overlay={ov} showVolume={true}/>
        </div>
        <div style={cs({padding:"12px 12px 8px"})}>
          <RSIStrip candles={candles} height={80}/>
        </div>
      </div>
    </div>
  );
}

/* LiveCharts main tab */
function LiveCharts({prices}){
  const [market,setMarket]=useState("crypto");
  const [expanded,setExpanded]=useState(null);
  const [search,setSearch]=useState("");
  const symbols=CHART_MARKETS[market]||[];
  const filtered=search.trim()?symbols.filter(s=>s.tag.toLowerCase().includes(search.toLowerCase())||s.label.toLowerCase().includes(search.toLowerCase())):symbols;
  const MTABS=[{id:"crypto",label:"🪙 Crypto"},{id:"stocks",label:"📈 Stocks"},{id:"forex",label:"💱 Forex / Commodities"}];
  return(
    <div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <div style={{display:"flex",gap:4,background:C.surface,borderRadius:8,padding:4,border:`1px solid ${C.border}`}}>
          {MTABS.map(m=>(
            <button key={m.id} style={{background:m.id===market?C.amber:"transparent",color:m.id===market?"#fff":C.mutedHi,border:"none",borderRadius:6,padding:"5px 14px",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:MONO,transition:"all 0.15s"}} onClick={()=>{setMarket(m.id);setSearch("");}}>
              {m.label}
            </button>
          ))}
        </div>
        <input style={{...is,width:200}} placeholder={`Search ${market}…`} value={search} onChange={e=>setSearch(e.target.value)}/>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <span style={{color:C.muted,fontSize:10}}>Live candles via Binance WebSocket</span>
          <span style={{...bgs(C.green),fontSize:9}}><span style={{width:6,height:6,background:C.green,borderRadius:"50%",display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>LIVE</span>
        </div>
      </div>
      <div style={{padding:"8px 14px",background:C.surface,borderRadius:6,border:`1px solid ${C.border}`,fontSize:11,color:C.mutedHi}}>
        {market==="crypto"&&"Real-time OHLC candlestick charts — green candle = bullish (close > open), red candle = bearish (close < open). Click any chart to expand with full indicators."}
        {market==="stocks"&&"US equity charts powered by TradingView. Click any card to open the full interactive chart with all indicators."}
        {market==="forex"&&"Foreign exchange and commodity spot rates via TradingView. Includes Gold and Silver."}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
        {filtered.map(item=>(
          <MiniCandleCard key={item.sym} item={item} onClick={()=>setExpanded(item)}/>
        ))}
        {filtered.length===0&&<div style={{...cs(),gridColumn:"1/-1",textAlign:"center",color:C.muted,padding:40}}>No charts match "{search}"</div>}
      </div>
      {expanded&&expanded.tv&&<TVFullChart item={expanded} onClose={()=>setExpanded(null)}/>}
      {expanded&&!expanded.tv&&<CryptoFullChart item={expanded} onClose={()=>setExpanded(null)} prices={prices}/>}
    </div>
  );
}

/* ══ BACKTEST ════════════════════════════════════════════ */
function Backtest(){
  const[cfg,setCfg]=useState({strategy:"RSI_MACD",symbol:"BTCUSDT",interval:"1h",sl:2,tp:4,trail:1.5,tradeAmt:1000,balance:10000});
  const[res,setRes]=useState(null),[load,setLoad]=useState(false),[status,setStatus]=useState("");
  const run=async()=>{setLoad(true);setRes(null);setStatus("Fetching 500 candles from Binance…");const cs=await loadKlines(cfg.symbol,cfg.interval,500);if(cs.length<60){setLoad(false);setStatus("Not enough data.");return;}setStatus(`Simulating ${cs.length} candles with SL/TP/Trailing…`);await new Promise(r=>setTimeout(r,30));const r=runBacktest(cs,cfg.strategy,STRATS[cfg.strategy].defaults,{sl:cfg.sl,tp:cfg.tp,trail:cfg.trail},cfg.balance,cfg.tradeAmt);setRes(r);setLoad(false);setStatus("");};
  const rc=res?.ret>=0?C.green:C.red,eqD=(res?.equity||[]).filter((_,i)=>i%Math.max(1,Math.floor((res?.equity?.length||1)/80))===0);
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.text}}>Backtest Configuration</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        {[{lbl:"Strategy",key:"strategy",type:"sel",opts:Object.values(STRATS).map(s=>({v:s.id,l:`${s.icon} ${s.label}`}))},
          {lbl:"Symbol",key:"symbol",type:"sel",opts:CRYPTO_SYMS.map(s=>({v:s,l:s}))},
          {lbl:"Interval",key:"interval",type:"sel",opts:INTERVALS.map(i=>({v:i,l:i}))},
          {lbl:"Stop Loss %",key:"sl",step:0.5},{lbl:"Take Profit %",key:"tp",step:0.5},{lbl:"Trailing Stop %",key:"trail",step:0.5},
          {lbl:"Trade Amount ($)",key:"tradeAmt"},{lbl:"Starting Balance ($)",key:"balance"}].map(f=>(
          <div key={f.key}><label style={ls}>{f.lbl}</label>
            {f.type==="sel"?<select style={is} value={cfg[f.key]} onChange={e=>setCfg(p=>({...p,[f.key]:e.target.value}))}>{f.opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
            :<input style={is} type="number" step={f.step||1} value={cfg[f.key]} onChange={e=>setCfg(p=>({...p,[f.key]:+e.target.value}))}/>}
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:12,marginTop:14,alignItems:"center"}}>
        <button style={bs(C.amber)} onClick={run} disabled={load}>{load?"⟳ Running…":"▶ Run Backtest"}</button>
        {(status||(!load&&!res))&&<span style={{color:C.mutedHi,fontSize:11}}>{status||"Loads 500 candles · applies SL / TP / Trailing"}</span>}
      </div>
    </div>
    {res&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10}}>
        <Stat label="Total Return" value={fmtPct(res.ret)} color={rc} bg={res.ret>=0?C.greenBg:C.redBg}/>
        <Stat label="Final Equity" value={fmtUSD(res.finalEq)} color={C.amber} bg={C.amberBg}/>
        <Stat label="Win Rate" value={`${fmt(res.winRate)}%`} color={res.winRate>=50?C.green:C.red}/>
        <Stat label="Max Drawdown" value={`-${fmt(res.maxDD)}%`} color={C.orange}/>
        <Stat label="Sharpe" value={fmt(res.sharpe,3)} color={res.sharpe>=1?C.green:res.sharpe>=0?C.amber:C.red}/>
        <Stat label="Sortino" value={fmt(res.sortino,3)} color={res.sortino>=1?C.green:res.sortino>=0?C.amber:C.red}/>
        <Stat label="Trades" value={res.tradeCount} color={C.cyan}/>
      </div>
      <div style={cs({padding:"16px 16px 10px"})}>
        <div style={{fontWeight:600,fontSize:11,color:C.mutedHi,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Equity Curve</div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={eqD} margin={{top:4,right:5,left:0,bottom:4}}>
            <defs><linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={rc} stopOpacity={0.2}/><stop offset="95%" stopColor={rc} stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="t" tick={{fill:C.muted,fontSize:9}} interval={Math.floor(eqD.length/8)}/><YAxis tick={{fill:C.muted,fontSize:9}} tickFormatter={v=>fmtUSD(v)} width={72}/>
            <Tooltip formatter={v=>[fmtUSD(v),"Equity"]} contentStyle={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:MONO,fontSize:11}}/>
            <ReferenceLine y={cfg.balance} stroke={C.muted} strokeDasharray="4 2"/>
            <Area type="monotone" dataKey="v" stroke={rc} strokeWidth={2} fill="url(#eqG)"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div style={cs()}>
        <div style={{fontWeight:600,fontSize:11,color:C.mutedHi,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Trade Log ({res.trades.length} trades)</div>
        <table style={{width:"100%",borderCollapse:"collapse"}}><thead><tr>{["#","Date","Side","Reason","Price","P&L"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
          <tbody>{res.trades.slice(0,40).map((t,i)=>(
            <tr key={i} style={{background:t.side==="BUY"?`${C.green}05`:`${C.red}05`}}>
              <td style={{...TD,color:C.muted}}>{i+1}</td><td style={TD}>{t.date}</td>
              <td style={TD}><Sig s={t.side}/></td>
              <td style={{...TD,color:t.reason==="SL"?C.red:t.reason==="TP"?C.green:t.reason==="TRAIL"?C.orange:C.cyan,fontSize:10,fontWeight:600}}>{t.reason}</td>
              <td style={TD}>{fmtUSD(t.price)}</td>
              <td style={{...TD,color:t.pnl>0?C.green:t.pnl<0?C.red:C.muted,fontWeight:t.pnl?700:400}}>{t.pnl?fmtUSD(t.pnl):"—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </>}
  </div>);
}

/* ══ AI SIGNALS ══════════════════════════════════════════ */
function AISignals({prices,candles,onExecute}){
  const[sym,setSym]=useState("BTCUSDT"),[interval,setInterval]=useState("1h"),[load,setLoad]=useState(false),[sigs,setSigs]=useState([]),[auto,setAuto]=useState(false),[amt,setAmt]=useState(200);
  const analyze=async()=>{setLoad(true);let raw=candles[sym];if(!raw||raw.length<30)raw=await loadKlines(sym,interval,60);if(!raw||raw.length<20){setLoad(false);return;}
    const c=raw.map(d=>d.close),r=calcRSI(c),bb=calcBB(c),{line:ml,signal:sl}=calcMACD(c),n=c.length-1,price=prices[sym]?.price||c[n];
    const last20=raw.slice(-20).map(d=>({o:d.open.toFixed(2),h:d.high.toFixed(2),l:d.low.toFixed(2),c:d.close.toFixed(2)}));
    const prompt=`You are a professional crypto trading analyst. Analyze ${sym} on ${interval} timeframe.\nCurrent price: $${price}\nLast 20 candles OHLC: ${JSON.stringify(last20)}\nRSI(14): ${r[n]?.toFixed(2)}, MACD Line: ${ml[n]?.toFixed(6)}, BB Upper: $${bb[n]?.upper?.toFixed(2)}, Lower: $${bb[n]?.lower?.toFixed(2)}, EMA9: $${calcEMA(c,9)[n]?.toFixed(2)}, EMA21: $${calcEMA(c,21)[n]?.toFixed(2)}\nRespond ONLY in this exact JSON, no other text:\n{"signal":"BUY","confidence":7,"analysis":"2-sentence analysis.","entry":${price.toFixed(2)},"target":0,"stopLoss":0}`;
    try{const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:"claude-sonnet-4-20250514",max_tokens:400,messages:[{role:"user",content:prompt}]})});const data=await res.json();const text=data.content?.[0]?.text||"";const parsed=JSON.parse(text.replace(/```json|```/g,"").trim());const entry={...parsed,sym,interval,timestamp:Date.now(),price};setSigs(p=>[entry,...p.slice(0,9)]);if(auto&&parsed.signal!=="HOLD")onExecute(sym,parsed.signal,price,amt);}
    catch(e){setSigs(p=>[{signal:"ERROR",confidence:0,analysis:`Failed: ${e.message}`,sym,interval,timestamp:Date.now(),price},...p.slice(0,9)]);}
    setLoad(false);};
  const sc=s=>s==="BUY"?C.green:s==="SELL"?C.red:s==="HOLD"?C.cyan:C.muted;
  const scBg=s=>s==="BUY"?C.greenBg:s==="SELL"?C.redBg:s==="HOLD"?C.cyanBg:"transparent";
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{...cs(),borderColor:C.purpleBorder,background:C.purpleBg+"44"}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.purple}}>◈ AI Signal Engine — Powered by Claude Sonnet</div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div><label style={ls}>Symbol</label><select style={{...is,width:140}} value={sym} onChange={e=>setSym(e.target.value)}>{CRYPTO_SYMS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
        <div><label style={ls}>Interval</label><select style={{...is,width:100}} value={interval} onChange={e=>setInterval(e.target.value)}>{INTERVALS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
        <div><label style={ls}>Auto-Trade Amount ($)</label><input style={{...is,width:120}} type="number" value={amt} onChange={e=>setAmt(+e.target.value)}/></div>
        <div style={{display:"flex",flexDirection:"column",gap:4}}><label style={ls}>Auto-Execute</label>
          <div style={{display:"flex",gap:4}}><button style={{...bs(!auto?C.cyan:C.muted,!auto?"solid":"outline"),padding:"5px 12px"}} onClick={()=>setAuto(false)}>Off</button><button style={{...bs(auto?C.green:C.muted,auto?"solid":"outline"),padding:"5px 12px"}} onClick={()=>setAuto(true)}>On</button></div>
        </div>
        <button style={{...bs(C.purple),padding:"6px 20px"}} onClick={analyze} disabled={load}>{load?"⟳ Analyzing…":"◈ Get AI Signal"}</button>
      </div>
      {load&&<div style={{marginTop:14,padding:"10px 14px",background:C.purpleBg,borderRadius:6,fontSize:11,color:C.purple}}>Sending {sym} indicators to Claude Sonnet for analysis…</div>}
    </div>
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {sigs.map((s,i)=>(
        <div key={i} style={{...cs(),background:scBg(s.signal),borderColor:sc(s.signal)+"44"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <div style={{display:"flex",gap:14,alignItems:"center"}}>
              <div style={{textAlign:"center",minWidth:60,background:sc(s.signal)+"15",borderRadius:8,padding:"8px 12px"}}>
                <div style={{color:sc(s.signal),fontSize:18,fontWeight:900}}>{s.signal}</div>
                <div style={{color:C.muted,fontSize:9}}>{s.sym}·{s.interval}</div>
              </div>
              <div><div style={{color:C.mutedHi,fontSize:10,fontWeight:600,marginBottom:5}}>CONFIDENCE</div>
                <div style={{display:"flex",gap:2,alignItems:"center"}}>{Array.from({length:10},(_,j)=><div key={j} style={{width:12,height:12,borderRadius:2,background:j<(s.confidence||0)?sc(s.signal):C.border}}/>)}<span style={{color:sc(s.signal),marginLeft:6,fontWeight:700}}>{s.confidence}/10</span></div>
              </div>
            </div>
            <div style={{textAlign:"right"}}><div style={{color:C.muted,fontSize:10}}>Analyzed at</div><div style={{fontWeight:700,color:C.text}}>{fmtUSD(s.price)}</div><div style={{color:C.muted,fontSize:10}}>{tsStr(s.timestamp)}</div></div>
          </div>
          <div style={{color:C.text,fontSize:12,lineHeight:1.65,marginBottom:12,padding:"10px 14px",background:C.bg,borderRadius:6,borderLeft:`3px solid ${sc(s.signal)}`}}>{s.analysis}</div>
          {s.entry>0&&<div style={{display:"flex",gap:20,fontSize:11,alignItems:"center",flexWrap:"wrap"}}>
            <div><span style={{color:C.muted}}>Entry: </span><span style={{color:C.cyan,fontWeight:700}}>{fmtUSD(s.entry)}</span></div>
            {s.target>0&&<div><span style={{color:C.muted}}>Target: </span><span style={{color:C.green,fontWeight:700}}>{fmtUSD(s.target)}</span></div>}
            {s.stopLoss>0&&<div><span style={{color:C.muted}}>SL: </span><span style={{color:C.red,fontWeight:700}}>{fmtUSD(s.stopLoss)}</span></div>}
            {s.signal!=="HOLD"&&s.signal!=="ERROR"&&<button style={{...bs(sc(s.signal),"outline"),padding:"4px 14px",marginLeft:"auto"}} onClick={()=>onExecute(s.sym,s.signal,prices[s.sym]?.price||s.price,amt)}>Execute {s.signal}</button>}
          </div>}
        </div>
      ))}
      {!sigs.length&&<div style={{...cs(),textAlign:"center",color:C.muted,padding:48}}><div style={{fontSize:36,marginBottom:10}}>◈</div>No signals yet — click "Get AI Signal" to analyze</div>}
    </div>
  </div>);
}

/* ══ ANALYTICS ═══════════════════════════════════════════ */
function Analytics({trades,bots,portfolio}){
  const botStats=bots.map(bot=>{
    const bt=trades.filter(t=>t.botId===bot.id),sells=bt.filter(t=>t.side==="SELL"&&t.pnl!=null);
    const wins=sells.filter(t=>t.pnl>0),totalPnL=sells.reduce((s,t)=>s+t.pnl,0),winRate=sells.length?wins.length/sells.length*100:0;
    const rets=sells.map(t=>t.pnl/Math.max(t.amount,1)),meanR=rets.length?rets.reduce((a,b)=>a+b,0)/rets.length:0;
    const stdR=Math.sqrt(rets.reduce((a,r)=>a+(r-meanR)**2,0)/Math.max(rets.length,1));
    const downR=rets.filter(r=>r<0),downStd=Math.sqrt(downR.reduce((a,r)=>a+r**2,0)/Math.max(downR.length,1));
    let peak=0,maxDD=0,run=0;sells.forEach(t=>{run+=t.pnl;if(run>peak)peak=run;const dd=peak>0?(peak-run)/peak*100:0;if(dd>maxDD)maxDD=dd;});
    return{bot,total:bt.length,sells:sells.length,wins:wins.length,losses:sells.length-wins.length,totalPnL,winRate,sharpe:stdR>0?meanR/stdR*Math.sqrt(365):0,sortino:downStd>0?meanR/downStd*Math.sqrt(365):0,maxDD};
  });
  const now=new Date(),months=[];
  for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`,label:d.toLocaleDateString("en",{month:"short",year:"2-digit"})});}
  const monthly={};trades.filter(t=>t.pnl!=null&&t.side==="SELL").forEach(t=>{const k=dateKey(t.timestamp);if(monthly[k]===undefined)monthly[k]=0;monthly[k]+=t.pnl;});
  const maxAbs=Math.max(...months.map(m=>Math.abs(monthly[m.key]||0)),1);
  let running=portfolio.balance||10000;
  const eqCurve=trades.filter(t=>t.pnl!=null&&t.side==="SELL").sort((a,b)=>a.timestamp-b.timestamp).map(t=>{running+=t.pnl;return{t:new Date(t.timestamp).toLocaleDateString("en",{month:"short",day:"numeric"}),v:+running.toFixed(2)};});
  const closedTrades=trades.filter(t=>t.pnl!=null&&t.side==="SELL").sort((a,b)=>b.pnl-a.pnl);
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.text}}>Per-Bot Performance</div>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Bot","Strategy","Trades","Wins","Losses","Total P&L","Win Rate","Sharpe","Sortino","Max DD"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
        <tbody>{botStats.map(({bot,total,wins,losses,totalPnL,winRate,sharpe,sortino,maxDD})=>{
          const st=STRATS[bot.strategy];
          return(<tr key={bot.id}>
            <td style={{...TD,fontWeight:700,color:C.amber}}>{bot.id.slice(-6)}</td>
            <td style={{...TD,color:st?.color}}>{st?.icon} {st?.label}</td>
            <td style={TD}>{total}</td><td style={{...TD,color:C.green,fontWeight:600}}>{wins}</td><td style={{...TD,color:C.red,fontWeight:600}}>{losses}</td>
            <td style={{...TD,color:totalPnL>=0?C.green:C.red,fontWeight:700}}>{fmtUSD(totalPnL)}</td>
            <td style={{...TD,color:winRate>=50?C.green:C.red}}>{fmt(winRate)}%</td>
            <td style={{...TD,color:sharpe>=1?C.green:sharpe>=0?C.amber:C.red}}>{fmt(sharpe,3)}</td>
            <td style={{...TD,color:sortino>=1?C.green:sortino>=0?C.amber:C.red}}>{fmt(sortino,3)}</td>
            <td style={{...TD,color:C.orange}}>-{fmt(maxDD)}%</td>
          </tr>);
        })}
        {!botStats.length&&<tr><td colSpan={10} style={{...TD,textAlign:"center",color:C.muted,padding:28}}>No bots created yet</td></tr>}
        </tbody>
      </table>
    </div>
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.text}}>Monthly P&L Heatmap</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8}}>
        {months.map(m=>{const v=monthly[m.key]||0,intensity=Math.min(Math.abs(v)/maxAbs,1),bg=v>0?`rgba(22,163,74,${0.08+intensity*0.35})`:v<0?`rgba(220,38,38,${0.08+intensity*0.35})`:`${C.surface}`;
          return(<div key={m.key} style={{background:bg,border:`1px solid ${v>0?C.greenBorder:v<0?C.redBorder:C.border}`,borderRadius:6,padding:"10px 8px",textAlign:"center"}}>
            <div style={{color:C.muted,fontSize:10,marginBottom:4,fontWeight:600}}>{m.label}</div>
            <div style={{color:v>0?C.green:v<0?C.red:C.muted,fontWeight:700,fontSize:13}}>{v?fmtUSD(v):"—"}</div>
          </div>);
        })}
      </div>
    </div>
    {eqCurve.length>1&&<div style={cs({padding:"14px 16px 10px"})}>
      <div style={{fontWeight:600,fontSize:11,color:C.mutedHi,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Cumulative P&L Curve</div>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={eqCurve} margin={{top:4,right:5,left:0,bottom:4}}>
          <defs><linearGradient id="aqG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={C.cyan} stopOpacity={0.2}/><stop offset="95%" stopColor={C.cyan} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="t" tick={{fill:C.muted,fontSize:9}} interval={Math.max(1,Math.floor(eqCurve.length/8))}/><YAxis tick={{fill:C.muted,fontSize:9}} tickFormatter={v=>fmtUSD(v)} width={72}/>
          <Tooltip formatter={v=>[fmtUSD(v),"Equity"]} contentStyle={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:MONO,fontSize:11}}/>
          <Area type="monotone" dataKey="v" stroke={C.cyan} strokeWidth={2} fill="url(#aqG)"/>
        </AreaChart>
      </ResponsiveContainer>
    </div>}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
      {[{title:"🏆 Best Trades",data:closedTrades.slice(0,3),col:C.green,bg:C.greenBg},{title:"💀 Worst Trades",data:closedTrades.slice(-3).reverse(),col:C.red,bg:C.redBg}].map(({title,data,col,bg})=>(
        <div key={title} style={{...cs(),background:bg+"44"}}>
          <div style={{color:col,fontWeight:700,fontSize:12,marginBottom:12}}>{title}</div>
          {data.length?data.map((t,i)=>(
            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              <div><div style={{fontWeight:700,fontSize:11}}>{short(t.symbol)}</div><div style={{color:C.muted,fontSize:10}}>{STRATS[t.strategy]?.label} · {new Date(t.timestamp).toLocaleDateString("en",{month:"short",day:"numeric"})}</div></div>
              <div style={{color:col,fontWeight:800,fontSize:14}}>{fmtUSD(t.pnl)}</div>
            </div>
          )):<div style={{color:C.muted,fontSize:11,padding:"16px 0",textAlign:"center"}}>No closed trades yet</div>}
        </div>
      ))}
    </div>
  </div>);
}

/* ══ ALERTS ══════════════════════════════════════════════ */
function Alerts({prices,alerts,setAlerts,alertLog}){
  const[form,setForm]=useState({symbol:"BTCUSDT",dir:"above",price:"",note:""});
  const[notifPerm,setNP]=useState(typeof Notification!=="undefined"?Notification.permission:"denied");
  const reqNotif=async()=>{if(typeof Notification==="undefined")return;const p=await Notification.requestPermission();setNP(p);};
  const addAlert=()=>{if(!form.price)return;setAlerts(p=>[...p,{...form,price:+form.price,id:`al_${Date.now()}`,active:true,triggered:false,created:Date.now()}]);setForm(p=>({...p,price:"",note:""}));};
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{...cs(),background:notifPerm==="granted"?C.greenBg:C.amberBg,borderColor:notifPerm==="granted"?C.greenBorder:C.amberBorder}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div><div style={{color:notifPerm==="granted"?C.green:C.amber,fontWeight:700,marginBottom:4}}>🔔 Browser Notifications — {notifPerm==="granted"?"Enabled":"Disabled"}</div>
          <div style={{color:C.mutedHi,fontSize:11}}>{notifPerm==="granted"?"Alerts will fire as browser notifications even when tab is in background.":"Enable to receive price alerts outside this tab."}</div>
        </div>
        {notifPerm!=="granted"&&<button style={bs(C.amber)} onClick={reqNotif}>Enable</button>}
      </div>
    </div>
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.text}}>Create Price Alert</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        <div><label style={ls}>Symbol</label><select style={is} value={form.symbol} onChange={e=>setForm(p=>({...p,symbol:e.target.value}))}>{CRYPTO_SYMS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
        <div><label style={ls}>Direction</label><select style={is} value={form.dir} onChange={e=>setForm(p=>({...p,dir:e.target.value}))}><option value="above">Crosses Above</option><option value="below">Drops Below</option></select></div>
        <div><label style={ls}>Target Price ($)</label><input style={is} type="number" value={form.price} placeholder={prices[form.symbol]?.price?prices[form.symbol].price.toFixed(2):"e.g. 50000"} onChange={e=>setForm(p=>({...p,price:e.target.value}))}/></div>
        <div><label style={ls}>Note (optional)</label><input style={is} type="text" value={form.note} placeholder="e.g. breakout level" onChange={e=>setForm(p=>({...p,note:e.target.value}))}/></div>
      </div>
      {prices[form.symbol]?.price&&<div style={{marginTop:8,color:C.mutedHi,fontSize:11}}>Current: <span style={{fontWeight:700,color:C.text}}>{fmtUSD(prices[form.symbol].price)}</span></div>}
      <div style={{marginTop:14}}><button style={bs(C.amber)} onClick={addAlert}>+ Add Alert</button></div>
    </div>
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:C.text}}>Active Alerts ({alerts.filter(a=>a.active&&!a.triggered).length} watching)</div>
      {alerts.length?(<table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["Symbol","Condition","Current","Status","Note",""].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
        <tbody>{alerts.map(a=>{const curr=prices[a.symbol]?.price;return(<tr key={a.id}>
          <td style={{...TD,fontWeight:700}}>{short(a.symbol)}</td>
          <td style={TD}><span style={{color:a.dir==="above"?C.green:C.red,fontWeight:600}}>{a.dir==="above"?"▲ Above":"▼ Below"}</span> <span style={{fontWeight:700}}>{fmtUSD(a.price)}</span></td>
          <td style={TD}>{curr?fmtUSD(curr):"…"}</td>
          <td style={TD}>{a.triggered?<span style={bgs(C.orange)}>✓ Triggered</span>:a.active?<span style={bgs(C.green)}>● Watching</span>:<span style={bgs(C.muted)}>Paused</span>}</td>
          <td style={{...TD,color:C.muted,fontSize:10}}>{a.note||"—"}</td>
          <td style={TD}><div style={{display:"flex",gap:4}}>
            <button style={{...bs(a.active?C.muted:C.cyan,"outline"),padding:"2px 8px",fontSize:9}} onClick={()=>setAlerts(p=>p.map(x=>x.id===a.id?{...x,active:!x.active,triggered:false}:x))}>{a.active?"Pause":"Resume"}</button>
            <button style={{...bs(C.red,"outline"),padding:"2px 8px",fontSize:9}} onClick={()=>setAlerts(p=>p.filter(x=>x.id!==a.id))}>✕</button>
          </div></td>
        </tr>);})}
        </tbody>
      </table>):<div style={{color:C.muted,fontSize:11,textAlign:"center",padding:24}}>No alerts set.</div>}
    </div>
    {alertLog.length>0&&<div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:12,color:C.text}}>Alert Log ({alertLog.length})</div>
      {alertLog.slice(0,20).map((a,i)=>(
        <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:a.dir==="above"?C.greenBg:C.redBg,borderRadius:6,border:`1px solid ${a.dir==="above"?C.greenBorder:C.redBorder}`,marginBottom:6}}>
          <div><span style={{fontWeight:700,marginRight:8}}>{short(a.symbol)}</span><span style={{fontSize:11}}>{a.dir==="above"?"crossed above":"dropped below"} {fmtUSD(a.price)}</span>{a.note&&<span style={{color:C.muted,fontSize:10,marginLeft:8}}>— {a.note}</span>}</div>
          <div style={{color:C.muted,fontSize:10}}>{new Date(a.triggeredAt).toLocaleString("en",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})}</div>
        </div>
      ))}
    </div>}
  </div>);
}

/* ══ NEWS & SENTIMENT ════════════════════════════════════ */
function NewsSentiment(){
  const[fng,setFng]=useState(null),[news,setNews]=useState([]),[load,setLoad]=useState(false),[filter,setFilter]=useState("ALL");
  const refresh=async()=>{setLoad(true);const[f,n]=await Promise.all([loadFearGreed(),loadCryptoNews()]);if(f)setFng(f);if(n.length)setNews(n);setLoad(false);};
  useEffect(()=>{refresh();},[]);
  const fngVal=fng?.[0]?.value,fngLabel=fng?.[0]?.value_classification||"—";
  const fngColor=fngVal>75?C.green:fngVal>55?C.amber:fngVal>35?C.orange:C.red;
  const sentCats=["ALL","BTC","ETH","Altcoin","Exchange","Technology","Regulation"];
  const filtered=news.filter(n=>filter==="ALL"||n.categories?.toUpperCase().includes(filter.toUpperCase()));
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontWeight:700,fontSize:13,color:C.text}}>News & Market Sentiment</div>
      <button style={bs(C.cyan,"outline")} onClick={refresh} disabled={load}>{load?"⟳ Loading…":"↻ Refresh"}</button>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"260px 1fr",gap:14}}>
      <div style={{...cs(),textAlign:"center"}}>
        <div style={{fontWeight:600,fontSize:11,color:C.mutedHi,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:16}}>Crypto Fear & Greed Index</div>
        {fng?(<>
          <div style={{position:"relative",width:150,height:85,margin:"0 auto 14px"}}>
            <svg viewBox="0 0 150 85" width="150" height="85">
              <path d="M10 75 A65 65 0 0 1 140 75" fill="none" stroke={C.border} strokeWidth={14} strokeLinecap="round"/>
              <path d="M10 75 A65 65 0 0 1 140 75" fill="none" stroke={fngColor} strokeWidth={14} strokeLinecap="round" strokeDasharray={`${(fngVal/100)*204} 204`}/>
              <text x="75" y="68" textAnchor="middle" fontSize="26" fontWeight="800" fill={fngColor} fontFamily={MONO}>{fngVal}</text>
            </svg>
          </div>
          <div style={{color:fngColor,fontSize:15,fontWeight:800,marginBottom:4}}>{fngLabel}</div>
          <div style={{color:C.muted,fontSize:10,marginBottom:14}}>{new Date(+fng[0].timestamp*1000).toLocaleDateString()}</div>
          <div style={{display:"flex",gap:3,justifyContent:"center"}}>
            {fng.slice(0,7).reverse().map((d,i)=>{const v=+d.value,col=v>75?C.green:v>55?C.amber:v>35?C.orange:C.red;return(<div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <div style={{width:16,background:col,borderRadius:2,height:`${Math.max(4,v*0.38)}px`,opacity:0.85}}/>
              <div style={{color:C.muted,fontSize:8}}>{new Date(+d.timestamp*1000).toLocaleDateString("en",{weekday:"narrow"})}</div>
            </div>);})}
          </div>
          <div style={{color:C.muted,fontSize:9,marginTop:6}}>7-day trend</div>
        </>):<div style={{color:C.muted,fontSize:12,padding:24}}>Loading…</div>}
      </div>
      <div style={cs()}>
        <div style={{fontWeight:600,fontSize:11,color:C.mutedHi,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:12}}>Latest Crypto News</div>
        <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
          {sentCats.map(cat=><button key={cat} style={{background:cat===filter?C.cyan:"transparent",color:cat===filter?"#fff":C.mutedHi,border:`1px solid ${cat===filter?C.cyan:C.border}`,borderRadius:4,padding:"3px 10px",cursor:"pointer",fontSize:10,fontWeight:600,fontFamily:MONO}} onClick={()=>setFilter(cat)}>{cat}</button>)}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:360,overflowY:"auto"}}>
          {filtered.slice(0,12).map((n,i)=>(
            <div key={i} style={{padding:"10px 12px",background:C.surface,borderRadius:6,border:`1px solid ${C.border}`,cursor:"pointer"}} onClick={()=>window.open(n.url,"_blank")}>
              <div style={{fontWeight:600,fontSize:12,marginBottom:4,lineHeight:1.4,color:C.text}}>{n.title}</div>
              <div style={{display:"flex",gap:10,fontSize:10,color:C.muted}}>
                <span style={{color:C.cyan,fontWeight:600}}>{n.source_info?.name||n.source}</span>
                <span>{new Date(n.published_on*1000).toLocaleDateString("en",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})}</span>
                {n.categories&&<span>{n.categories.split("|").slice(0,2).join(" · ")}</span>}
              </div>
            </div>
          ))}
          {!filtered.length&&<div style={{color:C.muted,fontSize:11,textAlign:"center",padding:24}}>{load?"Loading news…":"No news for this filter."}</div>}
        </div>
      </div>
    </div>
  </div>);
}

/* ══ STRATEGY BUILDER ════════════════════════════════════ */
const IND_OPTS=[{v:"RSI",l:"RSI",hasP:true,pDef:14},{v:"MACD_LINE",l:"MACD Line",hasP:false},{v:"MACD_HIST",l:"MACD Histogram",hasP:false},{v:"BB_UPPER",l:"BB Upper",hasP:true,pDef:20},{v:"BB_LOWER",l:"BB Lower",hasP:true,pDef:20},{v:"EMA",l:"EMA",hasP:true,pDef:9},{v:"SMA",l:"SMA",hasP:true,pDef:20},{v:"PRICE",l:"Close Price",hasP:false},{v:"VOLUME",l:"Volume",hasP:false}];
const OP_OPTS=[{v:">",l:">"},{v:"<",l:"<"},{v:">=",l:">="},{v:"<=",l:"<="},{v:"CROSSES_ABOVE",l:"crosses above"},{v:"CROSSES_BELOW",l:"crosses below"}];
const mkCond=()=>({indicator:"RSI",period:14,operator:"<",value:30,id:Date.now()});
function CondRow({cond,onChange,onRemove}){
  const ind=IND_OPTS.find(o=>o.v===cond.indicator);
  return(<div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 12px",background:C.surface,borderRadius:6,marginBottom:6,border:`1px solid ${C.border}`}}>
    <select style={{...is,width:160,flex:2}} value={cond.indicator} onChange={e=>onChange({...cond,indicator:e.target.value,period:IND_OPTS.find(o=>o.v===e.target.value)?.pDef||14})}>{IND_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
    {ind?.hasP&&<><span style={{color:C.muted,fontSize:10,whiteSpace:"nowrap",fontWeight:600}}>period</span><input style={{...is,width:60}} type="number" value={cond.period||14} onChange={e=>onChange({...cond,period:+e.target.value})}/></>}
    <select style={{...is,width:140,flex:1}} value={cond.operator} onChange={e=>onChange({...cond,operator:e.target.value})}>{OP_OPTS.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
    <input style={{...is,width:90}} type="number" value={cond.value} step="0.1" onChange={e=>onChange({...cond,value:+e.target.value})}/>
    <button style={{...bs(C.red,"outline"),padding:"4px 8px"}} onClick={onRemove}>✕</button>
  </div>);
}
function StrategyBuilder({onDeployCustomBot}){
  const[name,setName]=useState("My Custom Strategy");
  const[buyConds,setBuyConds]=useState([mkCond()]);
  const[sellConds,setSellConds]=useState([{...mkCond(),operator:">",value:70}]);
  const[buyLogic,setBuyLogic]=useState("AND"),[sellLogic,setSellLogic]=useState("OR");
  const[btSym,setBtSym]=useState("BTCUSDT"),[btIv,setBtIv]=useState("1h");
  const[btRes,setBtRes]=useState(null),[btLoad,setBtLoad]=useState(false);
  const[deployAmt,setDeployAmt]=useState(100),[deployIv,setDeployIv]=useState("1h");
  const updBuy=(i,c)=>setBuyConds(p=>p.map((x,j)=>j===i?c:x));
  const updSell=(i,c)=>setSellConds(p=>p.map((x,j)=>j===i?c:x));
  const testBT=async()=>{setBtLoad(true);setBtRes(null);const cs=await loadKlines(btSym,btIv,400);if(cs.length<60){setBtLoad(false);return;}
    STRATS.CUSTOM_TEST={...STRATS.CUSTOM,run:(c)=>runCustomStrat(c,buyConds,sellConds,buyLogic,sellLogic)};
    const r=runBacktest(cs,"CUSTOM_TEST",{buyConds,sellConds,buyLogic,sellLogic},{sl:2,tp:4,trail:1.5},10000,500);
    delete STRATS.CUSTOM_TEST;setBtRes(r);setBtLoad(false);};
  const deploy=()=>{onDeployCustomBot({name,buyConds,sellConds,buyLogic,sellLogic,symbol:btSym,interval:deployIv,amount:deployAmt});};
  const rc=btRes?.ret>=0?C.green:C.red;
  const eqD=(btRes?.equity||[]).filter((_,i)=>i%Math.max(1,Math.floor((btRes?.equity?.length||1)/60))===0);
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{...cs(),borderColor:C.purpleBorder,background:C.purpleBg+"33"}}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.purple}}>🔧 Visual Strategy Builder — No-Code Rule Editor</div>
      <div style={{marginBottom:14}}><label style={ls}>Strategy Name</label><input style={{...is,maxWidth:320}} value={name} onChange={e=>setName(e.target.value)}/></div>
      {/* BUY */}
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{color:C.green,fontWeight:700,fontSize:12}}>▲ BUY Conditions</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span style={{color:C.muted,fontSize:10,fontWeight:600}}>Logic:</span>
            {["AND","OR"].map(l=><button key={l} style={{background:buyLogic===l?C.green:"transparent",color:buyLogic===l?"#fff":C.mutedHi,border:`1px solid ${buyLogic===l?C.green:C.border}`,borderRadius:4,padding:"3px 10px",cursor:"pointer",fontSize:10,fontFamily:MONO}} onClick={()=>setBuyLogic(l)}>{l}</button>)}
            <button style={bs(C.green,"outline")} onClick={()=>setBuyConds(p=>[...p,mkCond()])}>+ Add</button>
          </div>
        </div>
        {buyConds.map((c,i)=><CondRow key={c.id} cond={c} onChange={nc=>updBuy(i,nc)} onRemove={()=>setBuyConds(p=>p.filter((_,j)=>j!==i))}/>)}
        <div style={{color:C.muted,fontSize:10,padding:"4px 12px"}}>Fires BUY when {buyLogic==="AND"?"ALL":"ANY"} conditions are met.</div>
      </div>
      {/* SELL */}
      <div style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <div style={{color:C.red,fontWeight:700,fontSize:12}}>▼ SELL Conditions</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <span style={{color:C.muted,fontSize:10,fontWeight:600}}>Logic:</span>
            {["AND","OR"].map(l=><button key={l} style={{background:sellLogic===l?C.red:"transparent",color:sellLogic===l?"#fff":C.mutedHi,border:`1px solid ${sellLogic===l?C.red:C.border}`,borderRadius:4,padding:"3px 10px",cursor:"pointer",fontSize:10,fontFamily:MONO}} onClick={()=>setSellLogic(l)}>{l}</button>)}
            <button style={bs(C.red,"outline")} onClick={()=>setSellConds(p=>[...p,{...mkCond(),operator:">",value:70}])}>+ Add</button>
          </div>
        </div>
        {sellConds.map((c,i)=><CondRow key={c.id} cond={c} onChange={nc=>updSell(i,nc)} onRemove={()=>setSellConds(p=>p.filter((_,j)=>j!==i))}/>)}
        <div style={{color:C.muted,fontSize:10,padding:"4px 12px"}}>Fires SELL when {sellLogic==="AND"?"ALL":"ANY"} conditions are met.</div>
      </div>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div>
          <div style={{fontWeight:600,fontSize:11,color:C.cyan,marginBottom:10}}>Test Strategy</div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <div style={{flex:1}}><label style={ls}>Symbol</label><select style={is} value={btSym} onChange={e=>setBtSym(e.target.value)}>{CRYPTO_SYMS.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div style={{flex:1}}><label style={ls}>Interval</label><select style={is} value={btIv} onChange={e=>setBtIv(e.target.value)}>{INTERVALS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
          </div>
          <button style={bs(C.cyan)} onClick={testBT} disabled={btLoad}>{btLoad?"⟳ Testing…":"▶ Run Backtest"}</button>
        </div>
        <div>
          <div style={{fontWeight:600,fontSize:11,color:C.purple,marginBottom:10}}>Deploy as Bot</div>
          <div style={{display:"flex",gap:8,marginBottom:8}}>
            <div style={{flex:1}}><label style={ls}>Amount ($)</label><input style={is} type="number" value={deployAmt} onChange={e=>setDeployAmt(+e.target.value)}/></div>
            <div style={{flex:1}}><label style={ls}>Interval</label><select style={is} value={deployIv} onChange={e=>setDeployIv(e.target.value)}>{INTERVALS.map(i=><option key={i} value={i}>{i}</option>)}</select></div>
          </div>
          <button style={bs(C.purple)} onClick={deploy}>🚀 Deploy Bot</button>
        </div>
      </div>
    </div>
    {btRes&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10}}>
        <Stat label="Return" value={fmtPct(btRes.ret)} color={rc} bg={btRes.ret>=0?C.greenBg:C.redBg}/>
        <Stat label="Final Equity" value={fmtUSD(btRes.finalEq)} color={C.amber} bg={C.amberBg}/>
        <Stat label="Win Rate" value={`${fmt(btRes.winRate)}%`} color={btRes.winRate>=50?C.green:C.red}/>
        <Stat label="Max DD" value={`-${fmt(btRes.maxDD)}%`} color={C.orange}/>
        <Stat label="Sharpe" value={fmt(btRes.sharpe,3)} color={btRes.sharpe>=1?C.green:C.amber}/>
        <Stat label="Trades" value={btRes.tradeCount} color={C.cyan}/>
      </div>
      <div style={cs({padding:"14px 16px 10px"})}>
        <div style={{fontWeight:600,fontSize:11,color:C.mutedHi,marginBottom:10}}>Custom Strategy Equity Curve</div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={eqD} margin={{top:4,right:5,left:0,bottom:4}}>
            <defs><linearGradient id="sbG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={rc} stopOpacity={0.2}/><stop offset="95%" stopColor={rc} stopOpacity={0}/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/><XAxis dataKey="t" tick={{fill:C.muted,fontSize:9}} interval={Math.max(1,Math.floor(eqD.length/8))}/><YAxis tick={{fill:C.muted,fontSize:9}} tickFormatter={v=>fmtUSD(v)} width={72}/>
            <Tooltip formatter={v=>[fmtUSD(v),"Equity"]} contentStyle={{background:C.bg,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:MONO,fontSize:11}}/>
            <Area type="monotone" dataKey="v" stroke={rc} strokeWidth={2} fill="url(#sbG)"/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>}
  </div>);
}

/* ══ TRADE HISTORY ═══════════════════════════════════════ */
function TradeHistory({trades}){
  const[fSym,setFS]=useState("ALL"),[fSide,setFSi]=useState("ALL"),[fExit,setFE]=useState("ALL");
  const filtered=trades.filter(t=>(fSym==="ALL"||t.symbol===fSym)&&(fSide==="ALL"||t.side===fSide)&&(fExit==="ALL"||(t.exitReason||"SIGNAL")===fExit));
  const totalPnL=filtered.reduce((s,t)=>s+(t.pnl||0),0),wins=filtered.filter(t=>t.pnl>0).length,losses=filtered.filter(t=>t.pnl<0).length;
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14}}>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
      <select style={{...is,width:"auto"}} value={fSym} onChange={e=>setFS(e.target.value)}><option value="ALL">All Symbols</option>{CRYPTO_SYMS.map(s=><option key={s} value={s}>{s}</option>)}</select>
      <select style={{...is,width:"auto"}} value={fSide} onChange={e=>setFSi(e.target.value)}><option value="ALL">All Sides</option><option value="BUY">BUY</option><option value="SELL">SELL</option></select>
      <select style={{...is,width:"auto"}} value={fExit} onChange={e=>setFE(e.target.value)}><option value="ALL">All Exits</option><option value="SIGNAL">Signal</option><option value="SL">Stop Loss</option><option value="TP">Take Profit</option><option value="TRAIL">Trailing</option><option value="AI_SIGNAL">AI Signal</option></select>
      <div style={{marginLeft:"auto",display:"flex",gap:16,fontSize:11,fontWeight:600}}>
        <span style={{color:C.muted}}>Showing {filtered.length}</span>
        <span style={{color:C.green}}>Wins: {wins}</span><span style={{color:C.red}}>Losses: {losses}</span>
        <span style={{color:totalPnL>=0?C.green:C.red}}>P&L: {fmtUSD(totalPnL)}</span>
      </div>
    </div>
    <div style={cs()}>
      <table style={{width:"100%",borderCollapse:"collapse"}}>
        <thead><tr>{["#","DateTime","Pair","Side","Strategy","Price","Amount","P&L","Exit"].map(h=><th key={h} style={TH}>{h}</th>)}</tr></thead>
        <tbody>
          {filtered.map((t,i)=>(<tr key={t.id} style={{background:t.side==="BUY"?`${C.green}04`:`${C.red}04`}}>
            <td style={{...TD,color:C.muted}}>{filtered.length-i}</td>
            <td style={{...TD,color:C.muted,fontSize:10}}>{new Date(t.timestamp).toLocaleString("en",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false})}</td>
            <td style={{...TD,fontWeight:700}}>{short(t.symbol)}</td>
            <td style={TD}><Sig s={t.side}/></td>
            <td style={{...TD,color:STRATS[t.strategy]?.color||C.purple,fontSize:10,fontWeight:600}}>{STRATS[t.strategy]?.icon} {STRATS[t.strategy]?.label||t.strategy}</td>
            <td style={TD}>{fmtUSD(t.price)}</td><td style={TD}>{fmtUSD(t.amount)}</td>
            <td style={{...TD,color:t.pnl>0?C.green:t.pnl<0?C.red:C.muted,fontWeight:t.pnl?700:400}}>{t.pnl!=null?fmtUSD(t.pnl):"—"}</td>
            <td style={{...TD,fontSize:10,fontWeight:600,color:t.exitReason==="SL"?C.red:t.exitReason==="TP"?C.green:t.exitReason==="TRAIL"?C.orange:t.exitReason?.startsWith("AI")?C.purple:C.muted}}>{t.exitReason||"SIGNAL"}</td>
          </tr>))}
          {!filtered.length&&<tr><td colSpan={9} style={{...TD,textAlign:"center",color:C.muted,padding:28}}>No trades match filters</td></tr>}
        </tbody>
      </table>
    </div>
  </div>);
}

/* ══ SETTINGS ════════════════════════════════════════════ */
function Settings({apiKeys,setApiKeys,setPortfolio}){
  const[keys,setKeys]=useState(apiKeys),[reveal,setReveal]=useState(false),[balData,setBalData]=useState(null),[balLoad,setBL]=useState(false),[orderResult,setOR]=useState(null),[resetBal,setRB]=useState(10000);
  const fetchBal=async()=>{setBL(true);const d=await getBinanceBalance(keys.key,keys.secret);setBalData(d);setBL(false);};
  const testOrder=async(sym,side)=>{const r=await placeBinanceOrder(keys.key,keys.secret,sym,side,10);setOR(r);};
  return(<div style={{padding:20,display:"flex",flexDirection:"column",gap:14,maxWidth:860}}>
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.text}}>Exchange API Configuration</div>
      <div style={{marginBottom:14,padding:"10px 14px",background:C.redBg,border:`1px solid ${C.redBorder}`,borderRadius:6,fontSize:11,color:C.red,lineHeight:1.7}}>⚠ Security: For production live trading, sign API requests server-side only. For testing, enable IP restrictions on your Binance API key.</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginBottom:14}}>
        <div><label style={ls}>Exchange</label><select style={is} value={keys.exchange} onChange={e=>setKeys(p=>({...p,exchange:e.target.value}))}>{EXCHANGES.map(e=><option key={e} value={e}>{e}</option>)}</select></div>
        <div><label style={ls}>API Key</label><input style={is} type={reveal?"text":"password"} value={keys.key} placeholder="Enter API key…" onChange={e=>setKeys(p=>({...p,key:e.target.value}))}/></div>
        <div><label style={ls}>API Secret</label><input style={is} type={reveal?"text":"password"} value={keys.secret} placeholder="Enter secret…" onChange={e=>setKeys(p=>({...p,secret:e.target.value}))}/></div>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <button style={bs(C.amber)} onClick={()=>setApiKeys(keys)}>Save Config</button>
        <button style={bs(C.muted,"outline")} onClick={()=>setReveal(p=>!p)}>{reveal?"Hide":"Show"} Keys</button>
        <button style={bs(C.cyan,"outline")} onClick={fetchBal} disabled={balLoad}>{balLoad?"⟳ Loading…":"Fetch Balance"}</button>
        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          <span style={{color:C.muted,fontSize:11}}>Mode:</span>
          <button style={{...bs(!keys.live?C.cyan:C.muted,!keys.live?"solid":"outline"),padding:"5px 14px"}} onClick={()=>setKeys(p=>({...p,live:false}))}>Paper</button>
          <button style={{...bs(keys.live?C.red:C.muted,keys.live?"solid":"outline"),padding:"5px 14px"}} onClick={()=>{if(window.confirm("Switch to LIVE trading? Real funds will be used."))setKeys(p=>({...p,live:true}));}}>Live</button>
        </div>
      </div>
      {balData&&<div style={{marginTop:14,padding:12,background:C.surface,borderRadius:6}}><div style={{color:C.green,fontWeight:700,fontSize:11,marginBottom:8}}>Live Account Balances</div><div style={{display:"flex",gap:10,flexWrap:"wrap"}}>{balData.map(b=><div key={b.asset} style={{padding:"6px 12px",background:C.bg,borderRadius:6,border:`1px solid ${C.border}`}}><div style={{color:C.amber,fontWeight:700,fontSize:11}}>{b.asset}</div><div style={{fontSize:12,marginTop:2}}>{parseFloat(b.free).toFixed(6)}</div></div>)}</div></div>}
    </div>
    {keys.live&&<div style={{...cs(),borderColor:C.redBorder,background:C.redBg+"44"}}>
      <div style={{color:C.red,fontWeight:700,marginBottom:12}}>⚡ Live Order Test — $10 USDT market orders</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>{CRYPTO_SYMS.slice(0,4).map(sym=><div key={sym} style={{display:"flex",gap:4}}><button style={bs(C.green)} onClick={()=>testOrder(sym,"BUY")}>Buy {short(sym)}</button><button style={bs(C.red)} onClick={()=>testOrder(sym,"SELL")}>Sell {short(sym)}</button></div>)}</div>
      {orderResult&&<pre style={{padding:10,background:C.bg,borderRadius:6,fontSize:10,color:C.green,overflow:"auto",maxHeight:200,border:`1px solid ${C.border}`}}>{JSON.stringify(orderResult,null,2)}</pre>}
    </div>}
    <div style={cs()}>
      <div style={{fontWeight:700,fontSize:13,marginBottom:14,color:C.text}}>Paper Account Reset</div>
      <div style={{display:"flex",gap:12,alignItems:"flex-end"}}>
        <div style={{flex:1}}><label style={ls}>Starting Balance (USDT)</label><input style={is} type="number" value={resetBal} onChange={e=>setRB(+e.target.value)}/></div>
        <button style={bs(C.orange,"outline")} onClick={()=>{if(window.confirm(`Reset to $${resetBal.toLocaleString()}?`))setPortfolio({balance:resetBal,positions:{},totalPnL:0});}}>Reset Account</button>
      </div>
    </div>
  </div>);
}

/* ══ ROOT APP ════════════════════════════════════════════ */
export default function TradingBot(){
  const[tab,setTab]=useState("dashboard");
  const[bots,setBots]=useState([]);
  const[trades,setTrades]=useState([]);
  const[portfolio,setPortfolio]=useState({balance:10000,positions:{},totalPnL:0});
  const[prices,setPrices]=useState({});
  const[candles,setCandles]=useState({});
  const[priceDir,setPriceDir]=useState({});
  const[apiKeys,setApiKeys]=useState({exchange:"Binance",key:"",secret:"",live:false});
  const[alerts,setAlerts]=useState([]);
  const[alertLog,setAlertLog]=useState([]);

  const candlesRef=useRef({});const pricesRef=useRef({});const botsRef=useRef([]);
  const portfolioRef=useRef(portfolio);const alertsRef=useRef([]);
  const timersRef=useRef({});const prevPriceRef=useRef({});

  useEffect(()=>{candlesRef.current=candles;},[candles]);
  useEffect(()=>{pricesRef.current=prices;},[prices]);
  useEffect(()=>{botsRef.current=bots;},[bots]);
  useEffect(()=>{portfolioRef.current=portfolio;},[portfolio]);
  useEffect(()=>{alertsRef.current=alerts;},[alerts]);

  /* Boot: load candles */
  useEffect(()=>{
    CRYPTO_SYMS.forEach(sym=>{
      loadKlines(sym,"1h",120).then(data=>{
        if(!data.length)return;
        setCandles(p=>({...p,[sym]:data}));
        const last=data[data.length-1],first=data[0];
        setPrices(p=>({...p,[sym]:{price:last.close,change24h:(last.close-first.close)/first.close*100}}));
      });
    });
  },[]);

  /* WebSocket: live prices + price direction flash + alert checking */
  useEffect(()=>{
    const streams=CRYPTO_SYMS.map(s=>`${s.toLowerCase()}@miniTicker`).join("/");
    let ws;
    try{
      ws=new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      ws.onmessage=e=>{
        try{
          const{data:d}=JSON.parse(e.data);if(!d?.s)return;
          const newPrice=parseFloat(d.c),sym=d.s,prev=prevPriceRef.current[sym];
          const dir=prev?newPrice>prev?"up":newPrice<prev?"down":null:null;
          prevPriceRef.current[sym]=newPrice;
          setPrices(p=>({...p,[sym]:{price:newPrice,change24h:parseFloat(d.P)}}));
          if(dir){setPriceDir(p=>({...p,[sym]:dir}));setTimeout(()=>setPriceDir(p=>({...p,[sym]:null})),700);}
          /* Check alerts */
          alertsRef.current.filter(a=>a.active&&!a.triggered&&a.symbol===sym).forEach(a=>{
            if((a.dir==="above"&&newPrice>=a.price)||(a.dir==="below"&&newPrice<=a.price)){
              setAlerts(p=>p.map(x=>x.id===a.id?{...x,triggered:true,triggeredAt:Date.now(),triggeredPrice:newPrice}:x));
              setAlertLog(p=>[{...a,triggeredAt:Date.now(),triggeredPrice:newPrice},...p.slice(0,99)]);
              if(typeof Notification!=="undefined"&&Notification.permission==="granted")
                try{new Notification(`NEXUSBOT: ${short(sym)} Alert`,{body:`Price ${a.dir==="above"?"crossed above":"dropped below"} ${fmtUSD(a.price)}. Now: ${fmtUSD(newPrice)}`});}catch{}
            }
          });
        }catch{}
      };
    }catch{}
    return()=>ws?.close();
  },[]);

  /* Execute trade — paper or live */
  const executeTrade=useCallback((bot,signal,price,exitReason="SIGNAL")=>{
    if(!price||signal==="HOLD")return;
    const qty=bot.amount/price;let pnl=null;
    setPortfolio(prev=>{
      const pos={...(prev.positions[bot.symbol]||{qty:0,avgPrice:0,hwm:0})};
      if(signal==="BUY"){const nq=pos.qty+qty;pos.avgPrice=pos.qty===0?price:(pos.qty*pos.avgPrice+qty*price)/nq;pos.qty=nq;pos.hwm=Math.max(pos.hwm||0,price);}
      else{const sq=Math.min(qty,pos.qty);pnl=sq>0?(price-pos.avgPrice)*sq:0;pos.qty=Math.max(0,pos.qty-sq);}
      return{balance:prev.balance+(signal==="SELL"?bot.amount:-bot.amount),positions:{...prev.positions,[bot.symbol]:pos},totalPnL:prev.totalPnL+(pnl||0)};
    });
    const trade={id:`${bot.id}_${Date.now()}`,botId:bot.id,symbol:bot.symbol,side:signal,price,quantity:qty,amount:bot.amount,strategy:bot.strategy,timestamp:Date.now(),pnl,exitReason};
    setTrades(p=>[trade,...p.slice(0,999)]);
    setBots(p=>p.map(b=>b.id===bot.id?{...b,lastSignal:signal,lastExit:exitReason,trades:(b.trades||0)+1}:b));
    if(apiKeys.live&&apiKeys.key&&apiKeys.secret)placeBinanceOrder(apiKeys.key,apiKeys.secret,bot.symbol,signal,bot.amount).catch(()=>{});
  },[apiKeys]);

  const executeAISignal=useCallback((sym,signal,price,amount)=>{
    executeTrade({id:"ai_bot",symbol:sym,strategy:"AI",amount,risk:{sl:2,tp:4,trail:1.5}},signal,price,"AI_SIGNAL");
  },[executeTrade]);

  const deployCustomBot=useCallback((cfg)=>{
    setBots(p=>[...p,{id:`bot_${Date.now().toString(36)}`,symbol:cfg.symbol||"BTCUSDT",interval:cfg.interval||"1h",amount:cfg.amount||100,strategy:"CUSTOM",config:{buyConds:cfg.buyConds,sellConds:cfg.sellConds,buyLogic:cfg.buyLogic,sellLogic:cfg.sellLogic},active:false,trades:0,risk:{sl:2,tp:4,trail:1.5},state:{},created:Date.now(),label:cfg.name}]);
    setTab("bots");
  },[]);

  /* Run bot: risk check → strategy signal */
  const runBot=useCallback(botId=>{
    const bot=botsRef.current.find(b=>b.id===botId);if(!bot?.active)return;
    const price=pricesRef.current[bot.symbol]?.price;if(!price)return;
    const pos=portfolioRef.current.positions[bot.symbol];
    if(pos?.qty>1e-8&&price>(pos.hwm||0))
      setPortfolio(prev=>({...prev,positions:{...prev.positions,[bot.symbol]:{...prev.positions[bot.symbol],hwm:price}}}));
    const riskExit=checkRisk(bot,pos,price);
    if(riskExit){executeTrade(bot,"SELL",price,riskExit);return;}
    const cd=candlesRef.current[bot.symbol];if(!cd?.length)return;
    const strat=STRATS[bot.strategy];if(!strat)return;
    const signal=strat.run(cd,{...strat.defaults,...bot.config},bot.state||{});
    if(bot.strategy==="DCA"&&signal==="BUY")setBots(p=>p.map(b=>b.id===botId?{...b,state:{...b.state,lastDCA:Date.now()}}:b));
    executeTrade(bot,signal,price,"SIGNAL");
  },[executeTrade]);

  /* Bot lifecycle */
  useEffect(()=>{
    bots.forEach(bot=>{
      if(bot.active&&!timersRef.current[bot.id]){runBot(bot.id);timersRef.current[bot.id]=setInterval(()=>runBot(bot.id),10000);}
      else if(!bot.active&&timersRef.current[bot.id]){clearInterval(timersRef.current[bot.id]);delete timersRef.current[bot.id];}
    });
  },[bots.map(b=>`${b.id}:${b.active}`).join(",")]);

  const addBot=form=>{const strat=STRATS[form.strategy];setBots(p=>[...p,{...form,id:`bot_${Date.now().toString(36)}`,config:{...strat.defaults},active:false,trades:0,risk:{sl:2,tp:4,trail:1.5},state:form.strategy==="GRID"?{gridCenter:pricesRef.current[form.symbol]?.price||0}:{},created:Date.now()}]);};
  const toggleBot=id=>setBots(p=>p.map(b=>b.id===id?{...b,active:!b.active}:b));
  const removeBot=id=>{clearInterval(timersRef.current[id]);delete timersRef.current[id];setBots(p=>p.filter(b=>b.id!==id));};
  const updateRisk=(id,risk)=>setBots(p=>p.map(b=>b.id===id?{...b,risk}:b));

  const liveCount=bots.filter(b=>b.active).length;
  const pendingAlerts=alerts.filter(a=>a.active&&!a.triggered).length;

  const TABS=[
    {id:"dashboard",label:"Dashboard"},
    {id:"bots",label:`Bots${bots.length?` (${bots.length})`:""}`},
    {id:"chart",label:"📊 Chart"},
    {id:"livecharts",label:"📡 Live Charts"},
    {id:"phase1",label:"✅ Phase 1"},
    {id:"backtest",label:"Backtest"},
    {id:"ai",label:"◈ AI Signals"},
    {id:"analytics",label:"Analytics"},
    {id:"alerts",label:`🔔 Alerts${pendingAlerts?` (${pendingAlerts})`:""}`},
    {id:"news",label:"News"},
    {id:"builder",label:"🔧 Builder"},
    {id:"trades",label:`Trades${trades.length?` (${trades.length})`:""}`},
    {id:"settings",label:"Settings"},
  ];

  const tabColor=id=>id==="ai"||id==="builder"?C.purple:id==="alerts"?C.orange:id==="livecharts"||id==="chart"?C.cyan:id==="phase1"?C.green:C.amber;

  return(
    <div style={{background:C.bg,minHeight:"100vh",color:C.text,fontFamily:MONO,fontSize:12}}>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#fff;color:#0f172a}
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:${C.surface}}
        ::-webkit-scrollbar-thumb{background:${C.borderHi};border-radius:3px}
        ::-webkit-scrollbar-thumb:hover{background:${C.muted}}
        select option{background:#fff;color:#0f172a}
        button:hover{opacity:.87;transform:translateY(-0.5px)}
        button:active{transform:translateY(0)}
        input:focus,select:focus{border-color:${C.cyan}!important;box-shadow:0 0 0 3px ${C.cyan}22}
        @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(0.85)}}
        @keyframes scan{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}}
      `}</style>

      {/* TOP NAV */}
      <nav style={{background:C.bg,borderBottom:`1px solid ${C.border}`,padding:"0 20px",display:"flex",alignItems:"center",height:52,position:"sticky",top:0,zIndex:100,boxShadow:C.shadow,gap:0,overflowX:"auto"}}>
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginRight:24,flexShrink:0}}>
          <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${C.amber},${C.orange})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,boxShadow:"0 2px 6px rgba(180,83,9,0.3)"}}>◈</div>
          <div>
            <div style={{fontWeight:900,fontSize:14,color:C.text,letterSpacing:"-0.02em",lineHeight:1}}>NexusBot</div>
            <div style={{fontSize:9,color:C.muted,letterSpacing:"0.04em"}}>v5 · AUTO TRADER</div>
          </div>
        </div>

        {/* Tabs */}
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"0 13px",height:"100%",display:"flex",alignItems:"center",cursor:"pointer",color:tab===t.id?tabColor(t.id):C.muted,fontSize:11,fontWeight:tab===t.id?700:500,background:"none",border:"none",borderBottom:tab===t.id?`2px solid ${tabColor(t.id)}`:"2px solid transparent",fontFamily:MONO,transition:"all 0.12s",whiteSpace:"nowrap"}}>
            {t.label}
          </button>
        ))}

        {/* Status badges */}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,flexShrink:0,paddingLeft:16}}>
          {liveCount>0&&(
            <span style={{...bgs(C.green),gap:5}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:C.green,display:"inline-block",animation:"pulse 1.5s ease-in-out infinite"}}/>
              {liveCount} Live
            </span>
          )}
          {pendingAlerts>0&&<span style={bgs(C.orange)}>🔔 {pendingAlerts}</span>}
          <span style={bgs(apiKeys.live?C.red:C.cyan)}>{apiKeys.live?"⚡ Live":"◎ Paper"}</span>
        </div>
      </nav>

      {/* PRICE TICKER BAR */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,height:32,display:"flex",alignItems:"center",padding:"0 20px",gap:28,overflowX:"auto",flexShrink:0}}>
        {CRYPTO_SYMS.map(sym=>{
          const p=prices[sym],chg=p?.change24h,dir=priceDir[sym];
          return(
            <span key={sym} style={{whiteSpace:"nowrap",display:"flex",gap:7,alignItems:"center",fontSize:11,cursor:"pointer"}} onClick={()=>setTab("chart")}>
              <span style={{fontWeight:700,color:C.text}}>{short(sym)}</span>
              <span style={{color:dir==="up"?C.green:dir==="down"?C.red:C.text,transition:"color 0.35s",fontWeight:600,fontVariantNumeric:"tabular-nums"}}>
                {p?.price?fmtUSD(p.price):"…"}
              </span>
              {chg!=null&&(
                <span style={{...bgs(chg>=0?C.green:C.red,chg>=0?C.greenBg:C.redBg),fontSize:9,padding:"1px 5px"}}>
                  {fmtPct(chg)}
                </span>
              )}
              {dir&&<span style={{color:dir==="up"?C.green:C.red,fontSize:11,fontWeight:700}}>{dir==="up"?"▲":"▼"}</span>}
            </span>
          );
        })}
        <span style={{marginLeft:"auto",color:C.muted,fontSize:10,whiteSpace:"nowrap",flexShrink:0}}>
          Click any ticker to open chart
        </span>
      </div>

      {/* MAIN CONTENT */}
      <main style={{overflowY:"auto",minHeight:"calc(100vh - 84px)",background:C.surface2}}>
        {tab==="dashboard"&&<Dashboard portfolio={portfolio} prices={prices} trades={trades} bots={bots} priceDir={priceDir}/>}
        {tab==="bots"&&<BotManager bots={bots} onAdd={addBot} onToggle={toggleBot} onRemove={removeBot} onUpdateRisk={updateRisk} prices={prices} trades={trades}/>}
        {tab==="chart"&&<ChartView prices={prices} allCandles={candles}/>}
        {tab==="livecharts"&&<LiveCharts prices={prices}/>}
        {tab==="phase1"&&<Phase1Suite/>}
        {tab==="backtest"&&<Backtest/>}
        {tab==="ai"&&<AISignals prices={prices} candles={candles} onExecute={executeAISignal}/>}
        {tab==="analytics"&&<Analytics trades={trades} bots={bots} portfolio={portfolio}/>}
        {tab==="alerts"&&<Alerts prices={prices} alerts={alerts} setAlerts={setAlerts} alertLog={alertLog}/>}
        {tab==="news"&&<NewsSentiment/>}
        {tab==="builder"&&<StrategyBuilder onDeployCustomBot={deployCustomBot}/>}
        {tab==="trades"&&<TradeHistory trades={trades}/>}
        {tab==="settings"&&<Settings apiKeys={apiKeys} setApiKeys={setApiKeys} setPortfolio={setPortfolio}/>}
      </main>
    </div>
  );
}
/* ══ PHASE 1 VALIDATION SUITE ════════════════════════════════════════
   Strategy Sweep · Parameter Optimizer · Paper Trading Journal
   Everything you need to validate before risking real money.
══════════════════════════════════════════════════════════════════════ */

// Run a quick backtest per strategy/symbol combo (uses existing engine)
async function quickBT(stratId, sym, iv = "1h") {
  const candles = await loadKlines(sym, iv, 300);
  if (candles.length < 60) return null;
  return runBacktest(candles, stratId, STRATS[stratId]?.defaults || {}, { sl: 2, tp: 4, trail: 1.5 }, 10000, 500);
}

function ScoreBar({ value, max, color }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, minWidth: 36, textAlign: "right" }}>{typeof value === "number" ? value.toFixed(2) : value}</span>
    </div>
  );
}

function Phase1Suite() {
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepResults, setSweepResults] = useState([]);
  const [sweepProgress, setSweepProgress] = useState({ done: 0, total: 0, current: "" });
  const [sweepSymbols, setSweepSymbols] = useState(["BTCUSDT", "ETHUSDT", "BNBUSDT"]);
  const [sweepIv, setSweepIv] = useState("1h");

  // ── Parameter Optimizer ──
  const [optStrategy, setOptStrategy] = useState("RSI_MACD");
  const [optSymbol, setOptSymbol]     = useState("BTCUSDT");
  const [optRunning, setOptRunning]   = useState(false);
  const [optResults, setOptResults]   = useState([]);
  const [optProgress, setOptProgress] = useState({ done: 0, total: 0 });

  // ── Paper Journal ──
  const [journal, setJournal] = useState([]);
  const [jForm, setJForm] = useState({ strategy: "RSI_MACD", symbol: "BTCUSDT", rating: 3, notes: "", outcome: "neutral" });

  // ═══ STRATEGY SWEEP ═══════════════════════════════════════════════
  const runSweep = async () => {
    setSweepRunning(true);
    setSweepResults([]);
    const combos = [];
    Object.keys(STRATS).filter(id => id !== "CUSTOM").forEach(sid => {
      sweepSymbols.forEach(sym => combos.push({ sid, sym }));
    });
    setSweepProgress({ done: 0, total: combos.length, current: "" });
    const results = [];
    for (const { sid, sym } of combos) {
      setSweepProgress(p => ({ ...p, current: `${sid} on ${short(sym)}…`, done: p.done + 1 }));
      const r = await quickBT(sid, sym, sweepIv);
      if (r) {
        const score = (r.winRate / 100) * 30 + Math.max(0, Math.min(r.sharpe, 3)) * 20 + Math.max(0, r.ret) * 0.3 + Math.max(0, 20 - r.maxDD) * 0.5;
        results.push({ stratId: sid, stratLabel: STRATS[sid]?.label, icon: STRATS[sid]?.icon, color: STRATS[sid]?.color, sym, ...r, score: +score.toFixed(2) });
      }
      await new Promise(r => setTimeout(r, 200)); // avoid rate limits
    }
    results.sort((a, b) => b.score - a.score);
    setSweepResults(results);
    setSweepRunning(false);
    setSweepProgress(p => ({ ...p, current: "Complete!" }));
  };

  // ═══ PARAMETER OPTIMIZER ══════════════════════════════════════════
  const runOptimizer = async () => {
    setOptRunning(true);
    setOptResults([]);
    const paramSets = [];

    if (optStrategy === "RSI_MACD") {
      for (const oversold of [25, 30, 35]) for (const overbought of [65, 70, 75]) for (const rsiLen of [10, 14, 21]) {
        paramSets.push({ oversold, overbought, rsiLen, fast: 12, slow: 26, sigLen: 9 });
      }
    } else if (optStrategy === "MA_CROSS") {
      for (const fastLen of [5, 9, 12]) for (const slowLen of [18, 21, 26]) {
        paramSets.push({ fastLen, slowLen });
      }
    } else if (optStrategy === "BOLLINGER") {
      for (const period of [15, 20, 25]) for (const stdDev of [1.5, 2, 2.5]) {
        paramSets.push({ period, stdDev });
      }
    } else if (optStrategy === "SCALP") {
      for (const oversold of [20, 25, 30]) for (const overbought of [70, 75, 80]) for (const rsiLen of [5, 7, 9]) {
        paramSets.push({ oversold, overbought, rsiLen });
      }
    } else {
      paramSets.push(STRATS[optStrategy]?.defaults || {});
    }

    setOptProgress({ done: 0, total: paramSets.length });
    const candles = await loadKlines(optSymbol, "1h", 350);
    if (candles.length < 60) { setOptRunning(false); return; }

    const results = [];
    for (const params of paramSets) {
      const r = runBacktest(candles, optStrategy, params, { sl: 2, tp: 4, trail: 1.5 }, 10000, 500);
      if (r) results.push({ params, ...r });
      setOptProgress(p => ({ done: p.done + 1, total: p.total }));
      await new Promise(r => setTimeout(r, 10));
    }
    results.sort((a, b) => {
      const scoreA = (a.winRate / 100) * 30 + Math.max(0, a.sharpe) * 20 + Math.max(0, a.ret) * 0.5 - a.maxDD * 0.5;
      const scoreB = (b.winRate / 100) * 30 + Math.max(0, b.sharpe) * 20 + Math.max(0, b.ret) * 0.5 - b.maxDD * 0.5;
      return scoreB - scoreA;
    });
    setOptResults(results.slice(0, 10));
    setOptRunning(false);
  };

  // ═══ JOURNAL ══════════════════════════════════════════════════════
  const addJournalEntry = () => {
    if (!jForm.notes.trim()) return;
    setJournal(prev => [{
      ...jForm, id: Date.now(), timestamp: Date.now(),
    }, ...prev]);
    setJForm(p => ({ ...p, notes: "" }));
  };

  const outcomeColors = { positive: C.green, neutral: C.amber, negative: C.red };
  const RatingStars = ({ value, onChange }) => (
    <div style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} onClick={() => onChange(n)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: n <= value ? C.amber : C.border, padding: 0, lineHeight: 1 }}>★</button>
      ))}
    </div>
  );

  const [activeSection, setActiveSection] = useState("sweep");

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 4, background: C.surface, borderRadius: 8, padding: 4, border: `1px solid ${C.border}`, alignSelf: "flex-start" }}>
        {[
          { id: "sweep",     label: "📊 Strategy Sweep"       },
          { id: "optimizer", label: "⚙️ Parameter Optimizer"  },
          { id: "journal",   label: "📓 Paper Journal"        },
        ].map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={{ background: s.id === activeSection ? C.amber : "transparent", color: s.id === activeSection ? "#fff" : C.mutedHi, border: "none", borderRadius: 6, padding: "6px 16px", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: MONO, transition: "all 0.15s" }}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Strategy Sweep ── */}
      {activeSection === "sweep" && (
        <>
          <div style={cs()}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 4 }}>Strategy Sweep</div>
            <div style={{ color: C.muted, fontSize: 11, marginBottom: 14 }}>Runs every strategy against your chosen symbols and ranks them by a composite score (win rate, Sharpe, return, drawdown).</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label style={ls}>Symbols to test (select multiple)</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CRYPTO_SYMS.map(sym => (
                    <button key={sym} onClick={() => setSweepSymbols(p => p.includes(sym) ? p.filter(s => s !== sym) : [...p, sym])}
                      style={{ background: sweepSymbols.includes(sym) ? C.cyan : "transparent", color: sweepSymbols.includes(sym) ? "#fff" : C.mutedHi, border: `1px solid ${sweepSymbols.includes(sym) ? C.cyan : C.border}`, borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 10, fontWeight: 600, fontFamily: MONO }}>
                      {short(sym)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={ls}>Interval</label>
                <select style={{ ...is, width: 90 }} value={sweepIv} onChange={e => setSweepIv(e.target.value)}>
                  {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
                </select>
              </div>
              <button style={{ ...bs(C.amber), padding: "8px 20px" }} onClick={runSweep} disabled={sweepRunning || !sweepSymbols.length}>
                {sweepRunning ? `⟳ ${sweepProgress.done}/${sweepProgress.total}` : "▶ Run Sweep"}
              </button>
            </div>
            {sweepRunning && (
              <div style={{ marginTop: 10, padding: "8px 14px", background: C.amberBg, borderRadius: 6, fontSize: 11, color: C.amber, display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: `${sweepProgress.total ? sweepProgress.done / sweepProgress.total * 100 : 0}%`, height: 3, background: C.amber, borderRadius: 2, transition: "width 0.3s" }} />
                Testing {sweepProgress.current}
              </div>
            )}
          </div>

          {sweepResults.length > 0 && (
            <div style={cs()}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 14 }}>
                Sweep Results — {sweepResults.length} combinations ranked
                <span style={{ ...bgs(C.green), marginLeft: 10, fontSize: 9 }}>✓ Complete</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["Rank","Strategy","Symbol","Score","Return","Win Rate","Sharpe","Max DD","Trades","Verdict"].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sweepResults.map((r, i) => {
                    const isTop = i < 3;
                    const verdict = r.winRate >= 55 && r.sharpe >= 1 && r.maxDD <= 15 && r.ret >= 5 ? "✅ Promising" : r.winRate >= 45 && r.ret >= 0 ? "⚠️ Marginal" : "❌ Avoid";
                    const vColor = verdict.startsWith("✅") ? C.green : verdict.startsWith("⚠️") ? C.amber : C.red;
                    return (
                      <tr key={`${r.stratId}_${r.sym}`} style={{ background: isTop ? `${r.color}08` : "transparent" }}>
                        <td style={{ ...TD, fontWeight: 800, color: isTop ? r.color : C.muted, fontSize: isTop ? 16 : 12 }}>{isTop ? ["🥇","🥈","🥉"][i] : i + 1}</td>
                        <td style={{ ...TD, color: r.color, fontWeight: 700 }}>{r.icon} {r.stratLabel}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{short(r.sym)}</td>
                        <td style={{ ...TD }}>
                          <ScoreBar value={r.score} max={sweepResults[0]?.score || 1} color={r.color} />
                        </td>
                        <td style={{ ...TD, color: r.ret >= 0 ? C.green : C.red, fontWeight: 700 }}>{r.ret >= 0 ? "+" : ""}{r.ret.toFixed(1)}%</td>
                        <td style={{ ...TD, color: r.winRate >= 55 ? C.green : r.winRate >= 45 ? C.amber : C.red }}>{r.winRate.toFixed(1)}%</td>
                        <td style={{ ...TD, color: r.sharpe >= 1 ? C.green : r.sharpe >= 0 ? C.amber : C.red }}>{r.sharpe.toFixed(2)}</td>
                        <td style={{ ...TD, color: r.maxDD <= 10 ? C.green : r.maxDD <= 20 ? C.amber : C.red }}>-{r.maxDD.toFixed(1)}%</td>
                        <td style={TD}>{r.tradeCount}</td>
                        <td style={{ ...TD, color: vColor, fontWeight: 600, fontSize: 10 }}>{verdict}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ marginTop: 12, padding: "10px 14px", background: C.cyanBg, borderRadius: 6, border: `1px solid ${C.cyanBorder}`, fontSize: 11, color: C.cyan }}>
                💡 <strong>Next step:</strong> Take the top 2 "✅ Promising" strategies and paper trade them for 7 days using the Bots tab. Then record your observations in the Paper Journal.
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Parameter Optimizer ── */}
      {activeSection === "optimizer" && (
        <>
          <div style={cs()}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 4 }}>Parameter Optimizer</div>
            <div style={{ color: C.muted, fontSize: 11, marginBottom: 14 }}>Sweeps key parameter combinations for a chosen strategy and ranks the best settings. Use to fine-tune before live trading.</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div>
                <label style={ls}>Strategy</label>
                <select style={{ ...is, width: 180 }} value={optStrategy} onChange={e => setOptStrategy(e.target.value)}>
                  {Object.values(STRATS).filter(s => s.id !== "CUSTOM").map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={ls}>Symbol</label>
                <select style={{ ...is, width: 140 }} value={optSymbol} onChange={e => setOptSymbol(e.target.value)}>
                  {CRYPTO_SYMS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <button style={bs(C.purple)} onClick={runOptimizer} disabled={optRunning}>
                {optRunning ? `⟳ ${optProgress.done}/${optProgress.total} tested` : "⚙️ Optimize"}
              </button>
            </div>
            {optRunning && (
              <div style={{ marginTop: 10 }}>
                <div style={{ height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: C.purple, width: `${optProgress.total ? optProgress.done / optProgress.total * 100 : 0}%`, transition: "width 0.2s", borderRadius: 2 }} />
                </div>
                <div style={{ color: C.purple, fontSize: 10, marginTop: 4 }}>Testing parameter {optProgress.done} of {optProgress.total}…</div>
              </div>
            )}
          </div>

          {optResults.length > 0 && (
            <div style={cs()}>
              <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 14 }}>
                Top 10 Parameter Sets — {optStrategy} on {short(optSymbol)}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Rank","Parameters","Return","Win Rate","Sharpe","Max DD","Trades"].map(h => <th key={h} style={TH}>{h}</th>)}</tr></thead>
                <tbody>
                  {optResults.map((r, i) => (
                    <tr key={i} style={{ background: i === 0 ? `${C.green}08` : "transparent" }}>
                      <td style={{ ...TD, fontWeight: 800, color: i === 0 ? C.green : C.muted }}>{i === 0 ? "🏆" : i + 1}</td>
                      <td style={{ ...TD, fontFamily: MONO, fontSize: 10, color: C.mutedHi }}>
                        {Object.entries(r.params).map(([k, v]) => `${k}:${v}`).join(" · ")}
                      </td>
                      <td style={{ ...TD, color: r.ret >= 0 ? C.green : C.red, fontWeight: 700 }}>{r.ret >= 0 ? "+" : ""}{r.ret.toFixed(1)}%</td>
                      <td style={{ ...TD, color: r.winRate >= 55 ? C.green : r.winRate >= 45 ? C.amber : C.red }}>{r.winRate.toFixed(1)}%</td>
                      <td style={{ ...TD, color: r.sharpe >= 1 ? C.green : C.amber }}>{r.sharpe.toFixed(3)}</td>
                      <td style={{ ...TD, color: r.maxDD <= 10 ? C.green : C.amber }}>-{r.maxDD.toFixed(1)}%</td>
                      <td style={TD}>{r.tradeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, padding: "10px 14px", background: C.purpleBg, borderRadius: 6, border: `1px solid ${C.purpleBorder}`, fontSize: 11, color: C.purple }}>
                💡 Use the top row's parameter values when creating a bot in the Bots tab. Click "⚙️ Risk Management" to apply the same SL/TP settings.
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Paper Journal ── */}
      {activeSection === "journal" && (
        <>
          <div style={cs()}>
            <div style={{ fontWeight: 700, fontSize: 13, color: C.text, marginBottom: 4 }}>Paper Trading Journal</div>
            <div style={{ color: C.muted, fontSize: 11, marginBottom: 14 }}>Log observations from each paper trading session. This record is your evidence that a strategy works before you risk real money.</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 12 }}>
              <div>
                <label style={ls}>Strategy</label>
                <select style={is} value={jForm.strategy} onChange={e => setJForm(p => ({ ...p, strategy: e.target.value }))}>
                  {Object.values(STRATS).map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
                </select>
              </div>
              <div>
                <label style={ls}>Symbol</label>
                <select style={is} value={jForm.symbol} onChange={e => setJForm(p => ({ ...p, symbol: e.target.value }))}>
                  {CRYPTO_SYMS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label style={ls}>Session Outcome</label>
                <select style={is} value={jForm.outcome} onChange={e => setJForm(p => ({ ...p, outcome: e.target.value }))}>
                  <option value="positive">✅ Positive</option>
                  <option value="neutral">⚠️ Neutral</option>
                  <option value="negative">❌ Negative</option>
                </select>
              </div>
              <div>
                <label style={ls}>Strategy Rating</label>
                <RatingStars value={jForm.rating} onChange={v => setJForm(p => ({ ...p, rating: v }))} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={ls}>Observations & Notes</label>
              <textarea
                style={{ ...is, minHeight: 80, resize: "vertical", lineHeight: 1.6 }}
                value={jForm.notes}
                onChange={e => setJForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. RSI+MACD on BTCUSDT fired 3 BUY signals today. 2 were profitable. The 1h timeframe seems too slow — will try 15m tomorrow. Max drawdown felt scary at -8% briefly..."
              />
            </div>
            <button style={bs(C.green)} onClick={addJournalEntry} disabled={!jForm.notes.trim()}>+ Add Entry</button>
          </div>

          {/* Journal entries */}
          {journal.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 11, color: C.mutedHi, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {journal.length} Journal {journal.length === 1 ? "Entry" : "Entries"}
              </div>
              {journal.map(entry => {
                const strat = STRATS[entry.strategy];
                const oc = outcomeColors[entry.outcome] || C.muted;
                return (
                  <div key={entry.id} style={{ ...cs(), borderLeft: `3px solid ${oc}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <span style={{ fontSize: 18 }}>{strat?.icon}</span>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 12, color: strat?.color }}>{strat?.label} · {short(entry.symbol)}</div>
                          <div style={{ color: C.muted, fontSize: 10 }}>{new Date(entry.timestamp).toLocaleString("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}</div>
                        </div>
                        <span style={{ ...bgs(oc), fontSize: 9 }}>{entry.outcome === "positive" ? "✅ Positive" : entry.outcome === "negative" ? "❌ Negative" : "⚠️ Neutral"}</span>
                      </div>
                      <div style={{ display: "flex", gap: 1 }}>
                        {[1,2,3,4,5].map(n => <span key={n} style={{ color: n <= entry.rating ? C.amber : C.border, fontSize: 14 }}>★</span>)}
                      </div>
                    </div>
                    <div style={{ color: C.text, fontSize: 12, lineHeight: 1.65, padding: "8px 12px", background: C.surface, borderRadius: 6 }}>
                      {entry.notes}
                    </div>
                    <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                      <button style={{ ...bs(C.red, "outline"), padding: "2px 8px", fontSize: 9 }} onClick={() => setJournal(p => p.filter(e => e.id !== entry.id))}>Delete</button>
                    </div>
                  </div>
                );
              })}

              {/* Phase 1 readiness check */}
              {journal.length >= 5 && (() => {
                const positive = journal.filter(e => e.outcome === "positive").length;
                const avgRating = journal.reduce((s, e) => s + e.rating, 0) / journal.length;
                const ready = positive / journal.length >= 0.6 && avgRating >= 3.5;
                return (
                  <div style={{ ...cs(), background: ready ? C.greenBg : C.amberBg, border: `1px solid ${ready ? C.greenBorder : C.amberBorder}` }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: ready ? C.green : C.amber, marginBottom: 8 }}>
                      {ready ? "✅ Phase 1 Complete — You're Ready for Phase 2!" : "⚠️ Phase 1 In Progress — Keep Paper Trading"}
                    </div>
                    <div style={{ display: "flex", gap: 24, fontSize: 11 }}>
                      <span>Positive sessions: <strong style={{ color: ready ? C.green : C.amber }}>{positive}/{journal.length} ({(positive/journal.length*100).toFixed(0)}%)</strong></span>
                      <span>Avg strategy rating: <strong style={{ color: ready ? C.green : C.amber }}>{avgRating.toFixed(1)}/5 ★</strong></span>
                    </div>
                    {ready && <div style={{ marginTop: 8, fontSize: 11, color: C.green }}>
                      You have enough evidence that your strategies work. Proceed to Phase 2 (backend server build). Your top strategies are ready for paper testing on the server.
                    </div>}
                    {!ready && <div style={{ marginTop: 8, fontSize: 11, color: C.amber }}>
                      Target: ≥60% positive sessions + avg rating ≥3.5 stars. Keep logging sessions and tuning parameters.
                    </div>}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div style={{ ...cs(), textAlign: "center", color: C.muted, padding: 40 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📓</div>
              <div style={{ fontSize: 12, marginBottom: 6 }}>No journal entries yet</div>
              <div style={{ fontSize: 11 }}>Run bots in paper mode, then return here to log what you observed each session. After 5+ entries, the readiness checker activates.</div>
            </div>
          )}
        </>
      )}
      <SpeedInsights />
    </div>
  );
}
