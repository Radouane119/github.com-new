let ssPoints = [];
let ssImg = null;

function ssUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      ssImg = img;
      const canvas = document.getElementById("screenshotCanvas");
      canvas.style.display = "block";
      canvas.width = Math.min(img.width, 800);
      canvas.height = Math.min(img.height, 400);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      document.getElementById("ssControls").style.display = "flex";
      ssPoints = [];
      document.getElementById("ssCount").textContent = "0 points";
      canvas.onmousedown = (ev) => {
        const rect = canvas.getBoundingClientRect();
        const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
        const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
        if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) return;
        ssPoints.push({ x, y });
        document.getElementById("ssCount").textContent = ssPoints.length + " points";
        const ctx2 = canvas.getContext("2d");
        ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx2.fillStyle = "#3fb950";
        ctx2.strokeStyle = "#3fb950";
        ctx2.lineWidth = 1.5;
        ctx2.beginPath();
        ssPoints.forEach((p, i) => { ctx2.arc(p.x, p.y, 3, 0, Math.PI * 2); if (i > 0) { ctx2.beginPath(); ctx2.moveTo(ssPoints[i-1].x, ssPoints[i-1].y); ctx2.lineTo(p.x, p.y); ctx2.stroke(); ctx2.beginPath(); ctx2.arc(p.x, p.y, 3, 0, Math.PI * 2); } ctx2.fill(); });
      };
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function ssAnalyze() {
  const min = Number(document.getElementById("ssMin").value);
  const max = Number(document.getElementById("ssMax").value);
  if (!ssImg || ssPoints.length < 5 || !isFinite(min) || !isFinite(max) || max <= min) { return; }
  const canvas = document.getElementById("screenshotCanvas");
  const range = max - min;
  const closes = ssPoints.map(p => max - (p.y / canvas.height) * range);
  const rows = closes.map((c, i) => ({
    date: new Date(Date.now() - (closes.length - 1 - i) * 86400000).toISOString().slice(0, 10),
    open: i > 0 ? closes[i-1] : c * 0.999,
    high: c * 1.002,
    low: c * 0.998,
    close: c,
  }));
  const analysis = rows.length >= 30 ? analyze(rows) : null;
  const el = document.getElementById("ssResult");
  if (!analysis) { el.innerHTML = "<span style='color:#f85149'>Need at least 30 points for analysis. Add more points along the chart line.</span>"; el.style.display = "block"; return; }
  const cls = analysis.direction.toLowerCase();
  const dirLabel = analysis.direction === "BUY" ? "🟢 BUY" : analysis.direction === "SELL" ? "🔴 SELL" : "⚪ WAIT";
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><strong style="color:${cls === 'buy' ? 'var(--buy)' : cls === 'sell' ? 'var(--sell)' : 'var(--wait)'}">${dirLabel}</strong><span style="font-size:.7rem;color:var(--muted)">${analysis.confidence}% confidence</span></div>
<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:.72rem;color:var(--muted);margin-bottom:4px"><span>📈 Buy: ${analysis.buyScore}/7</span><span>📉 Sell: ${analysis.sellScore}/7</span><span>⚠ Risk: ${analysis.risk}</span><span>📊 Volatility: ${analysis.volatilityPct.toFixed(2)}%</span></div>
<div style="font-size:.68rem;color:var(--muted-2);line-height:1.4">${analysis.reasons.map(r => `<span style="color:${r.ok ? 'var(--buy)' : 'var(--sell)'}">${r.ok ? '✓' : '✗'}</span> ${r.text}`).join("<br>")}</div>`;
  el.style.display = "block";
}

function setupEvents() {
  root.addEventListener("input", (event) => {
    if (event.target.id === "webhookInput") {
      webhookUrl = event.target.value;
      saveWebhook();
    }
    if (event.target.id === "fxApiKey") {
      fxApiPrefs.key = event.target.value;
      saveFxApiPrefs();
    }
    if (event.target.id === "strategyNameInput") {
      strategyName = event.target.value;
      saveStrategyName();
    }
    if (event.target.id === "rmBalance" || event.target.id === "rmRisk" || event.target.id === "rmMaxPos" || event.target.id === "rmDailyLimit" || event.target.id === "rmStartingBalance" || event.target.id === "rmMaxStreak" || event.target.id === "rmCorrCap") {
      const cfg = loadRiskConfig();
      if (event.target.id === "rmBalance") cfg.balance = Number(event.target.value) || 10000;
      if (event.target.id === "rmStartingBalance") cfg.startingBalance = Number(event.target.value) || 10000;
      if (event.target.id === "rmRisk") cfg.riskPct = Number(event.target.value) || 1;
      if (event.target.id === "rmMaxPos") cfg.maxPos = Number(event.target.value) || 5;
      if (event.target.id === "rmDailyLimit") cfg.dailyLimit = Number(event.target.value) || 5;
      if (event.target.id === "rmMaxStreak") cfg.maxLossStreak = Math.min(10, Math.max(1, Number(event.target.value) || 4));
      if (event.target.id === "rmCorrCap") cfg.corrCap = Math.min(5, Math.max(1, Number(event.target.value) || 2));
      saveRiskConfig(cfg);
      scheduleRender();
    }
    if (event.target.id === "stratThreshold" || event.target.id === "stratRR" || event.target.id === "stratVolMult" || event.target.id === "stratVolMedian" || event.target.id === "stratRSIBuy" || event.target.id === "stratRSISell" || event.target.id === "stratTrailMult" || event.target.id === "stratInitRR" || event.target.id === "stratPartialPct") {
      const cfg = loadStrategyConfig();
      if (event.target.id === "stratThreshold") cfg.threshold = Math.min(7, Math.max(3, Number(event.target.value) || 5));
      if (event.target.id === "stratRR") cfg.riskRewardRatio = Math.min(5, Math.max(1, Number(event.target.value) || 2));
      if (event.target.id === "stratVolMult") cfg.volumeMultiplier = Math.min(3, Math.max(1, Number(event.target.value) || 1.3));
      if (event.target.id === "stratVolMedian") cfg.volatilityMedianMultiplier = Math.min(5, Math.max(1, Number(event.target.value) || 2.5));
      if (event.target.id === "stratRSIBuy") cfg.rsiBuyThreshold = Math.min(70, Math.max(30, Number(event.target.value) || 55));
      if (event.target.id === "stratRSISell") cfg.rsiSellThreshold = Math.min(70, Math.max(30, Number(event.target.value) || 45));
      if (event.target.id === "stratTrailMult") cfg.trailingAtrMult = Math.min(8, Math.max(1, Number(event.target.value) || 3));
      if (event.target.id === "stratInitRR") cfg.initialRrMult = Math.min(5, Math.max(0.5, Number(event.target.value) || 1.5));
      if (event.target.id === "stratPartialPct") cfg.partialTakePct = Math.min(100, Math.max(0, Number(event.target.value) || 50));
      saveStrategyConfig(cfg);
      scheduleRender();
    }
    if (event.target.id === "stratAdxGate") {
      const cfg = loadStrategyConfig();
      cfg.adxGate = event.target.checked;
      saveStrategyConfig(cfg);
      render();
    }
    if (event.target.dataset.condToggle) {
      const key = event.target.dataset.condToggle;
      alertConditions[key].enabled = event.target.checked;
      saveAlertConditions();
      return;
    }
    if (event.target.dataset.condThreshold) {
      const key = event.target.dataset.condThreshold;
      alertConditions[key].threshold = Number(event.target.value) || 0;
      saveAlertConditions();
      return;
    }
    if (event.target.dataset.notePos) {
      const notes = getTradeNotes();
      notes[event.target.dataset.notePos] = event.target.value;
      saveTradeNotesDebounced();
    }
    if (event.target.id === "paperBuyBtn") { openManualPaperTrade("BUY"); return; }
    if (event.target.id === "paperSellBtn") { openManualPaperTrade("SELL"); return; }
    if (event.target.id === "paperBalance") {
      paperState.startingBalance = Number(event.target.value) || 10000;
      paperState.balance = paperState.startingBalance;
      savePaperState();
      scheduleRender();
    }

    if (event.target.id === "slipSpread") { slippageConfig.spreadPips = Math.max(0, Number(event.target.value) || 0); saveSlippageConfig(); return; }
    if (event.target.id === "slipSlip") { slippageConfig.slippagePips = Math.max(0, Number(event.target.value) || 0); saveSlippageConfig(); return; }
    if (event.target.id === "btFee" || event.target.id === "btRisk") {
      const cfg = loadStrategyConfig();
      if (event.target.id === "btFee") cfg.feePct = Math.max(0, Number(event.target.value) || 0);
      else cfg.riskPerTradePct = Math.max(0.1, Number(event.target.value) || 1);
      saveStrategyConfig(cfg);
      return;
    }
    if (event.target.id === "kellyToggle") {
      kellyEnabled = event.target.checked;
      saveOverlayPrefs();
      render();
    }
  });
  root.addEventListener("blur", (event) => {
    if (event.target && event.target.dataset && event.target.dataset.notePos) flushTradeNotes();
  }, true);
  root.addEventListener("change", (event) => {
    if (event.target.id === "ovSort") {
      multiScan.sortMode = event.target.value;
      saveOverviewPrefs();
      render();
      return;
    }
    if (event.target.id === "scanTfSel") {
      multiScan.timeframe = event.target.value;
      saveOverviewPrefs();
      cancelOverviewScan();
      scanAllPairs();
      return;
    }
    if (event.target.id === "fxApiEnable") {
      fxApiPrefs.enabled = event.target.checked;
      saveFxApiPrefs();
      render();
      return;
    }
    if (event.target.id === "schedToggleInput") {
      if (event.target.checked) startSchedule(); else stopSchedule();
      render();
      return;
    }
    if (event.target.id === "paperAutoToggle") {
      paperAutotrade = event.target.checked;
      saveOverlayPrefs();
      render();
      return;
    }
    if (event.target.id === "base") {
      state.base = event.target.value;
      if (nonFiat.has(state.base)) state.quote = "USD";
      load();
    }
    if (event.target.id === "quote") {
      state.quote = event.target.value;
      load();
    }
    if (event.target.dataset.scanPair) {
      toggleScanPair(event.target.dataset.scanPair);
    }
    if (event.target.id === "mpModeToggle") {
      backtest.multiPairMode = event.target.checked;
      saveBacktestMulti();
      render();
      return;
    }
    if (event.target.dataset.mpPair) {
      const pair = event.target.dataset.mpPair;
      const idx = backtest.multiPairSelected.indexOf(pair);
      if (idx >= 0) backtest.multiPairSelected.splice(idx, 1);
      else backtest.multiPairSelected.push(pair);
      saveBacktestMulti();
      render();
      return;
    }
    if (event.target.id === "screenshotFile") {
      ssUpload(event.target.files[0]);
    }
    if (event.target.id === "importFile") {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { importAllData(e.target.result); };
      reader.readAsText(file);
    }
    if (event.target.id === "importStrategyFile") {
      const file = event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => { importStrategy(e.target.result); };
      reader.readAsText(file);
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) {
      const entryRow = event.target.closest(".history-entry");
      if (entryRow) {
        const idx = entryRow.dataset.idx;
        const detail = document.getElementById(`hd-${idx}`);
        if (detail) {
          const isOpen = detail.classList.contains("open");
          document.querySelectorAll(".history-detail.open").forEach(el => el.classList.remove("open"));
          if (!isOpen) detail.classList.add("open");
        }
      }
      return;
    }

    if (target.dataset.del) {
      deleteHistoryEntry(Number(target.dataset.del));
      return;
    }
    if (target.dataset.star) {
      toggleWatchlist(target.dataset.star);
      return;
    }
    if (target.dataset.alert) {
      const pair = target.dataset.alert;
      const dir = confirm("Click OK for alert ABOVE price, Cancel for BELOW") ? "above" : "below";
      const price = prompt(`Set price alert for ${pair} (${dir === "above" ? "↑ above" : "↓ below"}):`);
      if (price && !isNaN(price)) setAlert(pair, price, dir);
      return;
    }
    if (target.dataset.rmAlert) {
      removeAlert(Number(target.dataset.rmAlert));
      return;
    }
    if (target.dataset.tf) { switchTF(target.dataset.tf); return; }
    if (target.dataset.action === "ml-reset") { mlReset(); render(); return; }
    if (target.dataset.action === "toggle-overlay") { toggleOverlay(target.dataset.overlay); return; }
    if (target.id === "settingsToggle") {
      document.getElementById("screenshotPanel").style.display = "none";
      const panel = document.getElementById("settingsPanel");
      if (panel) panel.style.display = panel.style.display === "none" ? "flex" : "none";
      return;
    }
    if (target.id === "screenshotToggle") {
      document.getElementById("settingsPanel").style.display = "none";
      const panel = document.getElementById("screenshotPanel");
      if (panel) panel.style.display = panel.style.display === "none" ? "flex" : "none";
      return;
    }
    if (target.id === "soundToggle") {
      soundEnabled = !soundEnabled;
      target.textContent = soundEnabled ? "🔊" : "🔇";
      target.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound");
      target.setAttribute("aria-pressed", String(soundEnabled));
      if (soundEnabled) playBeep();
      return;
    }
    if (target.id === "themeToggle") {
      darkTheme = !darkTheme;
      target.textContent = darkTheme ? "🌙" : "☀️";
      target.setAttribute("aria-label", darkTheme ? "Switch to light theme" : "Switch to dark theme");
      applyTheme();
      saveTheme();
      return;
    }
    if (target.id === "ssAnalyze") { ssAnalyze(); return; }
    if (target.id === "ssClear") {
      ssPoints = [];
      document.getElementById("ssCount").textContent = "0 points";
      document.getElementById("ssResult").style.display = "none";
      const canvas = document.getElementById("screenshotCanvas");
      if (ssImg) { const ctx = canvas.getContext("2d"); ctx.drawImage(ssImg, 0, 0, canvas.width, canvas.height); }
      return;
    }
    if (target.id === "testWebhook") {
      const inp = document.getElementById("webhookInput");
      if (inp) {
        webhookUrl = inp.value.trim();
        if (!isValidWebhookUrl(webhookUrl)) {
          showToast("Webhook must be an https Discord or Telegram URL.", "error");
          return;
        }
        saveWebhook();
        sendWebhook({ direction: "TEST", pair: "Webhook", confidence: 100, risk: "Test", entry: null, stop: null, target: null });
        showToast("Test message sent.", "ok");
      }
      return;
    }
    if (target.id === "testFxApi") {
      const keyInput = document.getElementById("fxApiKey");
      const enableBox = document.getElementById("fxApiEnable");
      if (keyInput) fxApiPrefs.key = keyInput.value;
      if (enableBox) fxApiPrefs.enabled = enableBox.checked;
      saveFxApiPrefs();
      (async () => {
        try {
          const rows = await fetchTwelveDataRows("EUR", "JPY", "1h");
          if (rows && rows.length >= 80) {
            showToast(`Twelve Data OK: ${rows.length} EUR/JPY 1h bars`, "ok");
          } else {
            throw new Error(rows ? "No usable bars returned" : "Enter a key or tick enable first");
          }
        } catch (e) {
          showToast("Twelve Data failed: " + (e && e.message ? e.message : e), "error");
        }
      })();
      return;
    }
    if (target.id === "exportData") { exportAllData(); return; }
    if (target.id === "clearCache") {
      clearMarketCache();
      render();
      showToast("Market cache cleared.", "ok");
      return;
    }
    if (target.id === "exportStrategy") { exportStrategy(); return; }
    if (target.dataset.trade) {
      const entry = autoScan.history.find(e => e.id === Number(target.dataset.trade));
      if (entry && entry.direction !== "WAIT") {
        const pred = mlPredictEntry(entry);
        if (mlFilterEnabled && pred && pred.label === "loss") { showToast(`Trade blocked: ML predicts loss (${(pred.win * 100).toFixed(0)}% win)`, "warn"); return; }
        openTrade(entry.pair, entry.direction, entry.entry, entry.stop, entry.target);
      }
      return;
    }
    if (target.dataset.tradeOv) {
      const pair = target.dataset.tradeOv;
      const r = multiScan.results[pair];
      if (r && r.direction !== "WAIT" && r.entry != null) {
        const pred = mlPredictEntry(r);
        if (mlFilterEnabled && pred && pred.label === "loss") { showToast(`Trade blocked: ML predicts loss (${(pred.win * 100).toFixed(0)}% win)`, "warn"); return; }
        openTrade(pair, r.direction, r.entry, r.stop, r.target);
      }
      return;
    }
    if (target.dataset.closePos) {
      const id = Number(target.dataset.closePos);
      const pos = positions.find(p => p.id === id && !p.closedAt);
      if (pos) closeTrade(id, getPosPrice(pos));
      return;
    }
    if (target.id === "closeAllPositions") {
      const open = positions.filter(p => !p.closedAt);
      open.forEach(p => closeTrade(p.id, getPosPrice(p)));
      return;
    }
    if (target.dataset.delPos) {
      deletePosition(Number(target.dataset.delPos));
      return;
    }
    if (target.id === "addPriceAlert") {
      var pair = document.getElementById("paPair");
      var dir = document.getElementById("paDir");
      var priceEl = document.getElementById("paPrice");
      if (pair && dir && priceEl) {
        var price = parseFloat(priceEl.value);
        if (pair.value && price > 0) {
          priceLevelAlerts.push({ pair: pair.value, dir: dir.value, price: price, id: Date.now() });
          savePriceLevelAlerts();
          render();
        }
      }
      return;
    }
    if (target.dataset.rmPa !== undefined) {
      var idx = parseInt(target.dataset.rmPa);
      if (!isNaN(idx) && idx >= 0 && idx < priceLevelAlerts.length) {
        priceLevelAlerts.splice(idx, 1);
        savePriceLevelAlerts();
        render();
      }
      return;
    }
    if (target.dataset.heatmap) {
      var pair = target.dataset.heatmap.split('/');
      state.base = pair[0];
      state.quote = pair[1];
      state.timeframe = "1d";
      load();
      return;
    }
    if (target.dataset.partialPos) {
      var posId = Number(target.dataset.partialPos);
      var pct = parseInt(target.dataset.pct) || 50;
      var pos = positions.find(function(p) { return p.id === posId && !p.closedAt; });
      if (pos) {
        var closePct = pct / 100;
        var cp = getPosPrice(pos);
        var pnl = pos.direction === "BUY" ? cp - pos.entry : pos.entry - cp;
        var pnlPct = pos.entry ? (pnl / pos.entry) * 100 : 0;
        var oldSize = pos.size || 10000;
        var closeSize = oldSize * closePct;
        var pnlCurrency = pnlPct / 100 * closeSize;
        positions.push({ id: posId + "-pc" + Date.now(), pair: pos.pair, direction: pos.direction, entry: pos.entry, stop: pos.stop, target: pos.target, openedAt: pos.openedAt, closedAt: new Date(), exitPrice: cp, pnl: pnlCurrency, pnlPct: pnlPct, pnlCurrency: pnlCurrency, size: closeSize });
        pos.size = oldSize * (1 - closePct);
        savePositions();
        render();
      }
      return;
    }
    if (target.id === "swap") {
      if (nonFiat.has(state.base)) return;
      [state.base, state.quote] = [state.quote, state.base];
      load();
    }
    if (target.id === "refresh") {
      load();
    }
    if (target.id === "autoScanToggle") {
      toggleAutoScan();
    }
    if (target.dataset.ovFilter) { multiScan.filter = target.dataset.ovFilter; saveOverviewPrefs(); render(); return; }
    if (target.classList.contains('ov-wl-filter')) { multiScan.watchlistOnly = !multiScan.watchlistOnly; render(); return; }
    if (target.id === "toggleScanConfig") {
      multiScan.configOpen = !multiScan.configOpen;
      render();
    }
    if (target.id === "scanAll") {
      scanAllPairs();
    }
    if (target.id === "scanSelAll") { scanPairs = [...allScanPairs]; saveScanConfig(); render(); return; }
    if (target.id === "scanSelNone") { scanPairs = []; saveScanConfig(); render(); return; }
    if (target.id === "scanSelCrypto") { scanPairs = allScanPairs.filter(p => nonFiat.has(p.split("/")[0])); saveScanConfig(); render(); return; }
    if (target.id === "scanSelFx") { scanPairs = allScanPairs.filter(p => !nonFiat.has(p.split("/")[0])); saveScanConfig(); render(); return; }
    if (target.id === "exportCSV") {
      exportCSV();
    }
    if (target.id === "exportJSON") {
      exportJSON();
    }
    if (target.id === "clearHistory") {
      clearSignalHistory();
    }
    if (target.id === "runBacktest") { runBacktestImpl(); return; }
    if (target.id === "compareBacktest") { runCompareBacktestImpl(); return; }
    if (target.id === "runMultiBacktest") { runMultiPairBacktest(); return; }
    if (target.id === "mpSelectAll") { backtest.multiPairSelected = [...allScanPairs]; saveBacktestMulti(); render(); return; }
    if (target.id === "mpClearAll") { backtest.multiPairSelected = []; saveBacktestMulti(); render(); return; }
    if (target.id === "runCorr") { computeCorrelationMatrix(); return; }
    if (target.id === "runMC") { if (backtest.results && backtest.results.trades.length >= 5) { mcState.running = true; mcState.progress = ""; render(); setTimeout(() => { mcState.results = runMonteCarlo(backtest.results.trades, 1000); mcState.running = false; render(); }, 50); } return; }
    if (target.id === "runWF") { runWalkForward(); return; }
    if (target.id === "runOpt") { runStrategyOptimizer(); return; }
    if (target.id === "applyOptimal") { if (optimizerState.results && optimizerState.results.length > 0) { const best = optimizerState.results[0].cfg; const cfg = loadStrategyConfig(); cfg.threshold = best.threshold; cfg.riskRewardRatio = best.riskRewardRatio; cfg.volumeMultiplier = best.volumeMultiplier; saveStrategyConfig(cfg); render(); } return; }
    if (target.id === "startReplay") { startReplay(`${state.base}/${state.quote}`); return; }
    if (target.id === "stopReplay") { stopReplay(); render(); return; }
    if (target.id === "replayStep") { stepReplay(); return; }
    if (target.id === "replayPlay") { toggleReplayPlay(); return; }
    if (target.id === "paperReset") { paperState.balance = paperState.startingBalance; paperState.trades = []; paperState.openPositions = []; paperState.equityCurve = []; savePaperState(); render(); return; }
    if (target.dataset.closePaper) { const price = prompt("Exit price:"); if (price && !isNaN(price)) { closePaperTrade(Number(target.dataset.closePaper), Number(price)); render(); } return; }
    if (target.id === "backtestToggle") {
      const body = document.getElementById("backtestBody");
      const toggle = document.getElementById(target.id);
      if (body) { body.classList.toggle("open"); toggle.classList.toggle("open"); }
      return;
    }
    if (["riskToggle","stratToggle","alertCondToggle","alertLogToggle","perfSumToggle","compToggle","corrToggle","paperToggle","replayToggle","mcToggle","wfToggle","optToggle","schedToggle","priceAlertToggle","heatmapToggle","ddToggle","econToggle","sessionToggle"].includes(target.id)) {
      const bodyId = target.id.replace("Toggle", "Body");
      const body = document.getElementById(bodyId);
      const toggle = document.getElementById(target.id);
      if (body) { body.classList.toggle("open"); toggle.classList.toggle("open"); }
      return;
    }
    if (target.id === "resetStratConfig") {
      saveStrategyConfig({ threshold: 5, riskRewardRatio: 2.0, volumeMultiplier: 1.3, volatilityMedianMultiplier: 2.5, rsiBuyThreshold: 55, rsiSellThreshold: 45, trailingAtrMult: 3, initialRrMult: 1.5, partialTakePct: 50, adxGate: false });
      render();
      return;
    }
    if (target.id === "testAlertCond") {
      const fired = evaluateAlertConditions(true);
      alertConditions.lastTestResult = fired.length > 0 ? `${fired.join(", ")} triggered` : "No conditions triggered";
      saveAlertConditions();
      render();
      return;
    }
    if (target.id === "clearAlertLog") {
      alertHistory = [];
      saveAlertHistory();
      render();
      return;
    }
    if (target.id === "historyToggle" || target.id === "dashToggle") {
      const body = document.getElementById(target.id === "historyToggle" ? "historyBody" : "dashBody");
      const toggle = document.getElementById(target.id);
      const isOpen = body.classList.contains("open");
      if (isOpen) {
        body.classList.remove("open");
        toggle.classList.remove("open");
      } else {
        body.classList.add("open");
        toggle.classList.add("open");
      }
    }
  });
}

const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(redrawChart);
});

function observeChartContainer() {
  const container = document.getElementById("chartContainer");
  if (container) resizeObserver.observe(container);
}

let soundEnabled = true;
let darkTheme = true;

document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  if (e.key === "r" || e.key === "R") { load(); return; }
  if (e.key === "s" || e.key === "S") { toggleAutoScan(); return; }
  if (e.key === "m" || e.key === "M") { soundEnabled = !soundEnabled; const sb = document.getElementById("soundToggle"); if (sb) { sb.textContent = soundEnabled ? "\uD83D\uDD0A" : "\uD83D\uDD07"; sb.setAttribute("aria-label", soundEnabled ? "Mute sound" : "Enable sound"); sb.setAttribute("aria-pressed", String(soundEnabled)); } playBeep(); return; }
  if (e.key === "1") { const ok = nonFiat.has(state.base) || (binanceFiat.has(state.base) && state.quote === "USD") || fxIntradayable(state.base, state.quote); if (ok) { state.timeframe = "1d"; load(); } return; }
  if (e.key === "4") { const ok = nonFiat.has(state.base) || (binanceFiat.has(state.base) && state.quote === "USD") || fxIntradayable(state.base, state.quote); if (ok) { state.timeframe = "4h"; load(); } return; }
  if (e.key === "h" || e.key === "H") { const ok = nonFiat.has(state.base) || (binanceFiat.has(state.base) && state.quote === "USD") || fxIntradayable(state.base, state.quote); if (ok) { state.timeframe = "1h"; load(); } return; }
  if (e.key === "b" || e.key === "B") { if (!backtest.running) { runBacktestImpl(); } return; }
  if (e.key === "t" || e.key === "T") { darkTheme = !darkTheme; applyTheme(); saveTheme(); const tb = document.getElementById("themeToggle"); if (tb) { tb.textContent = darkTheme ? "\uD83C\uDF19" : "\u2600\uFE0F"; tb.setAttribute("aria-label", darkTheme ? "Switch to light theme" : "Switch to dark theme"); } return; }
});

loadHistory();
loadPositions();
loadWebhook();
loadFxApiPrefs();
loadTdGate();
loadAlertConditions();
loadBacktestMulti();
loadAlertHistory();
loadStrategyName();
loadOverlayPrefs();
loadPaperState();
loadPriceLevelAlerts();
loadSlippageConfig();
loadScheduleState();
setupEvents();
load();
connectWS();
loadTheme();
fetchEconEvents();
setInterval(updateOverviewPrices, 15000);
setInterval(checkPriceLevelAlerts, 15000);
setInterval(function() { refreshSessionBar(); }, 60000);
if (scheduleState.enabled && webhookUrl) { scheduleState.intervalId = setInterval(sendScheduledReport, 6 * 60 * 60 * 1000); }
setInterval(autoCheckPaperPositions, 30000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
