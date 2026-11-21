export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ValueAblationRow {
  term: string;
  loo_miss: number;
  wf_miss: number;
  status: 'baseline' | 'kept' | 'tested, not kept' | 'control';
}

export interface OddsAblationRow {
  term: string;
  cv_brier: number;
  cv_acc: number;
  wf_brier: number;
  wf_acc: number;
  status: 'baseline' | 'kept' | 'tested, not kept' | 'control';
}

export interface RangeAudit {
  within_3x_loo: number;
  within_3x_wf: number;
  in_p25_p75_loo: number;
  in_p25_p75_wf: number;
  in_p10_p90_loo: number;
  in_p10_p90_wf: number;
  n_loo: number;
  n_wf: number;
}

export interface LedgerBreakdown {
  total: number;
  ranked_watchlist: number;
  ranked_early: number;
  ranked_offlist: number;
  token_priced: number;
  token_nocap: number;
  out_bridge: number;
  out_lst: number;
  out_exchange: number;
  out_versioned: number;
  out_wrapped: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  tier: 'watchlist' | 'early' | 'offlist';
  is_watchlist: boolean;
  age_days: number | null;
  token_odds: number;
  launch_value_usd: number;
  implied_value_usd: number;
  p25_value_usd: number;
  p75_value_usd: number;
  p10_value_usd: number;
  p90_value_usd: number;
  implied_multiple: number;
  plan_deposit_usd: number;
  farm_cost_usd: number;
  farm_hours: number;
  hold_days: number;
  model: {
    base_multiple: number;
    size_mult: number;
    category_mult: number;
    token_odds: number;
    odds_age_logit: number;
    odds_tvl_logit: number;
    odds_g7_logit: number;
    odds_cat_logit: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl_ratio: number;
  pred_mcap_usd: number;
  change_7d: number | null;
  symbol: string | null;
  listed_at: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  seal: string;
  total_implied_usd: number;
  ledger: LedgerBreakdown;
  value_params: {
    base_mult_100m: number;
    size_slope: number;
    cat_lambda: number;
    cat_min: number;
    cat_max: number;
    q25_log: number;
    q75_log: number;
    q10_log: number;
    q90_log: number;
  };
  odds_params: {
    intercept: number;
    age_coef: number;
    tvl_coef: number;
    g7_coef: number;
    base_rate: number;
    n_peers: number;
    n_tokenized: number;
  };
  value_ablation: ValueAblationRow[];
  odds_ablation: OddsAblationRow[];
  range_audit: RangeAudit;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  offlist_size: number;
  live_size: number;
  rows: Array<Omit<BoardRow, 'mcap_usd' | 'gecko_id' | 'symbol'>>;
  live: LiveRow[];
}

export const MODEL_VERSION = 'radar-oos-v4';
const DAY_MS = 86_400_000;
const TVL_REF = 100_000_000;
const CAT_VAL_LAMBDA = 24;
const CAT_ODDS_LAMBDA = 12;

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge']);
const LST_CATS = new Set(['Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const sigmoid = (z: number): number => 1 / (1 + Math.exp(-clamp(z, -20, 20)));

function quantile(nums: number[], q: number): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

const median = (nums: number[]): number => quantile(nums, 0.5);

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(1, Math.floor((a - b) / DAY_MS));
}

function ageYears(asOf: string, listedAt: string | null): number {
  const d = ageDays(asOf, listedAt);
  return d === null ? 1.0 : Math.max(0.02, d / 365.25);
}

function growth7d(p: SnapshotProtocol): number {
  return typeof p.change_7d === 'number' && Number.isFinite(p.change_7d)
    ? clamp(p.change_7d, -60, 150) / 100
    : 0;
}

export function isNoTokenRecorded(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

export function exclusionReason(p: SnapshotProtocol): 'bridge' | 'lst' | 'exchange' | 'versioned' | 'wrapped' | null {
  const cat = p.category ?? '';
  if (BRIDGE_CATS.has(cat)) return 'bridge';
  if (LST_CATS.has(cat)) return 'lst';
  if (cat === 'CEX' || EXCHANGE_PREFIX.test(p.name)) return 'exchange';
  if (VERSIONED.test(p.name)) return 'versioned';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped';
  return null;
}

function solveLinearRidge(X: number[][], y: number[], lam: number): number[] {
  const k = X[0]!.length;
  const A: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const b: number[] = new Array(k).fill(0);
  for (let n = 0; n < X.length; n++) {
    const row = X[n]!;
    const yi = y[n]!;
    for (let i = 0; i < k; i++) {
      b[i]! += row[i]! * yi;
      for (let j = 0; j < k; j++) A[i]![j]! += row[i]! * row[j]!;
    }
  }
  for (let i = 1; i < k; i++) A[i]![i]! += lam;
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[piv]![i]!)) piv = r;
    [A[i], A[piv]] = [A[piv]!, A[i]!];
    [b[i], b[piv]] = [b[piv]!, b[i]!];
    const d = A[i]![i] || 1e-9;
    for (let j = i; j < k; j++) A[i]![j]! /= d;
    b[i]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r]![i]!;
      for (let j = i; j < k; j++) A[r]![j]! -= f * A[i]![j]!;
      b[r]! -= f * b[i]!;
    }
  }
  return b;
}

