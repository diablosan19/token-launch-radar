// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a searchable and sortable table, a per-protocol detail drawer with the
// model's own inputs and the protocol's farm plan, the model panel, and a comparable-set panel
// built from the comp analysis in lib/comps.ts (quartiles, trimmed medians, data quality).
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // ---------- formatting helpers ----------

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMultiple(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (Math.round(n * 10000) / 10000) + 'x';
  }

  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same
  // arithmetic. The multiple is per row — the median market-cap/TVL of the tokenized protocols in
  // the row's own category, shrunk toward the market-wide median by comp depth (data.js carries
  // both the row's multiple and the comp table it came from). A row without its own multiple (old
  // data) falls back to the model's flat constant.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var multiple = row.base_multiple === null || row.base_multiple === undefined ? model.base_multiple : row.base_multiple;
    return Math.max(1, Math.round(row.tvl_usd * multiple * growthMult * maturity));
  }

  // A tiny element builder: el('td', { class: 'num', text: 'x' }, child, 'text', ...).
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------- the farm plan, re-derived in the page ----------
  // The plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  // The rationale step that opens a plan: the same sentence lib/model.ts writes into board.json,
  // rebuilt here from the row's own fields (multiple, comp count, confidence, implied value).
  function rationaleStep(p) {
    var cat = p.category || 'its category';
    var move = p.change_7d === null || p.change_7d === undefined ? 'a flat 7d TVL record' : 'a ' + (p.change_7d >= 0 ? 'rising' : 'falling') + ' 7d TVL (' + (p.change_7d >= 0 ? '+' : '') + (Math.round(p.change_7d * 10) / 10) + '%)';
    var comps = !p.comp_count ? 'no tokenized comps in its category, so the market-wide median multiple applies' : 'the ' + cat + ' median of ' + p.comp_count + ' tokenized comp' + (p.comp_count === 1 ? '' : 's') + ', shrunk toward the market-wide median';
    return {
      text: 'Why farm ' + p.name + ' first: its TVL priced at ' + p.base_multiple + 'x from ' + comps + ' implies about $' + Math.round(p.implied_value_usd).toLocaleString('en-US') + ', with ' + move + '; confidence ' + p.confidence + '/100, so size the position to that confidence, not to the headline number.',
      cost: 'nothing to read the evidence before you deposit',
      time: '2 minutes'
    };
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var plan = [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    // Rows that carry their scoring evidence get the rationale step, exactly as board.json
    // carries it, so the page's plan and the board's plan stay the same seven steps.
    if (p.base_multiple !== null && p.base_multiple !== undefined && p.confidence) plan.unshift(rationaleStep(p));
    return plan.map(stepText);
  }

  // ---------- view state in the URL hash ----------
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('sort')) state.sort = params.get('sort');
    if (params.get('dir') === '1' || params.get('dir') === '-1') state.dir = Number(params.get('dir'));
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.dir !== -1) params.set('dir', String(state.dir));
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---------- filtering, searching and sorting ----------

  // Text search matches the protocol's name and its slug first of all (a farmer who remembers
  // "steakhouse" or the slug "steakhouse-financial" should land on the same row), then falls
  // back to the category and chain names so broader terms still find their rows.
  function matchesSearch(r, q) {
    if (!q) return true;
    if (r.name.toLowerCase().indexOf(q) >= 0) return true;
    if (r.slug.toLowerCase().indexOf(q) >= 0) return true;
    var hay = [(r.category || ''), (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      return matchesSearch(r, q);
    });
  }
  // The sort keys the controls offer. Confidence sorts missing scores last in either direction:
  // an unscored row is not a zero-confidence row, it is an unknown one.
  var SORT_KEYS = {
    implied: function (r) { return r.implied_value_usd; },
    tvl: function (r) { return r.tvl_usd; },
    confidence: function (r) { return r.confidence === null || r.confidence === undefined ? -1 : r.confidence; },
    growth: function (r) { return r.change_7d === null || r.change_7d === undefined ? -Infinity : r.change_7d; },
    age: function (r) { return r.age_days === null || r.age_days === undefined ? Infinity : r.age_days; },
    name: function (r) { return r.name.toLowerCase(); }
  };
  function sortedRows(list) {
    var get = SORT_KEYS[state.sort] || SORT_KEYS.implied;
    return list.slice().sort(function (a, b) {
      var av = get(a), bv = get(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }
  // A one-line summary of whatever the current filter leaves on screen: how much TVL it holds,
  // and the average confidence across it — the quickest way to see whether a filter narrowed the
  // board down to solid rows or to speculative ones.
  function shownSummary(list) {
    if (list.length === 0) return '';
    var tvl = 0, confTotal = 0, confCount = 0;
    list.forEach(function (r) {
      tvl += r.tvl_usd || 0;
      if (r.confidence) { confTotal += r.confidence; confCount += 1; }
    });
    var avg = confCount ? Math.round(confTotal / confCount) : null;
    return list.length + ' rows shown · ' + fmtUsd(tvl) + ' combined TVL' + (avg === null ? '' : ' · average confidence ' + avg + '/100');
  }

  // ---------- the comparable-set table (lib/comps.ts, carried in data.js) ----------

  // Older data.js files predate comp_tables; rebuild a minimal version from the multiples the
  // model panel already carried so the panel never renders empty on stale data.
  function compTables() {
    if (Array.isArray(DATA.comp_tables) && DATA.comp_tables.length) return DATA.comp_tables;
    return (DATA.multiples || []).map(function (c) {
      return {
        category: c.category, seen: 0, usable: c.count, missing_mcap: 0, unusable_tvl: 0,
        coverage_pct: 0, median_multiple: c.median, q1_multiple: 0, q3_multiple: 0,
        iqr_multiple: 0, min_multiple: 0, max_multiple: 0, trimmed_median_multiple: c.median,
        outliers_removed: 0, quality: c.count === 0 ? 'none' : c.count === 1 ? 'single comp' : c.count < 4 ? 'thin' : 'usable'
      };
    });
  }
  function compFor(category) {
    var key = category || 'Other';
    var found = compTables().filter(function (t) { return t.category === key; });
    return found.length ? found[0] : null;
  }
  function compPanel() {
    var tables = compTables().filter(function (t) { return t.usable > 0; });
    var empty = compTables().filter(function (t) { return t.usable === 0; });
    if (tables.length === 0) return null;
    var tbody = el('tbody');
    tables.forEach(function (t) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('b', { text: t.category })),
        el('td', { class: 'num', text: String(t.usable) }),
        el('td', { class: 'num', text: fmtMultiple(t.median_multiple) }),
        el('td', { class: 'num', text: fmtMultiple(t.q1_multiple) }),
        el('td', { class: 'num', text: fmtMultiple(t.q3_multiple) }),
        el('td', { class: 'num', text: fmtMultiple(t.trimmed_median_multiple) }),
        el('td', { class: 'num', text: String(t.outliers_removed) }),
        el('td', { class: 'num', text: t.coverage_pct ? t.coverage_pct + '%' : 'n/a' }),
        el('td', null, el('span', { class: 'status', text: t.quality }))
      ));
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'The comparable set, category by category' }),
      el('p', { class: 'sub', text: 'Each row is one category of tokenized protocols and the market-cap/TVL multiples they trade at. The median is what the model shrinks and prices from; the quartiles show the spread behind it, and the trimmed median recomputes the middle after IQR outliers are set aside — when the two medians disagree, one wild comp is doing the talking. Coverage is the share of tokenized protocols in the category whose figures were usable at all, and the quality grade weighs depth and coverage together.' }),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Comparable multiples by category, deepest evidence first.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Comps' }),
            el('th', { scope: 'col', text: 'Median' }),
            el('th', { scope: 'col', text: 'Q1' }),
            el('th', { scope: 'col', text: 'Q3' }),
            el('th', { scope: 'col', text: 'Trimmed median' }),
            el('th', { scope: 'col', text: 'Outliers' }),
            el('th', { scope: 'col', text: 'Coverage' }),
            el('th', { scope: 'col', text: 'Quality' })
          )),
          tbody
        )
      ),
      empty.length ? el('p', { class: 'sub', text: empty.length + ' more categories (' + empty.map(function (t) { return t.category; }).join(', ') + ') have tokenized protocols but no usable comp — a missing market cap or TVL — so their rows are priced from the market-wide median instead.' }) : null
    );
  }

  // ---------- page sections ----------

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, slug, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    // Explicit sort controls beside the clickable column headers: a select for the key and a
    // button that flips direction, so sorting is discoverable without knowing the headers sort.
    var sortSelect = el('select', { id: 'sort', 'aria-label': 'Sort the board by' },
      [
        ['implied', 'Implied value'],
        ['tvl', 'TVL'],
        ['confidence', 'Confidence'],
        ['growth', '7d growth'],
        ['age', 'Age'],
        ['name', 'Name']
      ].map(function (pair) { return el('option', { value: pair[0], text: pair[1], selected: state.sort === pair[0] ? 'selected' : null }); })
    );
    sortSelect.addEventListener('change', function () { state.sort = sortSelect.value; writeHash(); render(); });
    var dirButton = el('button', {
      type: 'button', class: 'button', 'aria-label': 'Toggle sort direction',
      text: state.dir < 0 ? 'Descending' : 'Ascending',
      onclick: function () { state.dir = -state.dir; writeHash(); render(); }
    });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'sort', text: 'Sort by' }), sortSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Direction' }), dirButton),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? shownSummary(rows()) : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.confidence ? String(r.confidence) : 'n/a' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('confidence', 'Confidence'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    // The comp table in one line per category: the raw median it trades at and the shrunk
    // multiple rows of that category were actually priced with. The full spread is in the
    // comparable-set panel below.
    var compLines = (DATA.multiples || []).map(function (c) {
      return c.category + ': median ' + c.median + 'x from ' + c.count + ' comp' + (c.count === 1 ? '' : 's') + ' -> priced at ' + c.effective + 'x';
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'multiple(category) = shrink( median mcap/TVL of the category\'s tokenized comps toward the market-wide median ' + DATA.global_multiple + 'x, weight n/(n+' + m.comp_shrink_k + ') ), clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + '] and to [global/8, global x 3]\n' +
        'implied = round( tvl_usd x multiple(category) x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The snapshot prices its own watchlist: ' + DATA.comp_count + ' tokenized protocols are the comparable set, and a category with few comps mostly borrows the market-wide median instead of trusting its own. Each row also carries a confidence score (comp depth, TVL scale, known age, calm momentum, with a hard ceiling when a category has two comps or fewer), and its farm plan opens with the rationale. TVL and seven-day growth come from the snapshot; age is the time since the protocol was first listed, and an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' }),
      compLines.length ? el('div', { class: 'formula' }, compLines.join('\n')) : null
    );
  }

  // ---------- the detail drawer ----------

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var comp = compFor(row.category);
    var equationRows = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Maturity multiplier', String(row.maturity_multiplier)],
      ['Category multiple', row.base_multiple === null || row.base_multiple === undefined ? 'n/a' : String(row.base_multiple) + 'x'],
      ['Tokenized comps behind it', String(row.comp_count || 0)],
      ['Confidence', row.confidence ? String(row.confidence) + ' / 100' : 'n/a'],
      ['Implied value', fmtUsd(row.implied_value_usd)]
    ];
    // When the comp analysis knows this row's category, show the spread behind its multiple
    // right under the headline number: a multiple drawn from a tight, deep comp set and one
    // drawn from two wild observations should not read the same way.
    if (comp && comp.usable > 0) {
      equationRows.push(['Category comp median', fmtMultiple(comp.median_multiple)]);
      equationRows.push(['Category comp quartiles', fmtMultiple(comp.q1_multiple) + ' to ' + fmtMultiple(comp.q3_multiple)]);
      equationRows.push(['Trimmed median (outliers aside)', fmtMultiple(comp.trimmed_median_multiple) + (comp.outliers_removed ? ' (' + comp.outliers_removed + ' set aside)' : '')]);
      equationRows.push(['Comp data quality', comp.quality + ' · ' + comp.coverage_pct + '% coverage']);
    }
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' }, equationRows.map(function (pair) {
        return el('div', null, el('span', { text: pair[0] }), el('b', { class: 'num', text: pair[1] }));
      })),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(impliedOf(row, DATA.model)) + (impliedOf(row, DATA.model) === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(modelPanel());
      var comps = compPanel();
      if (comps) shell.appendChild(comps);
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
