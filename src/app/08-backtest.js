const backtest = { results: null, running: false, progress: "", comparison: null, comparing: false, multiPairMode: false, multiPairSelected: [], multiResults: null, multiRunning: false, multiProgress: "" };

function saveBacktestMulti() {
  storageSet("backtestMulti", JSON.stringify({ multiPairMode: backtest.multiPairMode, multiPairSelected: backtest.multiPairSelected }));
}

function loadBacktestMulti() {
  try {
    const s = localStorage.getItem("backtestMulti");
    if (s) { const d = JSON.parse(s); backtest.multiPairMode = d.multiPairMode || false; backtest.multiPairSelected = d.multiPairSelected || []; }
  } catch {}
}

function renderAlertConditions() {
  const c = alertConditions;
  function tog(key) {
    return `<label class="toggle"><input type="checkbox" data-cond-toggle="${key}" ${c[key].enabled ? "checked" : ""}><span class="toggle-track"></span><span class="toggle-knob"></span></label>`;
  }
  function thresh(key, min, max, step) {
    return `<input type="number" data-cond-threshold="${key}" value="${c[key].threshold}" min="${min}" max="${max}" step="${step}" style="width:52px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem;text-align:center">`;
  }
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="alertCondToggle"><div class="history-toggle-left"><h3>Alert Conditions</h3></div><span class="arrow">▾</span></button><div class="history-body" id="alertCondBody"><div style="padding:12px;display:flex;flex-direction:column;gap:8px">
    <div class="cond-row"><div class="cond-info"><span class="cond-title">MTF Alignment</span><span class="cond-desc">All 3 timeframes agree on BUY or SELL</span></div><div class="cond-controls">${tog("mtf_alignment")}</div></div>
    <div class="cond-row"><div class="cond-info"><span class="cond-title">Pattern + Trend</span><span class="cond-desc">Candlestick pattern confirms trend vote</span></div><div class="cond-controls">${tog("pattern_trend")}</div></div>
    <div class="cond-row"><div class="cond-info"><span class="cond-title">High Confidence</span><span class="cond-desc">Confidence exceeds threshold</span></div><div class="cond-controls">${thresh("high_confidence", 50, 100, 1)}${tog("high_confidence")}</div></div>
    <div class="cond-row"><div class="cond-info"><span class="cond-title">Volume Surge</span><span class="cond-desc">Volume > SMA × multiplier</span></div><div class="cond-controls">${thresh("volume_surge", 1.0, 5.0, 0.1)}${tog("volume_surge")}</div></div>
    <div style="padding-top:4px;display:flex;align-items:center;gap:8px"><button class="scan-button" id="testAlertCond">Test</button>${c.lastTestResult ? `<span style="font-size:.7rem;color:var(--muted)">${escapeHtml(c.lastTestResult)}</span>` : ""}</div>
  </div></div></section>`;
}

function renderStrategyConfig() {
  const cfg = loadStrategyConfig();
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="stratToggle"><div class="history-toggle-left"><h3>Strategy Config</h3></div><span class="arrow">▾</span></button><div class="history-body" id="stratBody"><div style="padding:12px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:.72rem"><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Threshold (votes)<input type="number" id="stratThreshold" value="${cfg.threshold}" min="3" max="7" step="1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Risk/Reward ratio<input type="number" id="stratRR" value="${cfg.riskRewardRatio}" min="1.0" max="5.0" step="0.1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Volume multiplier<input type="number" id="stratVolMult" value="${cfg.volumeMultiplier}" min="1.0" max="3.0" step="0.1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Volatility median mult.<input type="number" id="stratVolMedian" value="${cfg.volatilityMedianMultiplier}" min="1.0" max="5.0" step="0.1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">RSI buy threshold<input type="number" id="stratRSIBuy" value="${cfg.rsiBuyThreshold}" min="30" max="70" step="1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">RSI sell threshold<input type="number" id="stratRSISell" value="${cfg.rsiSellThreshold}" min="30" max="70" step="1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Trailing stop ATR mult.<input type="number" id="stratTrailMult" value="${cfg.trailingAtrMult}" min="1" max="8" step="0.5" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Initial R multiple<input type="number" id="stratInitRR" value="${cfg.initialRrMult}" min="0.5" max="5" step="0.1" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">Partial take profit %<input type="number" id="stratPartialPct" value="${cfg.partialTakePct}" min="0" max="100" step="5" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted)">ADX trend gate<label class="toggle" style="margin-top:4px"><input type="checkbox" id="stratAdxGate" ${cfg.adxGate ? "checked" : ""}><span class="toggle-track"></span><span class="toggle-knob"></span></label></label></div><div style="padding:0 12px 12px"><button id="resetStratConfig" style="width:100%;padding:8px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:6px;font-size:.72rem;cursor:pointer;font-family:inherit">Reset to defaults</button></div></div></section>`;
}

