const analyzeMemo = new WeakMap();
function analyzeMemoKey(cfg) {
  const ml = mlModel.trained
    ? [mlModel.n, mlModel.nWin, mlModel.nLoss, mlModel.muWin.join(","), mlModel.varWin.join(","), mlModel.muLoss.join(","), mlModel.varLoss.join(",")]
    : null;
  return JSON.stringify([cfg || null, macdHistVote, !!(state && state.isDemo), ml]);
}

function analyze(rows, cfg, sigKey, trackSignal = false) {
  if (rows.length < 80) return null;
  // Tracking signals mutates lastSignals, so only pure analyses are memoized.
  const memoKey = trackSignal ? null : analyzeMemoKey(cfg);
  if (memoKey) {
    const cached = analyzeMemo.get(rows);
    if (cached && cached.key === memoKey) return cached.result;
  }
  // Rows can be synthetic demo data when every live source failed. Compute the
  // indicators as usual so charts still draw, but never emit a tradable signal.
  const demoSuppressed = !!(state && state.isDemo);
  if (demoSuppressed) trackSignal = false;
  const threshold = cfg?.threshold ?? 5;
  const rrRatio = cfg?.riskRewardRatio ?? 2.0;
  const volumeMultiplier = cfg?.volumeMultiplier ?? 1.3;
  const volMedianMultiplier = cfg?.volatilityMedianMultiplier ?? 2.5;
  const rsiBuyThreshold = cfg?.rsiBuyThreshold ?? 55;
  const rsiSellThreshold = cfg?.rsiSellThreshold ?? 45;
  const regime = detectRegime(rows);
  const closes = rows.map((row) => row.close);
  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const macdData = macd(closes);
  const bands = bollinger(closes);
  const atr14 = atr(rows, 14);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const obvData = obv(rows);
  const merged = rows.map((row, i) => ({
    ...row,
    sma20: sma20[i],
    sma50: sma50[i],
    sma200: sma200[i],
    rsi: rsi14[i],
    macd: macdData.line[i],
    macdSignal: macdData.signal[i],
    macdHist: macdData.hist[i],
    bUpper: bands.upper[i],
    bLower: bands.lower[i],
    atr: atr14[i],
    ema9: ema9[i],
    ema21: ema21[i],
    obv: obvData[i],
  }));

  const last = merged.at(-1);
  const prev = merged.at(-2);
  const volatilityPct = (last.atr / last.close) * 100;
  const recentVols = merged.slice(-30).filter(r => r.atr != null).map(r => (r.atr / r.close) * 100);
  recentVols.sort((a,b) => a-b);
  const medianVol = recentVols.length > 0 ? recentVols[Math.floor(recentVols.length / 2)] : 1.5;
  const volatilityOk = volatilityPct < Math.max(medianVol * volMedianMultiplier, 0.3);
  const trendUp = last.sma20 > last.sma50 && last.close > last.sma50;
  const trendDown = last.sma20 < last.sma50 && last.close < last.sma50;
  const longTrendUp = last.sma200 != null && last.close > last.sma200;
  const longTrendDown = last.sma200 != null && last.close < last.sma200;
  const momentumUp = last.macd > last.macdSignal && last.macdHist > prev.macdHist;
  const momentumDown = last.macd < last.macdSignal && last.macdHist < prev.macdHist;
  const rsiBuyZone = last.rsi < rsiBuyThreshold;
  const rsiSellZone = last.rsi > rsiSellThreshold;
  const adxNow = regime.adx;
  const adxStrongNow = adxNow > 25;
  const extBuffer = adxStrongNow ? (Number.isFinite(last.atr) ? last.atr : 0) : 0;
  const notExtendedLong = last.bUpper == null || last.close < last.bUpper + extBuffer;
  const notExtendedShort = last.bLower == null || last.close > last.bLower - extBuffer;
  const priceRising = rows.length >= 5 && last.close > rows[rows.length - 5].close;
  const priceFalling = rows.length >= 5 && last.close < rows[rows.length - 5].close;
  const hasVolume = rows.some(r => Number.isFinite(r.volume) && r.volume > 0);
  const volSma = hasVolume ? sma(rows.map(r => r.volume), 20) : null;
  const volSurge = hasVolume && volSma && last.volume > volSma.at(-1) * volumeMultiplier;
  const recentCloses = closes.slice(-10);
  const recentRsis = rsi14.slice(-10).filter(v => v != null);
  const priceLowNow = Math.min(...recentCloses.slice(-5));
  const priceLowPrev = Math.min(...recentCloses.slice(0, 5));
  const priceHighNow = Math.max(...recentCloses.slice(-5));
  const priceHighPrev = Math.max(...recentCloses.slice(0, 5));
  const rsiLowNow = Math.min(...recentRsis.slice(-5));
  const rsiLowPrev = Math.min(...recentRsis.slice(0, 5));
  const rsiHighNow = Math.max(...recentRsis.slice(-5));
  const rsiHighPrev = Math.max(...recentRsis.slice(0, 5));
  const bullishDiv = priceLowNow < priceLowPrev && rsiLowNow > rsiLowPrev;
  const bearishDiv = priceHighNow > priceHighPrev && rsiHighNow < rsiHighPrev;

  const emaCrossUp = last.ema9 != null && last.ema21 != null && prev.ema9 != null && prev.ema21 != null && last.ema9 > last.ema21 && prev.ema9 <= prev.ema21;
  const emaCrossDown = last.ema9 != null && last.ema21 != null && prev.ema9 != null && prev.ema21 != null && last.ema9 < last.ema21 && prev.ema9 >= prev.ema21;
  const emaStackUp = last.ema9 != null && last.ema21 != null && last.ema9 > last.ema21;
  const emaStackDown = last.ema9 != null && last.ema21 != null && last.ema9 < last.ema21;

  const obvArr = merged.map(r => r.obv).filter(v => v != null);
  const obvOk = obvArr.length >= 20;
  const obvSma = obvOk ? sma(obvArr, 20) : null;
  const lastObv = obvOk ? obvArr[obvArr.length - 1] : null;
  const prevObv = obvOk ? obvArr[obvArr.length - 2] : null;
  const obvSmaLast = obvOk && obvSma ? obvSma[obvSma.length - 1] : null;
  const obvUp = obvOk && obvSmaLast != null && lastObv > obvSmaLast && lastObv > prevObv;
  const obvDown = obvOk && obvSmaLast != null && lastObv < obvSmaLast && lastObv < prevObv;

  const adx = adxNow;
  const adxStrong = adxStrongNow;

  const currBody = Math.abs(last.close - last.open);
  const currRange = last.high - last.low;
  const currUpperWick = last.high - Math.max(last.open, last.close);
  const currLowerWick = Math.min(last.open, last.close) - last.low;
  const currGreen = last.close > last.open;
  const currRed = last.close < last.open;
  const prevGreen = prev.close > prev.open;
  const prevRed = prev.close < prev.open;
  const bullishEngulfing = prevRed && currGreen && last.close > prev.open && last.open < prev.close;
  const bearishEngulfing = prevGreen && currRed && last.close < prev.open && last.open > prev.close;
  const isDoji = currRange > 0 && Math.abs(last.open - last.close) / currRange < 0.1;
  const hammer = currLowerWick > 2 * currBody && currUpperWick < currBody && currBody > 0;
  const shootingStar = currUpperWick > 2 * currBody && currLowerWick < currBody && currBody > 0;

  const weight = { trend: 25, long: 15, momentum: 20, rsi: 10, ema: 12, obv: 8, vol: 6, adx: 4 };

  let buyScore = 0, sellScore = 0;
  const buyPieces = [], sellPieces = [];
  const addBuy = (w, on, label) => { if (on) { buyScore += w; buyPieces.push(label); } };
  const addSell = (w, on, label) => { if (on) { sellScore += w; sellPieces.push(label); } };

  const rsiStrength = Math.min(1, Math.abs(50 - last.rsi) / 30);
  addBuy(weight.rsi, rsiBuyZone && rsiStrength > 0.2, "RSI in pullback zone");
  addSell(weight.rsi, rsiSellZone && rsiStrength > 0.2, "RSI in rally zone");
  addBuy(weight.momentum, momentumUp, "MACD momentum up");
  addSell(weight.momentum, momentumDown, "MACD momentum down");
  if (macdHistVote) { addBuy(weight.momentum, last.macdHist > 0 && last.macdHist > prev.macdHist, "MACD histogram rising"); addSell(weight.momentum, last.macdHist < 0 && last.macdHist < prev.macdHist, "MACD histogram falling"); }
  addBuy(weight.trend, trendUp, "SMA20>50 uptrend");
  addSell(weight.trend, trendDown, "SMA20<50 downtrend");
  addBuy(weight.long, longTrendUp, "Above long-term SMA200");
  addSell(weight.long, longTrendDown, "Below long-term SMA200");
  addBuy(weight.ema, emaStackUp ? 8 : 0, "EMA9>21 bullish alignment");
  addSell(weight.ema, emaStackDown ? 8 : 0, "EMA9<21 bearish alignment");
  if (emaCrossUp) { buyScore += 6; buyPieces.push("EMA 9/21 golden cross"); }
  if (emaCrossDown) { sellScore += 6; sellPieces.push("EMA 9/21 death cross"); }
  addBuy(weight.obv, obvUp, "OBV confirming inflows");
  addSell(weight.obv, obvDown, "OBV confirming outflows");
  addBuy(weight.vol, volatilityOk && !volSurge ? 3 : volSurge ? 6 : 0, volSurge ? "Volatility OK + volume surge" : "Volatility OK");
  addSell(weight.vol, volatilityOk && !volSurge ? 3 : volSurge ? 6 : 0, volSurge ? "Volatility OK + volume surge" : "Volatility OK");
  addBuy(weight.adx, adxStrong ? 4 : 0, adxStrong ? `Strong trend (ADX ${adx})` : `Weak/ranging (ADX ${adx})`);
  addSell(weight.adx, adxStrong ? 4 : 0, adxStrong ? `Strong trend (ADX ${adx})` : `Weak/ranging (ADX ${adx})`);
  if (bullishEngulfing) { buyScore += 6; buyPieces.push("Bullish engulfing"); }
  if (bearishEngulfing) { sellScore += 6; sellPieces.push("Bearish engulfing"); }
  if (hammer) { buyScore += 5; buyPieces.push("Hammer"); }
  if (shootingStar) { sellScore += 5; sellPieces.push("Shooting star"); }
  if (isDoji) { buyScore += 1; sellScore += 1; }

  const maxWeighted = weight.trend + weight.long + weight.momentum + weight.rsi + weight.ema + weight.obv + weight.vol + weight.adx + (macdHistVote ? weight.momentum : 0);
  const thresholdWeight = (threshold / 7) * maxWeighted;
  const rawConfidence = Math.round((Math.max(buyScore, sellScore) / maxWeighted) * 100);

  const key = sigKey || (state ? `${state.base}/${state.quote}` : "DEFAULT");
  const prevSig = trackSignal ? lastSignals.get(key) : undefined;
  let direction = "WAIT";
  const buyGate = buyScore >= thresholdWeight && buyScore > sellScore && notExtendedLong;
  const sellGate = sellScore >= thresholdWeight && sellScore > buyScore && notExtendedShort;
  if (buyGate && (!prevSig || prevSig.direction !== "SELL")) direction = "BUY";
  else if (sellGate && (!prevSig || prevSig.direction !== "BUY")) direction = "SELL";
  let decay = 0;
  if (prevSig && prevSig.direction === direction) decay = Math.min(6, prevSig.count * 2);
  if (trackSignal) {
    if (direction !== "WAIT") lastSignals.set(key, { direction, count: (prevSig && prevSig.direction === direction ? prevSig.count + 1 : 1) });
    else if (prevSig) lastSignals.set(key, { ...prevSig, count: 0 });
  }

  const divBonus = direction === "BUY" && bullishDiv ? 8 : direction === "SELL" && bearishDiv ? 8 : 0;
  const score = Math.max(buyScore, sellScore);
  const volBonus = volSurge ? 8 : 0;
  const adxBonus = adxStrong ? 6 : 0;
  const confidence = Math.min(100, Math.max(0, rawConfidence + volBonus + adxBonus + divBonus - decay));

  const adxTrendOk = !!(cfg?.adxGate ? adxStrong : true);
  const risk = direction === "WAIT" || confidence < 72 || !volatilityOk || !adxTrendOk ? "No trade" : "Low";

  const atrStop = Math.max(last.atr * 1.15, last.close * 0.004);
  const swingPivot = findSwingStop(rows, direction);
  let stopDistance = atrStop;
  if (direction === "BUY" && swingPivot != null) {
    const d = last.close - swingPivot;
    if (d > atrStop * 0.6 && d < last.close * 0.3) stopDistance = Math.max(d + last.close * 0.0015, atrStop * 0.8);
  } else if (direction === "SELL" && swingPivot != null) {
    const d = swingPivot - last.close;
    if (d > atrStop * 0.6 && d < last.close * 0.3) stopDistance = Math.max(d + last.close * 0.0015, atrStop * 0.8);
  }
  const targetDistance = stopDistance * rrRatio;
  const entry = last.close;
  const stop = direction === "BUY" ? entry - stopDistance : entry + stopDistance;
  const target = direction === "BUY" ? entry + targetDistance : entry - targetDistance;
  const trailingStop = direction === "WAIT" ? null : computeTrailingStop(direction, entry, last.close, stop, stopDistance, last.atr, cfg?.trailingAtrMult, cfg?.initialRrMult); 

  const reasons = [
    { ok: trendUp || trendDown, text: trendUp ? "Short-term trend supports buying" : trendDown ? "Short-term trend supports selling" : "Trend is mixed" },
    { ok: momentumUp || momentumDown, text: momentumUp ? "MACD momentum confirms upside" : momentumDown ? "MACD momentum confirms downside" : "MACD momentum is not confirmed" },
    { ok: rsiBuyZone || rsiSellZone, text: `RSI is ${last.rsi.toFixed(0)}${last.rsi < rsiBuyThreshold ? ", not overbought" : last.rsi > rsiSellThreshold ? ", not oversold" : ""}` },
    { ok: volatilityOk, text: volatilityOk ? "Volatility is acceptable for low-risk mode" : `Volatility ${volatilityPct.toFixed(2)}% exceeds pair's normal range` },
    { ok: regime.type === "trending", text: regime.type === "trending" ? `Market regime trending (ADX ${regime.adx})` : `Market regime ranging (ADX ${regime.adx})` },
    { ok: emaStackUp || emaStackDown, text: emaStackUp ? "EMA 9>21 bullish alignment" : emaStackDown ? "EMA 9<21 bearish alignment" : "EMA alignment is flat" },
    { ok: obvUp || obvDown, text: obvUp ? "OBV rising — accumulation" : obvDown ? "OBV falling — distribution" : "OBV neutral" },
    { ok: volSurge, text: volSurge ? "Above-average volume confirms the move" : "Volume does not confirm unusual activity" },
    { ok: bullishDiv || bearishDiv, text: bullishDiv ? "Bullish RSI divergence detected — momentum building" : bearishDiv ? "Bearish RSI divergence detected — momentum fading" : "No RSI divergence pattern" },
    ...(bullishEngulfing ? [{ ok: true, text: "Bullish engulfing pattern detected" }] : []),
    ...(bearishEngulfing ? [{ ok: true, text: "Bearish engulfing pattern detected" }] : []),
    ...(isDoji ? [{ ok: false, text: "Doji pattern — indecision" }] : []),
    ...(hammer ? [{ ok: true, text: "Hammer pattern — potential reversal up" }] : []),
    ...(shootingStar ? [{ ok: true, text: "Shooting star — potential reversal down" }] : []),
  ];
  const outDirection = demoSuppressed ? "WAIT" : direction;
  const outConfidence = demoSuppressed ? 0 : confidence;
  const result = { chartRows: merged.slice(-140), last, direction: outDirection, confidence: outConfidence, risk: demoSuppressed ? "No trade (demo data)" : risk, entry, stop, target, trailingStop, reasons: demoSuppressed ? [...reasons, { ok: false, text: "Live market data could not be reached — signal suppressed, the chart below is simulated demo data and must not be traded." }] : reasons, buyScore, sellScore, volatilityPct, regime, adx, swingPivot, buyPieces, sellPieces, pullbackEntry: computePullbackEntry(outDirection, last.close, last.ema21 || entry, entry, stop), ml: mlModel.trained && !demoSuppressed ? mlPredict([outConfidence / 100, Math.max(buyScore, sellScore) / 100, Math.max(-1, Math.min(1, (buyScore - sellScore) / 100)), Math.max(0, Math.min(20, volatilityPct)) / 10, outDirection === "BUY" ? 1 : 0]) : null };
  if (memoKey) analyzeMemo.set(rows, { key: memoKey, result });
  return result;
}

