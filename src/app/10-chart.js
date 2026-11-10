const chartMemo = new WeakMap();
function chartMemoKey(rows, pair, tf, overlays, width, height, dpr) {
  const last = rows && rows.length ? rows[rows.length - 1] : null;
  return [pair, tf, rows ? rows.length : 0, last ? (last.time || last.date || "") : "", last ? last.open : "", last ? last.high : "", last ? last.low : "", last ? last.close : "", last ? last.volume : "", overlays.ichimoku ? 1 : 0, overlays.fib ? 1 : 0, overlays.vwap ? 1 : 0, Math.round(width), Math.round(height), dpr].join("|");
}

function chartSummary(rows, pair, tf) {
  if (!rows || rows.length === 0) return `${pair} ${tf} price chart: no data available.`;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const highs = rows.map((r) => r.high).filter(Number.isFinite);
  const lows = rows.map((r) => r.low).filter(Number.isFinite);
  const changePct = Number.isFinite(first.close) && first.close !== 0 && Number.isFinite(last.close)
    ? ((last.close - first.close) / first.close) * 100
    : null;
  const trend = changePct == null
    ? "change unavailable"
    : changePct >= 0 ? `up ${changePct.toFixed(2)}%` : `down ${Math.abs(changePct).toFixed(2)}%`;
  const range = highs.length > 0 && lows.length > 0
    ? ` High ${formatPrice(Math.max(...highs), pair)}, low ${formatPrice(Math.min(...lows), pair)}.`
    : "";
  const lastText = Number.isFinite(last.close) ? formatPrice(last.close, pair) : "unavailable";
  return `${pair} ${tf} price chart with ${rows.length} candles, ${trend} over the period. Last close ${lastText}.${range}`;
}

