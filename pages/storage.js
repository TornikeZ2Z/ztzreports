/* GO page: Storage — storage revenue tracking (additional vs included-in-bill).
   PBI source: General Overview "Storage" (05-dashboards.md GO-7). */

/* The "Storage Revenue Included in Total Bill" measure (PBI: SUM over the closing
   sheet's raw Storage column) needs "Storage" on the closing dataset. rs-core.js does
   not request it yet, so append it here — this runs at script load, before any
   RS.load("closing") call, so the cached fetch always includes the column. */
if (RS.DATASETS.closing.cols.indexOf("Storage") < 0) RS.DATASETS.closing.cols.push("Storage");

registerPage({
  id: "storage",
  group: "customers",
  title: "Storage",
  async render(host) {
    const [storageAll, closingAll] = await Promise.all([RS.load("storage"), RS.load("closing")]);
    const rows = RS.filtered("storage", storageAll);
    const closingRows = RS.filtered("closing", closingAll);
    const M = RS.M;

    // Exact DAX: both measures read Storage Payments, split on Payment Type —
    // 'Paid at Pickup' = included in the job's Total Bill, everything else = additional.
    const inclTotal = M["Storage Revenue Included in Total Bill"].fn(rows);
    const addTotal = M["Storage Additional Revenue"].fn(rows);

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Storage</h1>
        <p>Storage revenue — additional payments vs included-in-bill ·
           <b>${RS.fmtN(rows.length)}</b> storage payments in scope
           <span class="freshness">· monthly chart excludes the current partial month (PBI parity)</span></p>
      </div>
      <div class="rs-kpis" id="kpis"></div>
      <div id="main"></div>
      <div class="rs-grid2" id="subs"></div>`;

    RSC.kpis(document.getElementById("kpis"), [
      { label: "Storage Additional Revenue", value: RS.money(addTotal), sub: "separate storage payments" },
      { label: "Storage Payments", value: RS.fmtN(rows.length), sub: "# payments in scope" },
      { label: "Avg Payment", value: rows.length ? RS.money((addTotal + inclTotal) / rows.length) : "—", sub: "all storage revenue / payment" },
      { label: "Storage Rev. in Total Bill", value: RS.money(inclTotal), sub: "paid at pickup (in job bill)" },
      { label: "Storage Jobs", value: RS.fmtN(M["Total Storage Jobs"].fn(closingRows)), sub: "closings marked Our Storage" },
    ]);

    // ---- month buckets: additional (storage payments) + included-in-bill (closing)
    const mk = r => r._y + "-" + String(r._m).padStart(2, "0");
    const addByMonth = {};
    RS.groupBy(rows, "_month", "Storage Additional Revenue").forEach(x => { addByMonth[x.k] = x; });
    const closByMonth = {};
    closingRows.forEach(r => { const k = mk(r); (closByMonth[k] = closByMonth[k] || []).push(r); });
    const inclByMonth = {};
    RS.groupBy(rows, "_month", "Storage Revenue Included in Total Bill")
      .forEach(x => { inclByMonth[x.k] = x.v; });
    const months = [...new Set([...Object.keys(addByMonth), ...Object.keys(closByMonth)])].sort();
    const now = new Date();
    const curKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);

    // ---- main chart: storage revenue by month (PBI "Storage Analysis" clustered column)
    RSC.chartCard(document.getElementById("main"), {
      title: "Storage revenue by month",
      // PBI hard-codes a visual filter `End of Month <> <current month>`; replicated
      // DYNAMICALLY — the current partial calendar month is dropped from the chart only.
      controlsHtml: `<span class="lbl">last 24 mo · current partial month excluded</span>`,
      buildChart(canvas) {
        const shown = months
          .filter(k => k !== curKey && ((addByMonth[k] && addByMonth[k].v) || inclByMonth[k]))
          .slice(-24);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: shown.map(mLabel),
            datasets: [
              { label: "Storage Additional Revenue", data: shown.map(k => Math.round(addByMonth[k] ? addByMonth[k].v : 0)), backgroundColor: "#b7e23b", borderRadius: 4 },
              { label: "Storage Revenue Included in Total Bill", data: shown.map(k => Math.round(inclByMonth[k] || 0)), backgroundColor: "#5b8cff", borderRadius: 4 },
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
        // Parity with the PBI pivot "Leads Tabular Analysis": Year→Month rows with
        // Total Jobs, Total Bill, Storage Additional Revenue, Storage Rev. in Total Bill.
        // The tabular view keeps the current month (marked partial) — chart-only exclusion.
        const data = months.map(k => {
          const cl = closByMonth[k] || [];
          return {
            m: mLabel(k) + (k === curKey ? " (partial)" : ""),
            jobs: M["Total Jobs"].fn(cl), bill: M["Total Bill"].fn(cl),
            amt: addByMonth[k] ? addByMonth[k].v : 0,
            n: addByMonth[k] ? addByMonth[k].n : 0,
            incl: inclByMonth[k] || 0,
          };
        });
        return RSC.table(
          [{ key: "m", label: "Month" }, { key: "jobs", label: "Total Jobs", fmt: RS.fmtN },
           { key: "bill", label: "Total Bill", fmt: RS.money },
           { key: "amt", label: "Storage Additional Revenue", fmt: RS.money },
           { key: "n", label: "# Payments", fmt: RS.fmtN },
           { key: "incl", label: "Storage Rev. in Total Bill", fmt: RS.money }],
          data,
          { m: "Total", jobs: M["Total Jobs"].fn(closingRows), bill: M["Total Bill"].fn(closingRows),
            amt: addTotal, n: rows.length, incl: inclTotal });
      },
    });

    // ---- sub 1: doughnut of Amount by Payment Type · sub 2: recent payments table
    const subs = document.getElementById("subs");
    const byType = RS.groupBy(rows, "Payment Type", "Storage Additional Revenue");
    const PAL = ["#b7e23b", "#5b8cff", "#e8a33d", "#d85f3f", "#7a5fd8", "#38b2ac", "#6b7a88", "#c05299", "#8a9a5b", "#4a5568"];
    RSC.chartCard(subs, {
      title: "By payment type",
      buildChart(canvas) {
        let list = byType;
        if (list.length > 9) {          // keep the doughnut readable
          const rest = list.slice(9);
          list = list.slice(0, 9).concat([{
            k: "Other", v: rest.reduce((a, x) => a + (x.v || 0), 0), n: rest.reduce((a, x) => a + x.n, 0),
          }]);
        }
        return new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: list.map(x => x.k),
            datasets: [{ data: list.map(x => Math.round(x.v || 0)), backgroundColor: list.map((_, i) => PAL[i % PAL.length]), borderWidth: 1 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: "58%",
            plugins: {
              legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => {
                const tot = c.dataset.data.reduce((a, b) => a + b, 0);
                return `${c.label}: ${RS.money(c.raw)} (${tot ? (100 * c.raw / tot).toFixed(1) : 0}%)`;
              } } },
            },
          },
        });
      },
      buildTable() {
        const tot = byType.reduce((a, x) => a + (x.v || 0), 0);
        return RSC.table(
          [{ key: "k", label: "Payment Type" }, { key: "v", label: "Amount", fmt: RS.money },
           { key: "n", label: "# Payments", fmt: RS.fmtN }, { key: "p", label: "% of Amount", fmt: RS.fmtPct }],
          byType.map(x => ({ k: x.k, v: x.v, n: x.n, p: tot ? (x.v || 0) / tot : null })),
          { k: "Total", v: tot, n: rows.length, p: tot ? 1 : null });
      },
    });

    const pay = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Payments</span>
         <span class="spacer"></span>
         <span class="rs-ctl"><span class="lbl">most recent 50 of ${RS.fmtN(rows.length)}</span></span></div>
       <div class="tabwrap"></div>`);
    {
      const recent = rows.slice()
        .sort((a, b) => (b._d || "").localeCompare(a._d || "")).slice(0, 50);
      pay.querySelector(".tabwrap").innerHTML = RSC.table(
        [{ key: "d", label: "Payment Date" }, { key: "c", label: "Customer" },
         { key: "j", label: "Job Code" }, { key: "t", label: "Payment Type" },
         { key: "a", label: "Amount", fmt: RS.money }],
        recent.map(r => ({
          d: r._d || "—", c: r.Customer || "—", j: r["Job Code"] || "—",
          t: r["Payment Type"] || "—", a: RS.num(r.Amount),
        })));
    }
    subs.appendChild(pay);
  },
});