function computePullbackEntry(direction, price, ema21, entry, stop) {
  if (direction === "BUY" && ema21 < price && price - ema21 > 0) {
    return Math.max(ema21, entry * 0.995);
  }
  if (direction === "SELL" && ema21 > price && ema21 - price > 0) {
    return Math.min(ema21, entry * 1.005);
  }
  return null;
}

function formatPrice(value, pair) {
  if (!Number.isFinite(value)) return "-";
  const digits = pair.includes("JPY") ? 3 : pair.includes("XAU") || nonFiat.has(pair.split("/")[0]) ? 2 : 5;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  }).format(value);
}

function options(selected, exclude, disableNonFiat = false) {
  return currencies
    .filter((currency) => currency !== exclude)
    .map((currency) => `<option value="${currency}" ${currency === selected ? "selected" : ""} ${disableNonFiat && nonFiat.has(currency) ? "disabled" : ""}>${currency}</option>`)
    .join("");
}

function getCurrentSession() {
  var now = new Date();
  var utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  var utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  var sessions = [];
  if (utcH >= 0 && utcH < 9) sessions.push({ name: "Tokyo", color: "#b58cff", start: 0, end: 540 });
  if (utcH >= 8 && utcH < 16) sessions.push({ name: "London", color: "#3fb950", start: 480, end: 960 });
  if (utcH >= 13 && utcH < 21) sessions.push({ name: "New York", color: "#8dd7ff", start: 780, end: 1260 });
  var volatility = "Low";
  if (sessions.length >= 2) volatility = "High";
  else if (sessions.length === 1) volatility = "Medium";
  var nextSession = "";
  var allSessions = [
    { name: "Tokyo", start: 0 }, { name: "London", start: 480 }, { name: "New York", start: 780 }
  ];
  for (var i = 0; i < allSessions.length; i++) {
    if (utcMin < allSessions[i].start) { nextSession = allSessions[i].name + " in " + (allSessions[i].start - utcMin) + "m"; break; }
  }
  if (!nextSession) nextSession = "Tokyo in " + ((1440 - utcMin) + allSessions[0].start) + "m";
  return { sessions: sessions, volatility: volatility, utcH: utcH, nextSession: nextSession, timeStr: now.toUTCString().slice(17, 22) };
}