function drawChart(canvas, rows, pair, tf) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height || 460;
  const memoKey = chartMemoKey(rows, pair, tf, { ichimoku: ichimokuOverlay, fib: fibOverlay, vwap: vwapOverlay }, width, height, dpr);
  if (chartMemo.get(canvas) === memoKey) return;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  const pad = { left: 62, right: 18, top: 18, bottom: 60 };
  const values = rows.flatMap((row) => [row.close, row.sma20, row.sma50, row.bUpper, row.bLower]).filter(Number.isFinite);
  let min = Infinity, max = -Infinity;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
  const y = (value) => pad.top + ((max - value) / (max - min || 1)) * (height - pad.top - pad.bottom);
  const x = (index) => pad.left + (index / (rows.length - 1 || 1)) * (width - pad.left - pad.right);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#10171f";
  ctx.fillRect(0, 0, width, height);

  const vols = rows.map(r => r.volume).filter(v => Number.isFinite(v) && v > 0);
  let volMax = 1;
  if (vols.length > 0) { volMax = -Infinity; for (const v of vols) if (v > volMax) volMax = v; }
  const volH = 28;
  if (vols.length > 1) {
    rows.forEach((row, i) => {
      if (!Number.isFinite(row.volume) || row.volume <= 0) return;
      const vw = Math.max(1, (width - pad.left - pad.right) / rows.length - 1);
      const vx = x(i) - vw / 2;
      const vh = (row.volume / volMax) * volH;
      ctx.fillStyle = row.close >= row.open ? "#3fb950" : "#f85149";
      ctx.fillRect(vx, height - pad.bottom - vh + 4, vw, vh);
    });
    ctx.fillStyle = "#5a6a7a";
    ctx.font = "10px Inter, sans-serif";
    ctx.fillText("Volume", pad.left + 2, height - pad.bottom + 24);
  }

  ctx.strokeStyle = "#26313d";
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const yy = pad.top + (i / 4) * (height - pad.top - pad.bottom);
    ctx.beginPath();
    ctx.moveTo(pad.left, yy);
    ctx.lineTo(width - pad.right, yy);
    ctx.stroke();
    const label = max - (i / 4) * (max - min);
    ctx.fillStyle = "#8c98a5";
    ctx.font = "12px Inter, sans-serif";
    ctx.fillText(formatPrice(label, pair), 8, yy + 4);
  }
  drawLine(ctx, rows, x, y, "bUpper", "#394757", 1);
  drawLine(ctx, rows, x, y, "bLower", "#394757", 1);
  const swingLevels = findSwingLevels(rows, 80);
  swingLevels.forEach(level => {
    const yy = y(level.price);
    if (yy < pad.top || yy > height - pad.bottom) return;
    ctx.strokeStyle = level.type === "support" ? "rgba(63,185,80,0.35)" : "rgba(248,81,73,0.35)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = level.type === "support" ? "rgba(63,185,80,0.6)" : "rgba(248,81,73,0.6)";
    ctx.font = "9px Inter, sans-serif";
    ctx.fillText(level.type === "support" ? "S" : "R", width - pad.right - 12, yy - 3);
  });
  if (fibOverlay) {
    const fibs = findFibLevels(rows, Math.min(rows.length, 120));
    fibs.forEach(fib => {
      const yy = y(fib.price);
      if (yy < pad.top || yy > height - pad.bottom) return;
      ctx.strokeStyle = "rgba(181,140,255,0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(181,140,255,0.7)";
      ctx.font = "8px Inter, sans-serif";
      ctx.fillText("FIB " + fib.label, pad.left + 2, yy - 3);
    });
  }
  if (vwapOverlay) {
    let cumVol = 0, cumTP = 0;
    const vwapPts = [];
    for (let vi = 0; vi < rows.length; vi++) {
      const tp = (rows[vi].high + rows[vi].low + rows[vi].close) / 3;
      cumTP += tp * rows[vi].volume;
      cumVol += rows[vi].volume;
      const vwap = cumVol > 0 ? cumTP / cumVol : tp;
      const vIdx = Math.round(x(vi));
      const vY = Math.round(y(vwap));
      vwapPts.push(`${vIdx},${Math.max(pad.top, Math.min(height - pad.bottom, vY))}`);
    }
    if (vwapPts.length > 1) {
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      const f = vwapPts[0].split(',');
      ctx.moveTo(Number(f[0]), Number(f[1]));
      for (let vi2 = 1; vi2 < vwapPts.length; vi2++) {
        const pt = vwapPts[vi2].split(',');
        ctx.lineTo(Number(pt[0]), Number(pt[1]));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ff9800';
      ctx.font = '8px Inter, sans-serif';
      const lp = vwapPts[vwapPts.length - 1].split(',');
      ctx.fillText('VWAP', Number(lp[0]) - 24, Number(lp[1]) - 3);
    }
  }
  if (ichimokuOverlay && rows.length >= 78) {
    const ichi = computeIchimoku(rows);
    const cloudColors = [];
    for (let i = 0; i < rows.length; i++) {
      if (ichi.senkouA[i] != null && ichi.senkouB[i] != null) {
        cloudColors.push(ichi.senkouA[i] > ichi.senkouB[i] ? "rgba(63,185,80,0.1)" : "rgba(248,81,73,0.1)");
      } else cloudColors.push(null);
    }
    for (let i = 1; i < rows.length; i++) {
      if (cloudColors[i] && cloudColors[i - 1]) {
        const cx0 = x(i - 1), cx1 = x(i);
        const aA0 = y(ichi.senkouA[i - 1]), aA1 = y(ichi.senkouA[i]);
        const aB0 = y(ichi.senkouB[i - 1]), aB1 = y(ichi.senkouB[i]);
        ctx.fillStyle = cloudColors[i];
        ctx.beginPath();
        ctx.moveTo(cx0, aA0); ctx.lineTo(cx1, aA1); ctx.lineTo(cx1, aB1); ctx.lineTo(cx0, aB0);
        ctx.closePath(); ctx.fill();
      }
    }
    drawLine(ctx, rows.map((r, i) => ({...r, tenkan: ichi.tenkan[i]})), x, (v) => y(v), "tenkan", "rgba(240,195,90,0.6)", 1);
    drawLine(ctx, rows.map((r, i) => ({...r, kijun: ichi.kijun[i]})), x, (v) => y(v), "kijun", "rgba(141,215,255,0.6)", 1);
  }
  drawLine(ctx, rows, x, y, "sma50", "#b58cff", 1.6);
  drawLine(ctx, rows, x, y, "sma20", "#f0c35a", 1.6);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].sma20 == null || rows[i].sma50 == null || rows[i-1].sma20 == null || rows[i-1].sma50 == null) continue;
    const prevDiff = rows[i-1].sma20 - rows[i-1].sma50;
    const currDiff = rows[i].sma20 - rows[i].sma50;
    if (prevDiff <= 0 && currDiff > 0) {
      const cx2 = x(i);
      const cy2 = y(rows[i].sma20);
      ctx.beginPath();
      ctx.moveTo(cx2, cy2 - 5);
      ctx.lineTo(cx2 - 4, cy2 + 2);
      ctx.lineTo(cx2 + 4, cy2 + 2);
      ctx.closePath();
      ctx.fillStyle = "#3fb950";
      ctx.fill();
    } else if (prevDiff >= 0 && currDiff < 0) {
      const cx2 = x(i);
      const cy2 = y(rows[i].sma20);
      ctx.beginPath();
      ctx.moveTo(cx2, cy2 + 5);
      ctx.lineTo(cx2 - 4, cy2 - 2);
      ctx.lineTo(cx2 + 4, cy2 - 2);
      ctx.closePath();
      ctx.fillStyle = "#f85149";
      ctx.fill();
    }
  }
  drawLine(ctx, rows, x, y, "close", "#8dd7ff", 2.6);
  ctx.fillStyle = "#8c98a5";
  ctx.fillText(formatAxisDate(rows[0], tf), pad.left, height - 10);
  ctx.fillText(formatAxisDate(rows.at(-1), tf), width - pad.right - 78, height - 10);
  const summary = chartSummary(rows, pair, tf);
  const summaryEl = typeof document !== "undefined" && document.getElementById ? document.getElementById("chartSummary") : null;
  if (summaryEl) summaryEl.textContent = summary;
  else if (typeof canvas.setAttribute === "function") canvas.setAttribute("aria-label", summary);
  chartMemo.set(canvas, memoKey);
}

