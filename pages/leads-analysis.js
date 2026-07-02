/* GO page: Leads Analysis — moveboard leads funnel.
   PBI source: General Overview "Leads Analysis" (GO-2). Global filter bar supplies all slicers. */
registerPage({
  id: "leads-analysis",
  group: "sales",
  ico: "🧲",
  title: "Leads Analysis",
  async render(host) {
    const rows = RS.filtered("moveboard", await RS.load("moveboard"));
    const M = RS.M;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Leads Analysis</h1>
        <p>Moveboard lead funnel · <b>${RS.fmtN(rows.length)}</b> leads in scope
           <span class="freshness">· dates by Create Date</span></p>
      </div>
      <div class="rs-kpis" id="kpis"></div>
      <div class="rs-grid2">
        <div id="bySource"></div>
        <div id="overTime"></div>
      </div>
      <div id="funnel"></div>`;

    RSC.kpis(document.getElementById("kpis"), [
      { label: "Total Leads", value: RS.fmtN(M["Total Leads"].fn(rows)), sub: "all moveboard leads" },
      { label: "Qualified Leads", value: RS.fmtN(M["Qualified Leads"].fn(rows)), sub: "excl. bad leads" },
      { label: "Confirmed Leads", value: RS.fmtN(M["Confirmed Leads"].fn(rows)), sub: "booked jobs" },
      { label: "Dead Leads", value: RS.fmtN(M["Dead Leads"].fn(rows)), sub: "bad leads" },
      { label: "Booking Rate", value: RS.fmtPct(M["Booking Rate"].fn(rows)), sub: "confirmed / qualified" },
      { label: "Average Quote", value: RS.money(M["Average Quote (avg)"].fn(rows)), sub: "avg of quoted leads" },
    ]);

    /* ---- shared: one pass over Source, funnel measures per source ---- */
    const FUNNEL = ["Total Leads", "Qualified Leads", "Confirmed Leads", "Dead Leads", "Booking Rate"];
    function bySource() {
      const g = {};
      rows.forEach(r => { const s = r.Source || "—"; (g[s] = g[s] || []).push(r); });
      return Object.entries(g).map(([s, rs]) => ({
        s, total: M["Total Leads"].fn(rs), qual: M["Qualified Leads"].fn(rs),
        conf: M["Confirmed Leads"].fn(rs), dead: M["Dead Leads"].fn(rs),
        rate: M["Booking Rate"].fn(rs),
      })).sort((a, b) => b.total - a.total);
    }

    /* ---- chart 1: Leads by Source (horizontal bar, Calculate-by swap) ---- */
    let calcBy = FUNNEL[0];
    const srcCard = RSC.chartCard(document.getElementById("bySource"), {
      title: "Leads by Source",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="calcBy">` +
        FUNNEL.map(c => `<option ${c === calcBy ? "selected" : ""}>${c}</option>`).join("") + `</select>`,
      buildChart(canvas) {
        const m = RS.M[calcBy];
        const isPct = m.fmt === RS.fmtPct;
        // For Booking Rate rank by lead volume (rate on tiny sources is noise); else by the measure.
        const key = { "Total Leads": "total", "Qualified Leads": "qual", "Confirmed Leads": "conf", "Dead Leads": "dead", "Booking Rate": "rate" }[calcBy];
        let list = bySource();
        if (!isPct) list.sort((a, b) => (b[key] || 0) - (a[key] || 0));
        list = list.slice(0, 15);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.s),
            datasets: [{ label: calcBy, data: list.map(x => isPct ? x[key] : Math.round(x[key] || 0)),
              backgroundColor: "#9ABA3C", borderRadius: 4 }],
          },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: c => `${calcBy}: ${m.fmt(c.raw)}` } } },
            scales: {
              x: { title: { display: true, text: calcBy },
                   ticks: { callback: v => isPct ? RS.fmtPct(v) : RS.fmtN(v) } },
              y: { ticks: { font: { size: 11 } } },
            },
          },
        });
      },
      buildTable() {
        const data = bySource().slice(0, 100);   // safety cap; sources are few in practice
        const tq = M["Qualified Leads"].fn(rows), tc = M["Confirmed Leads"].fn(rows);
        return RSC.table(
          [{ key: "s", label: "Source" }, { key: "total", label: "Total Leads", fmt: RS.fmtN },
           { key: "qual", label: "Qualified", fmt: RS.fmtN }, { key: "conf", label: "Confirmed", fmt: RS.fmtN },
           { key: "dead", label: "Dead", fmt: RS.fmtN }, { key: "rate", label: "Booking Rate", fmt: RS.fmtPct }],
          data,
          { s: "Total", total: M["Total Leads"].fn(rows), qual: tq, conf: tc,
            dead: M["Dead Leads"].fn(rows), rate: tq ? Math.min(1, tc / tq) : null });
      },
    });
    document.getElementById("calcBy").onchange = e => { calcBy = e.target.value; srcCard.rerender(); };

    /* ---- chart 2: Leads over time (monthly, Total + Confirmed lines) ---- */
    function byMonth() {
      const g = {};
      rows.forEach(r => { const k = r._y + "-" + String(r._m).padStart(2, "0"); (g[k] = g[k] || []).push(r); });
      return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, rs]) => ({
        k, label: RS.monthName(+k.slice(5)) + " " + k.slice(2, 4),
        total: M["Total Leads"].fn(rs), qual: M["Qualified Leads"].fn(rs),
        conf: M["Confirmed Leads"].fn(rs), dead: M["Dead Leads"].fn(rs),
        rate: M["Booking Rate"].fn(rs),
      }));
    }
    RSC.chartCard(document.getElementById("overTime"), {
      title: "Leads over time",
      buildChart(canvas) {
        const list = byMonth();
        return new Chart(canvas, {
          type: "line",
          data: {
            labels: list.map(x => x.label),
            datasets: [
              { label: "Total Leads", data: list.map(x => x.total), borderColor: "#3f62d8",
                backgroundColor: "#3f62d8", borderWidth: 2, pointRadius: 2, tension: .3 },
              { label: "Confirmed Leads", data: list.map(x => x.conf), borderColor: "#9ABA3C",
                backgroundColor: "#9ABA3C", borderWidth: 2, pointRadius: 2, tension: .3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${RS.fmtN(c.raw)}` } } },
            scales: {
              y: { title: { display: true, text: "Leads" }, ticks: { callback: v => RS.fmtN(v) } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        const data = byMonth();
        const tq = M["Qualified Leads"].fn(rows), tc = M["Confirmed Leads"].fn(rows);
        return RSC.table(
          [{ key: "label", label: "Month" }, { key: "total", label: "Total Leads", fmt: RS.fmtN },
           { key: "qual", label: "Qualified", fmt: RS.fmtN }, { key: "conf", label: "Confirmed", fmt: RS.fmtN },
           { key: "dead", label: "Dead", fmt: RS.fmtN }, { key: "rate", label: "Booking Rate", fmt: RS.fmtPct }],
          data,
          { label: "Total", total: M["Total Leads"].fn(rows), qual: tq, conf: tc,
            dead: M["Dead Leads"].fn(rows), rate: tq ? Math.min(1, tc / tq) : null });
      },
    });

    /* ---- panel: Funnel by Status Category ---- */
    const fp = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Funnel by Status Category</span></div><div class="tabwrap"></div>`);
    {
      const g = {};
      rows.forEach(r => { const s = r["Status Category"] || "—"; g[s] = (g[s] || 0) + 1; });
      const n = rows.length || 1;
      const data = Object.entries(g).map(([s, c]) => ({ s, c, share: c / n }))
        .sort((a, b) => b.c - a.c);
      fp.querySelector(".tabwrap").innerHTML = RSC.table(
        [{ key: "s", label: "Status Category" }, { key: "c", label: "Leads", fmt: RS.fmtN },
         { key: "share", label: "Share", fmt: RS.fmtPct }],
        data,
        { s: "Total", c: rows.length, share: rows.length ? 1 : null });
    }
    document.getElementById("funnel").appendChild(fp);
  },
});
