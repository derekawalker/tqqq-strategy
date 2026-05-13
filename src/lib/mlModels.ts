export type FeatureName =
  | "qqq1dRet" | "qqq3dRet" | "qqq5dRet"
  | "vixLevel" | "vix1dChange" | "vixTerm"
  | "pctAbove200ma" | "realizedVol20d" | "tnxMom20d"
  | "skewLevel";

export const FEATURE_NAMES: FeatureName[] = [
  "qqq1dRet", "qqq3dRet", "qqq5dRet",
  "vixLevel", "vix1dChange", "vixTerm",
  "pctAbove200ma", "realizedVol20d", "tnxMom20d",
  "skewLevel",
];

export interface ModelCoefficients {
  fittedAt: string;
  trainN: number;
  featureNames: FeatureName[];
  featureMeans: Record<FeatureName, number>;
  featureStdevs: Record<FeatureName, number>;
  // [bias, w1, ..., wk] — index 0 is intercept/bias
  logisticWeights: number[];
  olsWeights: number[];
  directionAccuracy: number;   // fraction correct on training data
  magnitudeMae: number;        // in-sample MAE in %
  magnitudePearson: number;    // in-sample pearson(predicted, realized)
}

// ── math helpers ─────────────────────────────────────────────────────────────

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x))));
}

// ── normalization ─────────────────────────────────────────────────────────────

// Compute column-wise means and stdevs from raw feature matrix (no bias column).
export function computeNormParams(X: number[][]): { means: number[]; stdevs: number[] } {
  const n = X.length;
  const k = X[0].length;
  const means = new Array<number>(k).fill(0);
  for (const row of X) for (let j = 0; j < k; j++) means[j] += row[j] / n;
  const stdevs = new Array<number>(k).fill(0);
  for (const row of X) for (let j = 0; j < k; j++) stdevs[j] += (row[j] - means[j]) ** 2;
  for (let j = 0; j < k; j++) stdevs[j] = Math.sqrt(stdevs[j] / n);
  return { means, stdevs };
}

// Z-score normalize a single feature vector using stored params.
export function normalize(x: number[], means: number[], stdevs: number[]): number[] {
  return x.map((v, j) => (stdevs[j] > 1e-10 ? (v - means[j]) / stdevs[j] : 0));
}

// ── OLS regression ────────────────────────────────────────────────────────────

// Fit OLS via Gauss-Jordan on normal equations.
// X: [n x k], no bias column. Returns weights [intercept, w1, ..., wk].
export function fitOLS(X: number[][], y: number[]): number[] {
  const n = X.length;
  const k = X[0].length + 1;
  const Xb = X.map((row) => [1, ...row]);
  const A: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const b: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < k; r++) {
      b[r] += Xb[i][r] * y[i];
      for (let c = 0; c < k; c++) A[r][c] += Xb[i][r] * Xb[i][c];
    }
  }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) throw new Error(`OLS singular at col ${col}`);
    [M[col], M[piv]] = [M[piv], M[col]];
    const div = M[col][col];
    for (let c = 0; c <= k; c++) M[col][c] /= div;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = 0; c <= k; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[k]);
}

// ── logistic regression ───────────────────────────────────────────────────────

// Fit binary logistic regression via gradient descent with L2 regularization.
// X: [n x k], no bias column. y: binary 0/1.
// Returns weights [bias, w1, ..., wk].
export function fitLogistic(
  X: number[][],
  y: number[],
  lambda = 0.01,
  epochs = 800,
  lr = 0.05,
): number[] {
  const n = X.length;
  const k = X[0].length + 1;
  const Xb = X.map((row) => [1, ...row]);
  const w = new Array<number>(k).fill(0);

  for (let e = 0; e < epochs; e++) {
    const grad = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const err = sigmoid(dot(Xb[i], w)) - y[i];
      for (let j = 0; j < k; j++) grad[j] += (err * Xb[i][j]) / n;
    }
    for (let j = 1; j < k; j++) grad[j] += lambda * w[j]; // L2, skip bias
    for (let j = 0; j < k; j++) w[j] -= lr * grad[j];
  }
  return w;
}

// ── inference ─────────────────────────────────────────────────────────────────

// x: normalized feature vector (no bias). weights: [bias, w1, ..., wk].
export function predictProb(x: number[], weights: number[]): number {
  return sigmoid(weights[0] + dot(x, weights.slice(1)));
}

export function predictMagnitude(x: number[], weights: number[]): number {
  return weights[0] + dot(x, weights.slice(1));
}

// ── accuracy metrics ──────────────────────────────────────────────────────────

export function computePearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}
