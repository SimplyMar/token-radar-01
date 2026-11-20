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

export interface ModelConstants {
  global_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
}

export const MODEL_VERSION = 'radar-2-calibrated';

export const DEFAULT_MODEL: ModelConstants = {
  global_multiple: 0.28,
  growth_weight: 0.45,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_cap: 6,
};

export interface CategoryStat {
  category: string;
  sample_count: number;
  median_multiple: number;
  median_tvl_usd: number;
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
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl_ratio: number | null;
  change_7d: number | null;
  symbol: string | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
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
    category_multiple: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    farm_steps: string[];
  }>;
  live: LiveRow[];
}

const DAY_MS = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATS = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function median(nums: number[]): number {
  if (nums.length === 0) return 0.28;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
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

/** Calibrate category MCap/TVL multiples directly from live-token protocols in the snapshot. */
export function calibrateCategories(snapshot: Snapshot): {
  globalMultiple: number;
  byCategory: Map<string, CategoryStat>;
  statsList: CategoryStat[];
} {
  const allRatios: number[] = [];
  const grouped = new Map<string, { ratios: number[]; tvls: number[] }>();

  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === 'CEX') continue;
    const ratio = clamp(p.mcap_usd / p.tvl_usd, 0.04, 5.0);
    allRatios.push(ratio);
    const cat = p.category || 'Other';
    let entry = grouped.get(cat);
    if (!entry) {
      entry = { ratios: [], tvls: [] };
      grouped.set(cat, entry);
    }
    entry.ratios.push(ratio);
    entry.tvls.push(p.tvl_usd);
  }

  const globalMultiple = round4(clamp(median(allRatios), 0.12, 1.5));
  const byCategory = new Map<string, CategoryStat>();
  const statsList: CategoryStat[] = [];

  for (const [category, g] of grouped) {
    const rawMed = median(g.ratios);
    // Shrink small samples toward global median for stability
    const weight = Math.min(1, g.ratios.length / 5);
    const blended = rawMed * weight + globalMultiple * (1 - weight);
    const stat: CategoryStat = {
      category,
      sample_count: g.ratios.length,
      median_multiple: round4(clamp(blended, 0.10, 2.25)),
      median_tvl_usd: Math.round(median(g.tvls)),
    };
    byCategory.set(category, stat);
    statsList.push(stat);
  }

  statsList.sort((a, b) => b.sample_count - a.sample_count || b.median_multiple - a.median_multiple);
  return { globalMultiple, byCategory, statsList };
}

function gasEstimateFor(chain: string): { txUsd: string; label: string } {
  const c = chain.toLowerCase();
  if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'ton') return { txUsd: '$0.01', label: 'ultra-low fee' };
  if (c === 'arbitrum' || c === 'base' || c === 'optimism' || c === 'polygon' || c === 'scroll' || c === 'linea' || c === 'hyperliquid') {
    return { txUsd: '$0.05–$0.20', label: 'L2 gas' };
  }
  if (c === 'ethereum') return { txUsd: '$3–$8', label: 'L1 gas' };
  return { txUsd: '$0.10–$0.50', label: 'network gas' };
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 60;
  if (age < 365) return 45;
  return 30;
}

function buildFarmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const primaryChain = p.chains[0] ?? 'Mainnet';
  const secondaryChain = p.chains[1];
  const gas = gasEstimateFor(primaryChain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const c = (p.category ?? '').toLowerCase();

  let coreAction = `Deposit $${capital} USDC into ${p.name}'s core vault on ${primaryChain} to start accruing protocol activity.`;
  let cadenceAction = `Execute 1 weekly interaction (rebalance, top-up, or claim) on ${p.name} to maintain multi-epoch consistency.`;

  if (c.includes('dex')) {
    coreAction = `Provide $${capital} in a correlated or high-volume LP pair on ${p.name} (${primaryChain}) and route 3 swaps >=$25.`;
    cadenceAction = `Rebalance range or execute >=$50 swap volume weekly on ${p.name} across ${secondaryChain ? `${primaryChain}/${secondaryChain}` : primaryChain}.`;
  } else if (c.includes('lend') || c.includes('cdp')) {
    coreAction = `Supply $${capital} collateral on ${p.name} (${primaryChain}) and borrow 30–40% LTV in stables to stay safe from liquidation.`;
    cadenceAction = `Repay/adjust borrow ratio weekly and monitor health factor above 2.0 on ${p.name}.`;
  } else if (c.includes('derivative') || c.includes('perp')) {
    coreAction = `Deposit $${capital} margin into ${p.name} (${primaryChain}) and place delta-neutral or hedged trades for organic volume.`;
    cadenceAction = `Generate >=$${capital * 4} weekly notional volume with limit orders on ${p.name}.`;
  } else if (c.includes('staking') || c.includes('restak')) {
    coreAction = `Stake $${capital} of native/LST collateral via ${p.name} on ${primaryChain} and retain the liquid receipt token.`;
  } else if (c.includes('rwa')) {
    coreAction = `Mint or hold $${capital} of ${p.name}'s yield-bearing RWA instrument on ${primaryChain} in a single tracked wallet.`;
  } else if (c.includes('prediction')) {
    coreAction = `Fund $${capital} on ${p.name} (${primaryChain}) and take balanced positions across 3+ active markets.`;
  } else if (c.includes('bridge')) {
    coreAction = `Bridge $${capital} USDC via ${p.name} to ${primaryChain} across 2 distinct weekly batches.`;
  }

  const steps = [
    `Isolate a dedicated farming wallet on ${primaryChain} funded with $${capital} capital plus $15 gas buffer. Cost: ${gas.txUsd} setup (${gas.label}). Time: 5 min.`,
    `${coreAction} Cost: $${capital} locked capital + ${gas.txUsd} tx fee. Time: 10 min.`,
    `${cadenceAction} Cost: ~${gas.txUsd} per week. Time: 10 min/week.`,
    `Hold the position continuously for at least ${hold} days across multiple snapshot windows without full withdrawal. Cost: $${capital} opportunity cost. Time: ${hold} days.`,
    `Verify official points/leaderboard dashboard and claim only via verified protocol channels; log all tx hashes. Cost: ${gas.txUsd} claim gas. Time: 10 min.`,
  ];

  return steps.map((s) => (s.length > 596 ? `${s.slice(0, 593)}...` : s));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrateCategories(snapshot);
  const model: ModelConstants = { ...DEFAULT_MODEL, global_multiple: cal.globalMultiple };
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const wlSet = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) {
      chosen.set(p.slug, p);
    }
  }

  const scored = [...chosen.values()].map((p) => {
    const cat = p.category || 'Other';
    const catMult = cal.byCategory.get(cat)?.median_multiple ?? model.global_multiple;
    const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
    const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
    const growthMult = 1 + (growthPct / 100) * model.growth_weight;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const ageForModel = age ?? model.unknown_age_days;
    const maturityMult =
      model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
    const extraChains = clamp(p.chains.length - 1, 0, model.chain_cap);
    const chainMult = 1 + extraChains * model.chain_step;
    const implied = Math.max(1, Math.round(p.tvl_usd * catMult * growthMult * maturityMult * chainMult));
    return {
      p,
      isWatchlist: wlSet.has(p.slug),
      implied,
      catMult,
      growthPct,
      growthMult,
      maturityMult,
      chainMult,
      age,
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
    model: {
      category_multiple: round4(s.catMult),
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: buildFarmSteps(s.p, s.age),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      mcap_tvl_ratio: p.mcap_usd && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.is_watchlist).length,
    live_size: live.length,
    category_stats: cal.statsList.slice(0, 16),
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
      category_multiple: r.model.category_multiple,
      growth_multiplier: r.model.growth_multiplier,
      maturity_multiplier: r.model.maturity_multiplier,
      chain_multiplier: r.model.chain_multiplier,
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
