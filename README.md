# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/SimplyMar/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/SimplyMar/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Calibrated pre-token protocol valuation radar & actionable farming planner built for [make.fun/bounty/token-radar-01](https://make.fun/bounty/token-radar-01).

## Model (`radar-2-calibrated`)
- Empirically calibrates category `MCap / TVL` multiples directly from live-token protocols in `/input/snapshot.json` (with sample-size shrinkage toward the global median).
- Scores all watchlist protocols and rankable pre-token protocols using `TVL × CategoryMultiple × GrowthMult(change_7d) × MaturityMult(age_days) × ChainMult(chains)`.
- Generates chain-aware, category-specific 5-step farming plans with estimated gas costs and time horizons.