function formatAxisDate(row, tf) {
  if (!row) return "";
  if (isScalpTf(tf) && row.time) {
    try { return new Date(row.time).toISOString().slice(11, 16); } catch { return row.date; }
  }
  return row.date;
}

function drawLine(ctx, rows, x, y, key, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  let started = false;
  rows.forEach((row, index) => {
    if (!Number.isFinite(row[key])) return;
    if (!started) {
      ctx.moveTo(x(index), y(row[key]));
      started = true;
    } else {
      ctx.lineTo(x(index), y(row[key]));
    }
  });
  ctx.stroke();
}

function findSwingLevels(rows, lookback = 80) {
  const levels = [];
  const slice = rows.slice(-lookback);
  for (let i = 2; i < slice.length - 2; i++) {
    if (slice[i].high > slice[i-1].high && slice[i].high > slice[i-2].high &&
        slice[i].high > slice[i+1].high && slice[i].high > slice[i+2].high) {
      levels.push({ price: slice[i].high, type: "resistance" });
    }
    if (slice[i].low < slice[i-1].low && slice[i].low < slice[i-2].low &&
        slice[i].low < slice[i+1].low && slice[i].low < slice[i+2].low) {
      levels.push({ price: slice[i].low, type: "support" });
    }
  }
  const grouped = [];
  if (levels.length === 0) return grouped;
  const threshold = (Math.max(...levels.map(l => l.price)) - Math.min(...levels.map(l => l.price))) * 0.02;
  for (const level of levels) {
    const close = grouped.find(g => Math.abs(g.price - level.price) / g.price < threshold);
    if (close) { close.count++; close.price = (close.price + level.price) / 2; } else { grouped.push({ ...level, count: 1 }); }
  }
  return grouped.filter(g => g.count >= 2).sort((a,b) => a.price - b.price).slice(-6);
}

function redrawChart() {
  const canvas = document.getElementById("priceChart");
  const analysis = state.rows.length > 0 ? analyze(state.rows, loadStrategyConfig()) : null;
  if (canvas && analysis) {
    drawChart(canvas, analysis.chartRows, `${state.base}/${state.quote}`, state.timeframe);
  }
}

