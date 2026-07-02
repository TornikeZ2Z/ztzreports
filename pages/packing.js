/* GO page: Packing — packing revenue & estimate-vs-actual (PBI GO-10).
   Actuals = closing "Material $" (registry 'Packing Sold'); estimates come from the
   foreman scorecard mart (Total Packing Estimate). The PBI pivot (Forman Full Name ×
   End of Month: Total Jobs / Total Packing Estimate / Total Packing Written /
   Packing Difference %) is reproduced compactly: monthly actual-vs-estimate combo +
   a By-Foreman sold-vs-estimate card with colored diff %. */
registerPage({
  id: "packing",
  group: "ops",
  title: "Packing",
  async render(host) {
    const [closingAll, scorecardAll] = await Promise.all([RS.load("closing"), RS.load("scorecard")]);
    const rows = RS.filtered("closing", closingAll);
    const sc = RS.filtered("scorecard", scorecardAll);   // scorecard has its own Month date
    const M = RS.M;

    // ---- page-level totals (closing money columns can be '$ 1,234' varchar — registry
    //      measures + RS.num handle the parsing everywhere below)
    const soldTotal = M["Packing Sold"].fn(rows);        // PBI: Total Packing Written
    const matTotal = M["Material Total"].fn(rows);
    const jobsTotal = M["Total Jobs"].fn(rows);
    const billTotal = M["Total Bill"].fn(rows);
    const estTotal = sc.reduce((a, r) => a + RS.num(r["Total Packing Estimate"]), 0); // PBI: Total Packing Estimate
    const diffTotal = estTotal ? (soldTotal - estTotal) / estTotal : null;            // PBI: Packing Difference %

    // signed colored percent — green when actual beats estimate / grows
    const fmtDiff = v => (v == null || isNaN(v)) ? "—"
      : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}%</span>`;
    // signed colored percentage-POINT delta (for share-of-bill movement)
    const fmtPP = v => (v == null || isNaN(v)) ? "—"
      : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)} pp</span>`;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Packing</h1>
        <p>Packing revenue vs foreman estimates · <b>${RS.fmtN(jobsTotal)}</b> jobs ·
           <b>${RS.fmtN(sc.length)}</b> scorecard foreman-months in scope
           <span class="freshness">· estimates from the foreman scorecard mart</span></p>
      </div>
      <div class="rs-kpis" id="pckKpis"></div>
      <div id="pckMain"></div>
      <div class="rs-grid2" id="pckGrid"></div>`;

    RSC.kpis(document.getElementById("pckKpis"), [
      { label: "Packing Sold", value: RS.money(soldTotal), sub: "Material $ on closings" },
      { label: "Material Total", value: RS.money(matTotal), sub: "all material charged" },
      // portal addition — Packing Sold / Total Jobs (no direct PBI measure)
      { label: "Packing per Job", value: jobsTotal ? RS.money(soldTotal / jobsTotal) : "—", sub: "sold / job in scope" },
      { label: "Total Packing Estimate", value: RS.money(estTotal), sub: "scorecard foreman estimates" },
      // PBI: 'Packing Difference %' evaluated page-level (sold vs estimate)
      { label: "Sold vs Estimate", value: fmtDiff(diffTotal), sub: "actual over/under estimate" },
      // portal addition — share-of-total column family (Material $ / Total Bill)
      { label: "Packing Share of Bill", value: RS.fmtPct(billTotal ? soldTotal / billTotal : null), sub: "Material $ / Total Bill" },
    ]);

    // ---- month buckets: closing rows (sold/bill/jobs) + scorecard estimate sums
    const mk = r => r._y + "-" + String(r._m).padStart(2, "0");
    const closByM = {};
    rows.forEach(r => { const k = mk(r); (closByM[k] = closByM[k] || []).push(r); });
    const estByM = {};
    sc.forEach(r => { const k = mk(r); estByM[k] = (estByM[k] || 0) + RS.num(r["Total Packing Estimate"]); });
    const months = [...new Set([...Object.keys(closByM), ...Object.keys(estByM)])].sort();
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);

    // ---- main card: packing sold by month (bars) vs scorecard estimate (line)
    RSC.chartCard(document.getElementById("pckMain"), {
      title: "Packing sold by month — actual vs estimate",
      controlsHtml: `<span class="lbl">bars: closing Material $ · line: scorecard estimate · last 24 mo</span>`,
      buildChart(canvas) {
        const shown = months.slice(-24);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: shown.map(mLabel),
            datasets: [
              { label: "Packing Sold", order: 2,
                data: shown.map(k => Math.round(closByM[k] ? M["Packing Sold"].fn(closByM[k]) : 0)),
                backgroundColor: "#b7e23b", borderRadius: 4 },
              { type: "line", label: "Total Packing Estimate", order: 1,
                data: shown.map(k => Math.round(estByM[k] || 0)),
                borderColor: "#fbbf24", backgroundColor: "#fbbf24",
                borderWidth: 2, pointRadius: 2.5, tension: .3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${RS.money(c.raw)}` } },
            },
            scales: {
              y: { ticks: { callback: v => "$" + (v / 1000) + "k" } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        let prev = null;
        const data = months.map(k => {
          const cl = closByM[k] || [];
          const sold = M["Packing Sold"].fn(cl);
          const bill = M["Total Bill"].fn(cl);
          const est = estByM[k] || 0;
          const row = {
            m: mLabel(k), jobs: M["Total Jobs"].fn(cl), sold,
            mom: (prev != null && prev !== 0) ? (sold - prev) / Math.abs(prev) : null, // portal addition: MoM delta
            mat: M["Material Total"].fn(cl),
            est,
            diff: est ? (sold - est) / est : null,       // PBI: Packing Difference %
            sh: bill ? sold / bill : null,               // portal addition: share of bill
          };
          prev = sold;
          return row;
        });
        return RSC.table(
          [{ key: "m", label: "Month" }, { key: "jobs", label: "Total Jobs", fmt: RS.fmtN },
           { key: "sold", label: "Packing Sold", fmt: RS.money },
           { key: "mom", label: "MoM", fmt: fmtDiff },
           { key: "mat", label: "Material Total", fmt: RS.money },
           { key: "est", label: "Packing Estimate", fmt: RS.money },
           { key: "diff", label: "Sold vs Est", fmt: fmtDiff },
           { key: "sh", label: "Share of Bill", fmt: RS.fmtPct }],
          data,
          { m: "Total", jobs: jobsTotal, sold: soldTotal, mom: null, mat: matTotal,
            est: estTotal, diff: diffTotal, sh: billTotal ? soldTotal / billTotal : null });
      },
    });

    // ---- foreman merge: sold (closing, by Foreman) × estimate (scorecard, by Foreman)
    const soldByF = {};
    rows.forEach(r => {
      const f = (r.Foreman == null || r.Foreman === "") ? "—" : String(r.Foreman);
      (soldByF[f] = soldByF[f] || []).push(r);
    });
    const estByF = {};
    sc.forEach(r => {
      const f = (r.Foreman == null || r.Foreman === "") ? "—" : String(r.Foreman);
      estByF[f] = (estByF[f] || 0) + RS.num(r["Total Packing Estimate"]);
    });
    const fList = [...new Set([...Object.keys(soldByF), ...Object.keys(estByF)])].map(f => {
      const cl = soldByF[f] || [];
      const sold = M["Packing Sold"].fn(cl);
      const est = estByF[f] || 0;
      return { f, jobs: cl.length, sold, est,
        diff: est ? (sold - est) / est : null };       // PBI: Packing Difference % per foreman
    }).sort((a, b) => (b.sold || 0) - (a.sold || 0));

    const grid = document.getElementById("pckGrid");

    // ---- grid2 (a): by foreman — sold vs estimate grouped bars, top 15
    RSC.chartCard(grid, {
      title: "By foreman — sold vs estimate",
      controlsHtml: `<span class="lbl">top 15 of ${RS.fmtN(fList.length)} by packing sold</span>`,
      buildChart(canvas) {
        const top = fList.slice(0, 15);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: top.map(x => x.f),
            datasets: [
              { label: "Packing Sold", data: top.map(x => Math.round(x.sold || 0)),
                backgroundColor: "#b7e23b", borderRadius: 4 },
              { label: "Packing Estimate", data: top.map(x => Math.round(x.est || 0)),
                backgroundColor: "#5b8cff", borderRadius: 4 },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${RS.money(c.raw)}` } },
            },
            scales: {
              x: { ticks: { callback: v => "$" + (v / 1000) + "k" } },
              y: { ticks: { font: { size: 11 } } },
            },
          },
        });
      },
      buildTable() {
        const top = fList.slice(0, 15), rest = fList.slice(15);
        const data = top.map((x, i) => ({
          rk: i + 1, f: x.f, jobs: x.jobs, sold: x.sold, est: x.est, diff: x.diff,
          sh: soldTotal ? (x.sold || 0) / soldTotal : null,   // portal addition: share of sold
        }));
        if (rest.length) {                                    // "everything else" bucket
          const s = rest.reduce((a, x) => a + (x.sold || 0), 0);
          const e = rest.reduce((a, x) => a + (x.est || 0), 0);
          data.push({ rk: null, f: `Everything else (${rest.length})`,
            jobs: rest.reduce((a, x) => a + x.jobs, 0), sold: s, est: e,
            diff: e ? (s - e) / e : null, sh: soldTotal ? s / soldTotal : null });
        }
        return RSC.table(
          [{ key: "rk", label: "#", fmt: v => v == null ? "" : RS.fmtN(v) },
           { key: "f", label: "Foreman" },
           { key: "jobs", label: "Jobs", fmt: RS.fmtN },
           { key: "sold", label: "Packing Sold", fmt: RS.money },
           { key: "est", label: "Estimate", fmt: RS.money },
           { key: "diff", label: "Sold vs Est", fmt: fmtDiff },
           { key: "sh", label: "% of Sold", fmt: RS.fmtPct }],
          data,
          { f: "Total", jobs: jobsTotal, sold: soldTotal, est: estTotal,
            diff: diffTotal, sh: soldTotal ? 1 : null });
      },
    });

    // ---- grid2 (b): packing share of bill — monthly Material $ / Total Bill %
    RSC.chartCard(grid, {
      title: "Packing share of bill",
      controlsHtml: `<span class="lbl">Material $ / Total Bill · last 24 mo</span>`,
      buildChart(canvas) {
        const shown = months.filter(k => closByM[k]).slice(-24);
        return new Chart(canvas, {
          type: "line",
          data: {
            labels: shown.map(mLabel),
            datasets: [{
              label: "Packing share of bill",
              data: shown.map(k => {
                const cl = closByM[k], b = M["Total Bill"].fn(cl);
                return b ? +(100 * M["Packing Sold"].fn(cl) / b).toFixed(2) : null;
              }),
              borderColor: "#a78bfa", backgroundColor: "rgba(167,139,250,.15)",
              borderWidth: 2, pointRadius: 2.5, tension: .3, fill: true,
            }],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c => `Share of bill: ${c.raw == null ? "—" : c.raw.toFixed(2) + "%"}` } },
            },
            scales: {
              y: { ticks: { callback: v => v + "%" } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        let prevSh = null;
        const data = months.filter(k => closByM[k]).map(k => {
          const cl = closByM[k];
          const sold = M["Packing Sold"].fn(cl), bill = M["Total Bill"].fn(cl);
          const sh = bill ? sold / bill : null;
          const row = { m: mLabel(k), sold, bill, sh,
            d: (sh != null && prevSh != null) ? sh - prevSh : null };  // portal addition: pp delta
          if (sh != null) prevSh = sh;
          return row;
        });
        return RSC.table(
          [{ key: "m", label: "Month" },
           { key: "sold", label: "Packing Sold", fmt: RS.money },
           { key: "bill", label: "Total Bill", fmt: RS.money },
           { key: "sh", label: "Share of Bill", fmt: RS.fmtPct },
           { key: "d", label: "vs prev mo", fmt: fmtPP }],
          data,
          { m: "Total", sold: soldTotal, bill: billTotal,
            sh: billTotal ? soldTotal / billTotal : null, d: null });
      },
    });
  },
});