function fitLogisticRidge(X: number[][], y: number[], lam: number): number[] {
  const k = X[0]!.length;
  let w = new Array(k).fill(0);
  const p0 = clamp(y.reduce((a, b) => a + b, 0) / Math.max(1, y.length), 0.05, 0.95);
  w[0] = Math.log(p0 / (1 - p0));
  for (let iter = 0; iter < 14; iter++) {
    const H: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    const g: number[] = new Array(k).fill(0);
    for (let n = 0; n < X.length; n++) {
      const row = X[n]!;
      let z = 0;
      for (let i = 0; i < k; i++) z += w[i]! * row[i]!;
      const p = sigmoid(z);
      const err = y[n]! - p;
      const wt = Math.max(1e-5, p * (1 - p));
      for (let i = 0; i < k; i++) {
        g[i]! += err * row[i]!;
        for (let j = 0; j < k; j++) H[i]![j]! += wt * row[i]! * row[j]!;
      }
    }
    for (let i = 1; i < k; i++) {
      H[i]![i]! += lam;
      g[i]! -= lam * w[i]!;
    }
    // Solve H * delta = g
    for (let i = 0; i < k; i++) {
      let piv = i;
      for (let r = i + 1; r < k; r++) if (Math.abs(H[r]![i]!) > Math.abs(H[piv]![i]!)) piv = r;
      [H[i], H[piv]] = [H[piv]!, H[i]!];
      [g[i], g[piv]] = [g[piv]!, g[i]!];
      const d = H[i]![i] || 1e-9;
      for (let j = i; j < k; j++) H[i]![j]! /= d;
      g[i]! /= d;
      for (let r = 0; r < k; r++) {
        if (r === i) continue;
        const f = H[r]![i]!;
        for (let j = i; j < k; j++) H[r]![j]! -= f * H[i]![j]!;
        g[r]! -= f * g[i]!;
      }
    }
    let maxStep = 0;
    for (let i = 0; i < k; i++) {
      w[i]! += g[i]!;
      maxStep = Math.max(maxStep, Math.abs(g[i]!));
    }
    if (maxStep < 1e-5) break;
  }
  return w;
}

const dot = (w: number[], x: number[]): number => w.reduce((s, wi, i) => s + wi * x[i]!, 0);

function multMiss(preds: number[], actuals: number[]): number {
  return median(preds.map((pr, i) => Math.exp(Math.abs(pr - actuals[i]!))));
}