function renderBacktest() {
  if (!backtest.results && !backtest.running && !backtest.comparing && !backtest.multiResults && !backtest.multiRunning) {
    return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="backtestToggle"><div class="history-toggle-left"><h3>Backtest Strategy</h3></div><span class="arrow">▾</span></button><div class="history-body open" id="backtestBody"><div style="padding:12px;font-size:.72rem;color:var(--muted);text-align:center">Click <strong>Run Backtest</strong> to evaluate this strategy on historical data.</div><div style="padding:0 12px 12px;display:flex;gap:8px"><div style="padding:4px 12px;display:flex;gap:12px;flex-wrap:wrap"><label style="display:flex;align-items:center;gap:4px;color:var(--muted);font-size:.72rem">Spread (pips)<input type="number" id="slipSpread" value="${slippageConfig.spreadPips}" min="0" max="50" step="0.5" style="width:50px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem;text-align:center"></label><label style="display:flex;align-items:center;gap:4px;color:var(--muted);font-size:.72rem">Slippage (pips)<input type="number" id="slipSlip" value="${slippageConfig.slippagePips}" min="0" max="20" step="0.5" style="width:50px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem;text-align:center"></label><label style="display:flex;align-items:center;gap:4px;color:var(--muted);font-size:.72rem">Fee (%/rt)<input type="number" id="btFee" value="${(loadStrategyConfig().feePct ?? 0.1)}" min="0" max="1" step="0.05" style="width:50px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem;text-align:center"></label><label style="display:flex;align-items:center;gap:4px;color:var(--muted);font-size:.72rem">Risk/trade (%<input type="number" id="btRisk" value="${(loadStrategyConfig().riskPerTradePct ?? 1)}" min="0.1" max="5" step="0.1" style="width:50px;background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.72rem;text-align:center"></label></div><button id="runBacktest" style="flex:1;padding:10px;background:var(--buy);color:var(--on-accent);border:none;border-radius:8px;font-weight:600;font-size:.8rem;cursor:pointer">Run Backtest</button><button id="compareBacktest" style="flex:1;padding:10px;background:var(--accent);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:.8rem;cursor:pointer">Compare Strategies</button></div><div style="padding:0 12px 8px"><div class="cond-row"><div class="cond-info"><span class="cond-title">Multi-Pair Mode</span><span class="cond-desc">Backtest across multiple pairs</span></div><div class="cond-controls"><label class="toggle"><input type="checkbox" id="mpModeToggle" ${backtest.multiPairMode ? "checked" : ""}><span class="toggle-track"></span>...<span class="toggle-knob"></span></label></div></div></div>${backtest.multiPairMode ? `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;background:var(--panel-inset);border:1px solid var(--border);border-radius:8px;margin:0 12px 8px">${allScanPairs.map(p => { const on = backtest.multiPairSelected.includes(p); return `<label style="display:flex;align-items:center;gap:4px;font-size:.72rem;color:var(--muted);cursor:pointer;padding:3px 8px;border-radius:4px;background:${on ? 'var(--panel-hover)' : 'transparent'};border:1px solid ${on ? 'var(--border)' : 'transparent'}"><input type="checkbox" ${on ? "checked" : ""} data-mp-pair="${p}" style="accent-color:var(--wait)">${p}</label>`; }).join("")}<div style="width:100%;display:flex;gap:6px;margin-top:4px"><button id="mpSelectAll" style="padding:4px 10px;background:var(--border);border:1px solid var(--border-strong);color:var(--muted);border-radius:6px;font-size:.68rem;cursor:pointer;font-family:inherit">Select All</button><button id="mpClearAll" style="padding:4px 10px;background:var(--border);border:1px solid var(--border-strong);color:var(--muted);border-radius:6px;font-size:.68rem;cursor:pointer;font-family:inherit">Clear All</button></div></div><div style="padding:0 12px 12px"><button id="runMultiBacktest" style="width:100%;padding:10px;background:var(--wait);color:var(--on-accent);border:none;border-radius:8px;font-weight:600;font-size:.8rem;cursor:pointer">Run Multi-Pair Backtest</button></div>` : ""}</div></section>`;
  }
  if (backtest.running || backtest.comparing) {
    return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="backtestToggle"><div class="history-toggle-left"><h3>Backtest Strategy</h3></div><span class="arrow">▾</span></button><div class="history-body open" id="backtestBody"><div style="padding:12px;text-align:center;color:var(--muted);font-size:.72rem">${backtest.comparing ? "Running comparison..." : "Running backtest..."} ${backtest.progress}</div></div></section>`;
  }
  if (backtest.multiRunning) {
    return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="backtestToggle"><div class="history-toggle-left"><h3>Backtest Strategy</h3></div><span class="arrow">▾</span></button><div class="history-body open" id="backtestBody"><div style="padding:12px;text-align:center;color:var(--muted);font-size:.72rem">Running multi-pair backtest... ${backtest.multiProgress}</div></div></section>`;
  }
  const r = backtest.results;
  if ((!r || r.trades.length === 0) && !backtest.multiResults) return "";
  let singleResult = "";
  if (r && r.trades.length > 0) {
  const wins = r.trades.filter(t => t.result === "win").length;
  const losses = r.trades.filter(t => t.result === "loss").length;
  const pending = r.trades.filter(t => t.result === "pending").length;
  const total = r.trades.length;
  const wr = total > 0 ? Math.round((wins / total) * 100) : 0;
  const avgWin = wins > 0 ? r.trades.filter(t => t.result === "win").reduce((s, t) => s + t.pnlPct, 0) / wins : 0;
  const avgLoss = losses > 0 ? r.trades.filter(t => t.result === "loss").reduce((s, t) => s + t.pnlPct, 0) / losses : 0;
  const profitFactor = losses > 0 ? Math.abs(r.trades.filter(t => t.result === "win").reduce((s, t) => s + t.pnlPct, 0) / r.trades.filter(t => t.result === "loss").reduce((s, t) => s + t.pnlPct, 0)) : wins > 0 ? "∞" : 0;
  let eqCum = 0;
  const eqValsRaw = r.trades.map(t => { eqCum += t.pnlPct; return eqCum; });
  const cum = eqValsRaw.length > 0 ? eqValsRaw[eqValsRaw.length - 1] : 0;
  // Cap SVG points: long backtests otherwise build megabyte-long polyline strings,
  // and spreading them into Math.max/Math.min overflows the argument stack.
  const MAX_EQ_SVG_PTS = 600;
  let eqVals = eqValsRaw;
  if (eqValsRaw.length > MAX_EQ_SVG_PTS) {
    const stride = eqValsRaw.length / MAX_EQ_SVG_PTS;
    const picked = [];
    for (let k = 0; k < MAX_EQ_SVG_PTS; k++) picked.push(eqValsRaw[Math.min(eqValsRaw.length - 1, Math.floor(k * stride))]);
    picked[picked.length - 1] = eqValsRaw[eqValsRaw.length - 1];
    eqVals = picked;
  }
  const eqPeaks = [];
  let runPeak = -Infinity;
  for (const v of eqVals) { if (v > runPeak) runPeak = v; eqPeaks.push(runPeak); }
  const ddSeries = eqVals.map((v, i) => eqPeaks[i] - v);
  let maxDdPct = 0;
  for (const d of ddSeries) if (d > maxDdPct) maxDdPct = d;
  const tradeReturns = r.trades.filter(t => t.result !== "pending").map(t => t.pnlPct);
  const avgReturn = tradeReturns.length > 0 ? tradeReturns.reduce((s, v) => s + v, 0) / tradeReturns.length : 0;
  const stdDev = tradeReturns.length > 1 ? Math.sqrt(tradeReturns.reduce((s, v) => s + Math.pow(v - avgReturn, 2), 0) / (tradeReturns.length - 1)) : 0;
  const sharpeRaw = stdDev > 0 ? avgReturn / stdDev * Math.sqrt(252) : "-";
  const sharpe = sharpeRaw === "-" ? "-" : sharpeRaw.toFixed(2);
  const calmarRaw = maxDdPct > 0 ? cum / maxDdPct : "-";
  const calmar = calmarRaw === "-" ? "-" : calmarRaw.toFixed(2);
  const expectancy = total > 0 ? ((wr / 100 * avgWin) + ((1 - wr / 100) * avgLoss)).toFixed(2) : "0";
  let maxDdDur = 0, ddDur = 0;
  for (let i = 0; i < eqVals.length; i++) { if (eqVals[i] < eqPeaks[i]) { ddDur++; if (ddDur > maxDdDur) maxDdDur = ddDur; } else ddDur = 0; }
  let eqMax = 0, eqMin = 0;
  for (const v of eqVals) { if (v > eqMax) eqMax = v; if (v < eqMin) eqMin = v; }
  const eqRng = eqMax - eqMin || 1;
  const eqW = 480;
  const eqH = 80;
  const ddChartH = 36;
  const eqXs = eqVals.length > 1 ? eqW / (eqVals.length - 1) : eqW;
  const eqY = (v) => eqH - ((v - eqMin) / eqRng) * (eqH - 8) - 4;
  const eqX = (i) => i * eqXs;
  const eqZeroY = eqY(0);
  const peakLinePts = eqPeaks.map((v, i) => `${eqX(i)},${eqY(v)}`).join(" ");
  const eqPts = eqVals.map((v, i) => `${eqX(i).toFixed(1)},${eqY(v).toFixed(1)}`);
  const peakPts = eqPeaks.map((v, i) => `${eqX(i).toFixed(1)},${eqY(v).toFixed(1)}`);
  const ddPolyFwd = eqPeaks.map((v, i) => `${eqX(i)},${eqY(v)}`).join(" ");
  const ddPolyBwd = [...eqVals].reverse().map((v, i) => `${eqX(eqVals.length - 1 - i)},${eqY(v)}`).join(" ");
  const eqSegs = [];
  for (let i = 0; i < eqVals.length; i++) {
    const segColor = i > 0 ? (eqVals[i] >= eqVals[i - 1] ? "#3fb950" : "#f85149") : (eqVals[i] >= 0 ? "#3fb950" : "#f85149");
    if (i > 0) eqSegs.push(`<line x1="${eqX(i - 1)}" y1="${eqY(eqVals[i - 1])}" x2="${eqX(i)}" y2="${eqY(eqVals[i])}" stroke="${segColor}" stroke-width="1.5"/>`);
    eqSegs.push(`<circle cx="${eqX(i)}" cy="${eqY(eqVals[i])}" r="1.5" fill="${segColor}"/>`);
  }
  const eqCurve = `<svg width="100%" height="${eqH}" viewBox="0 0 ${eqW} ${eqH}" preserveAspectRatio="none" style="display:block;border-radius:4px;background:var(--bg)"><polygon points="${ddPolyFwd} ${ddPolyBwd}" fill="rgba(248,81,73,0.12)"/><polyline points="${peakLinePts}" fill="none" stroke="#26313d" stroke-width="0.5" stroke-dasharray="3,3"/><line x1="0" y1="${eqZeroY}" x2="${eqW}" y2="${eqZeroY}" stroke="#26313d" stroke-width="0.5" stroke-dasharray="3,3"/>${eqSegs.join("")}</svg>`;
  let ddMax = 0.1;
  for (const d of ddSeries) if (d > ddMax) ddMax = d;
  const ddY = (v) => ddChartH - (v / ddMax) * (ddChartH - 4) - 2;
  const ddX = (i) => i * eqXs;
  const ddPts = ddSeries.map((v, i) => `${ddX(i).toFixed(1)},${ddY(v).toFixed(1)}`);
  const ddFillPts = ddSeries.map((v, i) => `${ddX(i)},${ddY(v)}`).join(" ") + ` ${ddX(ddSeries.length - 1)},${ddChartH} ${ddX(0)},${ddChartH}`;
  const ddChart = `<svg width="100%" height="${ddChartH}" viewBox="0 0 ${eqW} ${ddChartH}" preserveAspectRatio="none" style="display:block;border-radius:4px;background:var(--bg)"><polygon points="${ddFillPts}" fill="rgba(248,81,73,0.2)"/><polyline points="${ddPts}" fill="none" stroke="#f85149" stroke-width="1"/></svg>`;
  const tradeRows = r.trades.slice(-50).reverse().map((t, i) => {
    const cls = t.direction.toLowerCase();
    const rCls = t.result === "win" ? "stat-win" : t.result === "loss" ? "stat-loss" : "";
    return `<div style="display:flex;align-items:center;gap:4px;font-size:.65rem;padding:2px 0;border-bottom:1px solid var(--panel-inset)"><span style="width:14px;font-size:.55rem">${r.trades.length - i}</span><span style="width:56px;text-transform:uppercase">${t.date}</span><span style="width:32px;font-weight:600;color:${t.direction === 'BUY' ? 'var(--buy)' : 'var(--sell)'}">${t.direction}</span><span style="width:44px;text-align:right;font-variant-numeric:tabular-nums">${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}%</span><span style="flex:1;height:4px;background:var(--border);border-radius:2px;overflow:hidden"><div style="width:${Math.min(Math.abs(t.pnlPct) * 5, 100)}%;height:100%;background:${t.pnlPct >= 0 ? 'var(--buy)' : 'var(--sell)'};border-radius:2px"></div></span><span style="width:30px;text-align:right;font-size:.58rem;color:${t.result === 'win' ? 'var(--buy)' : t.result === 'loss' ? 'var(--sell)' : 'var(--muted-2)'}">${t.result === 'win' ? 'W' : t.result === 'loss' ? 'L' : '?'}</span></div>`;
  }).join("");
  singleResult = `<section class="dashboard-section"><button class="backtest-toggle no-select" id="backtestToggle"><div class="history-toggle-left"><h3>Backtest Strategy</h3></div><span class="arrow">▾</span></button><div class="history-body open" id="backtestBody"><div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr;gap:4px;padding:12px"><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${total}</div><div style="font-size:.6rem;color:var(--muted-3)">Signals</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:${wr >= 50 ? 'var(--buy)' : 'var(--sell)'}">${wr}%</div><div style="font-size:.6rem;color:var(--muted-3)">Win Rate</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--buy)">+${avgWin.toFixed(1)}%</div><div style="font-size:.6rem;color:var(--muted-3)">Avg Win</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--sell)">${avgLoss.toFixed(1)}%</div><div style="font-size:.6rem;color:var(--muted-3)">Avg Loss</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${typeof profitFactor === 'number' ? profitFactor.toFixed(2) : profitFactor}</div><div style="font-size:.6rem;color:var(--muted-3)">Profit Factor</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--sell)">${maxDdPct.toFixed(1)}%</div><div style="font-size:.6rem;color:var(--muted-3)">Max DD (${maxDdDur}t)</div></div></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;padding:4px 12px"><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:${sharpeRaw !== '-' && sharpeRaw > 1 ? 'var(--buy)' : sharpeRaw !== '-' && sharpeRaw > 0 ? 'var(--warn)' : 'var(--sell)'}">${sharpe}</div><div style="font-size:.55rem;color:var(--muted-3)">Sharpe Ratio</div></div><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:${calmarRaw !== '-' && calmarRaw > 1 ? 'var(--buy)' : 'var(--sell)'}">${calmar}</div><div style="font-size:.55rem;color:var(--muted-3)">Calmar Ratio</div></div><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:var(--text-strong)">${expectancy}%</div><div style="font-size:.55rem;color:var(--muted-3)">Expectancy</div></div></div><div style="display:flex;gap:6px;padding:0 12px 8px;flex-wrap:wrap;font-size:.65rem;color:var(--muted-3)"><span>${wins}W / ${losses}L / ${pending}P</span><span>· Balance: ${cum >= 0 ? '+' : ''}${cum.toFixed(1)}%</span><span>· Period: ${r.startDate} → ${r.endDate}</span></div><div style="max-height:200px;overflow-y:auto;border-top:1px solid var(--border);padding:4px 12px">${tradeRows}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;padding:4px 12px"><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:${r.finalEquity >= 10000 ? 'var(--buy)' : 'var(--sell)'}">$${r.finalEquity != null ? r.finalEquity.toFixed(0) : '-'}</div><div style="font-size:.55rem;color:var(--muted-3)">Final Equity</div></div><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:${r.totalReturnPct >= 0 ? 'var(--buy)' : 'var(--sell)'}">${r.totalReturnPct != null ? (r.totalReturnPct >= 0 ? '+' : '') + r.totalReturnPct.toFixed(1) + '%' : '-'}</div><div style="font-size:.55rem;color:var(--muted-3)">Net Return</div></div><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:var(--text-strong)">${r.feePerTrade ?? 0}%</div><div style="font-size:.55rem;color:var(--muted-3)">Fee/trade</div></div><div style="text-align:center"><div style="font-size:.9rem;font-weight:700;color:var(--text-strong)">${r.riskPerTrade ?? 1}%</div><div style="font-size:.55rem;color:var(--muted-3)">Risk/trade</div></div></div><div style="padding:4px 12px"><div style="font-size:.6rem;color:var(--muted-3);margin-bottom:2px">Equity Curve</div><svg width="100%" height="${eqH + ddChartH}" viewBox="0 0 ${eqW} ${eqH + ddChartH}" preserveAspectRatio="none" style="display:block;background:var(--bg);border-radius:4px"><polyline points="${eqPts.join(' ')}" fill="none" stroke="#3fb950" stroke-width="1.5"/><line x1="0" y1="${eqY(0)}" x2="${eqW}" y2="${eqY(0)}" stroke="#2a3848" stroke-width="0.5" stroke-dasharray="3,3"/><polyline points="${peakPts.join(' ')}" fill="none" stroke="#3fb950" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.3"/><rect x="0" y="${eqH}" width="${eqW}" height="${ddChartH}" fill="none"/><polyline points="${ddPts.join(' ')}" fill="rgba(248,81,73,0.2)" stroke="#f85149" stroke-width="1"/></svg><div style="display:flex;justify-content:space-between;font-size:.55rem;color:var(--muted-3);margin-top:2px"><span>Max DD: ${maxDdPct.toFixed(1)}%</span><span>DD Duration: ${maxDdDur} trades</span></div></div></div></section>`;
  }
  let multiResult = "";
  if (backtest.multiResults) {
    const mr = backtest.multiResults;
    const pairs = Object.keys(mr);
    const totalSignals = pairs.reduce((s, p) => s + mr[p].signals, 0);
    const allWins = pairs.reduce((s, p) => s + mr[p].wins, 0);
    const allLosses = pairs.reduce((s, p) => s + mr[p].losses, 0);
    const overallWr = totalSignals > 0 ? Math.round((allWins / totalSignals) * 100) : 0;
    let bestPair = "", bestWr = -1, worstPair = "", worstWr = 101;
    pairs.forEach(p => { if (mr[p].signals > 0 && mr[p].winRate > bestWr) { bestWr = mr[p].winRate; bestPair = p; } if (mr[p].signals > 0 && mr[p].winRate < worstWr) { worstWr = mr[p].winRate; worstPair = p; } });
    const pairRows = pairs.map(p => { const d = mr[p]; return `<div style="display:flex;align-items:center;gap:6px;font-size:.72rem;padding:6px 8px;border-bottom:1px solid var(--panel-inset)"><span style="width:64px;font-weight:600;color:var(--text)">${p}</span><span style="width:40px;text-align:right;color:var(--muted)">${d.signals}</span><span style="width:44px;text-align:right;color:${d.winRate >= 50 ? 'var(--buy)' : 'var(--sell)'}">${d.winRate}%</span><span style="width:40px;text-align:right;color:var(--muted)">${d.avgRR}</span><span style="width:40px;text-align:right;color:var(--muted)">${d.profitFactor}</span><span style="width:48px;text-align:right;color:var(--sell)">${d.maxDD}</span></div>`; }).join("");
    multiResult = `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 1fr;gap:4px;padding:12px"><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${totalSignals}</div><div style="font-size:.6rem;color:var(--muted-3)">Total Signals</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:${overallWr >= 50 ? 'var(--buy)' : 'var(--sell)'}">${overallWr}%</div><div style="font-size:.6rem;color:var(--muted-3)">Overall Win Rate</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--buy)">${bestPair}</div><div style="font-size:.6rem;color:var(--muted-3)">Best (${bestWr}%)</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--sell)">${worstPair}</div><div style="font-size:.6rem;color:var(--muted-3)">Worst (${worstWr}%)</div></div><div style="text-align:center"><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${pairs.length}</div><div style="font-size:.6rem;color:var(--muted-3)">Pairs Tested</div></div></div><div style="padding:0 12px 4px"><div style="display:flex;align-items:center;gap:6px;font-size:.65rem;padding:4px 8px;color:var(--muted-3);font-weight:600;border-bottom:1px solid var(--border)"><span style="width:64px">Pair</span><span style="width:40px;text-align:right">Sigs</span><span style="width:44px;text-align:right">Win%</span><span style="width:40px;text-align:right">Avg R:R</span><span style="width:40px;text-align:right">PF</span><span style="width:48px;text-align:right">Max DD</span></div>${pairRows}</div>`;
  }
  if (!singleResult && !multiResult) return "";
  const mpPairs = allScanPairs;
  const mpCheckboxes = backtest.multiPairMode ? `<div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;background:var(--panel-inset);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">${mpPairs.map(p => { const on = backtest.multiPairSelected.includes(p); return `<label style="display:flex;align-items:center;gap:4px;font-size:.72rem;color:var(--muted);cursor:pointer;padding:3px 8px;border-radius:4px;background:${on ? 'var(--panel-hover)' : 'transparent'};border:1px solid ${on ? 'var(--border)' : 'transparent'}"><input type="checkbox" ${on ? "checked" : ""} data-mp-pair="${p}" style="accent-color:var(--wait)">${p}</label>`; }).join("")}<div style="width:100%;display:flex;gap:6px;margin-top:4px"><button id="mpSelectAll" style="padding:4px 10px;background:var(--border);border:1px solid var(--border-strong);color:var(--muted);border-radius:6px;font-size:.68rem;cursor:pointer;font-family:inherit">Select All</button><button id="mpClearAll" style="padding:4px 10px;background:var(--border);border:1px solid var(--border-strong);color:var(--muted);border-radius:6px;font-size:.68rem;cursor:pointer;font-family:inherit">Clear All</button></div></div>` : "";
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="backtestToggle"><div class="history-toggle-left"><h3>Backtest Strategy</h3></div><span class="arrow">▾</span></button><div class="history-body open" id="backtestBody">${singleResult}${multiResult}<div style="padding:0 12px 8px"><div class="cond-row"><div class="cond-info"><span class="cond-title">Multi-Pair Mode</span><span class="cond-desc">Backtest across multiple pairs</span></div><div class="cond-controls"><label class="toggle"><input type="checkbox" id="mpModeToggle" ${backtest.multiPairMode ? "checked" : ""}><span class="toggle-track"></span><span class="toggle-knob"></span></label></div></div></div>${mpCheckboxes}${backtest.multiPairMode ? `<div style="padding:0 12px 12px"><button id="runMultiBacktest" style="width:100%;padding:10px;background:var(--wait);color:var(--on-accent);border:none;border-radius:8px;font-weight:600;font-size:.8rem;cursor:pointer">Run Multi-Pair Backtest</button></div>` : ""}<div style="padding:8px 12px;display:flex;gap:8px"><button id="runBacktest" style="flex:1;padding:8px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:8px;font-size:.75rem;cursor:pointer">Re-run Backtest</button></div></div></section>`;
}

function resolveTradeExit(rows, fromIndex, isBuy, stop, target) {
  for (let j = fromIndex + 1; j < rows.length; j++) {
    const bar = rows[j];
    // OHLC carries no intrabar ordering. When one bar spans both the stop and the
    // target the outcome is unknowable, so assume the stop filled first. This keeps
    // wide-range bars from silently inflating the backtest win rate.
    if (isBuy) {
      if (bar.low <= stop) return { result: "loss", exitPrice: stop, hitIndex: j };
      if (bar.high >= target) return { result: "win", exitPrice: target, hitIndex: j };
    } else {
      if (bar.high >= stop) return { result: "loss", exitPrice: stop, hitIndex: j };
      if (bar.low <= target) return { result: "win", exitPrice: target, hitIndex: j };
    }
  }
  return { result: "pending", exitPrice: null, hitIndex: -1 };
}

async function runBacktestImpl() {
  if (backtest.running) return;
  backtest.running = true;
  backtest.results = null;
  backtest.progress = "";
  render();
  try {
    const rows = await fetchBinanceRows(state.base, state.quote, "1d", 1000);
    if (rows.length < 120) { backtest.running = false; render(); return; }
    const cfg = loadStrategyConfig();
    {
      const fe = document.getElementById("btFee");
      const rt = document.getElementById("btRisk");
      if (fe) cfg.feePct = Math.max(0, Number(fe.value) || 0);
      if (rt) cfg.riskPerTradePct = Math.max(0.1, Number(rt.value) || 1);
    }
    const trades = [];
    for (let i = 100; i < rows.length; i++) {
      backtest.progress = `${i - 99}/${rows.length - 100}`;
      if (i % 50 === 0) { await new Promise(r => setTimeout(r, 0)); render(); }
      const slice = rows.slice(0, i + 1);
      const analysis = analyze(slice, cfg);
      if (!analysis || analysis.direction === "WAIT") continue;
      const rawEntry = analysis.entry || slice[i].close;
      const spreadSlip = ((slippageConfig.spreadPips || 0) + (slippageConfig.slippagePips || 0)) * 0.0001;
      const entry = analysis.direction === "BUY" ? rawEntry + spreadSlip : rawEntry - spreadSlip;
      const stop = analysis.stop;
      const target = analysis.target;
      if (stop == null || target == null) continue;
      const isBuy = analysis.direction === "BUY";
      const riskPct = isBuy ? ((entry - stop) / entry) * 100 : ((stop - entry) / entry) * 100;
      const rewardPct = isBuy ? ((target - entry) / entry) * 100 : ((entry - target) / entry) * 100;
      const exit = resolveTradeExit(rows, i, isBuy, stop, target);
      const result = exit.result;
      const exitPrice = exit.exitPrice;
      const pnlPct = result === "win" ? rewardPct : result === "loss" ? -riskPct : 0;
      const fee = cfg.feePct || 0;
      const riskSize = cfg.riskPerTradePct || 1;
      const rr = riskPct > 0 ? rewardPct / riskPct : 0;
      const rPnl = result === "win" ? rr : result === "loss" ? -1 : 0;
      const feeCost = fee; // round-trip commission % of notional (~ risk%) -> convert: fee applied to risk amount
      const equityPct = (rPnl * riskSize) - (result === "pending" ? 0 : feeCost);
      trades.push({
        date: slice[i].date, direction: analysis.direction, entry, stop, target,
        confidence: analysis.confidence, risk: analysis.risk, result, pnlPct, exitPrice,
        rr: Number(rr.toFixed(2)), equityPct: Number(equityPct.toFixed(3)),
      });
    }
    let equity = 10000;
    const equityCurve = [];
    trades.forEach(t => { equity *= (1 + t.equityPct / 100); t.equity = equity; equityCurve.push(equity); });
    backtest.results = {
      trades,
      startDate: rows[100].date, endDate: rows[rows.length - 1].date,
      finalEquity: equity, totalReturnPct: ((equity - 10000) / 10000) * 100,
      feePerTrade: cfg.feePct || 0, riskPerTrade: cfg.riskPerTradePct || 1, equityCurve,
    };
  } catch { }
  backtest.running = false;
  render();
}

async function runCompareBacktestImpl() {
  if (backtest.running || backtest.comparing) return;
  backtest.comparing = true;
  backtest.comparison = null;
  backtest.progress = "";
  render();
  try {
    const rows = await fetchBinanceRows(state.base, state.quote, "1d", 1000);
    if (rows.length < 120) { backtest.comparing = false; render(); return; }
    const defaultCfg = { threshold: 5, riskRewardRatio: 2.0, volumeMultiplier: 1.3, volatilityMedianMultiplier: 2.5, rsiBuyThreshold: 55, rsiSellThreshold: 45 };
    const customCfg = loadStrategyConfig();
    function runCfg(cfg, useMl) {
      const local = useMl ? { n: 0, trained: false, minSamples: 8, muWin: [0,0,0,0,0], varWin: [0,0,0,0,0], muLoss: [0,0,0,0,0], varLoss: [0,0,0,0,0], nWin: 0, nLoss: 0 } : null;
      function ltrain(entry) {
        if (!local) return;
        const f = mlFeaturize(entry);
        if (entry.result === "win") { local.nWin = _updateClass(local.muWin, local.varWin, local.nWin, f); }
        else { local.nLoss = _updateClass(local.muLoss, local.varLoss, local.nLoss, f); }
        local.n++;
        local.trained = local.n >= local.minSamples;
      }
      function lpredict(entry) {
        if (!local || !local.trained) return null;
        const f = mlFeaturize(entry);
        const nWin = local.nWin, nLoss = local.nLoss, total = nWin + nLoss;
        if (total < local.minSamples) return null;
        let lWin = Math.log(nWin + 1) - Math.log(total + 2);
        let lLoss = Math.log(nLoss + 1) - Math.log(total + 2);
        for (let i = 0; i < ML_FEATURES.length; i++) {
          if (nWin > 0) lWin += Math.log(Math.max(_gauss(f[i], local.muWin[i], local.varWin[i]), 1e-12));
          if (nLoss > 0) lLoss += Math.log(Math.max(_gauss(f[i], local.muLoss[i], local.varLoss[i]), 1e-12));
        }
        const m = Math.max(lWin, lLoss), eW = Math.exp(lWin - m), eL = Math.exp(lLoss - m);
        return { win: eW / (eW + eL), label: (eW / (eW + eL)) >= 0.5 ? "win" : "loss" };
      }
      const trades = [];
      for (let i = 100; i < rows.length; i++) {
        const slice = rows.slice(0, i + 1);
        const a = analyze(slice, cfg);
        if (!a || a.direction === "WAIT") continue;
        const entryBar = a.entry || slice[i].close;
        const stop = a.stop;
        const target = a.target;
        if (stop == null || target == null) continue;
        if (useMl && local.trained) {
          const pred = lpredict({ confidence: a.confidence, buyScore: a.buyScore, sellScore: a.sellScore, volatilityPct: a.volatilityPct, direction: a.direction });
          if (pred && pred.label === "loss") continue;
        }
        const isBuy = a.direction === "BUY";
        const riskPct = isBuy ? ((entryBar - stop) / entryBar) * 100 : ((stop - entryBar) / entryBar) * 100;
        const rewardPct = isBuy ? ((target - entryBar) / entryBar) * 100 : ((entryBar - target) / entryBar) * 100;
        let result = "pending";
        let pnlPct = 0;
        for (let j = i + 1; j < rows.length; j++) {
          const bar = rows[j];
          if (isBuy) {
            if (bar.high >= target) { result = "win"; pnlPct = rewardPct; break; }
            if (bar.low <= stop) { result = "loss"; pnlPct = -riskPct; break; }
          } else {
            if (bar.low <= target) { result = "win"; pnlPct = rewardPct; break; }
            if (bar.high >= stop) { result = "loss"; pnlPct = -riskPct; break; }
          }
        }
        if (result === "pending") pnlPct = 0;
        const resolved = { confidence: a.confidence, buyScore: a.buyScore, sellScore: a.sellScore, volatilityPct: a.volatilityPct, direction: a.direction, result, pnlPct };
        if (useMl && (result === "win" || result === "loss")) ltrain(resolved);
        trades.push({ result, pnlPct });
      }
      return trades;
    }
    backtest.progress = "Default config...";
    render();
    await new Promise(r => setTimeout(r, 0));
    const defTrades = runCfg(defaultCfg, false);
    backtest.progress = "Custom config...";
    render();
    await new Promise(r => setTimeout(r, 0));
    const cstTrades = runCfg(customCfg, false);
    backtest.progress = "Custom + ML filter...";
    render();
    await new Promise(r => setTimeout(r, 0));
    const mlTrades = runCfg(customCfg, true);
    function metrics(trades) {
      const total = trades.length;
      const wins = trades.filter(t => t.result === "win");
      const losses = trades.filter(t => t.result === "loss");
      const wr = total > 0 ? Math.round((wins.length / total) * 100) : 0;
      const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
      const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length) : 0;
      const avgRR = avgLoss > 0 ? (avgWin / avgLoss).toFixed(1) : "0";
      const pf = losses.length > 0 ? (Math.abs(wins.reduce((s, t) => s + t.pnlPct, 0)) / Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0))).toFixed(2) : (wins.length > 0 ? "∞" : "0");
      let eq = 0;
      let peak = -Infinity;
      let maxDD = 0;
      trades.forEach(t => { eq += t.pnlPct; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd; });
      return { signals: total, winRate: wr + "%", avgRR, profitFactor: pf, maxDD: maxDD.toFixed(1) + "%" };
    }
    backtest.comparison = { default: metrics(defTrades), custom: metrics(cstTrades), ml: metrics(mlTrades) };
  } catch {}
  backtest.comparing = false;
  render();
}

function renderComparison() {
  if (!backtest.comparison) return "";
  const d = backtest.comparison.default;
  const c = backtest.comparison.custom;
  const m = backtest.comparison.ml;
  const g = (a, b) => (a.startsWith("∞") ? "#3fb950" : parseFloat(a) >= parseFloat(b) ? "#3fb950" : "#e6edf3");
  const dg = (a, b) => (parseFloat(a) <= parseFloat(b) ? "#3fb950" : "#e6edf3");
  const head = (t) => `<div style="color:var(--muted-3);font-weight:600;text-align:center;padding:4px 0">${t}</div>`;
  const row = (label, v1, c1, v2, c2, v3, c3) => `<div style="color:var(--muted);padding:4px 0">${label}</div><div style="text-align:center;padding:4px 0;color:${c1}">${v1}</div><div style="text-align:center;padding:4px 0;color:${c2}">${v2}</div><div style="text-align:center;padding:4px 0;color:${c3}">${v3}</div>`;
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="compToggle"><div class="history-toggle-left"><h3>Strategy Comparison</h3><span class="history-count">🤖 ML</span></div><span class="arrow">▾</span></button><div class="history-body open" id="compBody"><div style="padding:4px 12px;font-size:.58rem;color:var(--muted-3)">Green = better of Custom vs Custom + ML. ML column filters trades the self-trained model predicts as losses (walk-forward).</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:0;padding:8px 12px;font-size:.72rem">${head("Metric")}${head("Default")}${head("Custom")}${head("Custom+ML")}${row("Signals", d.signals, "#e6edf3", c.signals, "#e6edf3", m.signals, "#e6edf3")}${row("Win Rate", d.winRate, g(d.winRate, c.winRate), c.winRate, g(c.winRate, m.winRate), m.winRate, g(m.winRate, c.winRate))}${row("Avg R:R", d.avgRR, g(d.avgRR, c.avgRR), c.avgRR, g(c.avgRR, m.avgRR), m.avgRR, g(m.avgRR, c.avgRR))}${row("Profit Factor", d.profitFactor, g(d.profitFactor, c.profitFactor), c.profitFactor, g(c.profitFactor, m.profitFactor), m.profitFactor, g(m.profitFactor, c.profitFactor))}${row("Max DD", d.maxDD, dg(d.maxDD, c.maxDD), c.maxDD, dg(c.maxDD, m.maxDD), m.maxDD, dg(m.maxDD, c.maxDD))}</div></div></section>`;
}

