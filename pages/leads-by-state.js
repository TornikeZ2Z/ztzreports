/* GO page: Leads by State — lead funnel by geography (state → county → city drill).
   PBI original: azure map + "Leads Tabular Analysis" pivot, hidden behind a FIXED visual
   filter (State Name IN CT/DE/MA/NJ/NY/PA/MD). We approximate the map with ranked bars
   (a real choropleth is a listed future improvement) and show ALL states — the global
   State slicer reproduces the NE-corridor cut when wanted. */
registerPage({
  id: "leads-by-state",
  group: "sales",
  title: "Leads by State",
  async render(host) {
    const all = await RS.load("moveboard");
    const rows = RS.filtered("moveboard", all);                                 // Create Date context
    const rowsB = RS.filtered("moveboard", all, { dateColumn: "Booked Date" }); // USERELATIONSHIP → Booked Date
    const M = RS.M;
    const nn = v => (v == null || v === "" ? "—" : String(v));

    /* Funnel stats per geography key, with this page's PBI date semantics:
       Total/Qualified/Dead over Create Date (PBI "Qualified Leads by Created Date"),
       Confirmed over Booked Date (PBI "Confirmed Leads by Booked Date"),
       Booking Rate = confirmed / qualified capped at 100% (matches RS.M["Booking Rate"]). */
    function funnelBy(keyFn, nameFn) {
      const g = new Map();
      const get = r => {
        const k = keyFn(r);
        let o = g.get(k);
        if (!o) { o = { key: k, name: nameFn(r), total: 0, qual: 0, conf: 0, dead: 0 }; g.set(k, o); }
        // Backfill a better display name (e.g. full State Name) if the first row
        // for this key lacked one: for states the fallback name equals the key.
        else if (o.name === "—" || o.name === o.key) { const n = nameFn(r); if (n !== "—") o.name = n; }
        return o;
      };
      rows.forEach(r => {
        const o = get(r); o.total++;
        if (r["Status Category"] === "Bad Lead") o.dead++; else o.qual++;
      });
      rowsB.forEach(r => { if (r["Status Category"] === "Confirmed") get(r).conf++; });
      const out = [...g.values()];
      out.forEach(o => { o.rate = o.qual ? Math.min(1, o.conf / o.qual) : null; });
      out.sort((a, b) => b.total - a.total);
      return out;
    }

    const states = funnelBy(r => nn(r.State),
      r => (r["State Name"] ? String(r["State Name"]) : nn(r.State)));
    const counties = funnelBy(r => nn(r["County Name"]) + "|" + nn(r.State),
      r => nn(r["County Name"]));
    counties.forEach(c => { c.st = c.key.split("|")[1]; });
    const cities = funnelBy(r => nn(r["City Name"]) + "|" + nn(r.State),
      r => nn(r["City Name"]));
    cities.forEach(c => { c.st = c.key.split("|")[1]; });

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Leads by State</h1>
        <p>Lead funnel by geography · <b>${RS.fmtN(rows.length)}</b> leads in scope
           <span class="freshness">· PBI fixes this page to 7 NE states — use the global State slicer to reproduce; map shown as ranked bars</span></p>
      </div>
      <div class="rs-kpis" id="kpis"></div>
      <div id="main"></div>
      <div class="rs-grid2" id="subs"></div>`;

    const qual = M["Qualified Leads"].fn(rows);   // PBI: Qualified Leads by Created Date
    const conf = M["Confirmed Leads"].fn(rowsB);  // PBI: Confirmed Leads by Booked Date
    // inline: DISTINCTCOUNT(Moveboard[State]) — no PBI measure exists for this
    const nStates = new Set(rows.map(r => r.State).filter(v => v != null && v !== "")).size;
    RSC.kpis(document.getElementById("kpis"), [
      { label: "Total Leads", value: RS.fmtN(M["Total Leads"].fn(rows)), sub: "by created date" },
      { label: "Confirmed Leads", value: RS.fmtN(conf), sub: "by booked date" },
      { label: "Booking Rate", value: RS.fmtPct(qual ? Math.min(1, conf / qual) : null), sub: "confirmed / qualified" },
      { label: "States", value: RS.fmtN(nStates), sub: "distinct states in scope" },
    ]);

    /* ---- main: horizontal ranked bars — the map stand-in ---- */
    const CALC = ["Total Leads", "Confirmed Leads", "Booking Rate"];
    let calcBy = CALC[0];
    const stateCard = RSC.chartCard(document.getElementById("main"), {
      title: "Leads by State",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="lbsCalc">` +
        CALC.map(c => `<option ${c === calcBy ? "selected" : ""}>${c}</option>`).join("") + `</select>`,
      buildChart(canvas) {
        const isRate = calcBy === "Booking Rate";
        const val = s => isRate ? s.rate : (calcBy === "Confirmed Leads" ? s.conf : s.total);
        const list = states.filter(s => s.key !== "—").slice(0, 15)  // membership: top 15 by Total Leads
          .sort((a, b) => (val(b) || 0) - (val(a) || 0));
        const fmt = isRate ? RS.fmtPct : RS.fmtN;
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(s => s.name),
            datasets: [{ label: calcBy, data: list.map(val), backgroundColor: "#b7e23b", borderRadius: 4 }],
          },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: c => `${calcBy}: ${fmt(c.raw)}` } } },
            scales: {
              x: { title: { display: true, text: calcBy },
                ticks: { callback: v => isRate ? Math.round(100 * v) + "%" : RS.fmtN(v) } },
              y: { ticks: { font: { size: 11 } } },
            },
          },
        });
      },
      buildTable() {
        const t = k => states.reduce((a, s) => a + s[k], 0);
        const tq = t("qual"), tc = t("conf");
        return RSC.table(
          [{ key: "name", label: "State" }, { key: "total", label: "Total Leads", fmt: RS.fmtN },
           { key: "qual", label: "Qualified", fmt: RS.fmtN }, { key: "conf", label: "Confirmed", fmt: RS.fmtN },
           { key: "dead", label: "Dead", fmt: RS.fmtN }, { key: "rate", label: "Booking Rate", fmt: RS.fmtPct }],
          states,
          { name: "Total", total: t("total"), qual: tq, conf: tc, dead: t("dead"),
            rate: tq ? Math.min(1, tc / tq) : null });
      },
    });
    document.getElementById("lbsCalc").onchange = e => { calcBy = e.target.value; stateCard.rerender(); };

    /* ---- sub 1: county drill level ---- */
    const subs = document.getElementById("subs");
    RSC.chartCard(subs, {
      title: "Top Counties",
      buildChart(canvas) {
        const list = counties.filter(c => c.name !== "—").slice(0, 20);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(c => c.st !== "—" ? `${c.name}, ${c.st}` : c.name),
            datasets: [{ label: "Total Leads", data: list.map(c => c.total), backgroundColor: "#b7e23b", borderRadius: 4 }],
          },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: c => `Total Leads: ${RS.fmtN(c.raw)}` } } },
            scales: { x: { ticks: { callback: v => RS.fmtN(v) } }, y: { ticks: { font: { size: 11 } } } },
          },
        });
      },
      buildTable() {  // top 50 keeps the tabular view fast on the 107k-row dataset
        return RSC.table(
          [{ key: "name", label: "County" }, { key: "st", label: "State" },
           { key: "total", label: "Total Leads", fmt: RS.fmtN }, { key: "qual", label: "Qualified", fmt: RS.fmtN },
           { key: "conf", label: "Confirmed", fmt: RS.fmtN }, { key: "rate", label: "Booking Rate", fmt: RS.fmtPct }],
          counties.filter(c => c.name !== "—").slice(0, 50));
      },
    });

    /* ---- sub 2: city drill level ---- */
    const cp = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Top Cities</span></div><div class="tabwrap"></div>`);
    cp.querySelector(".tabwrap").innerHTML = RSC.table(
      [{ key: "name", label: "City" }, { key: "st", label: "State" },
       { key: "total", label: "Leads", fmt: RS.fmtN }, { key: "conf", label: "Confirmed", fmt: RS.fmtN },
       { key: "rate", label: "Booking Rate", fmt: RS.fmtPct }],
      cities.filter(c => c.name !== "—").slice(0, 30));
    subs.appendChild(cp);
  },
});
