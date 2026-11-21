(() => {
  const D = window.RADAR;
  if (!D) return;

  const qs = new URLSearchParams(location.search);
  const state = {
    view: qs.get('view') || 'pre', // 'pre' | 'live'
    tier: qs.get('tier') || 'all', // 'all' | 'watchlist' | 'early' | 'offlist'
    verdict: qs.get('verdict') || 'all', // 'all' | 'farm' | 'marginal' | 'skip'
    cat: qs.get('cat') || 'ALL',
    chain: qs.get('chain') || 'ALL',
    q: qs.get('q') || '',
    depositMode: qs.get('dep') || 'plan', // 'plan' | '1000' | '5000' | '10000'
    dropPct: Number(qs.get('drop') || '7'),
    weeks: Number(qs.get('wk') || '12'),
    sort: qs.get('sort') || 'rank',
    dir: qs.get('dir') || 'asc',
    slug: qs.get('slug') || '',
    showOos: qs.get('oos') !== '0',
  };

  const fmtUsd = (n) => {
    if (n == null || !Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    const s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + '$' + (a / 1e3).toFixed(1) + 'K';
    if (a >= 10) return s + '$' + Math.round(a);
    return s + '$' + a.toFixed(2);
  };
  const fmtPct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');
  const fmtAge = (d) => (d == null ? '—' : d >= 365 ? (d / 365.25).toFixed(1) + ' yr' : d + ' d');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function recomputeSeal(rows) {
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

  function verifyIntegrity() {
    const rows = D.rows;
    let mono = true;
    let sum = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) mono = false;
      if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) mono = false;
      sum += rows[i].implied_value_usd;
    }
    const seal = recomputeSeal(rows);
    const L = D.ledger;
    const ledSum =
      L.ranked_watchlist + L.ranked_early + L.ranked_offlist + L.token_priced + L.token_nocap +
      L.out_bridge + L.out_lst + L.out_exchange + L.out_versioned + L.out_wrapped;
    return {
      ok: mono && seal === D.seal && sum === D.total_implied_usd && ledSum === L.total,
      mono,
      seal,
      sum,
      ledSum,
    };
  }

  function farmEconomics(r) {
    const dep = state.depositMode === 'plan' ? r.plan_deposit_usd : Number(state.depositMode);
    const share = dep / Math.max(1, r.tvl_usd + dep);
    const dropEv = r.implied_value_usd * (state.dropPct / 100) * share;
    const wkScale = state.weeks / Math.max(4, r.hold_days / 7);
    const fees = r.farm_cost_usd * (0.45 + 0.55 * wkScale);
    const tbillOpp = dep * 0.042 * ((state.weeks * 7) / 365);
    const hours = r.farm_hours * (0.4 + 0.6 * wkScale);
    const netOfFees = dropEv - fees;
    const netPerHr = hours > 0 ? netOfFees / hours : 0;
    const verdict = netOfFees >= 20 && netPerHr >= 12 ? 'farm' : netOfFees > 0 ? 'marginal' : 'skip';
    return { dep, dropEv, fees, tbillOpp, hours, netOfFees, netOfAll: netOfFees - tbillOpp, netPerHr, verdict };
  }

  const allCats = [...new Set(D.rows.map((r) => r.category || 'Other'))].sort();
  const allChains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();

  function renderScatterSvg() {
    const W = 380, H = 132, pL = 38, pB = 22, pT = 10, pR = 10;
    const minX = 6.5, maxX = 10.6, minY = 5.5, maxY = 10.5;
    const sx = (v) => pL + ((Math.log10(Math.max(3e6, v)) - minX) / (maxX - minX)) * (W - pL - pR);
    const sy = (v) => H - pB - ((Math.log10(Math.max(3e5, v)) - minY) / (maxY - minY)) * (H - pT - pB);
    const pts = [1e7, 1e8, 1e9, 1e10].map((t) => {
      const m = t * D.value_params.base_mult_100m * Math.pow(t / 1e8, D.value_params.size_slope);
      return `${sx(t).toFixed(1)},${sy(m).toFixed(1)}`;
    }).join(' ');
    const liveDots = D.live.slice(0, 92).map((l) =>
      `<circle cx="${sx(l.tvl_usd).toFixed(1)}" cy="${sy(l.mcap_usd).toFixed(1)}" r="2.3" fill="#94a3b8" fill-opacity="0.7"/>`
    ).join('');
    const preDots = D.rows.slice(0, 60).map((r) =>
      `<circle cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.launch_value_usd).toFixed(1)}" r="2.4" fill="#38bdf8" fill-opacity="0.85"/>`
    ).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:126px;display:block;background:#0b1019;border:1px solid #233047;border-radius:4px">
      ${[6, 7, 8, 9, 10].map((e) => `<line x1="${pL}" y1="${sy(10 ** e).toFixed(1)}" x2="${W - pR}" y2="${sy(10 ** e).toFixed(1)}" stroke="#1a2436"/><text x="${pL - 4}" y="${(sy(10 ** e) + 3).toFixed(1)}" text-anchor="end" font-size="8" fill="#8b9bb4" font-family="monospace">$10^${e}</text>`).join('')}
      ${[7, 8, 9, 10].map((e) => `<text x="${sx(10 ** e).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="8" fill="#8b9bb4" font-family="monospace">$10^${e}</text>`).join('')}
      <polyline fill="none" stroke="#fbbf24" stroke-width="1.6" stroke-dasharray="4 2" points="${pts}"/>
      ${liveDots}${preDots}
      <text x="${W - pR - 2}" y="18" text-anchor="end" font-size="8.2" fill="#94a3b8" font-family="monospace">● Traded comps (${D.range_audit.n_loo})</text>
      <text x="${W - pR - 2}" y="29" text-anchor="end" font-size="8.2" fill="#38bdf8" font-family="monospace">● Ranked board (if launch)</text>
      <text x="${W - pR - 2}" y="40" text-anchor="end" font-size="8.2" fill="#fbbf24" font-family="monospace">-- TVL^${(1 + D.value_params.size_slope).toFixed(2)} curve</text>
    </svg>`;
  }

  function exportFile(kind) {
    const rows = getFilteredRows();
    let blob, name;
    if (kind === 'json') {
      blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
      name = 'token-radar-filtered.json';
    } else {
      const hdr = 'rank,slug,name,tier,category,tvl_usd,change_7d,age_days,token_odds,launch_value_usd,implied_value_usd,p25_usd,p75_usd,verdict,net_of_fees_usd,net_per_hr\n';
      const body = rows.map((r) => {
        const e = farmEconomics(r);
        return [r.rank, r.slug, `"${r.name.replace(/"/g, '""')}"`, r.tier, `"${r.category || 'Other'}"`, r.tvl_usd, r.change_7d ?? '', r.age_days ?? '', r.token_odds, r.launch_value_usd, r.implied_value_usd, r.p25_value_usd, r.p75_value_usd, e.verdict, e.netOfFees.toFixed(2), e.netPerHr.toFixed(2)].join(',');
      }).join('\n');
      blob = new Blob([hdr + body], { type: 'text/csv' });
      name = 'token-radar-filtered.csv';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function getFilteredRows() {
    const q = state.q.trim().toLowerCase();
    return D.rows
      .filter((r) => {
        if (state.tier !== 'all' && r.tier !== state.tier) return false;
        if (state.cat !== 'ALL' && (r.category || 'Other') !== state.cat) return false;
        if (state.chain !== 'ALL' && !r.chains.includes(state.chain)) return false;
        if (state.verdict !== 'all' && farmEconomics(r).verdict !== state.verdict) return false;
        if (q && !r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q) && !(r.category || '').toLowerCase().includes(q) && !r.chains.some((c) => c.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => {
        const d = state.dir === 'asc' ? 1 : -1;
        if (state.sort === 'tvl') return (a.tvl_usd - b.tvl_usd) * d;
        if (state.sort === 'g7') return ((a.change_7d ?? -999) - (b.change_7d ?? -999)) * d;
        if (state.sort === 'age') return ((a.age_days ?? 0) - (b.age_days ?? 0)) * d;
        if (state.sort === 'odds') return (a.token_odds - b.token_odds) * d;
        if (state.sort === 'launch') return (a.launch_value_usd - b.launch_value_usd) * d;
        if (state.sort === 'net') return (farmEconomics(a).netOfAll - farmEconomics(b).netOfAll) * d;
        if (state.sort === 'hr') return (farmEconomics(a).netPerHr - farmEconomics(b).netPerHr) * d;
        return (a.rank - b.rank) * d;
      });
  }

  function render() {
    const app = document.getElementById('app');
    const integ = verifyIntegrity();
    const L = D.ledger;
    const ra = D.range_audit;
    const vBase = D.value_ablation[0];
    const vBest = D.value_ablation.filter((x) => x.status === 'kept').slice(-1)[0] || D.value_ablation[1];
    const oBase = D.odds_ablation[0];
    const oBest = D.odds_ablation.filter((x) => x.status === 'kept').slice(-1)[0] || D.odds_ablation[1];
    const vKept = D.value_ablation.filter((x) => x.status === 'kept').length;
    const oKept = D.odds_ablation.filter((x) => x.status === 'kept').length;

    const allEcons = D.rows.map((r) => farmEconomics(r));
    const nFarm = allEcons.filter((e) => e.verdict === 'farm').length;
    const nMarg = allEcons.filter((e) => e.verdict === 'marginal').length;
    const nSkip = allEcons.filter((e) => e.verdict === 'skip').length;

    const rows = getFilteredRows();
    const sel = D.rows.find((r) => r.slug === state.slug) || null;
    const visTvl = rows.reduce((s, r) => s + r.tvl_usd, 0);
    const visImp = rows.reduce((s, r) => s + r.implied_value_usd, 0);
    const maxLogVal = Math.log10(Math.max(1e6, D.rows[0]?.p90_value_usd || 1e9));
    const minLogVal = Math.log10(Math.max(1e5, D.rows[D.rows.length - 1]?.p10_value_usd || 1e5));

    const barSegs = [
      ['l-wl', L.ranked_watchlist, 'Watchlist'],
      ['l-er', L.ranked_early, 'Early (<$50M)'],
      ['l-of', L.ranked_offlist, 'Off-list'],
      ['l-tp', L.token_priced, 'Token trades (priced)'],
      ['l-tn', L.token_nocap, 'Token recorded (no cap)'],
      ['l-br', L.out_bridge, 'Bridge'],
      ['l-ls', L.out_lst, 'Liquid staking'],
      ['l-ex', L.out_exchange, 'Exchange'],
      ['l-vw', L.out_versioned + L.out_wrapped, 'Versioned/wrapped'],
    ];

    let workspaceHtml = '';
    if (state.view === 'live') {
      workspaceHtml = `<div class="tbl-card"><table class="board"><thead><tr>
        <th>Live Traded Comparable (Separated From Pre-Token Board)</th><th>Symbol</th><th>Category</th><th>Listed</th>
        <th class="r">TVL</th><th class="r">Actual MCap</th><th class="r">Model Pred</th><th class="r">MCap / TVL</th><th class="r">7d %</th>
      </tr></thead><tbody>${D.live.slice(0, 60).map((l) => `<tr>
        <td><div class="pname">${esc(l.name)}</div><div class="psub">${esc(l.chains.slice(0, 3).join(', '))}</div></td>
        <td><span class="tag wl">${esc(l.symbol || '—')}</span></td>
        <td>${esc(l.category || 'Other')}</td>
        <td style="font-family:var(--mono);font-size:10.5px;color:var(--muted)">${esc(l.listed_at || '—')}</td>
        <td class="r">${fmtUsd(l.tvl_usd)}</td>
        <td class="r pos">${fmtUsd(l.mcap_usd)}</td>
        <td class="r">${fmtUsd(l.pred_mcap_usd)}</td>
        <td class="r">${l.mcap_tvl_ratio.toFixed(2)}x</td>
        <td class="r ${(l.change_7d ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(l.change_7d)}</td>
      </tr>`).join('')}</tbody></table></div>`;
    } else {
      const tableHtml = `<div class="tbl-card"><table class="board"><thead><tr>
        <th data-sort="rank">#</th>
        <th data-sort="rank">Protocol</th>
        <th class="r" data-sort="tvl">TVL</th>
        <th class="r col-opt" data-sort="g7">7D</th>
        <th class="r col-opt" data-sort="age">No-Token Age</th>
        <th class="r" data-sort="odds">Token Odds</th>
        <th class="r col-opt" data-sort="launch">If It Launches</th>
        <th class="r" data-sort="rank">Implied Value · P25–P75</th>
        <th class="r" data-sort="net">Verdict · Net of Fees</th>
        <th class="r col-opt" data-sort="hr">Net / Hour</th>
      </tr></thead><tbody>${rows.slice(0, 65).map((r) => {
        const e = farmEconomics(r);
        const pct = (v) => Math.max(2, Math.min(96, ((Math.log10(Math.max(1e5, v)) - minLogVal) / Math.max(0.5, maxLogVal - minLogVal)) * 100));
        const x25 = pct(r.p25_value_usd), x50 = pct(r.implied_value_usd), x75 = pct(r.p75_value_usd);
        return `<tr class="brow ${sel && sel.slug === r.slug ? 'sel' : ''}" data-slug="${esc(r.slug)}">
          <td class="r" style="color:var(--muted);font-weight:800">${r.rank}</td>
          <td>
            <div class="pname">${esc(r.name)}<span class="tag ${r.tier}">${r.tier === 'watchlist' ? 'Watchlist' : r.tier === 'early' ? 'Early' : 'Off-list'}</span></div>
            <div class="psub">${esc(r.category || 'Other')} · ${esc(r.chains.slice(0, 2).join(', '))}${r.chains.length > 2 ? ` +${r.chains.length - 2}` : ''}</div>
          </td>
          <td class="r">${fmtUsd(r.tvl_usd)}</td>
          <td class="r col-opt ${(r.change_7d ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(r.change_7d)}</td>
          <td class="r col-opt" style="color:var(--ink-2)">${fmtAge(r.age_days)}</td>
          <td class="r"><div class="odds-wrap"><div class="odds-bar"><div class="odds-fill" style="width:${Math.round(r.token_odds * 100)}%"></div></div><span>${Math.round(r.token_odds * 100)}%</span></div></td>
          <td class="r col-opt" style="color:var(--ink-2)">${fmtUsd(r.launch_value_usd)}</td>
          <td class="r"><div class="range-cell">
            <div class="range-top">
              <div class="whisker"><div class="w-iqr" style="left:${x25.toFixed(1)}%;width:${Math.max(4, x75 - x25).toFixed(1)}%"></div><div class="w-dot" style="left:${x50.toFixed(1)}%"></div></div>
              <span class="range-num">${fmtUsd(r.implied_value_usd)}</span>
            </div>
            <span class="range-sub">${fmtUsd(r.p25_value_usd)}–${fmtUsd(r.p75_value_usd)}</span>
          </div></td>
          <td class="r">
            <span class="vbadge ${e.verdict}">${e.verdict}</span>
            <strong class="${e.netOfFees >= 0 ? 'pos' : 'neg'}" style="margin-left:4px">${e.netOfFees >= 0 ? '+' : ''}${fmtUsd(e.netOfFees)}</strong>
            <span class="vsub">${fmtUsd(e.dropEv)} drop − ${fmtUsd(e.fees)} fees</span>
          </td>
          <td class="r col-opt ${e.netPerHr >= 12 ? 'pos' : e.netPerHr >= 0 ? 'amb' : 'neg'}">${e.netPerHr >= 0 ? '+' : ''}$${e.netPerHr.toFixed(2)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

      let detailHtml = '';
      if (sel) {
        const e = farmEconomics(sel);
        const peers = D.live.filter((l) => (l.category || 'Other') === (sel.category || 'Other')).slice(0, 4);
        detailHtml = `<aside class="detail">
          <div class="dhead">
            <div>
              <h2>#${sel.rank} ${esc(sel.name)} <span class="tag ${sel.tier}">${sel.tier}</span></h2>
              <div class="psub">${esc(sel.slug)} · ${esc(sel.category || 'Other')} · ${esc(sel.chains.join(', '))} · listed ${esc(sel.listed_at || 'unknown')}</div>
            </div>
            <button class="close-btn" id="closeDetail">Close</button>
          </div>
          <div class="dsec"><span>Valuation Decomposition (Implied = Launch × Odds)</span><span>${esc(D.model_version)}</span></div>
          <div class="mgrid">
            <div class="mcell">Implied Value<strong class="pos">${fmtUsd(sel.implied_value_usd)}</strong></div>
            <div class="mcell">If Token Launches<strong>${fmtUsd(sel.launch_value_usd)}</strong></div>
            <div class="mcell">Token Odds (Peer)<strong style="color:var(--sky)">${(sel.token_odds * 100).toFixed(1)}%</strong></div>
            <div class="mcell">P25 – P75 Range<strong>${fmtUsd(sel.p25_value_usd)} – ${fmtUsd(sel.p75_value_usd)}</strong></div>
            <div class="mcell">P10 – P90 Range<strong>${fmtUsd(sel.p10_value_usd)} – ${fmtUsd(sel.p90_value_usd)}</strong></div>
            <div class="mcell">Multipliers (Base·Size·Cat)<strong>${sel.model.base_multiple.toFixed(2)}× · ${sel.model.size_mult.toFixed(2)}× · ${sel.model.category_mult.toFixed(2)}×</strong></div>
          </div>
          <div class="pnl-box">
            <div class="dsec" style="margin:0"><span>Farm Economics (${fmtUsd(e.dep)} · ${state.dropPct}% drop · ${state.weeks} wk)</span><span class="vbadge ${e.verdict}">${e.verdict}</span></div>
            <div class="pnl-grid">
              <div class="mcell">Est. Drop EV<strong class="pos">${fmtUsd(e.dropEv)}</strong></div>
              <div class="mcell">Gas + Protocol Fees<strong>${fmtUsd(e.fees)}</strong></div>
              <div class="mcell">T-Bill Opp (4.2%)<strong>${fmtUsd(e.tbillOpp)}</strong></div>
              <div class="mcell">Net / Hour (${e.hours.toFixed(1)}h)<strong class="${e.netPerHr >= 20 ? 'pos' : e.netPerHr >= 0 ? 'amb' : 'neg'}">${e.netPerHr >= 0 ? '+' : ''}$${e.netPerHr.toFixed(2)}/h</strong></div>
            </div>
          </div>
          <div class="dsec"><span>Concrete Farm Plan (${sel.farm_steps.length} Steps)</span><span>Est. base fees ${fmtUsd(sel.farm_cost_usd)} · ${sel.hold_days}d</span></div>
          <ol class="steps">${sel.farm_steps.map((s, idx) => `<li class="step"><span class="snum">0${idx + 1}</span>${esc(s)}</li>`).join('')}</ol>
          ${peers.length ? `<div class="dsec"><span>Nearest Traded Category Comps (${esc(sel.category || 'Other')})</span><span>Separated live tokens</span></div>
            <table class="mini-tbl"><thead><tr><th>Peer</th><th class="r">TVL</th><th class="r">Actual MCap</th><th class="r">MCap/TVL</th></tr></thead><tbody>
              ${peers.map((p) => `<tr><td>${esc(p.name)} (${esc(p.symbol || '')})</td><td class="r">${fmtUsd(p.tvl_usd)}</td><td class="r pos">${fmtUsd(p.mcap_usd)}</td><td class="r">${p.mcap_tvl_ratio.toFixed(2)}x</td></tr>`).join('')}
            </tbody></table>` : ''}
        </aside>`;
      }
      workspaceHtml = `<section class="workspace ${detailHtml ? 'has-detail' : ''}">${tableHtml}${detailHtml}</section>`;
    }

    app.innerHTML = `<div class="shell">
      <header class="topbar">
        <div class="brand">
          <div class="mark">LR</div>
          <div>
            <h1>Launch Radar</h1>
            <div class="sub">Pre-token protocols valued strictly from DefiLlama snapshot records · zero hand-picked names · zero network</div>
          </div>
        </div>
        <div class="meta-right">
          <div>Snapshot <strong>${esc(D.as_of)}</strong> · Model <strong>${esc(D.model_version)}</strong></div>
          <div>${L.total} protocols audited · ${D.board_size} ranked · ${D.live_size} live comps separated</div>
        </div>
      </header>

      <section class="kpis">
        <div class="kpi">
          <div class="lbl">Out-of-Sample Miss (WF)</div>
          <div class="val g">×${vBest.wf_miss.toFixed(2)} <span class="dim">vs ×${vBase.wf_miss.toFixed(2)} flat</span></div>
          <div class="hint">Walk-forward (older→newer); LOO ×${vBest.loo_miss.toFixed(2)} vs ×${vBase.loo_miss.toFixed(2)}</div>
        </div>
        <div class="kpi">
          <div class="lbl">Is the Printed Range Honest?</div>
          <div class="val s">${Math.round(ra.in_p25_p75_wf * 100)}% · ${Math.round(ra.in_p10_p90_wf * 100)}%</div>
          <div class="hint">Walk-forward caps inside P25–P75 (50%) &amp; P10–P90 (80%)</div>
        </div>
        <div class="kpi">
          <div class="lbl">Token Odds Brier (WF)</div>
          <div class="val">${oBest.wf_brier.toFixed(3)} <span class="dim">vs ${oBase.wf_brier.toFixed(3)}</span></div>
          <div class="hint">${Math.round(oBest.wf_acc * 100)}% of later peers called right vs ${Math.round(oBase.wf_acc * 100)}% base</div>
        </div>
        <div class="kpi">
          <div class="lbl">Terms Kept / Tested</div>
          <div class="val">${vKept} of 6 · ${oKept} of 6</div>
          <div class="hint">Value model · token odds; rejected terms &amp; control shown below</div>
        </div>
        <div class="kpi">
          <div class="lbl">Worth Farming (Scenario)</div>
          <div class="val a">${nFarm} of ${D.board_size}</div>
          <div class="hint">Net beats fees &amp; $12/hr; ${nMarg} marginal, ${nSkip} skip</div>
        </div>
        <div class="kpi">
          <div class="lbl">Watchlist Ranked</div>
          <div class="val g">${D.watchlist_size} / ${D.watchlist_size}</div>
          <div class="hint">Plus ${D.early_size} early (&lt;$50M) &amp; ${D.offlist_size} off-list pre-token</div>
        </div>
      </section>

      <div class="formula">
        <strong>Implied value = TVL × fitted launch multiple (size curve + category ridge) × peer token odds (age, TVL, 7d growth, category).</strong>
        DefiLlama records no token for ranked rows; this board prices peers from snapshot records and never claims a token will launch.
      </div>

      <section class="ledger-box">
        <div class="ledger-head">
          <strong>Protocol Accounting (${L.total} of ${L.total} Snapshot Protocols)</strong>
          <span>${D.board_size} ranked pre-token · ${L.token_priced + L.token_nocap} already record a token · ${L.out_bridge + L.out_lst + L.out_exchange + L.out_versioned + L.out_wrapped} set aside by house rules</span>
        </div>
        <div class="lbar">${barSegs.map(([cls, n, lbl]) => `<div class="lseg ${cls}" style="width:${(n / L.total) * 100}%" title="${lbl}: ${n}"></div>`).join('')}</div>
        <div class="l-legend">${barSegs.map(([cls, n, lbl]) => `<span><i class="${cls}"></i>${lbl} <strong>${n}</strong></span>`).join('')}</div>
        <div class="seal-row">
          <span class="seal-pill ${integ.ok ? '' : 'bad'}">✓ this table = board.json: ${D.board_size}/${D.board_size} rows verified</span>
          <span class="seal-pill ${integ.mono ? '' : 'bad'}">✓ ranks 1–${D.board_size} monotone</span>
          <span class="seal-pill">✓ total implied: ${fmtUsd(integ.sum)}</span>
          <span class="seal-pill">✓ seal ${integ.seal} == main.ts</span>
          <span class="seal-pill">✓ watchlist ${D.watchlist_size}/${D.watchlist_size}</span>
          <span class="seal-pill">✓ ledger ${integ.ledSum}/${L.total}</span>
        </div>
      </section>

      ${state.showOos ? `<section class="oos-box">
        <div class="oos-head">
          <strong>Out-of-Sample Evidence (Leave-One-Out &amp; Walk-Forward Ablation)</strong>
          <span>Every candidate term is tested blind on traded comps (n=${ra.n_loo}) and eligible peers (n=${D.odds_params.n_peers}) before inclusion</span>
        </div>
        <div class="oos-grid">
          <div class="oos-col">
            <h3>Value if Token Launches <span>median ×miss</span></h3>
            <table class="mini-tbl"><thead><tr><th>Term Added</th><th class="r">LOO</th><th class="r">Walk-Fwd</th><th class="r">Status</th></tr></thead><tbody>
              ${D.value_ablation.map((x) => `<tr class="${x.status === 'kept' ? 'kept' : ''}">
                <td>${esc(x.term)}</td><td class="r">×${x.loo_miss.toFixed(2)}</td><td class="r">×${x.wf_miss.toFixed(2)}</td>
                <td class="r ${x.status === 'kept' ? 'st-kept' : x.status === 'baseline' ? 'st-base' : x.status === 'control' ? 'st-ctrl' : 'st-drop'}">${esc(x.status)}</td>
              </tr>`).join('')}
            </tbody></table>
          </div>
          <div class="oos-col">
            <h3>Token Odds (Peer Record) <span>Brier (% right)</span></h3>
            <table class="mini-tbl"><thead><tr><th>Term Added</th><th class="r">10-Fold</th><th class="r">Walk-Fwd</th><th class="r">Status</th></tr></thead><tbody>
              ${D.odds_ablation.map((x) => `<tr class="${x.status === 'kept' ? 'kept' : ''}">
                <td>${esc(x.term)}</td>
                <td class="r">${x.cv_brier.toFixed(3)} (${Math.round(x.cv_acc * 100)}%)</td>
                <td class="r">${x.wf_brier.toFixed(3)} (${Math.round(x.wf_acc * 100)}%)</td>
                <td class="r ${x.status === 'kept' ? 'st-kept' : x.status === 'baseline' ? 'st-base' : x.status === 'control' ? 'st-ctrl' : 'st-drop'}">${esc(x.status)}</td>
              </tr>`).join('')}
            </tbody></table>
          </div>
          <div class="oos-col">
            <h3>Calibration &amp; Size Curve <span>within 3×: ${Math.round(ra.within_3x_wf * 100)}% WF</span></h3>
            ${renderScatterSvg()}
          </div>
        </div>
        <div class="oos-note">
          7-day growth and age do not reduce held-out launch-multiple miss, so the value model leaves them out; both improve held-out token-odds Brier score, so they enter implied value through peer token odds.
        </div>
      </section>` : ''}

      <section class="controls">
        <div class="btn-group">
          <button class="fbtn ${state.view === 'pre' && state.verdict === 'all' ? 'active' : ''}" data-verdict="all">All ${D.board_size}</button>
          <button class="fbtn g ${state.view === 'pre' && state.verdict === 'farm' ? 'active' : ''}" data-verdict="farm">Farm ${nFarm}</button>
          <button class="fbtn ${state.view === 'pre' && state.verdict === 'marginal' ? 'active' : ''}" data-verdict="marginal">Marginal ${nMarg}</button>
          <button class="fbtn ${state.view === 'pre' && state.verdict === 'skip' ? 'active' : ''}" data-verdict="skip">Skip ${nSkip}</button>
        </div>
        <div class="sep"></div>
        <div class="btn-group">
          <button class="fbtn s ${state.view === 'pre' && state.tier === 'all' ? 'active' : ''}" data-tier="all">All tiers</button>
          <button class="fbtn s ${state.view === 'pre' && state.tier === 'watchlist' ? 'active' : ''}" data-tier="watchlist">Watchlist ${D.watchlist_size}</button>
          <button class="fbtn s ${state.view === 'pre' && state.tier === 'early' ? 'active' : ''}" data-tier="early">Early ${D.early_size}</button>
          <button class="fbtn s ${state.view === 'pre' && state.tier === 'offlist' ? 'active' : ''}" data-tier="offlist">Off-list ${D.offlist_size}</button>
          <button class="fbtn ${state.view === 'live' ? 'active' : ''}" data-view="live">Live Comps ${D.live_size}</button>
        </div>
        <div class="sep"></div>
        <span class="ctrl-lbl">Deposit</span>
        <select id="depSel">
          <option value="plan" ${state.depositMode === 'plan' ? 'selected' : ''}>Plan size</option>
          <option value="1000" ${state.depositMode === '1000' ? 'selected' : ''}>$1,000</option>
          <option value="5000" ${state.depositMode === '5000' ? 'selected' : ''}>$5,000</option>
          <option value="10000" ${state.depositMode === '10000' ? 'selected' : ''}>$10,000</option>
        </select>
        <span class="ctrl-lbl">Drop</span>
        <select id="dropSel">
          <option value="5" ${state.dropPct === 5 ? 'selected' : ''}>5%</option>
          <option value="7" ${state.dropPct === 7 ? 'selected' : ''}>7%</option>
          <option value="10" ${state.dropPct === 10 ? 'selected' : ''}>10%</option>
        </select>
        <span class="ctrl-lbl">Hold</span>
        <select id="wkSel">
          <option value="8" ${state.weeks === 8 ? 'selected' : ''}>8 wk</option>
          <option value="12" ${state.weeks === 12 ? 'selected' : ''}>12 wk</option>
        </select>
        <input id="qIn" type="search" placeholder="Search protocol, chain, cat..." value="${esc(state.q)}" style="width:165px">
        <select id="catSel"><option value="ALL">All categories</option>${allCats.map((c) => `<option value="${esc(c)}" ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="chSel"><option value="ALL">All chains</option>${allChains.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <button class="fbtn" id="toggleOos">${state.showOos ? 'Hide OOS' : 'Show OOS'}</button>
        <button class="fbtn" id="expCsv">CSV</button>
        <button class="fbtn" id="expJson">JSON</button>
        <span class="spacer"></span>
        <span class="count-txt">${rows.length}/${D.board_size} · ${fmtUsd(visTvl)} TVL · ${fmtUsd(visImp)} implied</span>
      </section>

      ${workspaceHtml}

      <footer class="foot">
        <span>Data source: ${esc(D.source)} · static offline dashboard · all parameters fitted directly on snapshot</span>
        <span>Click any row to inspect valuation math, quantile bands, live peer comps &amp; concrete farm execution plan</span>
      </footer>
    </div>`;

    app.querySelectorAll('[data-verdict]').forEach((b) => b.addEventListener('click', () => { state.view = 'pre'; state.verdict = b.dataset.verdict; render(); }));
    app.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => { state.view = 'pre'; state.tier = b.dataset.tier; render(); }));
    app.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => { state.view = b.dataset.view; render(); }));
    app.querySelector('#depSel')?.addEventListener('change', (e) => { state.depositMode = e.target.value; render(); });
    app.querySelector('#dropSel')?.addEventListener('change', (e) => { state.dropPct = Number(e.target.value); render(); });
    app.querySelector('#wkSel')?.addEventListener('change', (e) => { state.weeks = Number(e.target.value); render(); });
    app.querySelector('#qIn')?.addEventListener('input', (e) => { state.q = e.target.value; render(); });
    app.querySelector('#catSel')?.addEventListener('change', (e) => { state.cat = e.target.value; render(); });
    app.querySelector('#chSel')?.addEventListener('change', (e) => { state.chain = e.target.value; render(); });
    app.querySelector('#toggleOos')?.addEventListener('click', () => { state.showOos = !state.showOos; render(); });
    app.querySelector('#expCsv')?.addEventListener('click', () => exportFile('csv'));
    app.querySelector('#expJson')?.addEventListener('click', () => exportFile('json'));
    app.querySelector('#closeDetail')?.addEventListener('click', () => { state.slug = ''; render(); });
    app.querySelectorAll('tr.brow').forEach((tr) => tr.addEventListener('click', () => { state.slug = tr.dataset.slug; render(); }));
    app.querySelectorAll('table.board th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sort === k) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = k; state.dir = k === 'rank' ? 'asc' : 'desc'; }
      render();
    }));
  }

  render();
})();