function renderSessionBar() {
  const s = getCurrentSession();
  const tokyoActive = s.utcH >= 0 && s.utcH < 9;
  const londonActive = s.utcH >= 8 && s.utcH < 16;
  const nyActive = s.utcH >= 13 && s.utcH < 21;
  const volClass = s.volatility === "High" ? "vol-high" : s.volatility === "Medium" ? "vol-medium" : "vol-low";
  return '<div class="session-bar"><span class="session-label">Sessions</span><div class="session-seg ' + (tokyoActive ? 'active' : 'inactive') + '" style="background:var(--wait-soft)"><span class="dot" style="background:var(--wait)"></span>Tokyo</div><div class="session-seg ' + (londonActive ? 'active' : 'inactive') + '" style="background:var(--buy-soft)"><span class="dot" style="background:var(--buy)"></span>London</div><div class="session-seg ' + (nyActive ? 'active' : 'inactive') + '" style="background:var(--accent-soft)"><span class="dot" style="background:var(--accent)"></span>New York</div><span class="session-vol ' + volClass + '">Vol: ' + s.volatility + '</span><span style="font-size:.58rem;color:var(--muted-2);margin-left:6px">' + s.nextSession + '</span><span style="font-size:.6rem;color:var(--muted-3);margin-left:auto">' + s.timeStr + ' UTC</span></div>';
}


