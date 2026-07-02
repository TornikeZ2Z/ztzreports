/* GO page: YoY Diff — year-over-year comparison of the core closing measures.
   Global filter bar supplies all slicers (multi-select + date range + day between).
   NOTE: the PBI original (GO-15) pivots "Ads Analysis - ROI" by Source × Year; those
   measures need advertisement-expense data not present in any RS dataset, so this
   page delivers the YoY comparison over the core Calculations measures instead. */
registerPage({
  id: "yoy-diff",
  group: "overview",
  ico: "📆",
  title: "YoY Diff",
  async render(host) {
    const rows = RS.filtered("closing", await RS.load("closing"));
    const M = RS.M;

    // ---- pre-aggregate once: rows by year and by year×month (fast on 100k+ rows)
    const byYear = {}, byYM = {};
    rows.forEach(r => {
      if (!/^\d{4}$/.test(r._y)) return;
      (byYear[r._y] = byYear[r._y] || []).push(r);
      ((byYM[r._y] = byYM[r._y] || {})[r._m] = byYM[r._y][r._m] || []).push(r);
    });
    const years = Object.keys(byYear).sort();
    const growthTxt = g => g == null ? "—" : (g >= 0 ? "▲ " : "▼ ") + RS.fmtPct(Math.abs(g));

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>YoY Diff</h1>
        <p>Year-over-year comparison of core measures · <b>${RS.fmtN(rows.length)}</b> jobs in scope
           <span class="freshness">· ${years.length ? years[0] + "–" + years[years.length - 1] : "no data"} in filter</span></p>
      </div>
      <div class="rs-kpis" id="kpis"></div>
      <div id="yearly"></div>
      <div id="monthly"></div>`;

    // ---- KPI strip: current value + YoY growth.
    // Date range set → RS.yoy (DATEADD -1y window). No range → two most recent calendar years.
    const KPI = ["Total Jobs", "Total Bill", "Net Cash", "Card Payment"];
    const hasRange = !!(RS.state.dateFrom || RS.state.dateTo);
    let kpiItems;
    if (hasRange) {
      kpiItems = await Promise.all(KPI.map(async name => {
        const r = await RS.yoy(name);
        return { label: name, value: M[name].fmt(r.cur),
          sub: r.growth == null ? "no LY data in range"
             : `${growthTxt(r.growth)} vs same period LY (${M[name].fmt(r.prev)})` };
      }));
    } else {
      const cy = years[years.length - 1], py = years[years.length - 2];
      kpiItems = KPI.map(name => {
        const m = M[name];
        const cur = cy ? m.fn(byYear[cy]) : null, prev = py ? m.fn(byYear[py]) : null;
        // inline: PBI "<measure> Yearly Growth Rate" pattern — not in RS.M registry
        const g = (prev && cur != null) ? (cur - prev) / Math.abs(prev) : null;
        return { label: name, value: m.fmt(m.fn(rows)),
          sub: g == null ? "single year in scope"
             : `${growthTxt(g)} · ${cy} vs ${py} (${m.fmt(prev)})` };
      });
    }
    RSC.kpis(document.getElementById("kpis"), kpiItems);

    // ---- shared Calculate-by (drives both charts, like the PBI field parameter)
    const CALC = ["Total Jobs", "Total Bill", "Net Cash", "Card Payment",
                  "Net Cash + Card Payment", "Hours Worked by Forman"];
    let calcBy = CALC[1];
    const perYear = name => years.map(y => M[name].fn(byYear[y]));

    // ---- chart 1: yearly comparison — measure bars by year + YoY growth % line
    const yearCard = RSC.chartCard(document.getElementById("yearly"), {
      title: "Yearly comparison",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="yoyCalcBy">` +
        CALC.map(c => `<option ${c === calcBy ? "selected" : ""}>${c}</option>`).join("") + `</select>`,
      buildChart(canvas) {
        const m = M[calcBy], vals = perYear(calcBy);
        // inline: PBI "Yearly Growth Rate" — growth vs prior year, not in RS.M registry
        const growth = vals.map((v, i) => (i > 0 && vals[i - 1]) ? (v - vals[i - 1]) / Math.abs(vals[i - 1]) : null);
        const isMoney = m.fmt === RS.money;
        return new Chart(canvas, {
          data: {
            labels: years,
            datasets: [
              { type: "bar", label: calcBy, data: vals.map(v => Math.round(v)),
                backgroundColor: "#9ABA3C", borderRadius: 4, yAxisID: "y", order: 2 },
              { type: "line", label: "YoY growth %", data: growth.map(g => g == null ? null : +(100 * g).toFixed(1)),
                borderColor: "#3f62d8", backgroundColor: "#3f62d8", borderWidth: 2,
                pointRadius: 3, tension: .3, spanGaps: false, yAxisID: "y1", order: 1 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => c.dataset.yAxisID === "y"
                ? `${calcBy}: ${m.fmt(c.raw)}` : `YoY: ${c.raw == null ? "—" : c.raw + "%"}` } } },
            scales: {
              y: { position: "left", title: { display: true, text: calcBy },
                   ticks: { callback: v => isMoney ? "$" + (v / 1000) + "k" : RS.fmtN(v) } },
              y1: { position: "right", title: { display: true, text: "YoY growth %" },
                    grid: { drawOnChartArea: false }, ticks: { callback: v => v + "%" } },
              x: { ticks: { font: { size: 12 } } },
            },
          },
        });
      },
      buildTable() {
        const sel = perYear(calcBy);
        const data = years.map((y, i) => ({
          y, jobs: M["Total Jobs"].fn(byYear[y]), bill: M["Total Bill"].fn(byYear[y]),
          net: M["Net Cash"].fn(byYear[y]), card: M["Card Payment"].fn(byYear[y]),
          nc: M["Net Cash + Card Payment"].fn(byYear[y]), hrs: M["Hours Worked by Forman"].fn(byYear[y]),
          g: (i > 0 && sel[i - 1]) ? (sel[i] - sel[i - 1]) / Math.abs(sel[i - 1]) : null,
        }));
        const tot = k => data.reduce((a, x) => a + (x[k] || 0), 0);
        return RSC.table(
          [{ key: "y", label: "Year" }, { key: "jobs", label: "Total Jobs", fmt: RS.fmtN },
           { key: "bill", label: "Total Bill", fmt: RS.money }, { key: "net", label: "Net Cash", fmt: RS.money },
           { key: "card", label: "Card Payment", fmt: RS.money }, { key: "nc", label: "Net + Card", fmt: RS.money },
           { key: "hrs", label: "Hours", fmt: RS.fmtN },
           { key: "g", label: `YoY % (${calcBy})`, fmt: growthTxt }],
          data,
          { y: "Total", jobs: tot("jobs"), bill: tot("bill"), net: tot("net"),
            card: tot("card"), nc: tot("nc"), hrs: tot("hrs") });
      },
    });

    // ---- chart 2: monthly trend — one line per year (last 3 in scope), Jan..Dec
    const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const trendYears = () => years.slice(-3);
    const LINE = [  // oldest → latest; latest year emphasised in brand blue
      { color: "#98a2b3", width: 2, dash: [5, 3] },
      { color: "#9ABA3C", width: 2, dash: [] },
      { color: "#3f62d8", width: 2.5, dash: [] },
    ];
    const monthCard = RSC.chartCard(document.getElementById("monthly"), {
      title: "Monthly trend (last 3 years)",
      buildChart(canvas) {
        const m = M[calcBy], ys = trendYears();
        const isMoney = m.fmt === RS.money;
        const datasets = ys.map((y, i) => {
          const st = LINE[LINE.length - ys.length + i];
          return { type: "line", label: y,
            data: MONTHS.map(mo => (byYM[y] && byYM[y][mo]) ? Math.round(m.fn(byYM[y][mo])) : null),
            borderColor: st.color, backgroundColor: st.color, borderDash: st.dash,
            borderWidth: st.width, pointRadius: 2.5, tension: .3, spanGaps: false };
        });
        return new Chart(canvas, {
          data: { labels: MONTHS.map(RS.monthName), datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.raw == null ? "—" : m.fmt(c.raw)}` } } },
            scales: {
              y: { title: { display: true, text: calcBy },
                   ticks: { callback: v => isMoney ? "$" + (v / 1000) + "k" : RS.fmtN(v) } },
              x: { ticks: { font: { size: 12 } } },
            },
          },
        });
      },
      buildTable() {
        const m = M[calcBy], ys = trendYears();
        const safe = v => v == null ? "—" : m.fmt(v);
        const data = MONTHS.map(mo => {
          const r = { m: RS.monthName(mo) };
          ys.forEach(y => r[y] = (byYM[y] && byYM[y][mo]) ? m.fn(byYM[y][mo]) : null);
          return r;
        });
        const totals = { m: "Total" };
        ys.forEach(y => totals[y] = m.fn(byYear[y]));
        return RSC.table(
          [{ key: "m", label: "Month" }, ...ys.map(y => ({ key: y, label: y, fmt: safe }))],
          data, totals);
      },
    });

    document.getElementById("yoyCalcBy").onchange = e => {
      calcBy = e.target.value;
      yearCard.rerender(); monthCard.rerender();
    };
  },
});
