/* GO page: Packing per 100 CF — packing revenue intensity per foreman.
   PBI source: General Overview "Packing per 100 CF" (05-dashboards.md GO-13):
   pivot Forman Full Name × End of Month with [Packing per 100 CF]. Rebuilt
   compactly on mart_forman_scorecard (one row per foreman-month, B17). */
registerPage({
  id: "packing-per-100cf",
  group: "ops",
  title: "Packing per 100 CF",
  async render(host) {
    const all = await RS.load("scorecard");
    const rows = RS.filtered("scorecard", all);

    // PBI measure: [Packing per 100 CF] — exact DAX SWITCH sentinels:
    //   both blank -> BLANK, no CF -> 90, no packing -> 0, else packing/CF*100.
    //   (0 triggers the same branch as BLANK per the extract notes.)
    const per100 = (pack, cf) => {
      if (!pack && !cf) return null;
      if (!cf) return 90;
      if (!pack) return 0;
      return 100 * pack / cf;
    };
    const val = c => c ? per100(c.pack, c.cf) : null;   // null when no row at all
    const scoreColor = s => s == null ? "#6b7a88" :
      s >= 90 ? "#b7e23b" : s >= 70 ? "#5b8cff" : s >= 50 ? "#a78bfa" :
      s >= 30 ? "#fbbf24" : "#f87171";
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);
    const d1 = v => v == null ? "—" : "$" + RS.fmt1(v);           // per-100CF display
    // trend delta vs previous month — higher packing intensity is better
    const dfmt = v => v == null ? "—" :
      `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : "−"}$${RS.fmt1(Math.abs(v))}</span>`;
    const scfmt = s => s == null ? "—" :
      `<span style="color:${scoreColor(s)}">${RS.fmt1(s)}</span>`;

    // ---- cells: (foreman, month) -> { pack, cf, score } (mart grain = 1 row, sums are safety)
    const cells = {};                                    // "F|YYYY-MM" -> cell
    const byForeman = {};                                // foreman -> [rows]
    const monthKeys = [...new Set(rows.map(r => r._y + "-" + String(r._m).padStart(2, "0")))].sort();
    rows.forEach(r => {
      const f = r.Foreman == null || r.Foreman === "" ? "—" : String(r.Foreman);
      const mk = r._y + "-" + String(r._m).padStart(2, "0");
      const c = cells[f + "|" + mk] = cells[f + "|" + mk] || { pack: 0, cf: 0, score: null };
      c.pack += RS.num(r["Total Packing Written"]);      // PBI: [Total Packing Written]
      c.cf += RS.num(r["Total CF"]);                     // PBI: [Total CF]
      if (r["Packing per 100 CF Score"] != null && r["Packing per 100 CF Score"] !== "")
        c.score = RS.num(r["Packing per 100 CF Score"]); // PBI: [Packing per 100 CF Score]
      (byForeman[f] = byForeman[f] || []).push(r);
    });
    const totPack = rows.reduce((a, r) => a + RS.num(r["Total Packing Written"]), 0);
    const totCF = rows.reduce((a, r) => a + RS.num(r["Total CF"]), 0);
    const scores = rows.map(r => r["Packing per 100 CF Score"])
      .filter(s => s != null && s !== "").map(RS.num);
    const latestKey = monthKeys[monthKeys.length - 1] || null;
    const prevKey = monthKeys.length > 1 ? monthKeys[monthKeys.length - 2] : null;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Packing per 100 CF</h1>
        <p>Packing revenue intensity per foreman ·
           <b>${RS.fmtN(Object.keys(byForeman).length)}</b> foremen ·
           <b>${RS.fmtN(monthKeys.length)}</b> months in scope
           <span class="freshness">· foreman-months with no recorded CF default to $90/100CF (PBI DAX sentinel)</span></p>
      </div>
      <div class="rs-kpis" id="p100kpis"></div>
      <div id="p100main"></div>
      <div class="rs-grid2" id="p100grid"></div>`;

    if (!latestKey) {
      document.getElementById("p100main").innerHTML =
        `<div class="panel"><div class="panel-head"><span class="panel-title">No scorecard rows in the current filter scope</span></div></div>`;
      return;
    }

    // ---- latest-month per-foreman stats (drives the main card)
    const fLatest = Object.keys(byForeman)
      .map(f => {
        const c = cells[f + "|" + latestKey];
        if (!c) return null;
        const v = val(c), pv = val(cells[f + "|" + prevKey]);
        return { f, v, pv, dl: (v != null && pv != null) ? v - pv : null,
                 sc: c.score, cf: c.cf, pk: c.pack, sentinel: !c.cf };
      })
      .filter(x => x && x.v != null)
      .sort((a, b) => (b.v || 0) - (a.v || 0));
    const bestReal = fLatest.filter(x => !x.sentinel)[0] || null;

    RSC.kpis(document.getElementById("p100kpis"), [
      // PBI: [Packing per 100 CF] over the whole scope (weighted, not avg of months)
      { label: "Packing / 100 CF", value: d1(per100(totPack, totCF)), sub: "scope total, weighted" },
      // PBI: [Packing per 100 CF Score] — mean across foreman-months with a score
      { label: "Avg Score", value: scores.length ? RS.fmt1(scores.reduce((a, b) => a + b, 0) / scores.length) : "—", sub: "across foreman-months" },
      { label: "Total CF", value: RS.fmtN(totCF), sub: "cubic feet moved" },        // PBI: [Total CF]
      { label: "Packing Written", value: RS.money(totPack), sub: "packing revenue" }, // PBI: [Total Packing Written]
      { label: "Foremen", value: RS.fmtN(Object.keys(byForeman).length), sub: "active in scope" },
      { label: "Best (" + mLabel(latestKey) + ")", value: bestReal ? d1(bestReal.v) : "—",
        sub: bestReal ? bestReal.f : "no non-sentinel foreman" },
    ]);

    // ---- main: Packing per 100 CF by foreman, latest month, colored by score band
    RSC.chartCard(document.getElementById("p100main"), {
      title: "Packing per 100 CF by Foreman",
      controlsHtml: `<span class="lbl">latest month: ${RSC.esc(mLabel(latestKey))} · bar color = score band · * = no CF (sentinel $90)</span>`,
      buildChart(canvas) {
        const list = fLatest.slice(0, 20);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.f + (x.sentinel ? " *" : "")),
            datasets: [{ label: "Packing / 100 CF",
              data: list.map(x => +x.v.toFixed(1)),
              backgroundColor: list.map(x => scoreColor(x.sc)), borderRadius: 5 }],
          },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: {
                label: c => {
                  const x = list[c.dataIndex];
                  return `${d1(x.v)} / 100 CF · score ${x.sc == null ? "—" : RS.fmt1(x.sc)}` +
                         (x.sentinel ? " · no CF (sentinel)" : "");
                } } },
            },
            scales: { x: { ticks: { callback: v => "$" + v } } },
          },
        });
      },
      buildTable() {
        // all columns are latest-month (the PBI pivot's last End of Month column)
        const mPack = fLatest.reduce((a, y) => a + y.pk, 0);
        const mCF = fLatest.reduce((a, y) => a + y.cf, 0);
        return RSC.table(
          [{ key: "rk", label: "#" },
           { key: "f", label: "Foreman" },
           { key: "v", label: "Packing / 100 CF", fmt: d1 },
           { key: "dl", label: "Δ vs prev mo", fmt: dfmt },
           { key: "sc", label: "Score", fmt: scfmt },
           { key: "cf", label: "Total CF", fmt: RS.fmtN },
           { key: "pk", label: "Packing Written", fmt: RS.money },
           { key: "sh", label: "% of packing", fmt: RS.fmtPct }],
          fLatest.slice(0, 60).map((x, i) => ({
            rk: i + 1, f: x.f + (x.sentinel ? " *" : ""), v: x.v, dl: x.dl,
            sc: x.sc, cf: x.cf, pk: x.pk, sh: mPack ? x.pk / mPack : null,
          })),
          { f: "All foremen (" + mLabel(latestKey) + ")", v: per100(mPack, mCF),
            cf: mCF, pk: mPack, sh: mPack ? 1 : null });
      },
    });

    // ---- grid2 (a): monthly trend, one line per top-6 foreman (by Total CF in scope)
    const grid = document.getElementById("p100grid");
    const PAL = ["#b7e23b", "#5b8cff", "#a78bfa", "#fbbf24", "#f87171", "#38b2ac"];
    const top6 = Object.entries(byForeman)
      .map(([f, rs]) => ({
        f, cf: rs.reduce((a, r) => a + RS.num(r["Total CF"]), 0),
        pack: rs.reduce((a, r) => a + RS.num(r["Total Packing Written"]), 0),
      }))
      .filter(x => x.f !== "—")
      .sort((a, b) => b.cf - a.cf).slice(0, 6);
    RSC.chartCard(grid, {
      title: "Trend — top 6 foremen by CF",
      controlsHtml: `<span class="lbl">last 18 months</span>`,
      buildChart(canvas) {
        const shown = monthKeys.slice(-18);
        return new Chart(canvas, {
          data: {
            labels: shown.map(mLabel),
            datasets: top6.map((t, i) => ({
              type: "line", label: t.f,
              data: shown.map(k => { const v = val(cells[t.f + "|" + k]);
                return v == null ? null : +v.toFixed(1); }),
              borderColor: PAL[i], backgroundColor: PAL[i],
              borderWidth: 2, pointRadius: 2, tension: .3, spanGaps: true,
            })),
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${d1(c.raw)}` } },
            },
            scales: {
              y: { ticks: { callback: v => "$" + v } },
              x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 18 } },
            },
          },
        });
      },
      buildTable() {
        // PBI-parity pivot: Forman Full Name × End of Month with [Packing per 100 CF]
        // same 18-month window as the chart (card label says "last 18 months")
        const shown = monthKeys.slice(-18);
        let html = `<table class="tab"><thead><tr><th>Foreman</th>` +
          shown.map(k => `<th>${RSC.esc(mLabel(k))}</th>`).join("") +
          `<th>Scope</th></tr></thead><tbody>`;
        top6.forEach(t => {
          html += `<tr><td>${RSC.esc(t.f)}</td>` +
            shown.map(k => { const v = val(cells[t.f + "|" + k]);
              return `<td>${v == null ? "—" : "$" + RS.fmt1(v)}</td>`; }).join("") +
            `<td><b>${d1(per100(t.pack, t.cf))}</b></td></tr>`;
        });
        html += `</tbody><tfoot><tr><td>All foremen</td>` + shown.map(k => {
          const mrs = rows.filter(r => (r._y + "-" + String(r._m).padStart(2, "0")) === k);
          const v = per100(mrs.reduce((a, r) => a + RS.num(r["Total Packing Written"]), 0),
                           mrs.reduce((a, r) => a + RS.num(r["Total CF"]), 0));
          return `<td>${v == null ? "—" : "$" + RS.fmt1(v)}</td>`;
        }).join("") + `<td>${d1(per100(totPack, totCF))}</td></tr></tfoot></table>`;
        return html;
      },
    });

    // ---- grid2 (b): score distribution across latest-month foremen
    const BANDS = [
      { min: 90, label: "90–100", c: "#b7e23b" },
      { min: 70, label: "70–89", c: "#5b8cff" },
      { min: 50, label: "50–69", c: "#a78bfa" },
      { min: 30, label: "30–49", c: "#fbbf24" },
      { min: -Infinity, label: "< 30", c: "#f87171" },
    ];
    const bandOf = s => BANDS.find(b => s >= b.min);
    const dist = BANDS.map(b => ({ ...b, fs: [] }));
    fLatest.forEach(x => {
      if (x.sc == null) return;
      dist[BANDS.indexOf(bandOf(x.sc))].fs.push(x.f + (x.sentinel ? " *" : ""));
    });
    const noScore = fLatest.filter(x => x.sc == null).length;
    RSC.chartCard(grid, {
      title: "Score distribution — " + mLabel(latestKey),
      // sentinel note (PBI DAX): a no-CF month scores as if per-100CF were exactly $90
      controlsHtml: `<span class="lbl">no-CF months default to $90 (DAX sentinel) — scored as 90` +
        (noScore ? ` · ${noScore} unscored` : "") + `</span>`,
      buildChart(canvas) {
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: dist.map(b => b.label),
            datasets: [{ label: "Foremen",
              data: dist.map(b => b.fs.length),
              backgroundColor: dist.map(b => b.c), borderRadius: 5 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: {
                label: c => `${c.raw} foremen` +
                  (dist[c.dataIndex].fs.length ? `: ${dist[c.dataIndex].fs.slice(0, 6).join(", ")}` +
                    (dist[c.dataIndex].fs.length > 6 ? "…" : "") : ""),
              } },
            },
            scales: { y: { ticks: { precision: 0 } } },
          },
        });
      },
      buildTable() {
        const n = fLatest.filter(x => x.sc != null).length;
        return RSC.table(
          [{ key: "b", label: "Score band" },
           { key: "n", label: "Foremen", fmt: RS.fmtN },
           { key: "sh", label: "% of foremen", fmt: RS.fmtPct },
           { key: "who", label: "Who" }],
          dist.map(b => ({
            b: b.label, n: b.fs.length, sh: n ? b.fs.length / n : null,
            who: b.fs.slice(0, 8).join(", ") + (b.fs.length > 8 ? ` +${b.fs.length - 8} more` : ""),
          })),
          { b: "Total", n: n, sh: n ? 1 : null });
      },
    });
  },
});