export function computeSeal(rows: Array<{ slug: string; rank: number; implied_value_usd: number }>): string {
  let h = 2166136261 >>> 0;
  for (const r of rows) {
    const s = `${r.rank}:${r.slug}:${r.implied_value_usd}|`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

function fitValueModelAndAblate(comps: SnapshotProtocol[], asOf: string) {
  const yAll = comps.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const dated = comps
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!) || a.slug.localeCompare(b.slug));
  const wfCut = Math.floor(dated.length * 0.6);
  const wfTrain = dated.slice(0, wfCut);
  const wfTest = dated.slice(wfCut);

  const evalVariant = (
    featFn: (p: SnapshotProtocol, idx: number, pool: SnapshotProtocol[]) => number[],
    useCat: boolean,
    catLam: number,
  ) => {
    const looPreds: number[] = [];
    for (let i = 0; i < comps.length; i++) {
      const tr: SnapshotProtocol[] = [];
      const trX: number[][] = [];
      const trY: number[] = [];
      for (let j = 0; j < comps.length; j++) {
        if (j === i) continue;
        tr.push(comps[j]!);
        trX.push(featFn(comps[j]!, j, comps));
        trY.push(yAll[j]!);
      }
      const w = solveLinearRidge(trX, trY, 1.0);
      let hat = dot(w, featFn(comps[i]!, i, comps));
      if (useCat) {
        const cat = comps[i]!.category || 'Other';
        let sum = 0, cnt = 0;
        for (let j = 0; j < tr.length; j++) {
          if ((tr[j]!.category || 'Other') === cat) {
            sum += trY[j]! - dot(w, trX[j]!);
            cnt++;
          }
        }
        hat += sum / (cnt + catLam);
      }
      looPreds.push(hat);
    }
    const wfTrX = wfTrain.map((p, i) => featFn(p, i, wfTrain));
    const wfTrY = wfTrain.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    const wWf = solveLinearRidge(wfTrX, wfTrY, 1.0);
    const wfPreds = wfTest.map((p, i) => {
      let hat = dot(wWf, featFn(p, i, wfTest));
      if (useCat) {
        const cat = p.category || 'Other';
        let sum = 0, cnt = 0;
        for (let j = 0; j < wfTrain.length; j++) {
          if ((wfTrain[j]!.category || 'Other') === cat) {
            sum += wfTrY[j]! - dot(wWf, wfTrX[j]!);
            cnt++;
          }
        }
        hat += sum / (cnt + catLam);
      }
      return hat;
    });
    const wfActual = wfTest.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
    return {
      loo: multMiss(looPreds, yAll),
      wf: multMiss(wfPreds, wfActual),
      looPreds,
      wfPreds,
      wfActual,
    };
  };

  const base = evalVariant(() => [1], false, 0);
  const size = evalVariant((p) => [1, Math.log(p.tvl_usd / TVL_REF)], false, 0);
  const sizeCat = evalVariant((p) => [1, Math.log(p.tvl_usd / TVL_REF)], true, CAT_VAL_LAMBDA);
  const plusG7 = evalVariant((p) => [1, Math.log(p.tvl_usd / TVL_REF), growth7d(p)], true, CAT_VAL_LAMBDA);
  const plusAge = evalVariant((p) => [1, Math.log(p.tvl_usd / TVL_REF), Math.log(ageYears(asOf, p.listed_at))], true, CAT_VAL_LAMBDA);
  const plusChains = evalVariant((p) => [1, Math.log(p.tvl_usd / TVL_REF), Math.log(Math.max(1, p.chains.length))], true, CAT_VAL_LAMBDA);
  const ctrl = evalVariant((p, idx, pool) => [1, Math.log(p.tvl_usd / TVL_REF), growth7d(pool[(idx + 7) % pool.length]!)], true, CAT_VAL_LAMBDA);

  const keepCat = sizeCat.wf <= size.wf + 0.03;
  const active = keepCat ? sizeCat : size;

  // Calibrate empirical quantiles on LOO residuals of the active model
  const looRes = active.looPreds.map((pr, i) => yAll[i]! - pr);
  const q25 = quantile(looRes, 0.25);
  const q75 = quantile(looRes, 0.75);
  const q10 = quantile(looRes, 0.10);
  const q90 = quantile(looRes, 0.90);

  const wfRes = active.wfPreds.map((pr, i) => active.wfActual[i]! - pr);
  const shareIn = (arr: number[], lo: number, hi: number) =>
    round3(arr.filter((v) => v >= lo && v <= hi).length / Math.max(1, arr.length));

  const rangeAudit: RangeAudit = {
    within_3x_loo: round3(looRes.filter((v) => Math.exp(Math.abs(v)) <= 3).length / Math.max(1, looRes.length)),
    within_3x_wf: round3(wfRes.filter((v) => Math.exp(Math.abs(v)) <= 3).length / Math.max(1, wfRes.length)),
    in_p25_p75_loo: shareIn(looRes, q25, q75),
    in_p25_p75_wf: shareIn(wfRes, q25, q75),
    in_p10_p90_loo: shareIn(looRes, q10, q90),
    in_p10_p90_wf: shareIn(wfRes, q10, q90),
    n_loo: looRes.length,
    n_wf: wfRes.length,
  };

  // Fit full value model on all clean comps
  const fullX = comps.map((p) => [1, Math.log(p.tvl_usd / TVL_REF)]);
  const wFull = solveLinearRidge(fullX, yAll, 1.0);
  const catBuckets = new Map<string, number[]>();
  for (let i = 0; i < comps.length; i++) {
    const cat = comps[i]!.category || 'Other';
    const res = yAll[i]! - dot(wFull, fullX[i]!);
    let arr = catBuckets.get(cat);
    if (!arr) { arr = []; catBuckets.set(cat, arr); }
    arr.push(res);
  }
  const catEffect = new Map<string, number>();
  let catMin = 1, catMax = 1;
  for (const [cat, arr] of catBuckets) {
    const adj = keepCat ? clamp(arr.reduce((a, b) => a + b, 0) / (arr.length + CAT_VAL_LAMBDA), -0.65, 0.65) : 0;
    catEffect.set(cat, adj);
    const m = Math.exp(adj);
    catMin = Math.min(catMin, m);
    catMax = Math.max(catMax, m);
  }

  const valueAblation: ValueAblationRow[] = [
    { term: 'flat median multiple', loo_miss: round3(base.loo), wf_miss: round3(base.wf), status: 'baseline' },
    { term: '+ size curve, ln TVL', loo_miss: round3(size.loo), wf_miss: round3(size.wf), status: 'kept' },
    { term: `+ category ridge (λ=${CAT_VAL_LAMBDA})`, loo_miss: round3(sizeCat.loo), wf_miss: round3(sizeCat.wf), status: keepCat ? 'kept' : 'tested, not kept' },
    { term: '+ 7-day TVL growth', loo_miss: round3(plusG7.loo), wf_miss: round3(plusG7.wf), status: 'tested, not kept' },
    { term: '+ age, ln years listed', loo_miss: round3(plusAge.loo), wf_miss: round3(plusAge.wf), status: 'tested, not kept' },
    { term: '+ chain count, ln', loo_miss: round3(plusChains.loo), wf_miss: round3(plusChains.wf), status: 'tested, not kept' },
    { term: '+ control: shuffled growth', loo_miss: round3(ctrl.loo), wf_miss: round3(ctrl.wf), status: 'control' },
  ];

  return { wFull, catEffect, catMin, catMax, q25, q75, q10, q90, valueAblation, rangeAudit };
}

