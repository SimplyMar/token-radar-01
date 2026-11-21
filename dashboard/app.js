(() => {
  const D = window.RADAR;
  if (!D) return;

  const qs = new URLSearchParams(location.search);
  const state = {
    tab: qs.get('tab') || 'all',
    search: qs.get('q') || '',
    category: qs.get('cat') || 'ALL',
    chain: qs.get('chain') || 'ALL',
    minGrowth: Number(qs.get('minGrowth') || '-999'),
    sortBy: qs.get('sort') || 'implied',
    sortDir: qs.get('dir') || 'desc',
    selectedSlug: qs.get('slug') || '',
    deposit: Number(qs.get('deposit') || '10000'),
    airdropPct: 5,
  };

  const fmtUsd = (n) => {
    if (n == null || !Number.isFinite(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  };
  const fmtPct = (n) => (n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const allCats = [...new Set(D.rows.map((r) => r.category || 'Other'))].sort();
  const allChains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();

  function farmEconomics(r, depositUsd) {
    const share = depositUsd / Math.max(1, r.tvl_usd + depositUsd);
    const poolUsd = r.implied_value_usd * (state.airdropPct / 100);
    const grossEv = poolUsd * share * r.peer_token_rate;
    const oppCost = depositUsd * 0.045 * (r.hold_days / 365);
    const totalCost = r.farm_cost_usd + oppCost;
    const netEv = grossEv - totalCost;
    const roiPct = totalCost > 0 ? (netEv / totalCost) * 100 : 0;
    const verdict = roiPct >= 150 ? ['High Conviction', 'high'] : roiPct >= 25 ? ['Selective', 'mid'] : ['Capital Heavy', 'low'];
    return { grossEv, oppCost, totalCost, netEv, roiPct, verdict };
  }

  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    return D.rows
      .filter((r) => {
        if (state.tab === 'watchlist' && !r.is_watchlist) return false;
        if (state.tab === 'early' && r.is_watchlist) return false;
        if (state.category !== 'ALL' && (r.category || 'Other') !== state.category) return false;
        if (state.chain !== 'ALL' && !r.chains.includes(state.chain)) return false;
        if (state.minGrowth > -900 && (r.change_7d ?? -999) < state.minGrowth) return false;
        if (q && !r.name.toLowerCase().includes(q) && !r.slug.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const dir = state.sortDir === 'asc' ? 1 : -1;
        if (state.sortBy === 'tvl') return (a.tvl_usd - b.tvl_usd) * dir;
        if (state.sortBy === 'growth') return ((a.change_7d ?? -999) - (b.change_7d ?? -999)) * dir;
        if (state.sortBy === 'age') return ((a.age_days ?? 0) - (b.age_days ?? 0)) * dir;
        if (state.sortBy === 'mult') return (a.implied_multiple - b.implied_multiple) * dir;
        if (state.sortBy === 'rate') return (a.peer_token_rate - b.peer_token_rate) * dir;
        return (a.implied_value_usd - b.implied_value_usd) * dir;
      });
  }

  function renderScatterSvg() {
    const pts = D.live.slice(0, 40).filter((l) => l.tvl_usd > 0 && l.mcap_usd > 0);
    const W = 540, H = 200, padL = 46, padB = 26, padT = 14, padR = 16;
    const minX = 6.5, maxX = 10.5, minY = 6.0, maxY = 10.5; // log10 USD
    const sx = (v) => padL + ((Math.log10(Math.max(1e6, v)) - minX) / (maxX - minX)) * (W - padL - padR);
    const sy = (v) => H - padB - ((Math.log10(Math.max(1e6, v)) - minY) / (maxY - minY)) * (H - padT - padB);
    const linePts = [1e7, 1e8, 1e9, 1e10].map((t) => {
      const m = t * Math.exp(D.weights.intercept + D.weights.log_tvl_slope * Math.log(t / 1e8));
      return `${sx(t).toFixed(1)},${sy(m).toFixed(1)}`;
    }).join(' ');
    const dots = pts.map((l) => `<circle cx="${sx(l.tvl_usd).toFixed(1)}" cy="${sy(l.mcap_usd).toFixed(1)}" r="3.6" fill="#1e4d8c" fill-opacity="0.72" stroke="#fff" stroke-width="0.7"><title>${esc(l.name)}: TVL ${fmtUsd(l.tvl_usd)}, MCap ${fmtUsd(l.mcap_usd)}</title></circle>`).join('');
    const wlDots = D.rows.slice(0, 15).map((r) => `<circle cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.implied_value_usd).toFixed(1)}" r="4.2" fill="#0f5c4d" stroke="#fffdf9" stroke-width="1"><title>#${r.rank} ${esc(r.name)} (Pre-Token): TVL ${fmtUsd(r.tvl_usd)}, Implied ${fmtUsd(r.implied_value_usd)}</title></circle>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:195px;display:block;background:#faf7f0;border:1px solid #d9d0be;border-radius:3px">
      ${[7, 8, 9, 10].map((e) => `<line x1="${padL}" y1="${sy(10 ** e).toFixed(1)}" x2="${W - padR}" y2="${sy(10 ** e).toFixed(1)}" stroke="#e4dccb" stroke-dasharray="3 3"/><text x="${padL - 5}" y="${(sy(10 ** e) + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#646e82" font-family="monospace">$10^${e}</text>`).join('')}
      ${[7, 8, 9, 10].map((e) => `<text x="${sx(10 ** e).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#646e82" font-family="monospace">TVL $10^${e}</text>`).join('')}
      <polyline fill="none" stroke="#a85a08" stroke-width="2" stroke-dasharray="5 3" points="${linePts}"/>
      ${dots}${wlDots}
      <text x="${W - padR - 4}" y="22" text-anchor="end" font-size="9.5" font-weight="700" fill="#1e4d8c">● Live Comps (n=${D.validation.live_comps_fitted})</text>
      <text x="${W - padR - 4}" y="35" text-anchor="end" font-size="9.5" font-weight="700" fill="#0f5c4d">● Top 15 Pre-Token (Implied)</text>
      <text x="${W - padR - 4}" y="48" text-anchor="end" font-size="9.5" font-weight="700" fill="#a85a08">-- Fitted Ridge Curve (slope ${(1 + D.weights.log_tvl_slope).toFixed(2)})</text>
    </svg>`;
  }

  function render() {
    const app = document.getElementById('app');
    const rows = filteredRows();
    const totalImplied = rows.reduce((acc, r) => acc + r.implied_value_usd, 0);
    const totalTvl = rows.reduce((acc, r) => acc + r.tvl_usd, 0);
    const selected = D.rows.find((r) => r.slug === state.selectedSlug) || null;
    const u = D.universe;
    const v = D.validation;
    const w = D.weights;

    let mainBody = '';
    if (state.tab === 'cal') {
      mainBody = `<section class="cal-grid">
        <div class="cal-card">
          <h3>Ridge Log-Linear Valuation Model &amp; 5-Fold CV</h3>
          <div class="eq-box">log(Implied/TVL) = ${w.intercept} + (${w.log_tvl_slope})·log(TVL/$100M) + (${w.log_age_slope})·log(Age/365d) + (${w.growth_7d_slope})·g7d + (${w.log_chains_slope})·log(Chains) + CatShrink</div>
          <div class="math-grid" style="margin-bottom:10px">
            <div class="math-item">5-Fold CV R² (log)<strong>${v.cv_r2_log.toFixed(3)}</strong></div>
            <div class="math-item">Naive Baseline R²<strong>${v.baseline_r2_log.toFixed(3)}</strong></div>
            <div class="math-item">CV RMSE (log)<strong>${v.cv_rmse_log.toFixed(3)}</strong></div>
            <div class="math-item">Fitted Live Comps<strong>${v.live_comps_fitted} / ${v.live_comps_total}</strong></div>
            <div class="math-item">CV Median APE<strong>${v.cv_median_ape_pct.toFixed(1)}%</strong></div>
            <div class="math-item">Global Med MCap/TVL<strong>${v.global_median_multiple.toFixed(2)}x</strong></div>
          </div>
          ${renderScatterSvg()}
        </div>
        <div class="cal-card">
          <h3>Category Multiples &amp; Peer Tokenization Rates</h3>
          <table><thead><tr><th>Category</th><th class="num">Live / Tot</th><th class="num">Token Rate</th><th class="num">Med Mult</th><th class="num">Cat Adj</th></tr></thead>
          <tbody>${D.category_stats.slice(0, 14).map((c) => `<tr>
            <td><strong>${esc(c.category)}</strong></td>
            <td class="num">${c.live_count}/${c.total_protocols}</td>
            <td class="num">${(c.tokenization_rate * 100).toFixed(0)}%</td>
            <td class="num pos">${c.median_multiple.toFixed(2)}x</td>
            <td class="num ${c.cat_residual_log >= 0 ? 'pos' : 'neg'}">${c.cat_residual_log >= 0 ? '+' : ''}${c.cat_residual_log.toFixed(2)}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      </section>
      <div class="card">
        <table><thead><tr><th>Live-Token Comp (Separated From Pre-Token Board)</th><th>Symbol</th><th>Category</th><th class="num">TVL</th><th class="num">Actual MCap</th><th class="num">Model Pred</th><th class="num">MCap/TVL</th></tr></thead>
        <tbody>${D.live.slice(0, 20).map((l) => `<tr>
          <td><span class="pname">${esc(l.name)}</span> <span class="chains">${esc(l.chains.slice(0, 2).join(', '))}</span></td>
          <td><span class="badge cat">${esc(l.symbol || '—')}</span></td>
          <td>${esc(l.category || 'Other')}</td>
          <td class="num">${fmtUsd(l.tvl_usd)}</td>
          <td class="num"><strong>${fmtUsd(l.mcap_usd)}</strong></td>
          <td class="num">${fmtUsd(l.pred_mcap_usd)}</td>
          <td class="num pos">${l.mcap_tvl_ratio.toFixed(2)}x</td>
        </tr>`).join('')}</tbody></table>
      </div>`;
    } else {
      const shown = rows.slice(0, 75);
      const tableHtml = `<div class="card"><table><thead><tr>
        <th data-sort="implied"># / Protocol</th>
        <th>Segment</th>
        <th>Category</th>
        <th class="num" data-sort="tvl">TVL</th>
        <th class="num" data-sort="growth">7d %</th>
        <th class="num" data-sort="age">Age</th>
        <th class="num" data-sort="rate">Peer TGE%</th>
        <th class="num" data-sort="mult">Mult</th>
        <th class="num" data-sort="implied">Implied Val (p10–p90)</th>
        <th>${fmtUsd(state.deposit)} Verdict</th>
      </tr></thead><tbody>${shown.map((r) => {
        const econ = farmEconomics(r, state.deposit);
        return `<tr class="row ${selected && selected.slug === r.slug ? 'selected' : ''}" data-slug="${esc(r.slug)}">
          <td><span class="pname">#${r.rank} ${esc(r.name)}</span><div class="chains">${esc(r.chains.slice(0, 3).join(', ') || 'Multi')}</div></td>
          <td><span class="badge ${r.is_watchlist ? 'wl' : 'early'}">${r.is_watchlist ? 'Watchlist' : (r.tvl_usd < D.floor_usd ? 'Early' : 'Extended')}</span></td>
          <td><span class="badge cat">${esc(r.category || 'Other')}</span></td>
          <td class="num">${fmtUsd(r.tvl_usd)}</td>
          <td class="num ${(r.change_7d ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(r.change_7d)}</td>
          <td class="num">${r.age_days != null ? r.age_days + 'd' : '—'}</td>
          <td class="num">${(r.peer_token_rate * 100).toFixed(0)}%</td>
          <td class="num">${r.implied_multiple.toFixed(2)}x</td>
          <td class="num"><strong class="pos">${fmtUsd(r.implied_value_usd)}</strong><span class="band-txt">${fmtUsd(r.p10_value_usd)} – ${fmtUsd(r.p90_value_usd)}</span></td>
          <td><span class="badge ${econ.verdict[1]}">${econ.verdict[0]}</span></td>
        </tr>`;
      }).join('')}</tbody></table></div>`;

      let detailHtml = '';
      if (selected) {
        const econ = farmEconomics(selected, state.deposit);
        detailHtml = `<aside class="detail">
          <div class="detail-head">
            <div>
              <h2>#${selected.rank} ${esc(selected.name)}</h2>
              <div class="chains">${esc(selected.slug)} · ${esc(selected.category || 'Other')} · ${esc(selected.chains.join(', '))}</div>
            </div>
            <button class="close-btn" id="closeDetail">Close</button>
          </div>
          <div class="sec-title"><span>Ridge-CV Valuation Decomposition</span><span>${esc(D.model_version)}</span></div>
          <div class="math-grid">
            <div class="math-item">Implied Value<strong class="pos">${fmtUsd(selected.implied_value_usd)}</strong></div>
            <div class="math-item">80% Band (p10–p90)<strong>${fmtUsd(selected.p10_value_usd)}–${fmtUsd(selected.p90_value_usd)}</strong></div>
            <div class="math-item">Locked TVL<strong>${fmtUsd(selected.tvl_usd)}</strong></div>
            <div class="math-item">TVL Scale Factor<strong>${selected.model.tvl_scale_mult.toFixed(2)}x</strong></div>
            <div class="math-item">Cat / Age / 7d<strong>${selected.model.category_mult.toFixed(2)}x · ${selected.model.age_mult.toFixed(2)}x · ${selected.model.growth_mult.toFixed(2)}x</strong></div>
            <div class="math-item">Peer Tokenization<strong>${(selected.peer_token_rate * 100).toFixed(0)}% live in cat</strong></div>
          </div>
          <div class="roi-box">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Deposit-Sized Farm Economics (${fmtUsd(state.deposit)} · ${selected.hold_days}d hold)</strong>
              <span class="badge ${econ.verdict[1]}">${econ.verdict[0]}</span>
            </div>
            <div class="roi-grid">
              <div class="roi-cell">Est. Airdrop EV<strong class="pos">${fmtUsd(econ.grossEv)}</strong></div>
              <div class="roi-cell">Gas + Opp Cost<strong>${fmtUsd(econ.totalCost)}</strong></div>
              <div class="roi-cell">Net Expected<strong>${econ.netEv >= 0 ? '+' : '-'}${fmtUsd(Math.abs(econ.netEv))}</strong></div>
              <div class="roi-cell">Est. Cost ROI<strong>${econ.roiPct >= 0 ? '+' : ''}${Math.round(econ.roiPct)}%</strong></div>
            </div>
          </div>
          <div class="sec-title"><span>Concrete Execution Plan (${selected.farm_steps.length} Steps)</span><span>Gas ~${fmtUsd(selected.farm_cost_usd)}</span></div>
          <ol class="steps">${selected.farm_steps.map((s, idx) => `<li class="step"><span class="step-num">0${idx + 1}</span>${esc(s)}</li>`).join('')}</ol>
        </aside>`;
      }
      mainBody = `<section class="grid-main ${detailHtml ? 'has-detail' : ''}">${tableHtml}${detailHtml}</section>`;
    }

    app.innerHTML = `<div class="shell">
      <header class="masthead">
        <div>
          <div class="kicker">DeFi Intelligence Desk &middot; Out-of-Sample Cross-Validated Pre-Token Valuation</div>
          <h1>Token Launch Radar</h1>
          <div class="sub">Snapshot ${esc(D.as_of)} &middot; All ${u.total} DefiLlama protocols accounted for &middot; Live-token comps strictly separated</div>
        </div>
        <div class="mast-right">
          <div class="pill-row">
            <span class="pill strong">${esc(D.model_version)}</span>
            <span class="pill accent">5-Fold CV R² = ${v.cv_r2_log.toFixed(3)} (vs ${v.baseline_r2_log.toFixed(3)} naive)</span>
            <span class="pill">${D.watchlist_size}/${D.watchlist_size} Watchlist Covered</span>
          </div>
        </div>
      </header>
      <section class="integrity">
        <strong>Universe Audit (${u.total}):</strong>
        <div class="int-bar">
          <div class="seg-wl" style="width:${(u.watchlist / u.total) * 100}%"></div>
          <div class="seg-early" style="width:${(u.early_pre_token / u.total) * 100}%"></div>
          <div class="seg-live" style="width:${(u.live_token / u.total) * 100}%"></div>
          <div class="seg-ex" style="width:${(u.excluded_wrapped_cex / u.total) * 100}%"></div>
        </div>
        <div class="int-legend">
          <span><i class="dot seg-wl"></i>Watchlist ${u.watchlist}</span>
          <span><i class="dot seg-early"></i>Early Pre-Token ${u.early_pre_token}</span>
          <span><i class="dot seg-live"></i>Live Token ${u.live_token}</span>
          <span><i class="dot seg-ex"></i>Wrapped/Bridge/CEX ${u.excluded_wrapped_cex}</span>
        </div>
      </section>
      <section class="kpis">
        <div class="kpi k-accent"><div class="label">Ranked Pre-Token</div><div class="val">${rows.length} <span style="font-size:12px;color:var(--muted)">/ ${D.board_size}</span></div><div class="hint">${D.watchlist_size} watchlist + ${D.early_size} early</div></div>
        <div class="kpi"><div class="label">Filtered Implied Value</div><div class="val pos">${fmtUsd(totalImplied)}</div><div class="hint">Across ${fmtUsd(totalTvl)} TVL</div></div>
        <div class="kpi k-amber"><div class="label">Fitted TVL Elasticity</div><div class="val">${(1 + w.log_tvl_slope).toFixed(2)}</div><div class="hint">Sublinear power law on ${v.live_comps_fitted} comps</div></div>
        <div class="kpi k-blue"><div class="label">5-Fold CV R² / RMSE</div><div class="val">${v.cv_r2_log.toFixed(2)} / ${v.cv_rmse_log.toFixed(2)}</div><div class="hint">Beats naive median (${v.baseline_r2_log.toFixed(2)})</div></div>
        <div class="kpi"><div class="label">Farming Deposit Size</div><div class="val">${fmtUsd(state.deposit)}</div><div class="hint">5% est. community TGE pool</div></div>
      </section>
      <section class="controls">
        <div class="tabs">
          <button class="tab ${state.tab === 'all' ? 'active' : ''}" data-tab="all">All Pre-Token (${D.board_size})</button>
          <button class="tab ${state.tab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">Watchlist (${D.watchlist_size})</button>
          <button class="tab ${state.tab === 'early' ? 'active' : ''}" data-tab="early">Beyond Watchlist (${D.early_size})</button>
          <button class="tab ${state.tab === 'cal' ? 'active' : ''}" data-tab="cal">Model CV &amp; Live Comps (${D.live_size})</button>
        </div>
        <div class="spacer"></div>
        <span class="dep-group">Deposit:
          ${[1000, 10000, 50000].map((amt) => `<button class="dep-btn ${state.deposit === amt ? 'active' : ''}" data-dep="${amt}">${fmtUsd(amt)}</button>`).join('')}
        </span>
        <input id="searchBox" type="search" placeholder="Search protocol..." value="${esc(state.search)}">
        <select id="catSel"><option value="ALL">All Categories</option>${allCats.map((c) => `<option value="${esc(c)}" ${state.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="chainSel"><option value="ALL">All Chains</option>${allChains.map((c) => `<option value="${esc(c)}" ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="growthSel">
          <option value="-999" ${state.minGrowth <= -900 ? 'selected' : ''}>Any 7d %</option>
          <option value="0" ${state.minGrowth === 0 ? 'selected' : ''}>&gt;= 0% 7d</option>
          <option value="5" ${state.minGrowth === 5 ? 'selected' : ''}>&gt;= +5% 7d</option>
          <option value="15" ${state.minGrowth === 15 ? 'selected' : ''}>&gt;= +15% 7d</option>
        </select>
      </section>
      ${mainBody}
      <footer class="footer-note">
        <span>Source: ${esc(D.source)}. Implied valuations follow a Ridge log-linear model calibrated on ${v.live_comps_fitted} live-token DefiLlama comps; DefiLlama records no token and does not guarantee a future launch.</span>
        <span>${D.board_size} pre-token rows &middot; ${u.total} total snapshot protocols</span>
      </footer>
    </div>`;

    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    app.querySelectorAll('[data-dep]').forEach((b) => b.addEventListener('click', () => { state.deposit = Number(b.dataset.dep); render(); }));
    app.querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => { state.selectedSlug = tr.dataset.slug; render(); }));
    app.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sortBy === k) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      else { state.sortBy = k; state.sortDir = 'desc'; }
      render();
    }));
    const cd = document.getElementById('closeDetail');
    if (cd) cd.addEventListener('click', () => { state.selectedSlug = ''; render(); });
    const sb = document.getElementById('searchBox');
    if (sb) sb.addEventListener('input', (e) => { state.search = e.target.value; render(); });
    const cs = document.getElementById('catSel');
    if (cs) cs.addEventListener('change', (e) => { state.category = e.target.value; render(); });
    const chs = document.getElementById('chainSel');
    if (chs) chs.addEventListener('change', (e) => { state.chain = e.target.value; render(); });
    const gs = document.getElementById('growthSel');
    if (gs) gs.addEventListener('change', (e) => { state.minGrowth = Number(e.target.value); render(); });
  }

  render();
})();