function renderHeatmap() {
  const pairs = scanPairs;
  if (pairs.length === 0) return '';
  const cells = pairs.map(function(p) {
    const r = multiScan.results[p];
    if (!r || r.loading) return '<div class="heatmap-cell" style="background:var(--panel-hover);color:var(--muted-3)">' + p.split('/')[0] + '<br>...</div>';
    var conf = r.confidence || 0;
    var bg, fg;
    if (r.direction === 'BUY') { bg = 'rgba(63,185,80,' + Math.min(conf / 100, 0.6) + ')'; fg = '#3fb950'; }
    else if (r.direction === 'SELL') { bg = 'rgba(248,81,73,' + Math.min(conf / 100, 0.6) + ')'; fg = '#f85149'; }
    else { bg = 'rgba(181,140,255,.1)'; fg = '#b58cff'; }
    var chg = r.change != null ? (r.change >= 0 ? '+' : '') + r.change.toFixed(1) + '%' : '';
    return '<div class="heatmap-cell" style="background:' + bg + ';color:' + fg + '" data-heatmap="' + p + '" title="' + p + ': ' + r.direction + ' ' + conf + '%">' + p.split('/')[0] + '<div style="font-size:.55rem;font-weight:400;opacity:.7">' + chg + '</div></div>';
  }).join('');
  return '<section class="dashboard-section"><button class="backtest-toggle no-select" id="heatmapToggle"><div class="history-toggle-left"><h3>Portfolio Heatmap</h3></div><span class="arrow">\u25BE</span></button><div class="history-body" id="heatmapBody"><div class="heatmap-grid">' + cells + '</div></div></section>';
}


