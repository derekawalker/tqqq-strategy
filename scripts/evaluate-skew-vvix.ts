/**
 * Evaluate ^SKEW and ^VVIX as QQQ 5d forward-return predictors.
 * Run with: npx tsx scripts/evaluate-skew-vvix.ts
 */

import YahooFinance from "yahoo-finance2";
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const YEARS = 5;
const FORWARD_DAYS = 5;

type Series = { date: Date; close: number }[];

async function fetchDaily(sym: string, years: number): Promise<Series> {
  const period1 = new Date(Date.now() - (years + 1) * 365 * 24 * 60 * 60 * 1000);
  const r = await yf.chart(sym, { period1, interval: "1d" });
  return r.quotes.filter((q) => q.close != null && q.date != null)
    .map((q) => ({ date: q.date as Date, close: q.close as number }));
}

function alignByDate(series: Record<string, Series>) {
  const maps = Object.fromEntries(Object.entries(series).map(([k, s]) => [k, new Map(s.map((d) => [d.date.toDateString(), d.close]))]));
  const sets = Object.values(maps).map((m) => new Set(m.keys()));
  const common = [...sets[0]].filter((d) => sets.every((s) => s.has(d)));
  return series[Object.keys(series)[0]]
    .filter((d) => common.includes(d.date.toDateString()))
    .map((d) => ({ date: d.date, values: Object.fromEntries(Object.keys(series).map((k) => [k, maps[k].get(d.date.toDateString()) as number])) }));
}

function pearson(xs: number[], ys: number[]) {
  const mx = xs.reduce((s,x)=>s+x,0)/xs.length, my = ys.reduce((s,y)=>s+y,0)/ys.length;
  let num=0,dx2=0,dy2=0;
  for(let i=0;i<xs.length;i++){const dx=xs[i]-mx,dy=ys[i]-my;num+=dx*dy;dx2+=dx*dx;dy2+=dy*dy;}
  return num/Math.sqrt(dx2*dy2);
}
function rankOf(arr: number[]) {
  const idx=arr.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v);const r=new Array(arr.length);idx.forEach((p,k)=>{r[p.i]=k+1;});return r;
}
function quantile(sorted: number[], q: number) {
  const pos=(sorted.length-1)*q,base=Math.floor(pos);
  return sorted[base+1]!==undefined?sorted[base]+(pos-base)*(sorted[base+1]-sorted[base]):sorted[base];
}

function reportFeature(name: string, xs: number[], ys: number[]) {
  const valid=xs.map((x,i)=>({x,y:ys[i]})).filter(p=>isFinite(p.x)&&isFinite(p.y));
  if(valid.length<50){console.log(`${name}: n=${valid.length} too few`);return;}
  const fx=valid.map(p=>p.x),fy=valid.map(p=>p.y);
  const corr=pearson(fx,fy),spearman=pearson(rankOf(fx),rankOf(fy));
  const baseline=fy.reduce((s,y)=>s+y,0)/fy.length;
  const sorted=[...fx].sort((a,b)=>a-b);
  const [q20,q40,q60,q80]=[0.2,0.4,0.6,0.8].map(q=>quantile(sorted,q));
  const bins=["Q1","Q2","Q3","Q4","Q5"].map(()=>[] as number[]);
  for(const p of valid){const b=p.x<=q20?0:p.x<=q40?1:p.x<=q60?2:p.x<=q80?3:4;bins[b].push(p.y);}
  console.log(`\n${name}  (n=${fx.length})`);
  console.log(`  pearson=${corr.toFixed(3)}   spearman=${spearman.toFixed(3)}`);
  const labels=[`Q1(≤${q20.toFixed(1)})`,`Q2`,`Q3`,`Q4`,`Q5(>${q80.toFixed(1)})`];
  for(let i=0;i<5;i++){
    const b=bins[i];
    const avg=b.reduce((s,y)=>s+y,0)/b.length;
    const up=(b.filter(y=>y>0).length/b.length)*100;
    const edge=avg-baseline;
    console.log(`  ${labels[i].padEnd(14)} n=${String(b.length).padStart(3)}  avg=${avg>=0?"+":""}${avg.toFixed(2)}%  edge=${edge>=0?"+":""}${edge.toFixed(2)}%  up=${up.toFixed(0)}%`);
  }
}

async function main() {
  console.log("Fetching data...");
  const [qqq, skew, vvix] = await Promise.all([
    fetchDaily("QQQ",   YEARS),
    fetchDaily("^SKEW", YEARS),
    fetchDaily("^VVIX", YEARS),
  ]);
  const aligned = alignByDate({ QQQ: qqq, SKEW: skew, VVIX: vvix });
  console.log(`Aligned: ${aligned.length} days`);

  const q = aligned.map(d => d.values.QQQ);
  const sk = aligned.map(d => d.values.SKEW);
  const vv = aligned.map(d => d.values.VVIX);

  const start = 20, end = aligned.length - FORWARD_DAYS;
  const targets: number[] = [], skewVals: number[] = [], vvixVals: number[] = [];
  const skewMom10: number[] = [], vvixMom5: number[] = [];

  for (let i = start; i < end; i++) {
    targets.push(((q[i + FORWARD_DAYS] - q[i]) / q[i]) * 100);
    skewVals.push(sk[i]);
    vvixVals.push(vv[i]);
    skewMom10.push(sk[i] - sk[i - 10]);
    vvixMom5.push(vv[i] - vv[i - 5]);
  }

  const baseline = targets.reduce((s,y)=>s+y,0)/targets.length;
  console.log(`\nBaseline 5d return: ${baseline.toFixed(3)}%  n=${targets.length}`);
  console.log(`\n── Evaluation ──`);
  reportFeature("SKEW level",    skewVals,  targets);
  reportFeature("SKEW 10d change",skewMom10, targets);
  reportFeature("VVIX level",    vvixVals,  targets);
  reportFeature("VVIX 5d change",vvixMom5,  targets);

  // Also check ±1.5% hit rates per quintile
  console.log(`\n── Bullish outcome rate (>+1.5%) per SKEW quintile ──`);
  const sorted=[...skewVals].sort((a,b)=>a-b);
  const[sq20,sq40,sq60,sq80]=[0.2,0.4,0.6,0.8].map(q=>quantile(sorted,q));
  const bins=["Q1","Q2","Q3","Q4","Q5"].map(()=>({bull:0,bear:0,n:0}));
  for(let i=0;i<skewVals.length;i++){
    const b=skewVals[i]<=sq20?0:skewVals[i]<=sq40?1:skewVals[i]<=sq60?2:skewVals[i]<=sq80?3:4;
    bins[b].n++;
    if(targets[i]>1.5) bins[b].bull++;
    if(targets[i]<-1.5) bins[b].bear++;
  }
  const labels=[`Q1(≤${sq20.toFixed(0)})`,`Q2(≤${sq40.toFixed(0)})`,`Q3(≤${sq60.toFixed(0)})`,`Q4(≤${sq80.toFixed(0)})`,`Q5(>${sq80.toFixed(0)})`];
  for(let i=0;i<5;i++){
    const b=bins[i];
    console.log(`  ${labels[i].padEnd(14)} n=${String(b.n).padStart(3)}  bull>+1.5%=${((b.bull/b.n)*100).toFixed(0)}%  bear<-1.5%=${((b.bear/b.n)*100).toFixed(0)}%`);
  }
}

main().catch(e=>{console.error(e);process.exit(1);});
