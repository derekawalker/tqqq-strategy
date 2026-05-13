import type { FeatureName } from "./mlModels";

export type { FeatureName };

export type RawFeatures = {
  date: string;
  qqqClose: number;
  qqq1dRet: number;
  qqq3dRet: number;
  qqq5dRet: number;
  vixLevel: number;
  vix1dChange: number;
  vixTerm: number;
  pctAbove200ma: number;
  realizedVol20d: number;
  tnxMom20d: number;
  skewLevel: number | null;
};

function stdev(xs: number[]): number {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function sma200(arr: number[], i: number): number | null {
  if (i < 199) return null;
  let s = 0;
  for (let j = i - 199; j <= i; j++) s += arr[j];
  return s / 200;
}

// Compute features for index i in aligned daily series.
// All series must be the same length and aligned by trading day.
// skewClose is the SKEW value for that day, or null if unavailable.
export function computeFeaturesAt(
  i: number,
  qqqCloses: number[],
  vixCloses: number[],
  vix3mCloses: number[],
  tnxCloses: number[],
  skewClose: number | null,
  date: string,
): RawFeatures | null {
  // Need 200 days for MA, 20 for TNX momentum, 20 for realized vol, 5 for 5d return
  if (i < 200) return null;

  const q = qqqCloses[i];
  if (q == null || q === 0) return null;

  const qqq1dRet = ((q - qqqCloses[i - 1]) / qqqCloses[i - 1]) * 100;
  const qqq3dRet = ((q - qqqCloses[i - 3]) / qqqCloses[i - 3]) * 100;
  const qqq5dRet = ((q - qqqCloses[i - 5]) / qqqCloses[i - 5]) * 100;

  const vixLevel = vixCloses[i];
  const vixPrev = vixCloses[i - 1];
  if (!vixLevel || !vixPrev) return null;
  const vix1dChange = ((vixLevel - vixPrev) / vixPrev) * 100;

  const vix3m = vix3mCloses[i];
  if (!vix3m) return null;
  const vixTerm = vixLevel / vix3m;

  const ma200 = sma200(qqqCloses, i);
  if (ma200 == null) return null;
  const pctAbove200ma = ((q / ma200) - 1) * 100;

  const rets20: number[] = [];
  for (let j = i - 19; j <= i; j++) {
    rets20.push((qqqCloses[j] - qqqCloses[j - 1]) / qqqCloses[j - 1]);
  }
  const realizedVol20d = stdev(rets20) * Math.sqrt(252) * 100;

  const tnx = tnxCloses[i];
  const tnxPrev20 = tnxCloses[i - 20];
  if (tnx == null || tnxPrev20 == null) return null;
  const tnxMom20d = tnx - tnxPrev20;

  return {
    date,
    qqqClose: q,
    qqq1dRet,
    qqq3dRet,
    qqq5dRet,
    vixLevel,
    vix1dChange,
    vixTerm,
    pctAbove200ma,
    realizedVol20d,
    tnxMom20d,
    skewLevel: skewClose,
  };
}

// Convert RawFeatures to a fixed-length array aligned with FEATURE_NAMES.
// Null skewLevel is replaced by the provided fallback (use column mean during inference).
export function featuresToArray(f: RawFeatures, skewFallback: number): number[] {
  return [
    f.qqq1dRet,
    f.qqq3dRet,
    f.qqq5dRet,
    f.vixLevel,
    f.vix1dChange,
    f.vixTerm,
    f.pctAbove200ma,
    f.realizedVol20d,
    f.tnxMom20d,
    f.skewLevel ?? skewFallback,
  ];
}

// Build aligned daily series from individual symbol series keyed by date string.
export function alignSeries(
  qqq: { date: string; close: number }[],
  vix: { date: string; close: number }[],
  vix3m: { date: string; close: number }[],
  tnx: { date: string; close: number }[],
  skew: { date: string; close: number }[],
): {
  dates: string[];
  qqqCloses: number[];
  vixCloses: number[];
  vix3mCloses: number[];
  tnxCloses: number[];
  skewByDate: Map<string, number>;
} {
  // Use QQQ trading days as the base; require VIX, VIX3M, and TNX to all have data.
  const vixMap = new Map(vix.map((d) => [d.date, d.close]));
  const vix3mMap = new Map(vix3m.map((d) => [d.date, d.close]));
  const tnxMap = new Map(tnx.map((d) => [d.date, d.close]));
  const skewMap = new Map(skew.map((d) => [d.date, d.close]));

  const dates: string[] = [];
  const qqqCloses: number[] = [];
  const vixCloses: number[] = [];
  const vix3mCloses: number[] = [];
  const tnxCloses: number[] = [];

  for (const { date, close } of qqq) {
    const v = vixMap.get(date);
    const v3 = vix3mMap.get(date);
    const t = tnxMap.get(date);
    if (v == null || v3 == null || t == null) continue;
    dates.push(date);
    qqqCloses.push(close);
    vixCloses.push(v);
    vix3mCloses.push(v3);
    tnxCloses.push(t);
  }

  return { dates, qqqCloses, vixCloses, vix3mCloses, tnxCloses, skewByDate: skewMap };
}