function renderDrawdownChart() {
  var sigs = autoScan.history.filter(function(e) { return e.result === 'win' || e.result === 'loss'; });
  if (sigs.length < 3) return '';
  var cum = 0, peak = 0;
  var ddSeries = sigs.map(function(s) {
    cum += s.result === 'win' ? 1 : -1;
    if (cum > peak) peak = cum;
    return peak - cum;
  });
  var maxDD = Math.max.apply(null, ddSeries.concat([1]));
  var w = 480, h = 60;
  var xs = ddSeries.length > 1 ? w / (ddSeries.length - 1) : w;
  var pts = ddSeries.map(function(v, i) { return (i * xs) + ',' + ((v / maxDD) * (h - 4)); }).join(' ');
  var fillPts = pts + ' ' + w + ',' + h + ' 0,' + h;
  var finalDD = ddSeries[ddSeries.length - 1];
  return '<section class="dashboard-section"><button class="backtest-toggle no-select" id="ddToggle"><div class="history-toggle-left"><h3>Drawdown Tracker</h3><span class="history-count" style="background:' + (finalDD > 0 ? 'var(--sell-bg)' : 'var(--buy-bg)') + ';color:' + (finalDD > 0 ? 'var(--sell)' : 'var(--buy)') + '">Max: -' + maxDD + '</span></div><span class="arrow">\u25BE</span></button><div class="history-body" id="ddBody"><div style="padding:8px 12px"><div class="drawdown-chart"><svg width="100%" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="display:block"><polygon points="' + fillPts + '" fill="rgba(248,81,73,0.15)"/><polyline points="' + pts + '" fill="none" stroke="#f85149" stroke-width="1.5"/></svg></div><div style="display:flex;justify-content:space-between;font-size:.6rem;color:var(--muted-3);margin-top:4px"><span>Start</span><span>Max DD: -' + maxDD + '</span><span>Current: -' + finalDD + '</span><span>Now</span></div></div></div></section>';
}