function fitTokenOddsAndAblate(peers: SnapshotProtocol[], asOf: string) {
  const yAll = peers.map((p) => (isNoTokenRecorded(p) ? 0 : 1));
  const dated = peers
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => a.listed_at!.localeCompare(b.listed_at!) || a.slug.localeCompare(b.slug));
  const wfCut = Math.floor(dated.length * 0.6);
  const wfTrain = dated.slice(0, wfCut);
  const wfTest = dated.slice(wfCut);

  const brierAndAcc = (probs: number[], actual: number[]) => {
    let b = 0, ok = 0;
    for (let i = 0; i < probs.length; i++) {
      b += (probs[i]! - actual[i]!) ** 2;
      if ((probs[i]! >= 0.5 ? 1 : 0) === actual[i]!) ok++;
    }
    return { brier: round3(b / Math.max(1, probs.length)), acc: round3(ok / Math.max(1, probs.length)) };
  };

  const evalOdds = (
    featFn: (p: SnapshotProtocol, idx: number, pool: SnapshotProtocol[]) => number[],
    useCat: boolean,
  ) => {
    // 10-fold CV
    const cvProbs = new Array<number>(peers.length).fill(0.5);
    for (let fold = 0; fold < 10; fold++) {
      const tr: SnapshotProtocol[] = [];
      const trX: number[][] = [];
      const trY: number[] = [];
      const teIdx: number[] = [];
      for (let i = 0; i < peers.length; i++) {
        if (i % 10 === fold) teIdx.push(i);
        else {
          tr.push(peers[i]!);
          trX.push(featFn(peers[i]!, i, peers));
          trY.push(yAll[i]!);
        }
      }
      const w = fitLogisticRidge(trX, trY, 2.0);
      const catSums = new Map<string, { res: number; n: number }>();
      if (useCat) {
        for (let i = 0; i < tr.length; i++) {
          const cat = tr[i]!.category || 'Other';
          const pHat = sigmoid(dot(w, trX[i]!));
          const cur = catSums.get(cat) ?? { res: 0, n: 0 };
          cur.res += trY[i]! - pHat;
          cur.n += 1;
          catSums.set(cat, cur);
        }
      }
      for (const idx of teIdx) {
        let z = dot(w, featFn(peers[idx]!, idx, peers));
        if (useCat) {
          const cur = catSums.get(peers[idx]!.category || 'Other');
          if (cur) z += clamp((cur.res * 4) / (cur.n + CAT_ODDS_LAMBDA), -1.1, 1.1);
        }
        cvProbs[idx] = sigmoid(z);
      }
    }
    const wfTrX = wfTrain.map((p, i) => featFn(p, i, wfTrain));
    const wfTrY = wfTrain.map((p) => (isNoTokenRecorded(p) ? 0 : 1));
    const wWf = fitLogisticRidge(wfTrX, wfTrY, 2.0);
    const catWf = new Map<string, { res: number; n: number }>();
    if (useCat) {
      for (let i = 0; i < wfTrain.length; i++) {
        const cat = wfTrain[i]!.category || 'Other';
        const cur = catWf.get(cat) ?? { res: 0, n: 0 };
        cur.res += wfTrY[i]! - sigmoid(dot(wWf, wfTrX[i]!));
        cur.n += 1;
        catWf.set(cat, cur);
      }
    }
    const wfProbs = wfTest.map((p, i) => {
      let z = dot(wWf, featFn(p, i, wfTest));
      if (useCat) {
        const cur = catWf.get(p.category || 'Other');
        if (cur) z += clamp((cur.res * 4) / (cur.n + CAT_ODDS_LAMBDA), -1.1, 1.1);
      }
      return sigmoid(z);
    });
    const wfAct = wfTest.map((p) => (isNoTokenRecorded(p) ? 0 : 1));
    return { cv: brierAndAcc(cvProbs, yAll), wf: brierAndAcc(wfProbs, wfAct) };
  };

  const base = evalOdds(() => [1], false);
  const plusAge = evalOdds((p) => [1, ageYears(asOf, p.listed_at)], false);
  const plusAgeCat = evalOdds((p) => [1, ageYears(asOf, p.listed_at)], true);
  const plusTvl = evalOdds((p) => [1, ageYears(asOf, p.listed_at), Math.log(Math.max(1, p.tvl_usd) / TVL_REF)], true);
  const plusG7 = evalOdds((p) => [1, ageYears(asOf, p.listed_at), Math.log(Math.max(1, p.tvl_usd) / TVL_REF), growth7d(p)], true);
  const plusCh = evalOdds((p) => [1, ageYears(asOf, p.listed_at), Math.log(Math.max(1, p.tvl_usd) / TVL_REF), growth7d(p), Math.log(Math.max(1, p.chains.length))], true);
  const ctrl = evalOdds((p, i, pool) => [1, ageYears(asOf, p.listed_at), Math.log(Math.max(1, p.tvl_usd) / TVL_REF), growth7d(p), growth7d(pool[(i + 11) % pool.length]!)], true);

  // Fit full kept odds model: [1, ageYears, ln(TVL/100M), g7] + shrunk category effect
  const fullX = peers.map((p) => [1, ageYears(asOf, p.listed_at), Math.log(Math.max(1, p.tvl_usd) / TVL_REF), growth7d(p)]);
  const wOdds = fitLogisticRidge(fullX, yAll, 2.0);
  const catSums = new Map<string, { res: number; n: number }>();
  for (let i = 0; i < peers.length; i++) {
    const cat = peers[i]!.category || 'Other';
    const cur = catSums.get(cat) ?? { res: 0, n: 0 };
    cur.res += yAll[i]! - sigmoid(dot(wOdds, fullX[i]!));
    cur.n += 1;
    catSums.set(cat, cur);
  }
  const catOddsLogit = new Map<string, number>();
  for (const [cat, cur] of catSums) {
    catOddsLogit.set(cat, clamp((cur.res * 4) / (cur.n + CAT_ODDS_LAMBDA), -1.1, 1.1));
  }

  const oddsAblation: OddsAblationRow[] = [
    { term: 'base rate of peers', cv_brier: base.cv.brier, cv_acc: base.cv.acc, wf_brier: base.wf.brier, wf_acc: base.wf.acc, status: 'baseline' },
    { term: '+ age, years listed', cv_brier: plusAge.cv.brier, cv_acc: plusAge.cv.acc, wf_brier: plusAge.wf.brier, wf_acc: plusAge.wf.acc, status: 'kept' },
    { term: `+ category effect (λ=${CAT_ODDS_LAMBDA})`, cv_brier: plusAgeCat.cv.brier, cv_acc: plusAgeCat.cv.acc, wf_brier: plusAgeCat.wf.brier, wf_acc: plusAgeCat.wf.acc, status: 'kept' },
    { term: '+ size curve, ln TVL', cv_brier: plusTvl.cv.brier, cv_acc: plusTvl.cv.acc, wf_brier: plusTvl.wf.brier, wf_acc: plusTvl.wf.acc, status: 'kept' },
    { term: '+ 7-day TVL growth', cv_brier: plusG7.cv.brier, cv_acc: plusG7.cv.acc, wf_brier: plusG7.wf.brier, wf_acc: plusG7.wf.acc, status: 'kept' },
    { term: '+ chain count, ln', cv_brier: plusCh.cv.brier, cv_acc: plusCh.cv.acc, wf_brier: plusCh.wf.brier, wf_acc: plusCh.wf.acc, status: 'tested, not kept' },
    { term: '+ control: shuffled growth', cv_brier: ctrl.cv.brier, cv_acc: ctrl.cv.acc, wf_brier: ctrl.wf.brier, wf_acc: ctrl.wf.acc, status: 'control' },
  ];

  const baseRate = yAll.reduce((a, b) => a + b, 0) / Math.max(1, yAll.length);
  return { wOdds, catOddsLogit, oddsAblation, baseRate, nPeers: peers.length, nTokenized: yAll.reduce((a, b) => a + b, 0) };
}

