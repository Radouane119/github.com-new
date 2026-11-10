// ---- Phase 3A: keep focus, scroll and open panels across full re-renders ----
let tradeNotesCache = null;
let tradeNotesSaveTimer = null;

function getTradeNotes() {
  if (tradeNotesCache) return tradeNotesCache;
  try {
    const parsed = JSON.parse(localStorage.getItem("tradeNotes") || "{}");
    tradeNotesCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { tradeNotesCache = {}; }
  return tradeNotesCache;
}

function flushTradeNotes() {
  if (tradeNotesSaveTimer) { clearTimeout(tradeNotesSaveTimer); tradeNotesSaveTimer = null; }
  if (!tradeNotesCache) return;
  try { localStorage.setItem("tradeNotes", JSON.stringify(tradeNotesCache)); } catch {}
}

function saveTradeNotesDebounced() {
  if (tradeNotesSaveTimer) clearTimeout(tradeNotesSaveTimer);
  tradeNotesSaveTimer = setTimeout(flushTradeNotes, 400);
}

let scheduledRenderTimer = null;
function scheduleRender(delay) {
  if (scheduledRenderTimer) clearTimeout(scheduledRenderTimer);
  scheduledRenderTimer = setTimeout(() => { scheduledRenderTimer = null; render(); }, delay == null ? 250 : delay);
}

function captureUiState() {
  const ui = { scrollY: 0, scrolls: [], openIds: [], settingsOpen: false, active: null };
  try { ui.scrollY = window.scrollY || 0; } catch {}
  try {
    const settings = document.getElementById("settingsPanel");
    ui.settingsOpen = !!(settings && settings.style && settings.style.display !== "none");
  } catch {}
  try {
    if (root && root.querySelectorAll) {
      root.querySelectorAll("[id]").forEach((el) => {
        if ((el.scrollTop || 0) > 0 || (el.scrollLeft || 0) > 0) {
          ui.scrolls.push({ id: el.id, top: el.scrollTop || 0, left: el.scrollLeft || 0 });
        }
      });
      root.querySelectorAll(".open").forEach((el) => { if (el.id) ui.openIds.push(el.id); });
    }
  } catch {}
  try {
    const active = document.activeElement;
    if (active && active !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName || "")) {
      let key = active.id ? "#" + active.id : null;
      if (!key && active.dataset && active.dataset.notePos) key = '[data-note-pos="' + active.dataset.notePos + '"]';
      if (key) ui.active = { key, tag: active.tagName, value: active.value, start: active.selectionStart, end: active.selectionEnd };
    }
  } catch {}
  return ui;
}

function restoreUiState(ui) {
  if (!ui) return;
  try { window.scrollTo(0, ui.scrollY || 0); } catch {}
  try {
    (ui.scrolls || []).forEach((s) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      el.scrollTop = s.top;
      el.scrollLeft = s.left;
    });
    (ui.openIds || []).forEach((id) => {
      const el = document.getElementById(id);
      if (el && el.classList) el.classList.add("open");
    });
    if (ui.settingsOpen) {
      const settings = document.getElementById("settingsPanel");
      if (settings && settings.style) settings.style.display = "flex";
    }
  } catch {}
  if (!ui.active) return;
  try {
    let el = null;
    if (ui.active.key.charAt(0) === "#") el = document.getElementById(ui.active.key.slice(1));
    else if (root && root.querySelector) el = root.querySelector(ui.active.key);
    if (!el) return;
    if (ui.active.tag !== "SELECT" && "value" in el && el.value !== ui.active.value) el.value = ui.active.value;
    if (ui.active.start != null && el.setSelectionRange) el.setSelectionRange(ui.active.start, ui.active.end);
    if (el.focus) el.focus({ preventScroll: true });
  } catch {}
}

function refreshSessionBar() {
  const current = document.querySelector(".session-bar");
  if (!current) return;
  const holder = document.createElement("div");
  holder.innerHTML = renderSessionBar();
  const next = holder.firstElementChild;
  if (next) current.replaceWith(next);
}

try {
  window.addEventListener("pagehide", flushTradeNotes);
  document.addEventListener("visibilitychange", function () { if (document.hidden) flushTradeNotes(); });
} catch {}

// Rendering patches stable top-level regions instead of replacing the whole app.
// Every <main> child is keyed by tag/id/classes plus its position among siblings,
// and reused verbatim when its generated HTML has not changed. Keeping the chart
// canvas alive is what makes the drawChart() memo skip real work.
const regionHtmlMemo = new WeakMap();

function regionBaseKey(el) {
  const tag = (el.tagName || "").toLowerCase();
  const raw = typeof el.className === "string" ? el.className : (el.getAttribute ? el.getAttribute("class") || "" : "");
  const cls = raw.trim().split(/\s+/).filter(Boolean).sort().join(".");
  return tag + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
}

function regionKey(el, seen) {
  const base = regionBaseKey(el);
  if (!seen) return base;
  const n = seen[base] || 0;
  seen[base] = n + 1;
  return base + "@" + n;
}

function rememberRegionHtml(mainEl) {
  if (!mainEl || !mainEl.children) return;
  Array.from(mainEl.children).forEach((child) => {
    if (child && child.outerHTML != null) regionHtmlMemo.set(child, child.outerHTML);
  });
}

function renderIntoRoot(html) {
  if (!root) return;
  let template = null;
  try { template = document.createElement("template"); } catch { template = null; }
  // Test harnesses and very old browsers lack <template>.content: fall back to a full write.
  if (!template || typeof template.innerHTML !== "string" || !("content" in template)) {
    root.innerHTML = html;
    rememberRegionHtml(root.querySelector ? root.querySelector("main") : null);
    return;
  }
  template.innerHTML = html;
  const nextMain = template.content.querySelector("main");
  const prevMain = root.querySelector ? root.querySelector("main") : null;
  if (!nextMain || !prevMain) {
    root.innerHTML = html;
    rememberRegionHtml(root.querySelector ? root.querySelector("main") : null);
    return;
  }
  Array.from(nextMain.attributes || []).forEach((attr) => {
    if (prevMain.getAttribute(attr.name) !== attr.value) prevMain.setAttribute(attr.name, attr.value);
  });
  // Bucket the current children by key so identical markup can be reused in place.
  const pools = new Map();
  const prevSeen = {};
  Array.from(prevMain.children).forEach((child) => {
    const key = regionKey(child, prevSeen);
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(child);
  });
  const ordered = [];
  const seen = {};
  Array.from(nextMain.children).forEach((child) => {
    const key = regionKey(child, seen);
    const pool = pools.get(key);
    const candidate = pool && pool.length ? pool.shift() : null;
    const markup = child.outerHTML;
    if (candidate && regionHtmlMemo.get(candidate) === markup) {
      ordered.push(candidate);
    } else {
      regionHtmlMemo.set(child, markup);
      ordered.push(child);
    }
  });
  if (prevMain.replaceChildren) {
    prevMain.replaceChildren(...ordered);
  } else {
    prevMain.textContent = "";
    ordered.forEach((node) => prevMain.appendChild(node));
  }
}