function checkPriceLevelAlerts() {
  if (priceLevelAlerts.length === 0) return;
  var toRemove = [];
  priceLevelAlerts.forEach(function(alert, idx) {
    var r = multiScan.results[alert.pair];
    if (!r || !r.price) return;
    var price = r.price;
    var triggered = false;
    if (alert.dir === 'above' && price >= alert.price) triggered = true;
    if (alert.dir === 'below' && price <= alert.price) triggered = true;
    if (triggered) {
      alertHistory.push({ timestamp: new Date().toISOString(), pair: alert.pair, type: 'price_level', message: alert.pair + ' hit ' + formatPrice(alert.price, alert.pair) + ' (' + alert.dir + ')' });
      saveAlertHistory();
      toRemove.push(idx);
      playBeep();
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(alert.pair + ' price alert', { body: alert.dir + ' ' + formatPrice(alert.price, alert.pair), silent: false });
      }
    }
  });
  if (toRemove.length > 0) {
    priceLevelAlerts = priceLevelAlerts.filter(function(_, i) { return toRemove.indexOf(i) === -1; });
    savePriceLevelAlerts();
    render();
  }
}


// The old ForexFactory mirror (nfs.faireconomy.media) never sent an
// Access-Control-Allow-Origin header, so a browser fetch from GitHub Pages was
// always blocked. Biquote exposes the same public calendar as CORS-enabled JSON
// and accepts a date window, so the request stays small.
var ECON_CALENDAR_BASE = 'https://biquote.io/api/calendar';