function renderCorrelationMatrix() {
  const isRunning = corrData.running;
  const hasData = corrData.matrix && corrData.pairs.length > 0;
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="corrToggle"><div class="history-toggle-left"><h3>Correlation Matrix</h3>${hasData ? `<span class="history-count">${corrData.pairs.length} pairs</span>` : ''}</div><span class="arrow">▾</span></button><div class="history-body${hasData ? ' open' : ''}" id="corrBody"><div style="padding:12px">${isRunning ? '<div style="text-align:center;color:var(--muted);font-size:.72rem">Computing correlations...</div>' : ''}${hasData ? (() => { const pairs = corrData.pairs; const m = corrData.matrix; return `<div style="overflow-x:auto"><table style="border-collapse:collapse;margin:0 auto"><tr><td></td>${pairs.map(p => `<td style="padding:2px 4px;font-size:.55rem;color:var(--muted);text-align:center;writing-mode:vertical-lr;transform:rotate(180deg);height:50px">${p}</td>`).join("")}</tr>${pairs.map((p1, i) => `<tr><td style="padding:2px 6px;font-size:.6rem;color:var(--muted);white-space:nowrap">${p1}</td>${pairs.map((p2, j) => { const v = m[i][j]; const bg = i === j ? '#1f2a36' : corrColor(v); return `<td class="corr-cell" style="background:${bg}33;border:1px solid ${bg}22" title="${p1} ↔ ${p2}: ${v.toFixed(2)}">${i === j ? "1.0" : v.toFixed(2)}</td>`; }).join("")}</tr>`).join("")}</table></div><div style="display:flex;gap:8px;justify-content:center;margin-top:8px;font-size:.6rem;color:var(--muted-3)"><span>🟢 Strong +</span><span>🟡 Weak +</span><span>⚪ Neutral</span><span>🟠 Weak -</span><span>🔴 Strong -</span></div>` })() : '<div style="text-align:center;color:var(--muted-3);font-size:.72rem">Run a scan first to compute correlations between pairs.</div>'}</div>${!isRunning ? `<div style="padding:0 12px 12px"><button id="runCorr" style="width:100%;padding:8px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:8px;font-size:.75rem;cursor:pointer">${hasData ? 'Recompute' : 'Compute Correlations'}</button></div>` : ''}</div></section>`;
}

function renderPaperTrading() {
  const p = paperState;
  const paperAnalysis = state.rows.length > 0 ? analyze(state.rows, loadStrategyConfig()) : null;
  const totalPnl = p.balance - p.startingBalance;
  const pnlPct = p.startingBalance > 0 ? (totalPnl / p.startingBalance * 100) : 0;
  const wins = p.trades.filter(t => t.pnlPct > 0).length;
  const losses = p.trades.filter(t => t.pnlPct <= 0).length;
  const wr = p.trades.length > 0 ? Math.round((wins / p.trades.length) * 100) : 0;
  const rawCov = (p.equityCurve || []).map(e => e.balance);
  if (rawCov.length < 2) rawCov.unshift(p.startingBalance);
  // Never spread a long curve into Math.max/Math.min: that overflows the argument stack
  // on long-running paper accounts and used to throw RangeError inside render().
  let eqMax = p.startingBalance, eqMin = p.startingBalance;
  for (const v of rawCov) { if (v > eqMax) eqMax = v; if (v < eqMin) eqMin = v; }
  const eqRng = eqMax - eqMin || 1;
  // Downsample to a sane SVG point budget while preserving first/last and extremes.
  const MAX_EQ_POINTS = 600;
  let eqCov = rawCov;
  if (rawCov.length > MAX_EQ_POINTS) {
    const stride = rawCov.length / MAX_EQ_POINTS;
    const picked = [];
    for (let k = 0; k < MAX_EQ_POINTS; k++) picked.push(rawCov[Math.min(rawCov.length - 1, Math.floor(k * stride))]);
    picked[picked.length - 1] = rawCov[rawCov.length - 1];
    eqCov = picked;
  }
  const eqX = (i) => (eqCov.length > 1 ? i * (460 / (eqCov.length - 1)) : 0);
  const eqY = (v) => 56 - ((v - eqMin) / eqRng) * 48 - 4;
  const eqPtsStr = eqCov.map((v, i) => `${eqX(i).toFixed(1)},${eqY(v).toFixed(1)}`).join(" ");
  const eqChart = (p.equityCurve || []).length > 0 || p.trades.length > 0 ? `<div style="padding:8px 12px 0"><div style="font-size:.6rem;color:var(--muted-3);margin-bottom:2px">Paper Equity Curve</div><svg width="100%" height="60" viewBox="0 0 460 60" preserveAspectRatio="none" style="display:block;background:var(--bg);border-radius:4px"><polyline points="${eqPtsStr}" fill="none" stroke="${pnlPct >= 0 ? '#3fb950' : '#f85149'}" stroke-width="1.5"/>${eqCov.length >= 2 ? `<line x1="0" y1="${eqY(p.startingBalance).toFixed(1)}" x2="460" y2="${eqY(p.startingBalance).toFixed(1)}" stroke="#2a3848" stroke-width="0.5" stroke-dasharray="3,3"/>` : ""}</svg><div style="display:flex;justify-content:space-between;font-size:.55rem;color:var(--muted-3);margin-top:2px"><span>${(p.equityCurve || []).length} points</span><span>high $${eqMax.toFixed(0)}</span><span>low $${eqMin.toFixed(0)}</span><span>PnL ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</span></div></div>` : "";
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="paperToggle"><div class="history-toggle-left"><h3>Paper Trading</h3><span class="history-count" style="background:${totalPnl>=0?'var(--buy-bg)':'var(--sell-bg)'};color:${totalPnl>=0?'var(--buy)':'var(--sell)'}">虚拟$${Math.round(p.balance)}</span></div><span class="arrow">▾</span></button><div class="history-body" id="paperBody"><div style="padding:12px;display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;text-align:center"><div><div style="font-size:1rem;font-weight:700;color:${totalPnl>=0?'var(--buy)':'var(--sell)'}">${totalPnl>=0?'+':''}$${totalPnl.toFixed(0)}</div><div style="font-size:.6rem;color:var(--muted-3)">P/L</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${wr}%</div><div style="font-size:.6rem;color:var(--muted-3)">Win Rate</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${p.trades.length}</div><div style="font-size:.6rem;color:var(--muted-3)">Trades</div></div><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${p.openPositions.length}</div><div style="font-size:.6rem;color:var(--muted-3)">Open</div></div></div>${eqChart}<div style="padding:4px 12px" class="cond-row"><div class="cond-info"><span class="cond-title">Auto-trade signals</span><span class="cond-desc">Open a paper trade on each new signal</span></div><div class="cond-controls"><label class="toggle"><input type="checkbox" id="paperAutoToggle" ${paperAutotrade ? "checked" : ""}><span class="toggle-track"></span><span class="toggle-knob"></span></label></div></div><div style="padding:8px 12px;border:1px solid var(--border);border-radius:6px;margin:4px 12px"><div style="font-size:.6rem;color:var(--muted-3);margin-bottom:4px">Manual Paper Trade — ${state.base}/${state.quote}</div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-bottom:4px"><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted);font-size:.6rem">Entry<input type="number" id="paperEntry" value="${paperAnalysis && paperAnalysis.entry != null ? Number(paperAnalysis.entry.toFixed(6)) : ''}" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.68rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted);font-size:.6rem">Stop<input type="number" id="paperStop" value="${paperAnalysis && paperAnalysis.stop != null ? Number(paperAnalysis.stop.toFixed(6)) : ''}" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.68rem"></label><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted);font-size:.6rem">Target<input type="number" id="paperTarget" value="${paperAnalysis && paperAnalysis.target != null ? Number(paperAnalysis.target.toFixed(6)) : ''}" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:3px 6px;color:var(--text);font-size:.68rem"></label></div><div style="display:flex;gap:6px"><button id="paperBuyBtn" style="flex:1;padding:5px;background:var(--buy-bg-deep);color:var(--buy);border:1px solid var(--buy-border);border-radius:6px;font-size:.72rem;cursor:pointer">BUY <span style="font-size:.55rem;color:var(--muted-3)">long</span></button><button id="paperSellBtn" style="flex:1;padding:5px;background:var(--sell-bg-deep);color:var(--sell);border:1px solid var(--sell-border);border-radius:6px;font-size:.72rem;cursor:pointer">SELL <span style="font-size:.55rem;color:var(--muted-3)">short</span></button></div></div><div style="padding:0 12px"><label style="display:flex;flex-direction:column;gap:2px;color:var(--muted);font-size:.72rem">Starting Balance<input type="number" id="paperBalance" value="${p.startingBalance}" style="background:var(--panel-hover);border:1px solid var(--border);border-radius:4px;padding:4px 8px;color:var(--text);font-size:.75rem"></label></div>${p.openPositions.length > 0 ? `<div style="padding:4px 12px;font-size:.65rem;color:var(--muted-3)">Open Paper Trades:</div>${p.openPositions.map(pos => { const r = multiScan.results[pos.pair]; const price = r?.price || pos.entry; const pnl = pos.direction === "BUY" ? ((price - pos.entry) / pos.entry * 100) : ((pos.entry - price) / pos.entry * 100); return `<div class="pos-row paper-trade" style="margin:4px 12px"><div class="pos-top"><span class="pos-pair">${pos.pair}</span><span class="pos-dir">${pos.direction}</span><span class="${pnl>=0?'pos-profit':'pos-loss'}">${pnl>=0?'+':''}${pnl.toFixed(2)}%</span><button class="pos-btn" data-close-paper="${pos.id}">Close</button></div><div class="pos-meta"><span>Entry ${formatPrice(pos.entry, pos.pair)}</span><span>Stop ${formatPrice(pos.stop, pos.pair)}</span><span>Target ${formatPrice(pos.target, pos.pair)}</span>${pos.takenPartial ? `<span style="color:var(--warn-orange)">${Math.round((pos.size ?? 1) * 100)}% left</span>` : ""}</div></div>`; }).join('')}` : ''}${p.trades.length > 0 ? `<div style="padding:4px 12px;font-size:.65rem;color:var(--muted-3)">Recent Paper Trades:</div><div style="max-height:150px;overflow-y:auto;padding:0 12px">${p.trades.slice(-10).reverse().map(t => `<div style="display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid var(--panel-inset);font-size:.65rem"><span style="color:var(--muted-3)">${t.date || ''}</span><span style="color:var(--muted);font-weight:600">${t.pair}</span><span style="color:${t.direction==='BUY'?'var(--buy)':'var(--sell)'};font-weight:700">${t.direction}</span><span style="color:${t.pnlPct>=0?'var(--buy)':'var(--sell)'};margin-left:auto">${t.pnlPct>=0?'+':''}${t.pnlPct.toFixed(2)}%</span></div>`).join('')}</div>` : ''}${(() => { if (p.trades.length === 0) return ""; const by = {}; p.trades.forEach(t => { if (!by[t.pair]) by[t.pair] = { n: 0, wins: 0, pnl: 0 }; by[t.pair].n++; if (t.pnlPct > 0) by[t.pair].wins++; by[t.pair].pnl += t.pnlPct; }); return `<div style="padding:4px 12px;font-size:.65rem;color:var(--muted-3)">Per-Pair P&L:</div><div style="max-height:130px;overflow-y:auto;padding:0 12px">${Object.entries(by).map(([pair, v]) => `<div style="display:flex;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid var(--panel-inset);font-size:.65rem"><span style="color:var(--muted);font-weight:600;width:70px">${pair}</span><div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${Math.min(100, Math.abs(v.pnl))}%;height:100%;background:${v.pnl >= 0 ? 'var(--buy)' : 'var(--sell)'};border-radius:3px"></div></div><span style="width:56px;text-align:right;color:${v.pnl >= 0 ? 'var(--buy)' : 'var(--sell)'}">${v.pnl >= 0 ? '+' : ''}${v.pnl.toFixed(2)}%</span><span style="color:var(--muted-3)">${v.wins}/${v.n}</span></div>`).join('')}</div>`; })()}</div><div style="padding:8px 12px;display:flex;gap:6px"><button id="paperReset" style="flex:1;padding:6px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:6px;font-size:.72rem;cursor:pointer">Reset</button></div></div></section>`;
}

