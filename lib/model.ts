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

export interface RidgeWeights {
  intercept: number;
  log_tvl_slope: number;
  log_age_slope: number;
  growth_7d_slope: number;
  log_chains_slope: number;
  lambda: number;
}

export interface ValidationMetrics {
  folds: number;
  live_comps_total: number;
  live_comps_fitted: number;
  cv_r2_log: number;
  baseline_r2_log: number;
  cv_rmse_log: number;
  cv_median_ape_pct: number;
  baseline_median_ape_pct: number;
  global_median_multiple: number;
}

export interface CategoryStat {
  category: string;
  total_protocols: number;
  live_count: number;
  pre_token_count: number;
  tokenization_rate: number;
  median_multiple: number;
  cat_residual_log: number;
  median_tvl_usd: number;
}

export interface UniverseBreakdown {
  total: number;
  watchlist: number;
  early_pre_token: number;
  live_token: number;
  excluded_wrapped_cex: number;
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
  token_status: 'pre-token';
  is_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  p10_value_usd: number;
  p90_value_usd: number;
  implied_multiple: number;
  peer_token_rate: number;
  farm_cost_usd: number;
  hold_days: number;
  model: {
    base_multiple: number;
    tvl_scale_mult: number;
    growth_mult: number;
    age_mult: number;
    chain_mult: number;
    category_mult: number;
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
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  weights: RidgeWeights;
  validation: ValidationMetrics;
  universe: UniverseBreakdown;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_stats: CategoryStat[];
  rows: Array<{
    rank: number;
    slug: string;
    name: string;
    category: string | null;
    chains: string[];
    tvl_usd: number;
    change_7d: number | null;
    listed_at: string | null;
    age_days: number | null;
    is_watchlist: boolean;
    implied_value_usd: number;
    p10_value_usd: number;
    p90_value_usd: number;
    implied_multiple: number;
    peer_token_rate: number;
    farm_cost_usd: number;
    hold_days: number;
    model: BoardRow['model'];
    farm_steps: string[];
  }>;
  live: LiveRow[];
}

export const MODEL_VERSION = 'ridge-cv-v3';
const DAY_MS = 86_400_000;
const LAMBDA = 6.0;
const CAT_SHRINK = 4.0;
const TVL_REF = 100_000_000;
const AGE_REF = 365;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATS = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(1, Math.floor((a - b) / DAY_MS));
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATS.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

function featureVec(p: SnapshotProtocol, asOf: string): [number, number, number, number, number] {
  const age = ageDays(asOf, p.listed_at) ?? AGE_REF;
  const g7 = clamp(typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0, -50, 150) / 100;
  const ch = Math.max(1, p.chains.length);
  return [1, Math.log(Math.max(1, p.tvl_usd) / TVL_REF), Math.log(age / AGE_REF), g7, Math.log(ch)];
}

/** Solve (X^T X + lambda * I_no_bias) w = X^T y via Gauss-Jordan elimination. */
function solveRidge(X: number[][], y: number[], lam: number): number[] {
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
    let pivRow = i;
    for (let r = i + 1; r < k; r++) {
      if (Math.abs(A[r]![i]!) > Math.abs(A[pivRow]![i]!)) pivRow = r;
    }
    if (pivRow !== i) {
      [A[i], A[pivRow]] = [A[pivRow]!, A[i]!];
      [b[i], b[pivRow]] = [b[pivRow]!, b[i]!];
    }
    const piv = A[i]![i] || 1e-9;
    for (let j = i; j < k; j++) A[i]![j]! /= piv;
    b[i]! /= piv;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = A[r]![i]!;
      for (let j = i; j < k; j++) A[r]![j]! -= f * A[i]![j]!;
      b[r]! -= f * b[i]!;
    }
  }
  return b;
}

const dot = (w: number[], x: number[]): number => w.reduce((acc, wi, i) => acc + wi * x[i]!, 0);