function econCalendarUrl(nowMs) {
  var now = Number.isFinite(nowMs) ? nowMs : Date.now();
  var from = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  var to = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return ECON_CALENDAR_BASE + '?from=' + from + '&to=' + to;
}

function econImpact(raw) {
  var value = String(raw == null ? '' : raw).toLowerCase();
  if (value === 'high') return 'high';
  if (value === 'medium' || value === 'med') return 'med';
  return null;
}

function econClock(iso) {
  var when = new Date(String(iso == null ? '' : iso));
  if (isNaN(when.getTime())) return { time: 'TBD', at: NaN };
  return {
    time: String(when.getUTCHours()).padStart(2, '0') + ':' + String(when.getUTCMinutes()).padStart(2, '0'),
    at: when.getTime(),
  };
}

function mapEconEvents(data) {
  if (!Array.isArray(data)) return [];
  return data.map(function(e) {
    if (!e || typeof e !== 'object') return null;
    var impact = econImpact(e.importance);
    if (!impact) return null;
    var clock = econClock(e.time);
    return {
      time: clock.time,
      at: clock.at,
      country: e.countryCode || e.country || '',
      name: e.name || e.eventName || e.title || 'Unknown',
      impact: impact,
      currency: e.currency || '',
    };
  }).filter(Boolean).sort(function(a, b) {
    var av = Number.isFinite(a.at) ? a.at : Number.MAX_SAFE_INTEGER;
    var bv = Number.isFinite(b.at) ? b.at : Number.MAX_SAFE_INTEGER;
    return av - bv;
  });
}