function renderTradeReplay() {
  if (!replayState.active) {
    return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="replayToggle"><div class="history-toggle-left"><h3>Trade Replay</h3></div><span class="arrow">▾</span></button><div class="history-body" id="replayBody"><div style="padding:12px;text-align:center"><div style="font-size:.72rem;color:var(--muted);margin-bottom:8px">Step through historical bars to see how signals develop in real time.</div><button id="startReplay" style="padding:8px 20px;background:var(--accent);color:var(--bg);border:none;border-radius:8px;font-weight:600;font-size:.78rem;cursor:pointer">Start Replay (${state.base}/${state.quote})</button></div></div></section>`;
  }
  const rs = replayState;
  const progress = rs.rows.length > 120 ? Math.round(((rs.currentBar - 120) / (rs.rows.length - 120)) * 100) : 0;
  const currentDate = rs.rows[rs.currentBar]?.date || '';
  const lastPrice = rs.rows[rs.currentBar]?.close;
  const dirColor = rs.direction === "BUY" ? '#3fb950' : rs.direction === "SELL" ? '#f85149' : '#b58cff';
  return `<section class="dashboard-section"><div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="font-size:.95rem;font-weight:600">Trade Replay</h3><button id="stopReplay" style="background:none;border:1px solid var(--sell-strong);color:var(--sell);padding:3px 10px;border-radius:4px;cursor:pointer;font-size:.68rem;font-family:inherit">Stop</button></div><div class="replay-bar"><button id="replayStep">Step →</button><button id="replayPlay" class="${rs.intervalId ? 'active' : ''}">${rs.intervalId ? '⏸ Pause' : '▶ Play'}</button><span style="font-size:.68rem;color:var(--muted);margin-left:auto">${currentDate} | Bar ${rs.currentBar}/${rs.rows.length} | ${progress}%</span></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;padding:8px 0;text-align:center"><div><div style="font-size:.85rem;font-weight:700;color:${dirColor}">${rs.direction}</div><div style="font-size:.55rem;color:var(--muted-3)">Signal</div></div><div><div style="font-size:.85rem;font-weight:700;color:var(--text-strong)">${rs.confidence}%</div><div style="font-size:.55rem;color:var(--muted-3)">Confidence</div></div><div><div style="font-size:.85rem;font-weight:700;color:var(--accent)">${lastPrice ? formatPrice(lastPrice, rs.pair) : '-'}</div><div style="font-size:.55rem;color:var(--muted-3)">Price</div></div><div><div style="font-size:.85rem;font-weight:700;color:var(--text-strong)">${rs.trades.length}</div><div style="font-size:.55rem;color:var(--muted-3)">Signals Found</div></div></div><div style="max-height:150px;overflow-y:auto;border-top:1px solid var(--border);padding-top:4px">${rs.trades.slice(-20).reverse().map(t => `<div style="display:flex;gap:6px;align-items:center;padding:2px 0;font-size:.62rem;border-bottom:1px solid var(--panel-inset)"><span style="color:var(--muted-3);width:60px">${t.date}</span><span style="color:${t.direction==='BUY'?'var(--buy)':'var(--sell)'};font-weight:700;width:32px">${t.direction}</span><span style="color:var(--muted);width:24px">${t.confidence}%</span><span style="color:${t.result==='win'?'var(--buy)':t.result==='loss'?'var(--sell)':'var(--muted-2)'};margin-left:auto">${t.result==='win'?'✓ Win':t.result==='loss'?'✗ Loss':'○ Pending'}</span></div>`).join('')}</div></div></section>`;
}

function renderMonteCarlo() {
  const hasTrades = backtest.results && backtest.results.trades.length >= 5;
  const r = mcState.results;
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="mcToggle"><div class="history-toggle-left"><h3>Monte Carlo Simulation</h3></div><span class="arrow">▾</span></button><div class="history-body" id="mcBody"><div style="padding:12px">${mcState.running ? '<div style="text-align:center;color:var(--muted);font-size:.72rem">Running simulation... ' + mcState.progress + '</div>' : r ? (() => { const eqVals = r.medianCurve; let eqMax = 0.1, eqMin = 0; for (const v of eqVals) { if (v > eqMax) eqMax = v; if (v < eqMin) eqMin = v; } const eqRng = eqMax - eqMin || 1; const w = 460, h = 60; const xs = eqVals.length > 1 ? w / (eqVals.length - 1) : w; const yFn = v => h - ((v - eqMin) / eqRng) * (h - 6) - 3; const pts = eqVals.map((v, i) => `${i * xs},${yFn(v)}`).join(" "); return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;text-align:center;margin-bottom:8px"><div><div style="font-size:.85rem;font-weight:700;color:var(--sell)">${r.p5.toFixed(1)}%</div><div style="font-size:.55rem;color:var(--muted-3)">5th %ile</div></div><div><div style="font-size:.85rem;font-weight:700;color:var(--wait)">${r.p50.toFixed(1)}%</div><div style="font-size:.55rem;color:var(--muted-3)">Median</div></div><div><div style="font-size:.85rem;font-weight:700;color:var(--buy)">${r.p95.toFixed(1)}%</div><div style="font-size:.55rem;color:var(--muted-3)">95th %ile</div></div><div><div style="font-size:.85rem;font-weight:700;color:var(--sell)">${r.worstDD.toFixed(1)}%</div><div style="font-size:.55rem;color:var(--muted-3)">Worst DD</div></div></div><svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block;background:var(--bg);border-radius:4px"><polyline points="${pts}" fill="none" stroke="#b58cff" stroke-width="1.5"/></svg><div style="font-size:.6rem;color:var(--muted-3);margin-top:4px;text-align:center">Median equity curve across 1,000 random trade orderings</div>` })() : hasTrades ? '<div style="text-align:center;color:var(--muted);font-size:.72rem">Run a backtest first, then click below to simulate.</div>' : '<div style="text-align:center;color:var(--muted-3);font-size:.72rem">Run a backtest with at least 5 trades to enable Monte Carlo simulation.</div>'}</div>${!mcState.running ? `<div style="padding:0 12px 12px"><button id="runMC" style="width:100%;padding:8px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:8px;font-size:.75rem;cursor:pointer" ${!hasTrades ? 'disabled' : ''}>Run 1,000 Simulations</button></div>` : ''}</div></section>`;
}

function renderWalkForward() {
  const r = wfState.results;
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="wfToggle"><div class="history-toggle-left"><h3>Walk-Forward Analysis</h3></div><span class="arrow">▾</span></button><div class="history-body" id="wfBody"><div style="padding:12px">${wfState.running ? `<div style="text-align:center;color:var(--muted);font-size:.72rem">Running walk-forward analysis... ${wfState.progress}</div>` : r ? (() => { const segRows = r.segments.map(s => `<div style="display:flex;align-items:center;gap:4px;font-size:.65rem;padding:3px 0;border-bottom:1px solid var(--panel-inset)"><span style="width:24px;color:var(--muted-3)">#${s.segment}</span><span style="flex:1;color:var(--muted)">${s.testRange}</span><span style="width:28px;text-align:right;color:var(--text-strong)">${s.testTrades}</span><span style="width:36px;text-align:right;color:${s.testWR>=50?'var(--buy)':'var(--sell)'}">${s.testWR}%</span><span style="width:44px;text-align:right;color:${s.testPnL>=0?'var(--buy)':'var(--sell)'}">${s.testPnL>=0?'+':''}${s.testPnL.toFixed(1)}%</span></div>`).join(""); return `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;text-align:center;margin-bottom:8px"><div><div style="font-size:1rem;font-weight:700;color:var(--text-strong)">${r.segments.length}</div><div style="font-size:.6rem;color:var(--muted-3)">Segments</div></div><div><div style="font-size:1rem;font-weight:700;color:${r.avgTestWR>=50?'var(--buy)':'var(--sell)'}">${r.avgTestWR}%</div><div style="font-size:.6rem;color:var(--muted-3)">Avg Test WR</div></div><div><div style="font-size:1rem;font-weight:700;color:${r.totalTestPnL>=0?'var(--buy)':'var(--sell)'}">${r.totalTestPnL>=0?'+':''}${r.totalTestPnL.toFixed(1)}%</div><div style="font-size:.6rem;color:var(--muted-3)">Total Test P/L</div></div></div><div style="max-height:200px;overflow-y:auto;border-top:1px solid var(--border);padding-top:4px">${segRows}</div>` })() : '<div style="text-align:center;color:var(--muted-3);font-size:.72rem">Splits data into rolling windows. Optimizes on training data, validates on unseen test data.</div>'}</div>${!wfState.running ? `<div style="padding:0 12px 12px"><button id="runWF" style="width:100%;padding:8px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:8px;font-size:.75rem;cursor:pointer">Run Walk-Forward Analysis</button></div>` : ''}</div></section>`;
}

function renderStrategyOptimizer() {
  const r = optimizerState.results;
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="optToggle"><div class="history-toggle-left"><h3>Strategy Optimizer</h3></div><span class="arrow">▾</span></button><div class="history-body" id="optBody"><div style="padding:12px">${optimizerState.running ? `<div style="text-align:center;color:var(--muted);font-size:.72rem">Optimizing parameters... ${optimizerState.progress}</div>` : r ? (() => { const top5 = r.slice(0, 5); return `<div style="text-align:center;color:var(--muted);font-size:.72rem;margin-bottom:8px">Tested ${r.length} combinations</div><div style="max-height:250px;overflow-y:auto"><div style="display:flex;align-items:center;gap:4px;font-size:.62rem;padding:3px 4px;color:var(--muted-3);font-weight:600;border-bottom:1px solid var(--border)"><span style="width:20px">#</span><span style="width:32px">Thr</span><span style="width:32px">RR</span><span style="width:32px">Vol</span><span style="width:32px;text-align:right">Sigs</span><span style="width:36px;text-align:right">WR%</span><span style="width:44px;text-align:right">P/L</span><span style="width:44px;text-align:right">MaxDD</span></div>${r.map((o, i) => `<div class="opt-row${i === 0 ? ' opt-best' : ''}"><span style="width:20px;color:${i===0?'var(--buy)':'var(--muted-3)'};font-weight:700">${i + 1}</span><span style="width:32px">${o.cfg.threshold}</span><span style="width:32px">${o.cfg.riskRewardRatio}</span><span style="width:32px">${o.cfg.volumeMultiplier}</span><span style="width:32px;text-align:right">${o.signals}</span><span style="width:36px;text-align:right;color:${o.winRate>=50?'var(--buy)':'var(--sell)'}">${o.winRate}%</span><span style="width:44px;text-align:right;color:${o.pnl>=0?'var(--buy)':'var(--sell)'}">${o.pnl>=0?'+':''}${o.pnl.toFixed(1)}%</span><span style="width:44px;text-align:right;color:var(--sell)">${o.maxDD}</span></div>`).join("")}</div>${top5.length > 0 ? `<div style="margin-top:8px;padding:8px;background:var(--panel-inset);border-radius:6px"><div style="font-size:.65rem;color:var(--muted-3);margin-bottom:4px">Best parameters: Threshold=${top5[0].cfg.threshold}, R:R=${top5[0].cfg.riskRewardRatio}, Vol=${top5[0].cfg.volumeMultiplier}</div><button id="applyOptimal" style="padding:6px 12px;background:var(--buy-strong);color:var(--on-accent);border:none;border-radius:6px;font-size:.72rem;cursor:pointer;font-family:inherit">Apply Best Parameters</button></div>` : ''}` })() : '<div style="text-align:center;color:var(--muted-3);font-size:.72rem">Brute-force search through parameter combinations to find the most profitable settings.</div>'}</div>${!optimizerState.running ? `<div style="padding:0 12px 12px"><button id="runOpt" style="width:100%;padding:8px;background:var(--border);color:var(--muted);border:1px solid var(--border-strong);border-radius:8px;font-size:.75rem;cursor:pointer">Run Optimizer</button></div>` : ''}</div></section>`;
}

function renderScheduledReports() {
  return `<section class="dashboard-section"><button class="backtest-toggle no-select" id="schedToggle"><div class="history-toggle-left"><h3>Scheduled Reports</h3></div><span class="arrow">▾</span></button><div class="history-body" id="schedBody"><div style="padding:12px"><div class="cond-row"><div class="cond-info"><span class="cond-title">Auto-Report to Webhook</span><span class="cond-desc">Send performance summary every 6 hours</span></div><div class="cond-controls"><label class="toggle"><input type="checkbox" id="schedToggleInput" ${scheduleState.enabled ? "checked" : ""}><span class="toggle-track"></span><span class="toggle-knob"></span></label></div></div>${scheduleState.lastSent ? `<div style="font-size:.65rem;color:var(--muted-3);margin-top:6px">Last sent: ${scheduleState.lastSent.toLocaleString()}</div>` : ''}<div style="font-size:.65rem;color:var(--muted-3);margin-top:4px">Requires webhook URL to be configured in Settings.</div></div></div></section>`;
}

async function runMultiPairBacktest() {
  if (backtest.multiRunning) return;
  const selected = [...backtest.multiPairSelected];
  if (selected.length === 0) return;
  backtest.multiRunning = true;
  backtest.multiResults = null;
  backtest.multiProgress = "";
  render();
  const results = {};
  const cfg = loadStrategyConfig();
  for (let i = 0; i < selected.length; i++) {
    const pair = selected[i];
    backtest.multiProgress = `${i + 1}/${selected.length} (${pair})`;
    if (i % 3 === 0) { await new Promise(r => setTimeout(r, 0)); render(); }
    try {
      const [base, quote] = pair.split("/");
      const rows = await fetchBinanceRows(base, quote, "1d", 1000);
      if (rows.length < 120) { results[pair] = { signals: 0, wins: 0, losses: 0, winRate: 0, avgRR: "0", profitFactor: "0", maxDD: "0%" }; continue; }
      const trades = [];
      for (let j = 100; j < rows.length; j++) {
        const slice = rows.slice(0, j + 1);
        const analysis = analyze(slice, cfg, pair);
        if (!analysis || analysis.direction === "WAIT") continue;
        const entry = analysis.entry || slice[j].close;
        const stop = analysis.stop;
        const target = analysis.target;
        if (stop == null || target == null) continue;
        const isBuy = analysis.direction === "BUY";
        const riskPct = isBuy ? ((entry - stop) / entry) * 100 : ((stop - entry) / entry) * 100;
        const rewardPct = isBuy ? ((target - entry) / entry) * 100 : ((entry - target) / entry) * 100;
        let result = "pending";
        let pnlPct = 0;
        for (let k = j + 1; k < rows.length; k++) {
          const bar = rows[k];
          if (isBuy) {
            if (bar.high >= target) { result = "win"; pnlPct = rewardPct; break; }
            if (bar.low <= stop) { result = "loss"; pnlPct = -riskPct; break; }
          } else {
            if (bar.low <= target) { result = "win"; pnlPct = rewardPct; break; }
            if (bar.high >= stop) { result = "loss"; pnlPct = -riskPct; break; }
          }
        }
        if (result === "pending") pnlPct = 0;
        trades.push({ result, pnlPct });
      }
      const wins = trades.filter(t => t.result === "win").length;
      const losses = trades.filter(t => t.result === "loss").length;
      const total = trades.length;
      const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
      const avgWin = wins > 0 ? trades.filter(t => t.result === "win").reduce((s, t) => s + t.pnlPct, 0) / wins : 0;
      const avgLoss = losses > 0 ? Math.abs(trades.filter(t => t.result === "loss").reduce((s, t) => s + t.pnlPct, 0) / losses) : 0;
      const avgRR = avgLoss > 0 ? (avgWin / avgLoss).toFixed(1) : "0";
      const pf = losses > 0 ? (Math.abs(trades.filter(t => t.result === "win").reduce((s, t) => s + t.pnlPct, 0)) / Math.abs(trades.filter(t => t.result === "loss").reduce((s, t) => s + t.pnlPct, 0))).toFixed(2) : (wins > 0 ? "\u221E" : "0");
      let eq = 0, peak = -Infinity, maxDD = 0;
      trades.forEach(t => { eq += t.pnlPct; if (eq > peak) peak = eq; const dd = peak - eq; if (dd > maxDD) maxDD = dd; });
      results[pair] = { signals: total, wins, losses, winRate, avgRR, profitFactor: pf, maxDD: maxDD.toFixed(1) + "%" };
    } catch {
      results[pair] = { signals: 0, wins: 0, losses: 0, winRate: 0, avgRR: "0", profitFactor: "0", maxDD: "0%" };
    }
  }
  backtest.multiResults = results;
  backtest.multiRunning = false;
  render();
}

