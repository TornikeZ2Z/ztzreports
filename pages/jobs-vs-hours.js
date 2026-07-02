/* GO page: Jobs Done Vs Hours Worked — reference page implementation.
   Global filter bar supplies all slicers (multi-select + date range + day between). */
registerPage({
  id: "jobs-vs-hours",
  group: "overview",
  title: "Jobs Done vs Hours Worked",
  async render(host) {
    const rows = RS.filtered("closing", await RS.load("closing"));
    const M = RS.M;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Jobs Done vs Hours Worked</h1>
        <p>Foreman output vs hours worked · <b>${RS.fmtN(rows.length)}</b> jobs in scope
           <span class="freshness">· includes appended trips & trips revenue</span></p>
      </div>
      <div class="rs-kpis" id="kpis"></div>
      <div id="main"></div>
      <div class="rs-grid2" id="subs"></div>`;

    RSC.kpis(document.getElementById("kpis"), [
      { label: "Total Jobs", value: RS.fmtN(M["Total Jobs"].fn(rows)), sub: "closed jobs (incl. trips)" },
      { label: "Total Bill", value: RS.money(M["Total Bill"].fn(rows)), sub: "revenue + trips extra" },
      { label: "Net Cash", value: RS.money(M["Net Cash"].fn(rows)), sub: "net + trips" },
      { label: "Card Payment", value: RS.money(M["Card Payment"].fn(rows)), sub: "card volume" },
      { label: "Hours Worked", value: RS.fmtN(M["Hours Worked by Forman"].fn(rows)), sub: "foreman hours" },
      { label: "Jobs / 100 hrs", value: RS.fmt1(M["Jobs per 100 Hours"].fn(rows)), sub: "efficiency" },
    ]);

    // ---- main combo chart: Calculate-by measure (bars) + Hours (line) by foreman
    const CALC = ["Total Jobs", "Total Bill", "Net Cash", "Card Payment", "Net Cash + Card Payment"];
    let calcBy = CALC[1];
    const card = RSC.chartCard(document.getElementById("main"), {
      title: "By Foreman",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="calcBy">` +
        CALC.map(c => `<option ${c === calcBy ? "selected" : ""}>${c}</option>`).join("") + `</select>`,
      buildChart(canvas) {
        const m = RS.M[calcBy];
        const g = {};
        rows.forEach(r => { const f = r.Foreman || "—"; (g[f] = g[f] || []).push(r); });
        const list = Object.entries(g)
          .map(([f, rs]) => ({ f, v: m.fn(rs), h: rs.reduce((a, r) => a + RS.num(r["Foreman Hours"]), 0) }))
          .sort((a, b) => (b.v || 0) - (a.v || 0)).slice(0, 20);
        const isMoney = m.fmt === RS.money;
        return new Chart(canvas, {
          data: {
            labels: list.map(x => x.f),
            datasets: [
              { type: "bar", label: calcBy, data: list.map(x => Math.round(x.v)), backgroundColor: "#b7e23b", borderRadius: 4, yAxisID: "y", order: 2 },
              { type: "line", label: "Hours Worked", data: list.map(x => Math.round(x.h)), borderColor: "#5b8cff", backgroundColor: "#5b8cff", borderWidth: 2, pointRadius: 2, tension: .3, yAxisID: "y1", order: 1 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => c.dataset.yAxisID === "y" ? `${calcBy}: ${m.fmt(c.raw)}` : `Hours: ${RS.fmtN(c.raw)}` } } },
            scales: {
              y: { position: "left", title: { display: true, text: calcBy }, ticks: { callback: v => isMoney ? "$" + (v / 1000) + "k" : RS.fmtN(v) } },
              y1: { position: "right", title: { display: true, text: "Hours Worked" }, grid: { drawOnChartArea: false } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        const g = {};
        rows.forEach(r => { const f = r.Foreman || "—"; (g[f] = g[f] || []).push(r); });
        const data = Object.entries(g).map(([f, rs]) => ({
          f, jobs: RS.M["Total Jobs"].fn(rs), bill: RS.M["Total Bill"].fn(rs),
          net: RS.M["Net Cash"].fn(rs), card: RS.M["Card Payment"].fn(rs),
          nc: RS.M["Net Cash + Card Payment"].fn(rs), hrs: rs.reduce((a, r) => a + RS.num(r["Foreman Hours"]), 0),
        })).sort((a, b) => b.jobs - a.jobs);
        const tot = k => data.reduce((a, x) => a + (x[k] || 0), 0);
        return RSC.table(
          [{ key: "f", label: "Foreman" }, { key: "jobs", label: "Jobs", fmt: RS.fmtN },
           { key: "bill", label: "Total Bill", fmt: RS.money }, { key: "net", label: "Net Cash", fmt: RS.money },
           { key: "card", label: "Card Payment", fmt: RS.money }, { key: "nc", label: "Net + Card", fmt: RS.money },
           { key: "hrs", label: "Hours", fmt: RS.fmtN }],
          data,
          { f: "Total", jobs: tot("jobs"), bill: tot("bill"), net: tot("net"),
            card: tot("card"), nc: tot("nc"), hrs: tot("hrs") });
      },
    });
    document.getElementById("calcBy").onchange = e => { calcBy = e.target.value; card.rerender(); };

    // ---- sub-table 1: Sales Person rollup · sub-table 2: monthly matrix
    const subs = document.getElementById("subs");
    const sp = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Sales Person</span></div><div class="tabwrap"></div>`);
    {
      const g = {};
      rows.forEach(r => { const s = r["Sales Person"] || "—"; (g[s] = g[s] || []).push(r); });
      const data = Object.entries(g).map(([s, rs]) => ({
        s, jobs: rs.length, bill: RS.M["Total Bill"].fn(rs), avg: RS.M["Average Bill"].fn(rs),
      })).sort((a, b) => b.bill - a.bill).slice(0, 30);
      sp.querySelector(".tabwrap").innerHTML = RSC.table(
        [{ key: "s", label: "Sales Person" }, { key: "jobs", label: "Jobs", fmt: RS.fmtN },
         { key: "bill", label: "Total Bill", fmt: RS.money }, { key: "avg", label: "Avg Bill", fmt: RS.money }],
        data);
    }
    subs.appendChild(sp);

    const mx = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Jobs by Foreman × Month</span></div><div class="tabwrap"></div>`);
    mx.querySelector(".tabwrap").innerHTML = RSC.matrix(rows, "Foreman", "Total Jobs", { rowLabel: "Foreman", lastN: 13 });
    subs.appendChild(mx);
  },
});