function render() {
  const uiState = captureUiState();
  const pair = `${state.base}/${state.quote}`;
  const analysis = analyze(state.rows, loadStrategyConfig());
  const mlBlocked = mlFilterWarn(analysis);
  const effAnalysis = mlBlocked ? { ...analysis, direction: "WAIT", risk: "No trade (ML filter)", reasons: [...(analysis?.reasons || []), { ok: false, text: "ML model predicts low win probability — filtered" }] } : analysis;
  const displayConfidence = effAnalysis ? Math.min(100, Math.max(0, effAnalysis.confidence + (effAnalysis.direction === "WAIT" ? 0 : mtfAgreementBonus(state.mtf, effAnalysis.direction)))) : null;
  const displayRisk = effAnalysis ? (effAnalysis.direction === "WAIT" ? effAnalysis.risk : (effAnalysis.risk === "Low" && displayConfidence >= 72 ? "Low" : "No trade")) : "";
  const signalClass = effAnalysis ? effAnalysis.direction.toLowerCase() : "wait";
  const headlineSignal = state.status === "error" ? "DATA ERROR" : state.status === "ready" && effAnalysis ? effAnalysis.direction : "LOADING";
  renderIntoRoot(`
    <main aria-busy="${state.status === "loading"}">
      <section class="topbar">
        <div>
          <p class="eyebrow">Low Risk Signal Desk</p>
          <h1>Forex, Crypto & Gold Trading Ideas</h1>
        </div>
        <div class="pair-controls">
          <label class="select-wrap"><span>${names[state.base] || state.base}</span><select id="base">${options(state.base, state.quote)}</select></label>
          <button class="icon-button" id="swap" title="Swap pair" aria-label="Swap base and quote currencies" ${nonFiat.has(state.base) ? "disabled" : ""}>⇄</button>
          <label class="select-wrap"><span>${names[state.quote] || state.quote}</span><select id="quote" ${nonFiat.has(state.base) ? "disabled" : ""}>${options(state.quote, state.base, true)}</select></label>
          <button class="icon-button" id="refresh" title="Refresh analysis" aria-label="Refresh analysis">↻</button>
          <button class="scan-button" id="autoScanToggle" title="Toggle auto-scan" aria-pressed="${autoScan.enabled}"><span class="dot" id="scanDot"></span><span id="scanLabel">Auto-scan</span></button>
          <button class="icon-button" id="settingsToggle" title="Settings" aria-label="Open settings">⚙</button>
          <button class="icon-button" id="screenshotToggle" title="Analyze chart screenshot" aria-label="Analyze chart screenshot">📷</button>
          <button class="icon-button" id="soundToggle" title="Toggle sound (M)" aria-label="${soundEnabled ? "Mute sound" : "Enable sound"}" aria-pressed="${soundEnabled}">${soundEnabled ? "🔊" : "🔇"}</button>
          <button class="icon-button" id="themeToggle" title="Toggle theme (T)" aria-label="${darkTheme ? "Switch to light theme" : "Switch to dark theme"}">${darkTheme ? "🌙" : "☀️"}</button>
          <button class="scan-button" id="mlToggle" data-action="toggle-overlay" data-overlay="ml" title="AI/ML win-probability filter" aria-pressed="${mlFilterEnabled}" style="${mlFilterEnabled ? 'background:var(--wait);color:var(--on-accent)' : ''}">🤖 ${mlFilterEnabled ? "ML ON" : "ML OFF"}${mlModel.trained ? "" : " ·t=" + mlModel.n + ""}</button>
          <span style="font-size:.55rem;color:var(--muted-3)">R=↻ S=⚡ 1/4/H=⏱ B=Back T=Theme</span>
        </div>
        <div class="tf-row">${["1d", "4h", "1h", "30m", "15m", "1m"].map(tf => `<button class="tf-btn${state.timeframe === tf ? " active" : ""}" data-tf="${tf}">${tf}</button>`).join("")}</div>
        <div class="settings-panel" id="settingsPanel" style="display:none;padding:10px 12px;background:var(--panel-inset);border:1px solid var(--border);border-radius:8px;margin:0 12px 8px;flex-direction:column;gap:6px">
          <label style="font-size:.72rem;color:var(--muted)">Webhook URL (Discord or Telegram)</label>
          <div style="display:flex;gap:6px">
            <input type="url" id="webhookInput" value="${escapeAttr(webhookUrl)}" maxlength="2048" autocomplete="off" placeholder="https://discord.com/api/webhooks/... or https://api.telegram.org/bot.../sendMessage?chat_id=..." style="flex:1;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-size:.75rem">
            <button class="scan-button" id="testWebhook" style="white-space:nowrap">Test</button>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px">
            <label style="font-size:.72rem;color:var(--muted)">FX intraday feed (Twelve Data)</label>
            <div style="display:flex;gap:6px;align-items:center">
              <input type="checkbox" id="fxApiEnable" ${fxApiPrefs.enabled ? "checked" : ""} title="Enable browser-readable intraday FX (EUR/JPY and other Binance-uncovered pairs)" style="accent-color:var(--accent)">
              <input type="text" id="fxApiKey" value="${escapeAttr(fxApiPrefs.key)}" maxlength="128" autocomplete="off" placeholder="Free key from twelvedata.com" spellcheck="false" style="flex:1;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-size:.75rem">
              <button class="scan-button" id="testFxApi" style="white-space:nowrap">Test</button>
            </div>
            <div style="font-size:.66rem;color:var(--muted-4);margin-top:3px">Optional. Unlocks 1m–4h for FX pairs Binance cannot cover (JPY, CHF, CAD, NZD and the added crosses). Without a key those pairs keep showing daily rates.</div>
            <div id="fxApiUsage" style="font-size:.62rem;color:${fxApiStatus ? 'var(--warn)' : 'var(--muted-4)'};margin-top:3px">Free tier budget: ${tdGate.used}/${TD_PER_DAY} requests used today · resets at 00:00 UTC${fxApiStatus ? " · " + escapeHtml(fxApiStatus) : ""}</div>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px">
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <button class="scan-button" id="clearCache" style="font-size:.7rem">🗑 Clear market cache</button>
              <span id="cacheStats" style="font-size:.62rem;color:var(--muted-3)">${escapeHtml(marketCacheStatsLabel())}</span>
            </div>
            <div style="font-size:.62rem;color:var(--muted-4);margin-top:3px">Cached provider responses survive reloads. Clearing forces a fresh download on the next chart or scan.</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:4px">
            <button class="scan-button" id="exportData" style="font-size:.7rem">⬇ Export data</button>
            <label style="background:var(--border);border:1px solid var(--border-strong);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.7rem;color:var(--text)">⬆ Import<input type="file" id="importFile" accept=".json" style="display:none"></label>
          </div>
          <div style="border-top:1px solid var(--border);padding-top:6px;margin-top:4px">
            <label style="font-size:.72rem;color:var(--muted)">Strategy Name</label>
            <div style="display:flex;gap:6px">
              <input type="text" id="strategyNameInput" value="${escapeAttr(strategyName)}" maxlength="64" placeholder="My Strategy" style="flex:1;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:6px 8px;color:var(--text);font-size:.75rem">
            </div>
            <div style="display:flex;gap:6px;margin-top:4px">
              <button class="scan-button" id="exportStrategy" style="font-size:.7rem">⬇ Export Strategy</button>
              <label style="background:var(--border);border:1px solid var(--border-strong);border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.7rem;color:var(--text)">⬆ Import Strategy<input type="file" id="importStrategyFile" accept=".json" style="display:none"></label>
            </div>
          </div>
        </div>
        <div class="screenshot-panel" id="screenshotPanel" style="display:none;padding:12px;background:var(--panel-inset);border:1px solid var(--border);border-radius:8px;margin:0 12px 8px;flex-direction:column;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <label for="screenshotFile" style="background:var(--border);border:1px solid var(--border-strong);border-radius:6px;padding:8px 16px;cursor:pointer;font-size:.78rem;color:var(--text);font-weight:600">📷 Choose Image</label>
            <input type="file" id="screenshotFile" accept="image/*" style="display:none">
            <span style="font-size:.7rem;color:var(--muted-2)">Upload a chart screenshot, then click along the price line</span>
          </div>
          <canvas id="screenshotCanvas" style="width:100%;max-height:360px;border-radius:6px;background:var(--bg-deep);cursor:crosshair;display:none"></canvas>
          <div id="ssControls" style="display:none;flex-wrap:wrap;gap:6px;align-items:center">
            <label style="font-size:.65rem;color:var(--muted)">Min price <input type="number" id="ssMin" step="any" style="width:80px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem"></label>
            <label style="font-size:.65rem;color:var(--muted)">Max price <input type="number" id="ssMax" step="any" style="width:80px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem"></label>
            <button class="scan-button" id="ssAnalyze" style="font-size:.7rem">Analyze</button>
            <button class="scan-button" id="ssClear" style="font-size:.7rem">Clear points</button>
            <span id="ssCount" style="font-size:.65rem;color:var(--muted-3)">0 points</span>
          </div>
          <div id="ssResult" style="display:none;padding:8px;background:var(--panel-hover);border-radius:6px;font-size:.8rem;line-height:1.5"></div>
        </div>
      </section>

      ${renderSessionBar()}
      <section class="summary-grid">
        <div class="signal-panel ${signalClass}">
          <div class="panel-label">Current idea</div>
          <div class="signal-row"><span>${headlineSignal}</span><small>${pair}</small></div>
          <p>${signalCopy(analysis, state.status)}</p>
          <span id="livePrice" style="display:${livePrice.price != null ? "inline" : "none"};font-size:.75rem;margin-top:6px"></span>
        </div>
        ${metric("Risk mode", displayRisk)}
        ${metric("Confidence", analysis ? `${displayConfidence}%` : "-")}
        ${metric("Volatility", analysis ? `${analysis.volatilityPct.toFixed(2)}%` : "-")}
        ${(() => { const b = renderMlBadge(analysis); return metric(b.label, b.value); })()}
      </section>

          ${state.error ? `<div class="notice error" role="alert">${escapeHtml(state.error)}</div>` : ""}
          ${state.notice ? `<div class="notice" role="status">${escapeHtml(state.notice)}</div>` : ""}
      ${state.source ? `<div class="source-line">Data source: ${escapeHtml(state.source)}${state.cacheLabel ? ` · cached ${escapeHtml(state.cacheLabel)}` : ""}. Signals are educational trading ideas, not financial advice.</div>` : ""}

      ${
        state.status === "ready" && analysis
          ? `<section class="workspace">
              <div class="chart-panel">
                <div class="section-head">
                  <div><p class="eyebrow">${pair}</p><h2>Price, trend and volatility</h2></div>
                  <span>${analysis.last.date}</span>
                </div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
                  <button data-action="toggle-overlay" data-overlay="ichimoku" aria-pressed="${ichimokuOverlay}" style="background:${ichimokuOverlay?'var(--buy-bg)':'var(--border)'};border:1px solid ${ichimokuOverlay?'var(--buy-strong)':'var(--border-strong)'};color:${ichimokuOverlay?'var(--buy)':'var(--muted)'};padding:3px 8px;border-radius:4px;cursor:pointer;font-size:.62rem;font-family:inherit">☁ Ichimoku</button>
                  <button data-action="toggle-overlay" data-overlay="fib" aria-pressed="${fibOverlay}" style="background:${fibOverlay?'var(--buy-bg)':'var(--border)'};border:1px solid ${fibOverlay?'var(--buy-strong)':'var(--border-strong)'};color:${fibOverlay?'var(--buy)':'var(--muted)'};padding:3px 8px;border-radius:4px;cursor:pointer;font-size:.62rem;font-family:inherit">📊 Fibonacci</button>
                  <button data-action="toggle-overlay" data-overlay="macd" aria-pressed="${macdHistVote}" style="background:${macdHistVote?'var(--buy-bg)':'var(--border)'};border:1px solid ${macdHistVote?'var(--buy-strong)':'var(--border-strong)'};color:${macdHistVote?'var(--buy)':'var(--muted)'};padding:3px 8px;border-radius:4px;cursor:pointer;font-size:.62rem;font-family:inherit">📊 MACD+Hist</button><button data-action="toggle-overlay" data-overlay="vwap" aria-pressed="${vwapOverlay}" style="background:${vwapOverlay?'var(--buy-bg)':'var(--border)'};border:1px solid ${vwapOverlay?'var(--buy-strong)':'var(--border-strong)'};color:${vwapOverlay?'var(--buy)':'var(--muted)'};padding:3px 8px;border-radius:4px;cursor:pointer;font-size:.62rem;font-family:inherit">📊 VWAP</button>
                </div>
                <div id="chartContainer"><canvas id="priceChart" role="img" aria-labelledby="chartSummary"></canvas><p id="chartSummary" class="sr-only">Price chart</p></div>
              </div>
              <aside class="idea-panel">
                <div class="section-head compact"><div><p class="eyebrow">Low-risk plan</p><h2>${analysis.direction === "WAIT" ? "Stand aside" : `${analysis.direction} setup`}</h2></div></div>
                <div class="levels">
                  ${level("Entry area", analysis.direction === "WAIT" ? "No entry" : formatPrice(analysis.entry, pair))}
                  ${level("Pullback limit", analysis.direction === "WAIT" || !analysis.pullbackEntry ? "-" : formatPrice(analysis.pullbackEntry, pair))}
                  ${level("Stop level", analysis.direction === "WAIT" ? "-" : formatPrice(analysis.stop, pair))}
                  ${level("Target area", analysis.direction === "WAIT" ? "-" : formatPrice(analysis.target, pair))}
                  ${level("Trail stop", analysis.direction === "WAIT" || !analysis.trailingStop ? "-" : formatPrice(analysis.trailingStop, pair))}
                </div>
                <div class="checks">${analysis.reasons.map((reason) => `<div class="check ${reason.ok ? "ok" : "bad"}"><span>${reason.ok ? "✓" : "!"}</span>${reason.text}</div>`).join("")}</div>
                  <div style="display:flex;gap:10px;font-size:.68rem;color:var(--muted-2);border-top:1px solid var(--border);padding-top:8px"><span>📈 Buy score ${analysis.buyScore.toFixed(0)}</span><span>📉 Sell score ${analysis.sellScore.toFixed(0)}</span><span>ADX ${analysis.adx}</span></div>
                ${(() => { const mtf = state.mtf; const entries = Object.entries(mtf); if (entries.length === 0) return ""; return `<div style="border-top:1px solid var(--border);padding-top:8px"><div style="font-size:.65rem;color:var(--muted-3);margin-bottom:4px">Multi-timeframe</div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;font-size:.62rem">${entries.map(([tf, a]) => `<div style="padding:4px;background:var(--panel-inset);border-radius:4px;text-align:center"><div style="color:var(--muted-3)">${tf}</div><div style="font-weight:600;color:${a.direction === 'BUY' ? 'var(--buy)' : a.direction === 'SELL' ? 'var(--sell)' : 'var(--wait)'}">${a.direction}</div><div style="color:var(--muted)">${a.confidence}%</div><div style="font-size:.55rem;color:var(--muted-3)">${a.buyScore}/${a.sellScore}</div></div>`).join("")}</div></div>`; })()}
                <div class="notice">Weighted scoring across trend, momentum, RSI, EMA alignment, OBV & volume. Strong trend (ADX) needed for entry. Signal confidence decays on repeat signals.</div>
              </aside>
            </section>`
          : ""
      }

      <section class="overview-section">
        <div class="overview-head">
          <h3>Market Overview</h3>
          <span class="ov-progress" id="ovProgress">${multiScan.progress}${autoScan.enabled ? ` · <span id="scanCountdown">${scanCountdown}s</span>` : ""}</span>
          <div style="display:flex;gap:6px">
            <button class="ov-wl-filter" style="background:${multiScan.watchlistOnly?'var(--buy-bg)':'var(--panel-hover)'};border:1px solid ${multiScan.watchlistOnly?'var(--buy-strong)':'var(--border)'};color:${multiScan.watchlistOnly?'var(--buy)':'var(--muted)'};padding:2px 8px;border-radius:4px;cursor:pointer;font-size:.62rem;font-family:inherit">${multiScan.watchlistOnly ? '★ On' : '☆ All'}</button>
            <button class="icon-button" id="toggleScanConfig" title="Configure pairs">⚙</button>
            <button class="scan-button" id="scanAll" ${multiScan.scanning ? "disabled" : ""}><span class="dot ${multiScan.scanning ? 'active pulse' : ''}"></span>Scan all</button>
            <select id="scanTfSel" title="Scan timeframe" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--muted);font-size:.62rem;font-family:inherit">
              ${[["1m","1M"],["5m","5M"],["15m","15M"],["30m","30M"],["1h","1H"],["4h","4H"],["1d","1D"]].map(([v,l]) => `<option value="${v}" ${multiScan.timeframe === v ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding:8px 12px 0">
          ${["all","BUY","SELL","WAIT"].map(f => `<button class="ov-filter" data-ov-filter="${f}" style="background:${multiScan.filter === f ? (f === 'BUY' ? 'var(--buy-bg)' : f === 'SELL' ? 'var(--sell-bg)' : 'var(--panel-hover)') : 'var(--panel-inset)'};border:1px solid ${multiScan.filter === f ? (f === 'BUY' ? 'var(--buy-strong)' : f === 'SELL' ? 'var(--sell)' : 'var(--border-strong)') : 'var(--border)'};color:${multiScan.filter === f ? (f === 'BUY' ? 'var(--buy)' : f === 'SELL' ? 'var(--sell)' : 'var(--text)') : 'var(--muted)'};padding:2px 10px;border-radius:4px;cursor:pointer;font-size:.62rem;font-family:inherit">${f === "all" ? "All" : f}</button>`).join("")}
          <select id="ovSort" title="Sort overview" style="margin-left:auto;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:2px 6px;color:var(--muted);font-size:.62rem;font-family:inherit">
            <option value="conf" ${multiScan.sortMode === "conf" ? "selected" : ""}>Sort: Confidence</option>
            <option value="dir" ${multiScan.sortMode === "dir" ? "selected" : ""}>Sort: Direction</option>
            <option value="name" ${multiScan.sortMode === "name" ? "selected" : ""}>Sort: Pair</option>
          </select>
        </div>
        ${multiScan.configOpen ? `<div style="padding:8px 12px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap"><button class="scan-button" id="scanSelAll" style="font-size:.62rem">All</button><button class="scan-button" id="scanSelNone" style="font-size:.62rem">None</button><button class="scan-button" id="scanSelCrypto" style="font-size:.62rem">Crypto</button><button class="scan-button" id="scanSelFx" style="font-size:.62rem">FX</button><span style="font-size:.62rem;color:var(--muted-3)">${scanPairs.length}/${allScanPairs.length} pairs selected</span></div><div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;background:var(--panel-inset);border:1px solid var(--border);border-radius:8px;margin-bottom:10px">${allScanPairs.map(p => { const on = scanPairs.includes(p); return `<label style="display:flex;align-items:center;gap:4px;font-size:.72rem;color:var(--muted);cursor:pointer;padding:3px 8px;border-radius:4px;background:${on ? 'var(--panel-hover)' : 'transparent'};border:1px solid ${on ? 'var(--border)' : 'transparent'}"><input type="checkbox" ${on ? "checked" : ""} data-scan-pair="${p}" style="accent-color:var(--buy)">${p}</label>`; }).join("")}</div>` : ""}
        <div class="overview-grid">${(() => { const best = overviewBestPair(); return overviewFilteredPairs().sort(overviewSort).map(pair => { const r = multiScan.results[pair] || { loading: true }; const cls = r.loading ? "loading" : (r.direction || "wait").toLowerCase(); const isBest = pair === best; const starred = watchlist.includes(pair); const hasAlert = alerts.some(a => a.pair === pair); return `<div class="ov-card ${cls}${isBest ? " ov-best" : ""}">${isBest && !r.loading ? `<div class="ov-best-badge">BEST</div>` : ""}<div class="ov-card-top"><span class="ov-pair">${pair}</span><button class="ov-star ${starred ? 'active' : ''}" data-star="${pair}" title="Toggle watchlist">${starred ? '★' : '☆'}</button></div><span class="ov-signal">${r.loading ? "..." : r.direction}</span><div class="ov-meta">${r.loading ? "" : `<span>${r.confidence}%</span><span id="op-${pair.replace("/","-")}">${r.price ? formatPrice(r.price, pair) : ""}</span>${r.change != null ? `<span id="oc-${pair.replace("/","-")}" class="${r.change >= 0 ? 'chg-up' : 'chg-down'}">${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%</span>` : ''}`}</div>${!r.loading && r.mtf4h ? `<span style="font-size:.55rem;padding:1px 4px;border-radius:3px;background:${r.mtf4h === r.direction ? 'var(--buy-soft)' : r.mtf4h === 'WAIT' ? 'var(--neutral-soft)' : 'var(--sell-soft)'};color:${r.mtf4h === r.direction ? 'var(--buy)' : r.mtf4h === 'WAIT' ? 'var(--muted)' : 'var(--sell)'};border:1px solid ${r.mtf4h === r.direction ? 'var(--buy-glow)' : r.mtf4h === 'WAIT' ? 'var(--neutral-soft)' : 'var(--sell-glow)'}" title="${r.mtfTf || '4H'}: ${r.mtf4h}">${r.mtf4h === r.direction ? '✓' : r.mtf4h === 'WAIT' ? '–' : '✗'} ${r.mtfTf || '4H'}</span>` : ''}${!r.loading && r.price ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px"><span style="font-size:.6rem;color:var(--muted-3)">📈${r.buyScore}/${macdHistVote?8:7} 📉${r.sellScore}/${macdHistVote?8:7}</span><button class="ov-alert-btn" data-alert="${pair}" title="Set price alert">${hasAlert ? '🔔' : '+ Alert'}</button><button class="ov-alert-btn" data-trade-ov="${pair}" title="Open trade" ${r.direction === "WAIT" ? "disabled" : ""}>→</button></div>` : ""}</div>`; }).join(""); })()}</div></div>
      </section>

      ${(() => { var pa = priceLevelAlerts; return '<section class="dashboard-section"><button class="backtest-toggle no-select" id="priceAlertToggle"><div class="history-toggle-left"><h3>Price Level Alerts</h3><span class="history-count">' + pa.length + '</span></div><span class="arrow">\u25BE</span></button><div class="history-body" id="priceAlertBody"><div style="padding:10px 12px"><div class="price-alert-row"><select id="paPair" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem">' + scanPairs.map(function(p) { return '<option value="' + escapeAttr(p) + '">' + escapeHtml(p) + '</option>'; }).join('') + '</select><select id="paDir"><option value="above">Above</option><option value="below">Below</option></select><input type="number" id="paPrice" placeholder="Price" step="any" style="width:80px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem"><button class="scan-button" id="addPriceAlert" style="font-size:.7rem">+ Add</button></div>' + pa.map(function(a, i) { return '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--panel-inset);font-size:.7rem"><span style="width:56px;color:var(--text);font-weight:600">' + escapeHtml(a.pair) + '</span><span style="color:' + (a.dir === 'above' ? 'var(--buy)' : 'var(--sell)') + '">' + (a.dir === 'above' ? '\u2191' : '\u2193') + '</span><span style="color:var(--muted)">' + formatPrice(a.price, a.pair) + '</span><button data-rm-pa="' + i + '" style="background:transparent;border:none;color:var(--muted-3);cursor:pointer;font-size:.7rem;margin-left:auto">\u2715</button></div>'; }).join('') + '</div></div></section>'; })()}
${alerts.length > 0 ? `<section class="alerts-section"><div class="alerts-head"><h4>Price Alerts</h4></div><div class="alerts-grid">${alerts.map(a => `<div class="alert-chip"><span>${escapeHtml(a.pair)}</span><strong>${formatPrice(a.price, a.pair)}</strong><span>${a.dir === "above" ? "↑" : "↓"}</span><button class="alert-chip-rm" data-rm-alert="${escapeAttr(a.id)}">✕</button></div>`).join("")}</div></section>` : ""}

      ${(() => { const open = positions.filter(p => !p.closedAt); if (open.length === 0) return ""; const corrGroups = [["EUR/USD","GBP/USD","EUR/GBP"],["AUD/USD","NZD/USD"]]; const openPairs = open.map(p => p.pair); const corrWarnings = []; for (const group of corrGroups) { const matched = openPairs.filter(p => group.includes(p)); if (matched.length >= 2) corrWarnings.push(matched.join(", ")); } return `<section class="positions-section"><div class="positions-head"><h4>Open Positions</h4><span>${open.length}</span><button id="closeAllPositions" style="margin-left:auto;padding:3px 10px;background:var(--sell-bg);border:1px solid var(--sell);color:var(--sell);border-radius:4px;cursor:pointer;font-size:.65rem;font-family:inherit">Close All</button></div>${open.map(p => { const cp = getPosPrice(p); const pnl = p.direction === "BUY" ? cp - p.entry : p.entry - cp; const pnlPct = p.entry ? (pnl / p.entry) * 100 : 0; const pnlCls = pnl >= 0 ? "pos-profit" : "pos-loss"; return `<div class="pos-row ${p.direction === 'BUY' ? 'pos-buy' : 'pos-sell'}"><div class="pos-top"><span class="pos-pair">${p.pair}</span><span class="pos-dir">${p.direction}</span><span class="${pnlCls}">${pnl >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%</span><button class="pos-btn" data-close-pos="${p.id}">Close</button></div><div class="pos-partial"><button data-partial-pos="${p.id}" data-pct="25">25%</button><button data-partial-pos="${p.id}" data-pct="50">50%</button><button data-partial-pos="${p.id}" data-pct="75">75%</button></div><div class="pos-meta"><span>Entry ${formatPrice(p.entry, p.pair)}</span><span>Cur ${formatPrice(cp, p.pair)}</span><span>Stop ${formatPrice(p.stop, p.pair)}</span><span>Target ${formatPrice(p.target, p.pair)}</span><span style="color:${pnl >= 0 ? 'var(--buy)' : 'var(--sell)'}">R: ${(() => { const risk = Math.abs(p.entry - p.stop); const reward = Math.abs(cp - p.entry); return risk > 0 ? (p.direction === 'BUY' ? (reward / risk) : (reward / risk)).toFixed(1) : '0'; })()}x</span></div></div>`; }).join("")}${corrWarnings.length > 0 ? `<div style="padding:6px 10px;background:var(--gold-bg);border:1px solid var(--gold-border);border-radius:6px;font-size:.68rem;color:var(--gold);margin-top:4px">⚠ Correlated positions detected: ${corrWarnings.join("; ")}</div>` : ""}</section>`; })()}

      ${(() => { const closed = positions.filter(p => p.closedAt); if (closed.length === 0) return ""; const tradeNotes = getTradeNotes(); return `<section class="positions-section closed"><div class="positions-head"><h4>Closed Positions</h4><span>${closed.length}</span></div>${closed.map(p => { const pnlCls = p.pnl >= 0 ? "pos-profit" : "pos-loss"; const noteVal = tradeNotes[p.id] || ""; return `<div class="pos-row ${p.direction === 'BUY' ? 'pos-buy' : 'pos-sell'} closed"><div class="pos-top"><span class="pos-pair">${p.pair}</span><span class="pos-dir">${p.direction}</span><span class="${pnlCls}">${p.pnl >= 0 ? '+' : ''}${p.pnlPct.toFixed(2)}%</span><button class="pos-btn" data-del-pos="${p.id}">✕</button></div><div class="pos-meta"><span>Entry ${formatPrice(p.entry, p.pair)}</span><span>Exit ${formatPrice(p.exitPrice, p.pair)}</span><span class="${pnlCls}">${p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(p.pair.includes('JPY') ? 3 : p.pair.includes('XAU') || nonFiat.has(p.pair.split('/')[0]) ? 2 : 5)}</span></div><textarea data-note-pos="${p.id}" placeholder="Trade notes..." style="width:100%;margin-top:4px;background:var(--panel-inset);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--muted);font-size:.65rem;resize:vertical;min-height:20px;font-family:inherit">${escapeHtml(noteVal)}</textarea></div>`; }).join("")}</section>`; })()}

      ${(() => { const perfData = (() => { const sigs = autoScan.history.filter(e => e.result === "win" || e.result === "loss").reverse(); if (sigs.length < 2) return null; let cum = 0; return sigs.map(s => { cum += s.result === "win" ? 1 : -1; return { date: s.timestamp, value: cum }; }); })(); if (!perfData) return ""; const vals = perfData.map(p => p.value); let mx = -Infinity, mn = Infinity; for (const v of vals) { if (v > mx) mx = v; if (v < mn) mn = v; } const rng = mx - mn || 1; const w = 240; const h = 48; const xSt = w / (vals.length - 1); const pts = vals.map((v, i) => `${i * xSt},${h - ((v - mn) / rng) * (h - 6) - 3}`).join(" "); const color = vals[vals.length - 1] >= vals[0] ? "#3fb950" : "#f85149"; return `<section class="perf-section"><div class="perf-head"><h4>Performance</h4><span>${vals[vals.length - 1] >= 0 ? "+" : ""}${vals[vals.length - 1]} pts</span></div><svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg></section>`; })()}

      ${autoScan.history.length > 0 ? (() => { const s = calcStats(); return s.total > 0 ? `<div class="stats-bar"><div class="stat-item"><span>Signals</span><strong>${s.total}</strong></div><div class="stat-item"><span>Wins</span><strong class="stat-win">${s.wins}</strong></div><div class="stat-item"><span>Losses</span><strong class="stat-loss">${s.losses}</strong></div><div class="stat-item"><span>Win rate</span><strong style="color:${s.winRate >= 50 ? 'var(--buy)' : 'var(--sell)'}">${s.winRate}%</strong></div>${s.streak > 0 ? `<div class="stat-item"><span>Streak</span><strong class="${s.streakType === 'win' ? 'stat-win' : 'stat-loss'}">${s.streak} ${s.streakType}${s.streak > 1 ? 's' : ''}</strong></div>` : ''}</div>` : "" })() : ""}

      ${(() => { const sigs = autoScan.history.filter(e => e.result === "win" || e.result === "loss"); if (sigs.length < 3) return ""; const byPair = {}; sigs.forEach(e => { if (!byPair[e.pair]) byPair[e.pair] = { wins: 0, losses: 0, rrSumAll: 0, rrSumWins: 0, rrCount: 0 }; const rr = e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : null; if (e.result === "win") { byPair[e.pair].wins++; if (rr != null && isFinite(rr)) { byPair[e.pair].rrSumWins += rr; byPair[e.pair].rrSumAll += rr; byPair[e.pair].rrCount++; } } else { byPair[e.pair].losses++; if (rr != null && isFinite(rr)) { byPair[e.pair].rrSumAll += rr; byPair[e.pair].rrCount++; } } }); const pairRows = Object.entries(byPair).map(([pair, v]) => { const total = v.wins + v.losses; const wr = Math.round((v.wins / total) * 100); const avgRR = v.rrCount > 0 ? (v.rrSumAll / v.rrCount).toFixed(1) : "-"; const pf = v.losses > 0 ? (v.rrSumWins / v.losses).toFixed(2) : (v.wins > 0 ? "∞" : "0"); return `<div style="display:flex;align-items:center;gap:6px;font-size:.65rem;padding:3px 0"><span style="width:52px;text-transform:uppercase">${pair.split("/")[0]}</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${wr}%;height:100%;background:${wr >= 50 ? 'var(--buy)' : 'var(--sell)'};border-radius:3px"></div></div><span style="width:28px;text-align:right;color:${wr >= 50 ? 'var(--buy)' : 'var(--sell)'}">${wr}%</span><span style="width:36px;text-align:right;color:var(--muted)" title="Avg R:R">RR ${avgRR}</span><span style="width:36px;text-align:right;color:var(--muted-3)" title="Profit Factor">PF ${pf}</span><span style="width:32px;text-align:right;color:var(--muted-3)">${v.wins}/${total}</span></div>`; }).join(""); const months = {}; sigs.forEach(e => { const m = e.timestamp.toISOString().slice(0, 7); if (!months[m]) months[m] = { wins: 0, losses: 0 }; months[m][e.result === "win" ? "wins" : "losses"]++; }); const monthRows = Object.entries(months).sort((a,b) => a[0].localeCompare(b[0])).map(([m, v]) => { const total = v.wins + v.losses; const wr = Math.round((v.wins / total) * 100); return `<div style="display:flex;align-items:center;gap:6px;font-size:.65rem;padding:3px 0"><span style="width:48px">${m.slice(5)}/${m.slice(2,4)}</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${wr}%;height:100%;background:${wr >= 50 ? 'var(--buy)' : 'var(--sell)'};border-radius:3px"></div></div><span style="width:30px;text-align:right;color:${wr >= 50 ? 'var(--buy)' : 'var(--sell)'}">${wr}%</span><span style="width:40px;text-align:right;color:var(--muted-3)">${v.wins}/${total}</span></div>`; }).join(""); return `<section class="dashboard-section"><button class="history-toggle no-select" id="dashToggle"><div class="history-toggle-left"><h3>Signal Quality Dashboard</h3></div><span class="arrow">▾</span></button><div class="history-body" id="dashBody"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:8px 0">${pairRows.length > 0 ? `<div><p style="font-size:.72rem;color:var(--muted);margin-bottom:4px">Win rate by pair</p>${pairRows}</div>` : ""}${monthRows.length > 0 ? `<div><p style="font-size:.72rem;color:var(--muted);margin-bottom:4px">Monthly win rate</p>${monthRows}</div>` : ""}</div></div></section>`; })()}

      ${(() => { const rc = (() => { try { const s = localStorage.getItem("riskConfig"); return s ? JSON.parse(s) : {}; } catch { return {}; } })(); const balance = rc.balance ?? 10000; const startingBalance = rc.startingBalance ?? balance; const riskPct = rc.riskPct ?? 1; const maxPos = rc.maxPos ?? 5; const dailyLimit = rc.dailyLimit ?? 5; const maxLossStreak = rc.maxLossStreak ?? 4; const corrCap = rc.corrCap ?? 2; const curStreak = getLossStreak(); const openCount = positions.filter(p => !p.closedAt).length; const analysis2 = analyze(state.rows, loadStrategyConfig()); const stopDist = analysis2 && analysis2.direction !== "WAIT" ? Math.abs(analysis2.entry - analysis2.stop) : 0; const realizedPnl = positions.filter(p => p.closedAt).reduce((s, p) => s + (p.pnlCurrency || 0), 0); const unrealizedPnl = positions.filter(p => !p.closedAt).reduce((s, p) => { const cp = getPosPrice(p); const diff = p.direction === "BUY" ? cp - p.entry : p.entry - cp; const pnlPct = p.entry ? (diff / p.entry) * 100 : 0; return s + pnlPct / 100 * balance; }, 0); const equity = startingBalance + realizedPnl + unrealizedPnl; const hist = autoScan.history.filter(e => e.direction !== "WAIT" && (e.result === "win" || e.result === "loss")); const histWins = hist.filter(e => e.result === "win").length; const histWR = hist.length > 0 ? histWins / hist.length : 0.5; const histAvgW = hist.filter(e => e.result === "win").length > 0 ? hist.filter(e => e.result === "win").reduce((s,e) => { const rr = e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 2; return s + rr; }, 0) / hist.filter(e => e.result === "win").length : 2; const histAvgL = hist.filter(e => e.result === "loss").length > 0 ? hist.filter(e => e.result === "loss").reduce((s,e) => { const rr = e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 1; return s + rr; }, 0) / hist.filter(e => e.result === "loss").length : 1; const kellyFrac = kellyFraction(histWR, histAvgW, histAvgL);
      // Kelly toggle must actually change the recommended size, not just the label.
      const posSizeFixed = stopDist > 0 ? Math.round((equity * riskPct * mlSizingFactor(analysis2, 0.5) / 100) / stopDist) : 0;
      const kellySize = stopDist > 0 ? Math.round((equity * kellyFrac) / stopDist) : 0;
      const posSizeFinal = kellyEnabled ? kellySize : posSizeFixed; const todayKey = new Date().toISOString().slice(0,10); let dailyPnl = 0; try { const dl = JSON.parse(localStorage.getItem("dailyLoss") || "{}"); dailyPnl = dl[todayKey] || 0; } catch {} const dailyPct = balance > 0 ? ((dailyPnl / balance) * 100).toFixed(2) : "0.00"; return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="riskToggle"><div class="history-toggle-left"><h3>Risk Management</h3></div><span class="arrow">▾</span></button><div class="history-body" id="riskBody"><div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:.72rem"><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Account Balance<input type="number" id="rmBalance" value="${balance}" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Starting Balance<input type="number" id="rmStartingBalance" value="${startingBalance}" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Risk Per Trade %<input type="number" id="rmRisk" value="${riskPct}" step="0.1" min="0.1" max="10" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Max Concurrent Positions<input type="number" id="rmMaxPos" value="${maxPos}" min="1" max="20" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Daily Loss Limit $<input type="number" id="rmDailyLimit" value="${dailyLimit}" min="1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Max Loss Streak<input type="number" id="rmMaxStreak" value="${maxLossStreak}" min="1" max="10" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Max Correlated Pos<input type="number" id="rmCorrCap" value="${corrCap}" min="1" max="5" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label></div><div style="padding:4px 12px 0;font-size:.72rem;color:var(--muted)">Equity: <strong style="color:var(--text-strong)">$${equity.toFixed(2)}</strong> <span style="font-size:.65rem;color:var(--muted-3)">(starting: $${startingBalance.toLocaleString()}, realized: <span style="color:${realizedPnl >= 0 ? 'var(--buy)' : 'var(--sell)'}">${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}</span>, unrealized: <span style="color:${unrealizedPnl >= 0 ? 'var(--buy)' : 'var(--sell)'}">${unrealizedPnl >= 0 ? '+' : ''}$${unrealizedPnl.toFixed(2)}</span>)</span></div><div style="padding:4px 12px 8px;display:flex;align-items:center;gap:8px;font-size:.72rem"><span style="color:var(--muted)">Kelly Sizing</span><label class="toggle"><input type="checkbox" id="kellyToggle" ${kellyEnabled ? "checked" : ""}><span class="toggle-track"></span><span class="toggle-knob"></span></label>${kellyEnabled && kellyFrac > 0 ? `<span style="color:var(--wait);font-size:.65rem">Fraction: ${(kellyFrac * 100).toFixed(1)}% \u2192 ${kellySize.toLocaleString()} units</span>` : ""}</div><div style="padding:4px 12px 12px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:.68rem"><div style="padding:6px 8px;background:var(--panel-inset);border-radius:6px;text-align:center"><div style="color:var(--muted-3);margin-bottom:2px">${kellyEnabled ? "Position Size (Kelly)" : "Position Size (Fixed)"}${mlModel.trained && analysis2 && analysis2.ml && analysis2.ml.win != null ? ' ·ML' : ''}</div><div style="font-weight:600;color:${posSizeFinal > 0 ? 'var(--buy)' : 'var(--muted-2)'};font-size:.85rem">${posSizeFinal > 0 ? posSizeFinal.toLocaleString() + ' units' : 'N/A'}</div><div style="font-size:.58rem;color:var(--muted-3);margin-top:2px">Stop: ${analysis2 && analysis2.direction !== "WAIT" ? formatPrice(analysis2.stop, pair) : '-'}</div></div><div style="padding:6px 8px;background:var(--panel-inset);border-radius:6px;text-align:center"><div style="color:var(--muted-3);margin-bottom:2px">Open Positions</div><div style="font-weight:600;color:${openCount >= maxPos ? 'var(--sell)' : 'var(--text-strong)'};font-size:.85rem">${openCount} / ${maxPos}</div><div style="font-size:.58rem;color:var(--muted-3);margin-top:2px">${openCount >= maxPos ? 'Max reached' : 'Available'}</div></div><div style="padding:6px 8px;background:var(--panel-inset);border-radius:6px;text-align:center"><div style="color:var(--muted-3);margin-bottom:2px">Daily P&L</div><div style="font-weight:600;color:${dailyPnl >= 0 ? 'var(--buy)' : 'var(--sell)'};font-size:.85rem">${dailyPnl >= 0 ? '+' : ''}${dailyPct}%</div><div style="font-size:.58rem;color:var(--muted-3);margin-top:2px">Limit: $${dailyLimit}${curStreak > 0 ? ` · Streak: <span style="color:${curStreak >= maxLossStreak ? 'var(--sell)' : 'var(--warn-orange)'}">${curStreak}/${maxLossStreak}</span>` : ""}</div></div></div></div></section>`; })()}

      ${renderAlertConditions()}
      ${renderPerformanceSummary()}
      ${renderAlertLog()}
      ${renderStrategyConfig()}
      ${renderBacktest()}
      ${renderComparison()}
      ${renderCorrelationMatrix()}
      ${renderPaperTrading()}
      ${renderTradeReplay()}
      ${renderMonteCarlo()}
      ${renderWalkForward()}
      ${renderStrategyOptimizer()}
      ${renderScheduledReports()}
      ${renderHeatmap()}
      ${renderDrawdownChart()}
      ${renderEconCalendar()}
      <section class="history-section">
        <button class="history-toggle no-select" id="historyToggle">
          <div class="history-toggle-left">
            <h3>Signal History</h3>
            <span class="history-count" title="${autoScan.history.length} in log">${autoScan.totalGenerated}</span>
          </div>
          <span class="arrow">▾</span>
        </button>
        <div class="history-body" id="historyBody">
          <div class="history-header">
            <span>Time</span><span>Pair</span><span>Signal</span><span>Conf.</span><span>Risk</span><span>Vol.</span><span>Result</span><span></span>
          </div>
          <div class="history-scroll" id="historyScroll">
            ${autoScan.history.length === 0 ? '<div class="history-empty">No signals yet. Enable auto-scan or refresh to generate signals.</div>' : ""}
            ${autoScan.history.map((entry, idx) => renderHistoryEntry(entry, idx)).join("")}
          </div>
          ${autoScan.history.length > 0 ? `<div class="history-actions"><button id="exportCSV">Export CSV</button><button id="exportJSON">Export JSON</button><button id="clearHistory">Clear history</button></div>` : ""}
        </div>
      </section>
    </main>
  `);
  if (state.status === "ready" && analysis) {
    drawChart(document.getElementById("priceChart"), analysis.chartRows, pair, state.timeframe);
  }
  resizeObserver.disconnect();
  observeChartContainer();
  updateScanUI();
  const lp = document.getElementById("livePrice");
  if (lp && livePrice.price != null) renderLivePrice(lp);
  restoreUiState(uiState);
}

function renderHistoryEntry(entry, idx) {
  const dirClass = entry.direction.toLowerCase();
  const resultLabel = entry.result === "win" ? "✓" : entry.result === "loss" ? "✗" : "○";
  const pair = escapeHtml(entry.pair);
  const direction = escapeHtml(entry.direction);
  const risk = escapeHtml(entry.risk);
  const entryId = escapeAttr(entry.id);
  return `<div class="history-entry" data-idx="${idx}">
    <div class="history-summary">
      <span class="h-time">${entry.timestamp.toLocaleTimeString()}</span>
      <span class="h-pair">${pair}</span>
      <span class="h-dir ${dirClass}">${direction}</span>
      <span class="h-conf">${entry.confidence}%</span>
      <span class="h-risk ${entry.risk === "Low" ? "valid" : ""}">${risk}</span>
      <span class="h-vol">${entry.volatilityPct.toFixed(2)}%</span>
      <span class="h-result ${entry.result}">${resultLabel}</span>
      <span><button class="h-delete" data-del="${entryId}" title="Delete entry">✕</button><button class="h-trade-btn" data-trade="${entryId}" title="Open trade" ${entry.direction === "WAIT" ? "disabled" : ""}>→</button><span class="h-expand">▼</span></span>
    </div>
    <div class="history-detail" id="hd-${idx}">
      <div class="history-detail-grid">
        <div class="hd-item"><span>Pair</span><span>${pair}</span></div>
        <div class="hd-item"><span>Direction</span><span class="h-dir ${dirClass}">${direction}</span></div>
        <div class="hd-item"><span>Entry</span><span>${entry.entry != null ? formatPrice(entry.entry, entry.pair) : "-"}</span></div>
        <div class="hd-item"><span>Stop</span><span>${entry.stop != null ? formatPrice(entry.stop, entry.pair) : "-"}</span></div>
        <div class="hd-item"><span>Target</span><span>${entry.target != null ? formatPrice(entry.target, entry.pair) : "-"}</span></div>
        <div class="hd-item"><span>Confidence</span><span>${entry.confidence}%</span></div>
        <div class="hd-item"><span>Risk mode</span><span>${risk}</span></div>
        <div class="hd-item"><span>Volatility</span><span>${entry.volatilityPct.toFixed(2)}%</span></div>
        <div class="hd-item"><span>Result</span><span style="color:${entry.result === 'win' ? 'var(--buy)' : entry.result === 'loss' ? 'var(--sell)' : 'var(--muted-2)'}">${escapeHtml(entry.result.charAt(0).toUpperCase() + entry.result.slice(1))}</span></div>
        <div class="hd-item"><span>Buy score</span><span>${entry.buyScore}/7</span></div>
        <div class="hd-item"><span>Sell score</span><span>${entry.sellScore}/7</span></div>
      </div>
      ${entry.reasons.length > 0 ? `<div class="history-detail-reasons"><p>Reasoning</p>${entry.reasons.map(r => `<div class="hd-reason"><span class="hd-r-icon ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '!'}</span>${escapeHtml(r.text)}</div>`).join("")}</div>` : ""}
      ${entry.direction !== "WAIT" ? `<button class="hd-trade-btn" data-trade="${entryId}">Open Trade →</button>` : ""}
    </div>
  </div>`;
}

function signalCopy(analysis, status) {
  if (status === "loading") return "Loading market data and checking strict confirmation filters.";
  if (status === "error") return "No signal is produced when live market data cannot be loaded.";
  if (!analysis) return "Waiting for enough market history.";
  if (analysis.direction === "WAIT") return "No low-risk entry right now. The app waits until the setup is cleaner.";
  return `${analysis.direction} idea with controlled risk, confirmed trend, momentum and volatility filters.`;
}

function metric(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function level(label, value) {
  return `<div class="level"><span>${label}</span><strong>${value}</strong></div>`;
}

function updateScanUI() {
  const dot = document.getElementById("scanDot");
  const label = document.getElementById("scanLabel");
  const btn = document.getElementById("autoScanToggle");
  if (!dot || !label || !btn) return;
  if (autoScan.enabled) {
    dot.className = "dot active pulse";
    label.textContent = "Scanning";
    btn.classList.add("active");
  } else {
    dot.className = "dot";
    label.textContent = "Auto-scan";
    btn.classList.remove("active");
  }
}

function addSignalToHistory(pair, task) {
  const direction = task?.direction ?? "WAIT";
  // Only actionable setups belong in history. WAIT means "stand aside", so
  // recording it would pad the log with non-signals and with demo-data noise.
  if (direction === "WAIT") return false;
  const lastForPair = autoScan.history.find(e => e.pair === pair);
  if (lastForPair && lastForPair.direction === direction && lastForPair.result === "pending") {
    Object.assign(lastForPair, {
      timestamp: new Date(),
      confidence: task?.confidence ?? 0,
      risk: task?.risk ?? "No trade",
      entry: task?.entry ?? null,
      stop: task?.stop ?? null,
      target: task?.target ?? null,
      volatilityPct: task?.volatilityPct ?? 0,
      buyScore: task?.buyScore ?? 0,
      sellScore: task?.sellScore ?? 0,
      reasons: task?.reasons ?? [],
    });
    saveHistory();
    return false;
  }
  autoScan.history.unshift({
    id: Date.now(),
    timestamp: new Date(),
    pair,
    direction,
    confidence: task?.confidence ?? 0,
    risk: task?.risk ?? "No trade",
    entry: task?.entry ?? null,
    stop: task?.stop ?? null,
    target: task?.target ?? null,
    volatilityPct: task?.volatilityPct ?? 0,
    buyScore: task?.buyScore ?? 0,
    sellScore: task?.sellScore ?? 0,
    reasons: task?.reasons ?? [],
    result: "pending",
  });
  autoScan.totalGenerated += 1;
  if (autoScan.history.length > autoScan.maxEntries) autoScan.history.length = autoScan.maxEntries;
  saveHistory();
  return true;
}

function recordSignal() {
  const task = state.rows.length > 0 ? analyze(state.rows, loadStrategyConfig(), `${state.base}/${state.quote}`, true) : null;
  const dir = task?.direction ?? "WAIT";
  const isNew = addSignalToHistory(`${state.base}/${state.quote}`, task);
  if (isNew && dir !== "WAIT") {
    const entry = autoScan.history[0];
    notifySignal({ direction: dir, pair: `${state.base}/${state.quote}`, confidence: task.confidence, risk: task.risk, entry: task.entry });
    if (paperAutotrade && entry && task.entry != null && task.stop != null && task.target != null && entry.result === "pending") {
      entry.paperId = addPaperTrade(dir, `${state.base}/${state.quote}`, task.entry, task.stop, task.target, entry.id, mlSizingFactor(task, 0.5));
      entry.autoPaper = true;
      saveHistory();
    }
  }
}

function saveHistory() {
  try {
    localStorage.setItem("signalHistory", JSON.stringify(autoScan.history));
    localStorage.setItem("signalHistoryTotal", String(autoScan.totalGenerated));
  } catch {}
}

function loadHistory() {
  try {
    const savedTotal = parseInt(localStorage.getItem("signalHistoryTotal") || "0", 10);
    if (Number.isFinite(savedTotal) && savedTotal > 0) autoScan.totalGenerated = savedTotal;
  } catch {}
  try {
    const saved = localStorage.getItem("signalHistory");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const before = parsed.length;
        // Sanitising also drops WAIT entries written by earlier builds, so the
        // log only ever contains actionable BUY/SELL signals.
        autoScan.history = parsed
          .map(sanitizeHistoryEntry)
          .filter(e => e && (e.result !== "pending" || (e.id || 0) > cutoff));
        if (autoScan.history.length !== before) saveHistory();
      }
    }
  } catch {}
  // Older installs have no lifetime counter; seed it from what was retained so
  // the badge never shows fewer signals than the visible log.
  if (autoScan.totalGenerated < autoScan.history.length) autoScan.totalGenerated = autoScan.history.length;
  mlLoad();
  mlBatchTrain(autoScan.history);
}

function playBeep() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + 0.12);
    osc.onended = () => ctx.close();
  } catch {}
}

function exportAllData() {
  const data = {
    exportedAt: new Date().toISOString(),
    totalGenerated: autoScan.totalGenerated,
    history: autoScan.history,
    positions: positions.map(p => ({ ...p, openedAt: p.openedAt.toISOString(), closedAt: p.closedAt ? p.closedAt.toISOString() : null })),
    watchlist, alerts, scanPairs, webhookUrl,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trading_dashboard_backup.json";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

function importAllData(json) {
  try {
    if (typeof json !== "string" || json.length > MAX_IMPORT_BYTES) throw new Error("file too large");
    const data = JSON.parse(json);
    if (!isPlainObject(data) || !Array.isArray(data.history) || !Array.isArray(data.positions)) throw new Error("missing history or positions");
    if (data.history.length > MAX_IMPORT_ROWS || data.positions.length > MAX_IMPORT_ROWS) throw new Error("too many rows");

    // Sanitise everything before touching live state so a bad file cannot leave
    // the dashboard half-imported.
    const nextHistory = data.history.map(sanitizeHistoryEntry).filter(Boolean);
    const nextPositions = data.positions.map(sanitizePosition).filter(Boolean);
    const nextWatchlist = Array.isArray(data.watchlist) ? sanitizePairList(data.watchlist) : null;
    const nextAlerts = Array.isArray(data.alerts) ? sanitizeAlerts(data.alerts) : null;
    const nextScanPairs = Array.isArray(data.scanPairs) ? sanitizePairList(data.scanPairs) : null;

    autoScan.history = nextHistory;
    const importedTotal = Math.floor(Number(data.totalGenerated));
    autoScan.totalGenerated = Math.max(nextHistory.length, Number.isFinite(importedTotal) ? importedTotal : 0);
    positions = nextPositions;
    if (nextWatchlist) watchlist = nextWatchlist;
    if (nextAlerts) alerts = nextAlerts;
    if (nextScanPairs && nextScanPairs.length > 0) { scanPairs = nextScanPairs; saveScanConfig(); }
    if (data.webhookUrl != null) {
      if (!data.webhookUrl) { webhookUrl = ""; saveWebhook(); }
      else if (isValidWebhookUrl(data.webhookUrl)) { webhookUrl = data.webhookUrl; saveWebhook(); }
      else showToast("Imported webhook ignored: only https Discord or Telegram URLs are accepted.", "warn");
    }

    const dropped = (data.history.length - nextHistory.length) + (data.positions.length - nextPositions.length);
    saveHistory(); savePositions(); saveWatchlist(); saveAlerts(); render();
    if (dropped > 0) showToast(`Imported backup; ${dropped} invalid row(s) skipped.`, "warn");
  } catch {
    alert("That backup file is invalid or incomplete. No data was imported.");
  }
}

function exportCSV() {
  const rows = [["Time","Pair","Direction","Confidence","Risk","Entry","Stop","Target","Volatility","BuyScore","SellScore","Result"]];
  for (const e of autoScan.history) {
    rows.push([e.timestamp.toISOString(), e.pair, e.direction, e.confidence, e.risk, e.entry ?? "", e.stop ?? "", e.target ?? "", e.volatilityPct.toFixed(2), e.buyScore, e.sellScore, e.result]);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "signal_history.csv";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

function clearSignalHistory() {
  autoScan.history = [];
  autoScan.totalGenerated = 0;
  saveHistory();
  render();
}

function exportJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    model: mlModel,
    stats: mlStats,
    signals: autoScan.history.map(e => ({ ...e, timestamp: e.timestamp.toISOString() })),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "trading_journal.json";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

function exportStrategy() {
  const data = {
    strategyName: strategyName,
    strategyConfig: loadStrategyConfig(),
    scanPairs: [...scanPairs],
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const safeName = (strategyName || "strategy").replace(/[^\w.-]+/g, "_").slice(0, 64) || "strategy";
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = safeName + ".json";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
}

function importStrategy(json) {
  try {
    if (typeof json !== "string" || json.length > MAX_IMPORT_BYTES) throw new Error("file too large");
    const data = JSON.parse(json);
    if (!isPlainObject(data) || !isPlainObject(data.strategyConfig)) { alert("Invalid strategy file: missing strategyConfig"); return; }
    const name = cleanText(data.strategyName, 64) || "Unnamed";
    if (!confirm(`Import strategy "${name}"?\nThis will overwrite your current strategy config and scan pairs.`)) return;
    saveStrategyConfig(data.strategyConfig);
    if (Array.isArray(data.scanPairs)) {
      const pairs = sanitizePairList(data.scanPairs);
      if (pairs.length > 0) { scanPairs = pairs; saveScanConfig(); }
    }
    if (data.strategyName) { strategyName = cleanText(data.strategyName, 64); saveStrategyName(); }
    render();
  } catch { alert("Failed to parse strategy file"); }
}

function renderAlertLog() {
  const entries = alertHistory;
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="alertLogToggle"><div class="history-toggle-left"><h3>Alert Log</h3><span class="history-count">${entries.length}</span></div><span class="arrow">▾</span></button><div class="history-body" id="alertLogBody"><div class="history-scroll" style="max-height:300px">${entries.length === 0 ? '<div class="history-empty">No alerts triggered yet.</div>' : entries.map(e => { const d = new Date(e.timestamp); return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;border-bottom:1px solid var(--panel-inset);font-size:.72rem"><span style="color:var(--muted-3);white-space:nowrap;font-variant-numeric:tabular-nums">${d.toLocaleString()}</span><span style="color:var(--muted);font-weight:600;white-space:nowrap">${escapeHtml(e.pair)}</span><span style="color:var(--wait);white-space:nowrap">${escapeHtml(e.type.replace(/_/g, " "))}</span><span style="color:var(--muted);flex:1">${escapeHtml(e.message)}</span></div>`; }).join("")}</div>${entries.length > 0 ? `<div class="history-actions"><button id="clearAlertLog">Clear log</button></div>` : ""}</div></section>`;
}

function renderPerformanceSummary() {
  const hist = autoScan.history.filter(e => e.direction !== "WAIT");
  const resolved = hist.filter(e => e.result === "win" || e.result === "loss");
  const closed = positions.filter(p => p.closedAt);
  const open = positions.filter(p => !p.closedAt);
  const totalResolved = resolved.length;
  const wins = resolved.filter(e => e.result === "win").length;
  const losses = resolved.filter(e => e.result === "loss").length;
  const overallWinRate = totalResolved > 0 ? Math.round((wins / totalResolved) * 100) : 0;
  const totalPnl = closed.reduce((s, p) => s + (p.pnlCurrency || 0), 0);
  let bestTrade = null, worstTrade = null;
  if (resolved.length > 0) {
    bestTrade = resolved.reduce((b, e) => {
      const rr = e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 0;
      return !b || (e.result === "win" && rr > b.rr) ? { pair: e.pair, rr, result: e.result } : b;
    }, null);
    worstTrade = resolved.reduce((w, e) => {
      const rr = e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 0;
      return !w || (e.result === "loss" && rr > w.rr) ? { pair: e.pair, rr, result: e.result } : w;
    }, null);
    if (bestTrade && bestTrade.result !== "win") bestTrade = resolved.filter(e => e.result === "win").map(e => ({ pair: e.pair, rr: e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 0 })).sort((a, b) => b.rr - a.rr)[0] || null;
    if (worstTrade && worstTrade.result !== "loss") worstTrade = resolved.filter(e => e.result === "loss").map(e => ({ pair: e.pair, rr: e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 0 })).sort((a, b) => b.rr - a.rr)[0] || null;
  }
  const totalSignals = hist.length;
  let avgDuration = null;
  if (closed.length > 0) {
    const durations = closed.map(p => (new Date(p.closedAt) - new Date(p.openedAt)) / 3600000).filter(d => d > 0);
    if (durations.length > 0) avgDuration = durations.reduce((s, d) => s + d, 0) / durations.length;
  }
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;
  for (const e of resolved) {
    if (e.result === "win") { winStreak++; lossStreak = 0; if (winStreak > maxWinStreak) maxWinStreak = winStreak; }
    else { lossStreak++; winStreak = 0; if (lossStreak > maxLossStreak) maxLossStreak = lossStreak; }
  }
  let totalRRWon = 0, totalRRLost = 0;
  resolved.forEach(e => {
    const rr = e.entry != null && e.stop != null && e.target != null && Math.abs(e.entry - e.stop) > 0 ? Math.abs(e.target - e.entry) / Math.abs(e.entry - e.stop) : 0;
    if (e.result === "win") totalRRWon += rr; else totalRRLost += rr;
  });
  const fmtDur = avgDuration != null ? avgDuration < 24 ? avgDuration.toFixed(1) + "h" : (avgDuration / 24).toFixed(1) + "d" : "-";
  const fmtBest = bestTrade ? bestTrade.pair + " (+" + bestTrade.rr.toFixed(1) + "R)" : "-";
  const fmtWorst = worstTrade ? worstTrade.pair + " (-" + worstTrade.rr.toFixed(1) + "R)" : "-";
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="perfSumToggle"><div class="history-toggle-left"><h3>Performance Summary</h3></div><span class="arrow">▾</span></button><div class="history-body" id="perfSumBody"><div style="padding:12px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;text-align:center"><div><div style="font-size:1rem;font-weight:700;color:${overallWinRate >= 50 ? 'var(--buy)' : 'var(--sell)'}">${overallWinRate}%</div><div style="font-size:.6rem;color:var(--muted-3)">Win Rate</div></div><div><div style="font-size:1rem;font-weight:700;color:${totalPnl >= 0 ? 'var(--buy)' : 'var(--sell)'}">${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}</div><div style="font-size:.6rem;color:var(--muted-3)">Total P/L</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--buy)">${fmtBest}</div><div style="font-size:.6rem;color:var(--muted-3)">Best Trade</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--sell)">${fmtWorst}</div><div style="font-size:.6rem;color:var(--muted-3)">Worst Trade</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${totalSignals}</div><div style="font-size:.6rem;color:var(--muted-3)">Total Signals</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${open.length}</div><div style="font-size:.6rem;color:var(--muted-3)">Open Positions</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${fmtDur}</div><div style="font-size:.6rem;color:var(--muted-3)">Avg Duration</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--buy)">${maxWinStreak}</div><div style="font-size:.6rem;color:var(--muted-3)">Win Streak</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--sell)">${maxLossStreak}</div><div style="font-size:.6rem;color:var(--muted-3)">Loss Streak</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--buy)">+${totalRRWon.toFixed(1)}R</div><div style="font-size:.6rem;color:var(--muted-3)">R Won</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--sell)">-${totalRRLost.toFixed(1)}R</div><div style="font-size:.6rem;color:var(--muted-3)">R Lost</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${wins}W / ${losses}L</div><div style="font-size:.6rem;color:var(--muted-3)">Record</div></div></div>${renderSignalAttributePanel(resolved)}</div></section>`;
}

function renderSignalAttributePanel(resolved) {
  if (resolved.length < 3) return "";
  const buck = (label, lo, hi) => {
    const sigs = resolved.filter(e => (e.confidence ?? 0) >= lo && (e.confidence ?? 0) < hi);
    if (sigs.length === 0) return { label, n: 0, wr: 0 };
    const w = sigs.filter(e => e.result === "win").length;
    return { label, n: sigs.length, wr: Math.round((w / sigs.length) * 100) };
  };
  const confRows = [buck("Conf >= 80", 80, 101), buck("Conf 70-79", 70, 80), buck("Conf < 70", 0, 70)].filter(r => r.n > 0);
  const sBuck = (label, lo, hi) => {
    const sigs = resolved.filter(e => { const sc = Math.max(e.buyScore || 0, e.sellScore || 0); return sc >= lo && sc < hi; });
    if (sigs.length === 0) return null;
    const w = sigs.filter(e => e.result === "win").length;
    return { label, n: sigs.length, wr: Math.round((w / sigs.length) * 100) };
  };
  const scoreRows = [sBuck("Score <= 50", 0, 51), sBuck("Score 51-70", 51, 71), sBuck("Score > 70", 71, Infinity)].filter(Boolean);
  const bar = (label, n, wr) => {
    const col = wr >= 50 ? "#3fb950" : "#f85149";
    return `<div style="display:flex;align-items:center;gap:6px;font-size:.65rem;padding:3px 0"><span style="width:90px;color:var(--muted)">${label}</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${wr}%;height:100%;background:${col};border-radius:3px"></div></div><span style="width:40px;text-align:right;color:${col}">${wr}%</span><span style="width:40px;text-align:right;color:var(--muted-3)">${n}</span></div>`;
  };
  const bandRows = rows => rows.map(r => bar(r.label, r.n, r.wr)).join("");
  const factors = {};
  resolved.forEach(e => {
    const win = e.result === "win";
    const tags = (e.buyPieces || []).concat(e.sellPieces || []);
    const seen = new Set();
    tags.forEach(t => {
      const k = String(t || "").replace(/\d+/g, "").replace(/\(.*?\)/g, "").trim().slice(0, 24);
      if (!k || seen.has(k)) return;
      seen.add(k);
      if (!factors[k]) factors[k] = { wins: 0, losses: 0 };
      factors[k][win ? "wins" : "losses"]++;
    });
  });
  const factorRows = Object.entries(factors).map(([k, v]) => ({ k, n: v.wins + v.losses, wr: Math.round((v.wins / (v.wins + v.losses)) * 100) }))
    .filter(f => f.n >= 2).sort((a, b) => b.n - a.n).slice(0, 12).map(f => {
      const col = f.wr >= 50 ? "#3fb950" : "#f85149";
      return `<div style="display:flex;align-items:center;gap:6px;font-size:.65rem;padding:3px 0"><span style="width:110px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${f.k}">${f.k}</span><div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${f.wr}%;height:100%;background:${col};border-radius:3px"></div></div><span style="width:40px;text-align:right;color:${col}">${f.wr}%</span><span style="width:32px;text-align:right;color:var(--muted-3)">${f.n}</span></div>`;
    }).join("");
  const factorBlock = factorRows ? `<div style="padding-top:8px;font-size:.68rem;color:var(--muted)">Top signal factors by outcome win rate</div>${factorRows}` : "";
  return `<div style="padding:10px 12px 12px;border-top:1px solid var(--border)"><div style="font-size:.72rem;color:var(--muted);margin-bottom:6px">Signal Quality Attribution</div><div style="font-size:.68rem;color:var(--muted-3)">Win rate by confidence band</div>${bandRows(confRows)}${scoreRows.length ? `<div style="padding-top:6px;font-size:.68rem;color:var(--muted-3)">Win rate by max factor score</div>${bandRows(scoreRows)}` : ""}${factorBlock}</div>`;
}

function deleteHistoryEntry(id) {
  autoScan.history = autoScan.history.filter(e => e.id !== id);
  saveHistory();
  render();
}

function notifySignal(entry) {
  playBeep();
  sendWebhook(entry);
  if (!("Notification" in window) || Notification.permission === "denied") return;
  if (Notification.permission === "granted") {
    new Notification(`${entry.direction} ${entry.pair}`, {
      body: `Confidence: ${entry.confidence}% | Risk: ${entry.risk}${entry.entry ? " | $" + formatPrice(entry.entry, entry.pair) : ""}`,
      silent: true,
    });
  } else if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function calcStats() {
  const signals = autoScan.history.filter(e => e.direction !== "WAIT" && e.result !== "pending");
  const total = signals.length;
  const wins = signals.filter(e => e.result === "win").length;
  const losses = signals.filter(e => e.result === "loss").length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  let streak = 0;
  let streakType = "";
  for (let i = 0; i < signals.length; i++) {
    if (signals[i].result === "win") { if (streakType === "loss") break; streakType = "win"; streak++; }
    else if (signals[i].result === "loss") { if (streakType === "win") break; streakType = "loss"; streak++; }
    else break;
  }
  return { total, wins, losses, winRate, streak, streakType };
}

let renderPending = false;