function fitRidgeAndCrossValidate(snapshot: Snapshot): {
  weights: RidgeWeights;
  catResidualLog: Map<string, number>;
  validation: ValidationMetrics;
  categoryStats: CategoryStat[];
  catTokenRate: Map<string, number>;
} {
  const rawLive = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  // Fit on non-extreme comps [0.02x..15x] to prevent memecoin / dead-TVL outliers distorting slopes
  const fitted = rawLive.filter((p) => {
    const r = p.mcap_usd! / p.tvl_usd;
    return r >= 0.02 && r <= 15.0;
  });

  const X = fitted.map((p) => featureVec(p, snapshot.as_of));
  const yRatio = fitted.map((p) => Math.log(p.mcap_usd! / p.tvl_usd));
  const yMcap = fitted.map((p) => Math.log(p.mcap_usd!));
  const wFull = solveRidge(X, yRatio, LAMBDA);

  // Empirical-Bayes shrunk category residuals on full fitted sample
  const catResList = new Map<string, number[]>();
  for (let i = 0; i < fitted.length; i++) {
    const cat = fitted[i]!.category || 'Other';
    const res = yRatio[i]! - dot(wFull, X[i]!);
    let arr = catResList.get(cat);
    if (!arr) {
      arr = [];
      catResList.set(cat, arr);
    }
    arr.push(res);
  }
  const catResidualLog = new Map<string, number>();
  for (const [cat, arr] of catResList) {
    const sum = arr.reduce((a, b) => a + b, 0);
    catResidualLog.set(cat, clamp(sum / (arr.length + CAT_SHRINK), -0.9, 0.9));
  }

  // Deterministic 5-fold cross-validation
  const folds = 5;
  const predMcap = new Array<number>(fitted.length).fill(0);
  const baseMcap = new Array<number>(fitted.length).fill(0);
  for (let fold = 0; fold < folds; fold++) {
    const trX: number[][] = [];
    const trY: number[] = [];
    const trIdx: number[] = [];
    const teIdx: number[] = [];
    for (let i = 0; i < fitted.length; i++) {
      if (i % folds === fold) teIdx.push(i);
      else {
        trIdx.push(i);
        trX.push(X[i]!);
        trY.push(yRatio[i]!);
      }
    }
    const wf = solveRidge(trX, trY, LAMBDA);
    const medLogRatio = median(trY);
    const foldCat = new Map<string, number[]>();
    for (const idx of trIdx) {
      const cat = fitted[idx]!.category || 'Other';
      const r = yRatio[idx]! - dot(wf, X[idx]!);
      let arr = foldCat.get(cat);
      if (!arr) {
        arr = [];
        foldCat.set(cat, arr);
      }
      arr.push(r);
    }
    for (const idx of teIdx) {
      const cat = fitted[idx]!.category || 'Other';
      const arr = foldCat.get(cat);
      const cAdj = arr ? clamp(arr.reduce((a, b) => a + b, 0) / (arr.length + CAT_SHRINK), -0.9, 0.9) : 0;
      const logTvl = Math.log(fitted[idx]!.tvl_usd);
      predMcap[idx] = logTvl + dot(wf, X[idx]!) + cAdj;
      baseMcap[idx] = logTvl + medLogRatio;
    }
  }

  const meanY = yMcap.reduce((a, b) => a + b, 0) / Math.max(1, yMcap.length);
  const ssTot = yMcap.reduce((a, y) => a + (y - meanY) ** 2, 0) || 1;
  const ssRes = yMcap.reduce((a, y, i) => a + (y - predMcap[i]!) ** 2, 0);
  const ssBase = yMcap.reduce((a, y, i) => a + (y - baseMcap[i]!) ** 2, 0);
  const apeMod = median(yMcap.map((y, i) => Math.abs(Math.exp(predMcap[i]!) - Math.exp(y)) / Math.exp(y))) * 100;
  const apeBase = median(yMcap.map((y, i) => Math.abs(Math.exp(baseMcap[i]!) - Math.exp(y)) / Math.exp(y))) * 100;
  const cvRmse = Math.sqrt(ssRes / Math.max(1, yMcap.length));
  const globalMedMult = Math.exp(median(yRatio));

  // Category tokenization & comp statistics across entire 758-protocol snapshot
  const catBuckets = new Map<string, { total: number; live: number; pre: number; ratios: number[]; tvls: number[] }>();
  for (const p of snapshot.protocols) {
    const cat = p.category || 'Other';
    let b = catBuckets.get(cat);
    if (!b) {
      b = { total: 0, live: 0, pre: 0, ratios: [], tvls: [] };
      catBuckets.set(cat, b);
    }
    b.total += 1;
    if (isPreToken(p)) b.pre += 1;
    else b.live += 1;
    if (p.mcap_usd && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX') {
      const r = p.mcap_usd / p.tvl_usd;
      if (r >= 0.02 && r <= 15.0) {
        b.ratios.push(r);
        b.tvls.push(p.tvl_usd);
      }
    }
  }

  const categoryStats: CategoryStat[] = [];
  const catTokenRate = new Map<string, number>();
  for (const [category, b] of catBuckets) {
    // Bayesian-smoothed tokenization rate (prior 35% with weight 4)
    const rate = round4((b.live + 4 * 0.35) / (b.total + 4));
    catTokenRate.set(category, rate);
    if (b.ratios.length > 0 || b.pre >= 3) {
      categoryStats.push({
        category,
        total_protocols: b.total,
        live_count: b.live,
        pre_token_count: b.pre,
        tokenization_rate: rate,
        median_multiple: round4(b.ratios.length > 0 ? median(b.ratios) : globalMedMult),
        cat_residual_log: round4(catResidualLog.get(category) ?? 0),
        median_tvl_usd: Math.round(b.tvls.length > 0 ? median(b.tvls) : 0),
      });
    }
  }
  categoryStats.sort((a, b) => b.live_count - a.live_count || b.total_protocols - a.total_protocols);

  return {
    weights: {
      intercept: round4(wFull[0]!),
      log_tvl_slope: round4(wFull[1]!),
      log_age_slope: round4(wFull[2]!),
      growth_7d_slope: round4(wFull[3]!),
      log_chains_slope: round4(wFull[4]!),
      lambda: LAMBDA,
    },
    catResidualLog,
    validation: {
      folds,
      live_comps_total: rawLive.length,
      live_comps_fitted: fitted.length,
      cv_r2_log: round4(1 - ssRes / ssTot),
      baseline_r2_log: round4(1 - ssBase / ssTot),
      cv_rmse_log: round4(cvRmse),
      cv_median_ape_pct: round4(apeMod),
      baseline_median_ape_pct: round4(apeBase),
      global_median_multiple: round4(globalMedMult),
    },
    categoryStats,
    catTokenRate,
  };
}