var econEvents = [];
async function fetchEconEvents() {
  try {
    const result = await cachedJson(econCalendarUrl(), {
      ttl: MARKET_TTL.econ,
      key: 'econ:biquote',
      provider: 'econ',
      swr: true,
    });
    var mapped = mapEconEvents(result.data);
    if (mapped.length > 0) {
      econEvents = mapped;
      // The bootstrap render used fallback rows; refresh once live data lands.
      scheduleRender();
    }
  } catch {}
}
function renderEconCalendar() {
  var events = econEvents.length > 0 ? econEvents : [
    { time: '08:30', country: 'US', name: 'US GDP (QoQ)', impact: 'high', currency: 'USD' },
    { time: '10:00', country: 'EU', name: 'ECB Interest Rate', impact: 'high', currency: 'EUR' },
    { time: '13:30', country: 'US', name: 'US Non-Farm Payrolls', impact: 'high', currency: 'USD' },
    { time: '14:00', country: 'UK', name: 'UK CPI (YoY)', impact: 'med', currency: 'GBP' },
    { time: '01:30', country: 'JP', name: 'Japan CPI (YoY)', impact: 'med', currency: 'JPY' },
    { time: '15:00', country: 'US', name: 'US Consumer Confidence', impact: 'med', currency: 'USD' },
    { time: '07:00', country: 'DE', name: 'German IFO Climate', impact: 'low', currency: 'EUR' },
    { time: '19:00', country: 'AU', name: 'AU Employment Change', impact: 'med', currency: 'AUD' },
  ];
  var now = new Date();
  var nowMs = now.getTime();
  var upcoming = events.filter(function(e) {
    // Live rows carry an absolute timestamp, so a later day is not dropped just
    // because its clock time is earlier than right now. Fallback rows are
    // illustrative and have no date, so they always stay visible.
    if (!Number.isFinite(e.at)) return true;
    return e.at >= nowMs - 60 * 60 * 1000;
  }).slice(0, 8);
  if (upcoming.length === 0) return '';
  var isLive = econEvents.length > 0;
  return '<section class="dashboard-section"><button class="backtest-toggle no-select" id="econToggle"><div class="history-toggle-left"><h3>Economic Calendar</h3><span class="history-count">' + upcoming.length + (isLive ? ' live' : '') + '</span></div><span class="arrow">\u25BE</span></button><div class="history-body" id="econBody"><div style="padding:4px 0">' + upcoming.map(function(e) { return '<div class="econ-row"><span class="econ-time">' + escapeHtml(e.time) + '</span><span class="econ-flag">' + escapeHtml(e.country || '') + '</span><span class="econ-name">' + escapeHtml(e.name) + '<span style="font-size:.58rem;color:var(--muted-3);margin-left:4px">' + escapeHtml(e.currency || '') + '</span></span><span class="econ-impact ' + escapeHtml(e.impact) + '"></span></div>'; }).join('') + '</div><div style="padding:4px 12px;font-size:.6rem;color:var(--muted-3)">' + (isLive ? 'Data from Biquote. ' : 'Fallback data. ') + 'High-impact events may increase volatility.</div></div></section>';
}

function toggleOverlay(name) {
  if (name === "ichimoku") ichimokuOverlay = !ichimokuOverlay;
  else if (name === "fib") fibOverlay = !fibOverlay;
  else if (name === "macd") macdHistVote = !macdHistVote;
  else if (name === "vwap") vwapOverlay = !vwapOverlay;
  else if (name === "ml") mlFilterEnabled = !mlFilterEnabled;
  else return;
  saveOverlayPrefs();
  render();
}

