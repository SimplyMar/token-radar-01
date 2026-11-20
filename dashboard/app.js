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
    growthWeight: D.model.growth_weight,
    chainStep: D.model.chain_step,
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

  function recomputeImplied(r) {
    const g = r.change_7d == null ? 0 : Math.min(D.model.growth_cap, Math.max(D.model.growth_floor, r.change_7d));
    const gMult = 1 + (g / 100) * state.growthWeight;
    const extra = Math.min(D.model.chain_cap, Math.max(0, r.chains.length - 1));
    const cMult = 1 + extra * state.chainStep;
    return Math.max(1, Math.round(r.tvl_usd * r.category_multiple * gMult * r.maturity_multiplier * cMult));
  }

  function filteredRows() {
    const q = state.search.trim().toLowerCase();
    return D.rows
      .map((r) => ({ ...r, live_implied: recomputeImplied(r) }))
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
        if (state.sortBy === 'chains') return (a.chains.length - b.chains.length) * dir;
        return (a.live_implied - b.live_implied) * dir;
      });
  }

  function render() {
    const app = document.getElementById('app');
    const rows = filteredRows();
    const totalImplied = rows.reduce((acc, r) => acc + r.live_implied, 0);
    const totalTvl = rows.reduce((acc, r) => acc + r.tvl_usd, 0);
    const selected = D.rows.find((r) => r.slug === state.selectedSlug) || null;
    const isLiveTab = state.tab === 'live';
    const isCatsTab = state.tab === 'cats';

    let tableHtml = '';
    if (isLiveTab) {
      tableHtml = `<table><thead><tr>
        <th>Protocol</th><th>Symbol</th><th>Category</th><th class="num">TVL</th><th class="num">Market Cap</th><th class="num">MCap/TVL</th><th class="num">7d %</th>
      </tr></thead><tbody>` + D.live.map((l) => `<tr>
        <td><strong>${esc(l.name)}</strong><div class="chains">${esc(l.chains.slice(0, 3).join(', '))}</div></td>
        <td><span class="badge cat">${esc(l.symbol || '—')}</span></td>
        <td>${esc(l.category || 'Other')}</td>
        <td class="num">${fmtUsd(l.tvl_usd)}</td>
        <td class="num">${fmtUsd(l.mcap_usd)}</td>
        <td class="num">${l.mcap_tvl_ratio != null ? l.mcap_tvl_ratio.toFixed(2) + 'x' : '—'}</td>
        <td class="num ${(l.change_7d ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(l.change_7d)}</td>
      </tr>`).join('') + `</tbody></table>`;
    } else if (isCatsTab) {
      tableHtml = `<table><thead><tr>
        <th>Category</th><th class="num">Live Comps</th><th class="num">Median MCap / TVL</th><th class="num">Median Live TVL</th>
      </tr></thead><tbody>` + D.category_stats.map((c) => `<tr>
        <td><strong>${esc(c.category)}</strong></td>
        <td class="num">${c.sample_count}</td>
        <td class="num pos">${c.median_multiple.toFixed(3)}x</td>
        <td class="num">${fmtUsd(c.median_tvl_usd)}</td>
      </tr>`).join('') + `</tbody></table>`;
    } else {
      const shown = rows.slice(0, 80);
      tableHtml = `<table><thead><tr>
        <th data-sort="implied"># / Protocol</th>
        <th>Segment</th>
        <th>Category</th>
        <th class="num" data-sort="tvl">TVL</th>
        <th class="num" data-sort="growth">7d %</th>
        <th class="num" data-sort="age">Age</th>
        <th class="num" data-sort="implied">Implied Val</th>
      </tr></thead><tbody>` + shown.map((r) => `<tr class="row ${selected && selected.slug === r.slug ? 'selected' : ''}" data-slug="${esc(r.slug)}">
        <td><strong>#${r.rank} ${esc(r.name)}</strong><div class="chains">${esc(r.chains.slice(0, 3).join(', ') || 'Multi')}</div></td>
        <td><span class="badge ${r.is_watchlist ? 'wl' : 'early'}">${r.is_watchlist ? 'Watchlist' : 'Early'}</span></td>
        <td><span class="badge cat">${esc(r.category || 'Other')}</span></td>
        <td class="num">${fmtUsd(r.tvl_usd)}</td>
        <td class="num ${(r.change_7d ?? 0) >= 0 ? 'pos' : 'neg'}">${fmtPct(r.change_7d)}</td>
        <td class="num">${r.age_days != null ? r.age_days + 'd' : '—'}</td>
        <td class="num pos"><strong>${fmtUsd(r.live_implied)}</strong></td>
      </tr>`).join('') + `</tbody></table>`;
    }

    let detailHtml = '';
    if (selected && !isLiveTab && !isCatsTab) {
      const imp = recomputeImplied(selected);
      detailHtml = `<aside class="detail">
        <div class="detail-head">
          <div>
            <h2>#${selected.rank} ${esc(selected.name)}</h2>
            <div class="chains">${esc(selected.slug)} · ${esc(selected.category || 'Other')} · ${esc(selected.chains.join(', '))}</div>
          </div>
          <button class="close-btn" id="closeDetail">Close</button>
        </div>
        <div class="math-box">
          <div style="font-size:11px;color:var(--muted)">VALUATION BREAKDOWN (${esc(D.model_version)})</div>
          <div class="math-grid">
            <div class="math-item">Implied Value<strong class="pos">${fmtUsd(imp)}</strong></div>
            <div class="math-item">Locked TVL<strong>${fmtUsd(selected.tvl_usd)}</strong></div>
            <div class="math-item">Cat MCap/TVL<strong>${selected.category_multiple.toFixed(3)}x</strong></div>
            <div class="math-item">7d Growth Mult<strong>${selected.growth_multiplier.toFixed(3)}x (${fmtPct(selected.change_7d)})</strong></div>
            <div class="math-item">Maturity Mult<strong>${selected.maturity_multiplier.toFixed(3)}x (${selected.age_days ?? '?'}d)</strong></div>
            <div class="math-item">Chain Breadth<strong>${selected.chain_multiplier.toFixed(2)}x (${selected.chains.length} ch)</strong></div>
          </div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">Actionable Farm Plan (${selected.farm_steps.length} Steps)</div>
        <ol class="steps">${selected.farm_steps.map((s, idx) => `<li class="step"><span class="step-num">0${idx + 1}</span>${esc(s)}</li>`).join('')}</ol>
      </aside>`;
    }

    app.innerHTML = `<div class="shell">
      <header class="topbar">
        <div class="brand">
          <h1>Token Launch Radar</h1>
          <div class="sub">Calibrated Pre-Token Protocol Valuation &amp; Concrete Farming Plans · Snapshot ${esc(D.as_of)}</div>
        </div>
        <div class="meta-pill">${esc(D.model_version)} · ${D.watchlist_size} Watchlist + ${D.early_size} Early Pre-Token</div>
      </header>
      <section class="kpis">
        <div class="kpi"><div class="label">Pre-Token Protocols</div><div class="val">${rows.length} <span style="font-size:12px;color:var(--muted)">/ ${D.board_size}</span></div><div class="hint">${D.watchlist_size} watchlist >=${fmtUsd(D.floor_usd)}</div></div>
        <div class="kpi"><div class="label">Filtered Implied Value</div><div class="val pos">${fmtUsd(totalImplied)}</div><div class="hint">Across ${fmtUsd(totalTvl)} total TVL</div></div>
        <div class="kpi"><div class="label">Global Median MCap/TVL</div><div class="val">${D.model.global_multiple.toFixed(2)}x</div><div class="hint">Calibrated from live-token comps</div></div>
        <div class="kpi"><div class="label">Live-Token Comps</div><div class="val">${D.live_size}</div><div class="hint">Kept strictly separate from board</div></div>
      </section>
      <section class="controls">
        <div class="tabs">
          <button class="tab ${state.tab === 'all' ? 'active' : ''}" data-tab="all">All Pre-Token (${D.board_size})</button>
          <button class="tab ${state.tab === 'watchlist' ? 'active' : ''}" data-tab="watchlist">Watchlist (${D.watchlist_size})</button>
          <button class="tab ${state.tab === 'early' ? 'active' : ''}" data-tab="early">Early &lt;$50M (${D.early_size})</button>
          <button class="tab ${state.tab === 'live' ? 'active' : ''}" data-tab="live">Live Comps (${D.live_size})</button>
          <button class="tab ${state.tab === 'cats' ? 'active' : ''}" data-tab="cats">Category Multiples</button>
        </div>
        <div class="spacer"></div>
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
      <section class="sandbox">
        <strong>Model Formula:</strong>
        <code>Implied = TVL × CatMedian(MCap/TVL) × GrowthMult × MaturityMult × ChainMult</code>
        <label>Growth Weight <input id="gwInput" type="range" min="0" max="1" step="0.05" value="${state.growthWeight}"> <code>${state.growthWeight.toFixed(2)}</code></label>
        <label>Chain Bonus <input id="csInput" type="range" min="0" max="0.1" step="0.01" value="${state.chainStep}"> <code>${(state.chainStep * 100).toFixed(0)}%/ch</code></label>
      </section>
      <section class="grid-main ${detailHtml ? 'has-detail' : ''}">
        <div class="table-wrap">${tableHtml}</div>
        ${detailHtml}
      </section>
      <p class="footer-note">Source: ${esc(D.source)}. Implied valuations are model estimates derived from snapshot TVL, 7d change, listing age, and live-token category benchmarks; DefiLlama records do not guarantee a future token.</p>
    </div>`;

    app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; render(); }));
    app.querySelectorAll('tr.row').forEach((tr) => tr.addEventListener('click', () => { state.selectedSlug = tr.dataset.slug; render(); }));
    app.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sortBy === k) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
      else { state.sortBy = k; state.sortDir = 'desc'; }
      render();
    }));
    const cd = document.getElementById('closeDetail');
    if (cd) cd.addEventListener('click', () => { state.selectedSlug = ''; render(); });
    document.getElementById('searchBox').addEventListener('input', (e) => { state.search = e.target.value; render(); });
    document.getElementById('catSel').addEventListener('change', (e) => { state.category = e.target.value; render(); });
    document.getElementById('chainSel').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
    document.getElementById('growthSel').addEventListener('change', (e) => { state.minGrowth = Number(e.target.value); render(); });
    document.getElementById('gwInput').addEventListener('input', (e) => { state.growthWeight = Number(e.target.value); render(); });
    document.getElementById('csInput').addEventListener('input', (e) => { state.chainStep = Number(e.target.value); render(); });
  }

  render();
})();