function gasProfile(chain: string): { txUsd: number; label: string } {
  const c = chain.toLowerCase();
  if (['solana', 'sui', 'aptos', 'ton', 'sei', 'near', 'hyperliquid'].includes(c)) return { txUsd: 0.02, label: 'low-fee L1' };
  if (['arbitrum', 'base', 'optimism', 'polygon', 'scroll', 'linea', 'zksync era', 'mantle', 'blast', 'mode', 'sonic'].includes(c)) {
    return { txUsd: 0.15, label: 'L2 rollup' };
  }
  if (c === 'ethereum') return { txUsd: 5.5, label: 'Ethereum L1' };
  return { txUsd: 0.35, label: 'network gas' };
}

function holdDaysFor(age: number | null, tvl: number): number {
  if (age !== null && age >= 450 && tvl >= 50_000_000) return 30;
  if (age !== null && age >= 180) return 45;
  return 60;
}

function buildFarmPlan(p: SnapshotProtocol, age: number | null): { steps: string[]; totalGasUsd: number; holdDays: number } {
  const primary = p.chains[0] ?? 'Mainnet';
  const secondary = p.chains[1];
  const gas = gasProfile(primary);
  const hold = holdDaysFor(age, p.tvl_usd);
  const weeks = Math.max(4, Math.round(hold / 7));
  const c = (p.category ?? '').toLowerCase();
  const baseCap = p.tvl_usd >= 500_000_000 ? 1000 : p.tvl_usd >= 100_000_000 ? 500 : 250;
  const totalGasUsd = Math.round((gas.txUsd * (4 + weeks)) * 100) / 100;
  const gasStr = gas.txUsd < 0.1 ? '$0.02' : `$${gas.txUsd.toFixed(2)}`;

  let deployStep = `Deposit $${baseCap} USDC (scales linearly for $1K/$10K/$50K accounts) into ${p.name}'s primary yield vault on ${primary} to establish a non-Sybil snapshot balance. Est. gas: ${gasStr} (${gas.label}); time: 10 min.`;
  let weeklyStep = `Run 1 organic weekly action (compound, top-up $25+, or rotate across vaults) on ${p.name} for ${weeks} consecutive weeks so multi-epoch consistency is recorded. Est. gas: ${gasStr}/wk; time: 8 min/wk.`;

  if (c.includes('dex')) {
    deployStep = `Seed $${baseCap} into a correlated or top-fee LP pool on ${p.name} (${primary}) and route 3 organic swaps >=$50 to qualify as both LP and active trader. Est. gas: ${gasStr} x 4; time: 12 min.`;
    weeklyStep = `Execute >=$${baseCap * 2} weekly swap volume and rebalance active LP ticks on ${p.name}${secondary ? ` across ${primary} and ${secondary}` : ''}. Est. gas: ${gasStr}/wk; time: 10 min/wk.`;
  } else if (c.includes('lend') || c.includes('cdp')) {
    deployStep = `Supply $${baseCap} blue-chip collateral on ${p.name} (${primary}) and borrow 30-35% LTV in stablecoins to earn dual supply+borrow points while keeping health factor >2.2. Est. gas: ${gasStr} x 2; time: 10 min.`;
    weeklyStep = `Repay or adjust 10% of the borrow balance weekly on ${p.name} and verify liquidation buffer across ${weeks} epochs. Est. gas: ${gasStr}/wk; time: 8 min/wk.`;
  } else if (c.includes('derivative') || c.includes('perp') || c.includes('basis')) {
    deployStep = `Fund $${baseCap} margin on ${p.name} (${primary}) and execute maker-fee delta-neutral or hedged trades to build organic open-interest and volume scores. Est. gas: ${gasStr} + ~0.04% maker fee; time: 15 min.`;
    weeklyStep = `Generate >=$${baseCap * 5} weekly notional maker volume across 2+ distinct trading days on ${p.name} for ${weeks} weeks. Est. fee+gas: ~$${Math.max(0.5, baseCap * 0.002).toFixed(2)}/wk; time: 15 min/wk.`;
  } else if (c.includes('risk curator') || c.includes('allocator') || c.includes('yield')) {
    deployStep = `Allocate $${baseCap} USDC/ETH into ${p.name}'s flagship curated vault on ${primary}, targeting vaults with active partner incentives to stack base APY plus pre-token points. Est. gas: ${gasStr} x 2; time: 10 min.`;
  } else if (c.includes('rwa')) {
    deployStep = `Mint or acquire $${baseCap} of ${p.name}'s yield-bearing RWA token on ${primary} and hold continuously in a single self-custody wallet to earn native T-bill/credit yield while farming. Est. gas: ${gasStr}; time: 12 min.`;
  } else if (c.includes('restak') || c.includes('stak')) {
    deployStep = `Stake $${baseCap} of native/LST collateral via ${p.name} on ${primary} and hold the liquid receipt token without looping past 2x leverage. Est. gas: ${gasStr} x 2; time: 10 min.`;
  }

  const steps = [
    `Prepare an isolated farming wallet on ${primary} with $${baseCap}+ principal and a $${Math.max(5, Math.ceil(totalGasUsd * 3))} native gas reserve (no cross-wallet dust transfers). Cost: ${gasStr} funding; time: 5 min.`,
    deployStep,
    weeklyStep,
    `Maintain continuous TVL exposure on ${p.name} for ${hold} days (${weeks} epochs) without withdrawing to zero between snapshots; estimated cumulative gas over window: ~$${totalGasUsd.toFixed(2)}. Time: ${hold} days hold.`,
    `Track accrual via official protocol docs/analytics only, export all tx hashes for claim verification, and unwind gradually after TGE rather than panic-exiting pre-snapshot. Cost: ${gasStr} exit/claim; time: 10 min.`,
  ];
  return { steps: steps.map((s) => (s.length > 596 ? `${s.slice(0, 593)}...` : s)), totalGasUsd, holdDays: hold };
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitRidgeAndCrossValidate(snapshot);
  const wVec = [
    fit.weights.intercept,
    fit.weights.log_tvl_slope,
    fit.weights.log_age_slope,
    fit.weights.growth_7d_slope,
    fit.weights.log_chains_slope,
  ];
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const wlSet = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const z80 = 1.2816; // 80% interval (p10..p90) from held-out CV RMSE
  const scored = [...chosen.values()].map((p) => {
    const cat = p.category || 'Other';
    const x = featureVec(p, snapshot.as_of);
    const catRes = fit.catResidualLog.get(cat) ?? 0;
    const logRatioPred = clamp(dot(wVec, x) + catRes, Math.log(0.03), Math.log(8.0));
    const impliedMult = Math.exp(logRatioPred);
    const implied = Math.max(1, Math.round(p.tvl_usd * impliedMult));
    const band = clamp(fit.validation.cv_rmse_log * z80, 0.35, 2.2);
    const p10 = Math.max(1, Math.round(implied * Math.exp(-band)));
    const p90 = Math.max(implied + 1, Math.round(implied * Math.exp(band)));
    const age = ageDays(snapshot.as_of, p.listed_at);
    const plan = buildFarmPlan(p, age);
    return {
      p,
      isWatchlist: wlSet.has(p.slug),
      age,
      implied,
      p10,
      p90,
      impliedMult,
      peerTokenRate: fit.catTokenRate.get(cat) ?? 0.35,
      plan,
      model: {
        base_multiple: round4(Math.exp(wVec[0]!)),
        tvl_scale_mult: round4(Math.exp(wVec[1]! * x[1]!)),
        age_mult: round4(Math.exp(wVec[2]! * x[2]!)),
        growth_mult: round4(Math.exp(wVec[3]! * x[3]!)),
        chain_mult: round4(Math.exp(wVec[4]! * x[4]!)),
        category_mult: round4(Math.exp(catRes)),
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
    token_status: 'pre-token',
    is_watchlist: s.isWatchlist,
    age_days: s.age,
    implied_value_usd: s.implied,
    p10_value_usd: s.p10,
    p90_value_usd: s.p90,
    implied_multiple: round4(s.impliedMult),
    peer_token_rate: s.peerTokenRate,
    farm_cost_usd: s.plan.totalGasUsd,
    hold_days: s.plan.holdDays,
    model: s.model,
    farm_steps: s.plan.steps,
  }));

  const liveAll = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX');
  const live: LiveRow[] = liveAll
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 50)
    .map((p) => {
      const cat = p.category || 'Other';
      const x = featureVec(p, snapshot.as_of);
      const catRes = fit.catResidualLog.get(cat) ?? 0;
      const pred = Math.round(p.tvl_usd * Math.exp(clamp(dot(wVec, x) + catRes, Math.log(0.03), Math.log(8.0))));
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
      };
    });

  const wlCount = board.filter((r) => r.is_watchlist).length;
  const earlyCount = board.length - wlCount;
  const totalLive = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const excludedCount = snapshot.protocols.length - board.length - totalLive;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    weights: fit.weights,
    validation: fit.validation,
    universe: {
      total: snapshot.protocols.length,
      watchlist: wlCount,
      early_pre_token: earlyCount,
      live_token: totalLive,
      excluded_wrapped_cex: Math.max(0, excludedCount),
    },
    watchlist_size: wlCount,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    category_stats: fit.categoryStats.slice(0, 18),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      is_watchlist: r.is_watchlist,
      implied_value_usd: r.implied_value_usd,
      p10_value_usd: r.p10_value_usd,
      p90_value_usd: r.p90_value_usd,
      implied_multiple: r.implied_multiple,
      peer_token_rate: r.peer_token_rate,
      farm_cost_usd: r.farm_cost_usd,
      hold_days: r.hold_days,
      model: r.model,
      farm_steps: r.farm_steps,
    })),
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