function gasProfile(chain: string): { txUsd: number; label: string } {
  const c = chain.toLowerCase();
  if (['solana', 'sui', 'aptos', 'ton', 'sei', 'near', 'hyperliquid', 'pharos', 'bittensor'].includes(c)) {
    return { txUsd: 0.03, label: 'low-fee L1' };
  }
  if (['arbitrum', 'base', 'optimism', 'polygon', 'scroll', 'linea', 'zksync era', 'mantle', 'blast', 'mode', 'sonic', 'ink', 'berachain', 'unichain'].includes(c)) {
    return { txUsd: 0.16, label: 'L2 rollup' };
  }
  if (c === 'ethereum') return { txUsd: 4.8, label: 'Ethereum L1' };
  return { txUsd: 0.35, label: 'network gas' };
}

function buildFarmPlan(p: SnapshotProtocol, age: number | null): {
  steps: string[];
  planDepositUsd: number;
  totalFeeUsd: number;
  hours: number;
  holdDays: number;
} {
  const primary = p.chains[0] ?? 'Mainnet';
  const secondary = p.chains[1];
  const gas = gasProfile(primary);
  const holdDays = age !== null && age >= 420 && p.tvl_usd >= 50_000_000 ? 60 : 84;
  const weeks = Math.round(holdDays / 7);
  const planDepositUsd = Math.round(clamp(p.tvl_usd * 0.00025, 1000, 10000) / 100) * 100;
  const c = (p.category ?? '').toLowerCase();
  const txCount = 4 + Math.ceil(weeks / 2);
  let protocolFee = 0;
  let hours = round3(0.75 + weeks * 0.18);
  const gasStr = gas.txUsd < 0.1 ? '$0.03' : `$${gas.txUsd.toFixed(2)}`;

  let deployStep = `Deposit $${planDepositUsd.toLocaleString()} USDC into ${p.name}'s primary vault on ${primary} via a single non-Sybil wallet to establish baseline snapshot liquidity. Cost: ${gasStr} x 2 (${gas.label}); time: 12 min.`;
  let activeStep = `Compound or top up >=$50 every two weeks across ${weeks} weeks (${Math.ceil(weeks / 2)} touches) so multi-epoch retention is recorded on ${p.name}. Cost: ${gasStr}/touch; time: 8 min/touch.`;

  if (c.includes('dex')) {
    protocolFee = round3(planDepositUsd * 0.0012);
    deployStep = `Seed $${planDepositUsd.toLocaleString()} into ${p.name}'s highest-volume pool on ${primary} and route 4 organic swaps >=$75 to qualify for both LP and trader multipliers. Cost: ${gasStr} x 5 + ~$${protocolFee.toFixed(2)} swap fee; time: 15 min.`;
    activeStep = `Rebalance LP ticks and route $${Math.round(planDepositUsd * 0.8).toLocaleString()} biweekly volume on ${p.name}${secondary ? ` (${primary} + ${secondary})` : ''} for ${weeks} weeks. Cost: ${gasStr}/touch; time: 12 min/touch.`;
    hours = round3(1.0 + weeks * 0.22);
  } else if (c.includes('lend') || c.includes('cdp')) {
    deployStep = `Supply $${planDepositUsd.toLocaleString()} blue-chip collateral on ${p.name} (${primary}) and borrow 30% LTV in stablecoins to accrue dual supply+borrow points with health factor >2.3. Cost: ${gasStr} x 3; time: 12 min.`;
    activeStep = `Adjust 10% of the borrow leg biweekly on ${p.name} and audit liquidation buffer across ${weeks} weeks. Cost: ${gasStr}/touch; time: 9 min/touch.`;
  } else if (c.includes('derivative') || c.includes('perp') || c.includes('basis') || c.includes('prediction')) {
    protocolFee = round3(planDepositUsd * 0.0025);
    deployStep = `Fund $${planDepositUsd.toLocaleString()} collateral on ${p.name} (${primary}) and place maker-fee hedged orders to build organic open interest without directional liquidation risk. Cost: ${gasStr} + ~$${protocolFee.toFixed(2)} maker fees; time: 18 min.`;
    activeStep = `Maintain weekly hedged maker volume (>=2x collateral) across 2+ distinct days per week on ${p.name} for ${weeks} weeks. Cost: ${gasStr}/wk; time: 14 min/wk.`;
    hours = round3(1.2 + weeks * 0.28);
  } else if (c.includes('rwa')) {
    deployStep = `Mint or acquire $${planDepositUsd.toLocaleString()} of ${p.name}'s yield-bearing RWA instrument on ${primary} and hold continuously in self-custody to earn native base yield while farming. Cost: ${gasStr} x 2; time: 15 min.`;
  } else if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield')) {
    deployStep = `Allocate $${planDepositUsd.toLocaleString()} USDC/WETH into ${p.name}'s flagship curated vault on ${primary}, prioritizing vaults with active partner point boosts. Cost: ${gasStr} x 2; time: 12 min.`;
  }

  const totalFeeUsd = round3(gas.txUsd * txCount + protocolFee);
  const steps = [
    `Isolate a dedicated farming wallet on ${primary} funded directly from an exchange with $${planDepositUsd.toLocaleString()} principal plus $${Math.max(6, Math.ceil(totalFeeUsd * 2.5))} native gas (no cross-wallet links). Cost: ${gasStr}; time: 8 min.`,
    deployStep,
    activeStep,
    `Hold continuous TVL in ${p.name} for ${holdDays} days (${weeks} weeks) without zeroing balances between snapshots; cumulative gas + protocol fees ~ $${totalFeeUsd.toFixed(2)} over ${hours.toFixed(1)}h total work.`,
    `Log every deposit, rebalance, and epoch balance from official ${p.name} docs only, and unwind gradually post-TGE after verifying claim eligibility. Cost: ${gasStr} claim/exit; time: 10 min.`,
  ];

  return {
    steps: steps.map((s) => (s.length > 596 ? `${s.slice(0, 593)}...` : s)),
    planDepositUsd,
    totalFeeUsd,
    hours,
    holdDays,
  };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const wlSet = new Set(snapshot.watchlist);
  const ledger: LedgerBreakdown = {
    total: snapshot.protocols.length,
    ranked_watchlist: 0,
    ranked_early: 0,
    ranked_offlist: 0,
    token_priced: 0,
    token_nocap: 0,
    out_bridge: 0,
    out_lst: 0,
    out_exchange: 0,
    out_versioned: 0,
    out_wrapped: 0,
  };

  const rankedCandidates: Array<{ p: SnapshotProtocol; tier: 'watchlist' | 'early' | 'offlist' }> = [];
  const eligiblePeers: SnapshotProtocol[] = [];
  const cleanComps: SnapshotProtocol[] = [];
  const allPricedLive: SnapshotProtocol[] = [];

  for (const p of snapshot.protocols) {
    const noTok = isNoTokenRecorded(p);
    const excl = exclusionReason(p);
    if (!noTok) {
      if (p.mcap_usd !== null && p.mcap_usd > 0) {
        ledger.token_priced++;
        allPricedLive.push(p);
        if (excl === null && p.tvl_usd > 0) cleanComps.push(p);
      } else {
        ledger.token_nocap++;
      }
      if (excl === null) eligiblePeers.push(p);
      continue;
    }
    if (wlSet.has(p.slug)) {
      ledger.ranked_watchlist++;
      rankedCandidates.push({ p, tier: 'watchlist' });
      eligiblePeers.push(p);
      continue;
    }
    if (excl === 'bridge') { ledger.out_bridge++; continue; }
    if (excl === 'lst') { ledger.out_lst++; continue; }
    if (excl === 'exchange') { ledger.out_exchange++; continue; }
    if (excl === 'versioned') { ledger.out_versioned++; continue; }
    if (excl === 'wrapped') { ledger.out_wrapped++; continue; }

    eligiblePeers.push(p);
    if (p.tvl_usd >= snapshot.floor_usd) {
      ledger.ranked_offlist++;
      rankedCandidates.push({ p, tier: 'offlist' });
    } else {
      ledger.ranked_early++;
      rankedCandidates.push({ p, tier: 'early' });
    }
  }

  const valFit = fitValueModelAndAblate(cleanComps, snapshot.as_of);
  const oddsFit = fitTokenOddsAndAblate(eligiblePeers, snapshot.as_of);

  const scored = rankedCandidates.map(({ p, tier }) => {
    const cat = p.category || 'Other';
    const lnTvlRel = Math.log(Math.max(1, p.tvl_usd) / TVL_REF);
    const catValAdj = valFit.catEffect.get(cat) ?? 0;
    const logMult = clamp(valFit.wFull[0]! + valFit.wFull[1]! * lnTvlRel + catValAdj, Math.log(0.02), Math.log(12));
    const launchVal = Math.max(1, Math.round(p.tvl_usd * Math.exp(logMult)));

    const ageY = ageYears(snapshot.as_of, p.listed_at);
    const g7 = growth7d(p);
    const catOdds = oddsFit.catOddsLogit.get(cat) ?? 0;
    const zOdds =
      oddsFit.wOdds[0]! +
      oddsFit.wOdds[1]! * ageY +
      oddsFit.wOdds[2]! * lnTvlRel +
      oddsFit.wOdds[3]! * g7 +
      catOdds;
    const tokenOdds = clamp(sigmoid(zOdds), 0.08, 0.96);

    const implied = Math.max(1, Math.round(launchVal * tokenOdds));
    const p25 = Math.max(1, Math.round(implied * Math.exp(valFit.q25)));
    const p75 = Math.max(implied + 1, Math.round(implied * Math.exp(valFit.q75)));
    const p10 = Math.max(1, Math.round(implied * Math.exp(valFit.q10)));
    const p90 = Math.max(p75 + 1, Math.round(implied * Math.exp(valFit.q90)));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const plan = buildFarmPlan(p, age);

    return {
      p,
      tier,
      age,
      tokenOdds,
      launchVal,
      implied,
      p25,
      p75,
      p10,
      p90,
      impliedMult: implied / Math.max(1, p.tvl_usd),
      plan,
      model: {
        base_multiple: round4(Math.exp(valFit.wFull[0]!)),
        size_mult: round4(Math.exp(valFit.wFull[1]! * lnTvlRel)),
        category_mult: round4(Math.exp(catValAdj)),
        token_odds: round4(tokenOdds),
        odds_age_logit: round3(oddsFit.wOdds[1]! * ageY),
        odds_tvl_logit: round3(oddsFit.wOdds[2]! * lnTvlRel),
        odds_g7_logit: round3(oddsFit.wOdds[3]! * g7),
        odds_cat_logit: round3(catOdds),
      },
    };
  });

  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    tier: s.tier,
    is_watchlist: s.tier === 'watchlist',
    age_days: s.age,
    token_odds: round4(s.tokenOdds),
    launch_value_usd: s.launchVal,
    implied_value_usd: s.implied,
    p25_value_usd: s.p25,
    p75_value_usd: s.p75,
    p10_value_usd: s.p10,
    p90_value_usd: s.p90,
    implied_multiple: round4(s.impliedMult),
    plan_deposit_usd: s.plan.planDepositUsd,
    farm_cost_usd: s.plan.totalFeeUsd,
    farm_hours: s.plan.hours,
    hold_days: s.plan.holdDays,
    model: s.model,
    farm_steps: s.plan.steps,
  }));

  const live: LiveRow[] = cleanComps
    .filter((p) => p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .map((p) => {
      const cat = p.category || 'Other';
      const lnTvlRel = Math.log(Math.max(1, p.tvl_usd) / TVL_REF);
      const catValAdj = valFit.catEffect.get(cat) ?? 0;
      const pred = Math.max(1, Math.round(p.tvl_usd * Math.exp(clamp(valFit.wFull[0]! + valFit.wFull[1]! * lnTvlRel + catValAdj, Math.log(0.02), Math.log(12)))));
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        mcap_tvl_ratio: round4(p.mcap_usd! / p.tvl_usd),
        pred_mcap_usd: pred,
        change_7d: p.change_7d,
        symbol: p.symbol,
        listed_at: p.listed_at,
      };
    });

  const seal = computeSeal(board);
  const totalImplied = board.reduce((s, r) => s + r.implied_value_usd, 0);

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    seal,
    total_implied_usd: totalImplied,
    ledger,
    value_params: {
      base_mult_100m: round3(Math.exp(valFit.wFull[0]!)),
      size_slope: round3(valFit.wFull[1]!),
      cat_lambda: CAT_VAL_LAMBDA,
      cat_min: round3(valFit.catMin),
      cat_max: round3(valFit.catMax),
      q25_log: round3(valFit.q25),
      q75_log: round3(valFit.q75),
      q10_log: round3(valFit.q10),
      q90_log: round3(valFit.q90),
    },
    odds_params: {
      intercept: round3(oddsFit.wOdds[0]!),
      age_coef: round3(oddsFit.wOdds[1]!),
      tvl_coef: round3(oddsFit.wOdds[2]!),
      g7_coef: round3(oddsFit.wOdds[3]!),
      base_rate: round3(oddsFit.baseRate),
      n_peers: oddsFit.nPeers,
      n_tokenized: oddsFit.nTokenized,
    },
    value_ablation: valFit.valueAblation,
    odds_ablation: oddsFit.oddsAblation,
    range_audit: valFit.rangeAudit,
    watchlist_size: ledger.ranked_watchlist,
    board_size: board.length,
    early_size: ledger.ranked_early,
    offlist_size: ledger.ranked_offlist,
    live_size: live.length,
    rows: board.map(({ mcap_usd: _m, gecko_id: _g, symbol: _s, ...rest }) => rest),
    live,
  };

  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  const o = JSON.parse(text) as Snapshot;
  if (!o || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) {
    throw new Error('Invalid snapshot.json');
  }
  return o;
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `board length ${board.length} out of 100..4000`;
  for (let i = 0; i < board.length; i++) {
    if (board[i]!.rank !== i + 1) return `rank mismatch at ${i}`;
    if (i > 0 && board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `not sorted at ${i}`;
    for (const s of board[i]!.farm_steps) {
      if (s.length < 20 || s.length > 600) return `bad farm step len ${s.length}`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
