/* GO page: Sales Person Analysis — salesperson performance: jobs, revenue,
   commission, refund deductions + normalized (Bill Distribution-weighted) revenue.
   PBI source: General Overview "Sales Person Analysis" (05-dashboards.md GO-3). */
registerPage({
  id: "sales-person-analysis",
  group: "sales",
  title: "Sales Person Analysis",
  async render(host) {
    const [closingAll, salariesAll, refundsAll] = await Promise.all([
      RS.load("closing"), RS.load("sales_salaries"), RS.load("refunds")]);
    const rows = RS.filtered("closing", closingAll);
    const refRows = RS.filtered("refunds", refundsAll);
    const M = RS.M;

    // ---- membership join: sales_salaries has no date column — time-slice it via
    // the Unique Key set of the FILTERED closing rows (client-side relationship).
    const keys = new Set();
    const keyBill = new Map();   // Unique Key -> raw closing Total Bill (normalization basis)
    const keyMonth = new Map();  // Unique Key -> "YYYY-MM" (buckets commission by job month)
    rows.forEach(r => {
      const k = r["Unique Key"]; if (!k) return;
      keys.add(k);
      keyBill.set(k, RS.num(r["Total Bill"]));
      keyMonth.set(k, r._y + "-" + String(r._m).padStart(2, "0"));
    });
    const salRows = salariesAll.filter(s => keys.has(s["Unique Key"]));

    // Bill Distribution is expected as a 0–1 share; if the source stores percents
    // (avg >> 1) scale down so normalized totals stay comparable to Total Bill.
    let distScale = 1;
    if (salRows.length) {
      const avg = salRows.reduce((a, s) => a + RS.num(s["Bill Distribution"]), 0) / salRows.length;
      if (avg > 1.5) distScale = 0.01;
    }

    // ---- page-level totals
    const totBill = M["Total Bill"].fn(rows);
    const totJobs = M["Total Jobs"].fn(rows);
    const totComm = M["Sales Commission"].fn(salRows);
    // PBI 'Amount Deducted From Sales Person' — refund amounts charged against commission
    const totReduced = refRows.reduce((a, r) => a + RS.num(r["Sales Commission Reduced Amount"]), 0);
    const totFinal = totComm - totReduced;   // PBI 'Sales Commission Final'-style

    // ---- per-SP aggregation (closing by primary SP; salaries/refunds by their own SP)
    const mkOf = r => r._y + "-" + String(r._m).padStart(2, "0");
    const spMap = new Map();
    const sp = name => {
      const k = (name == null || name === "") ? "—" : String(name);
      if (!spMap.has(k)) spMap.set(k, { name: k, rows: [], sal: [], reduced: 0, mm: {} });
      return spMap.get(k);
    };
    const bucket = (o, mk) => (o.mm[mk] = o.mm[mk] || { rows: [], sal: [], reduced: 0 });
    rows.forEach(r => { const o = sp(r["Sales Person"]); o.rows.push(r); bucket(o, mkOf(r)).rows.push(r); });
    salRows.forEach(s => {
      const o = sp(s["Sales Person"]); o.sal.push(s);
      const mk = keyMonth.get(s["Unique Key"]); if (mk) bucket(o, mk).sal.push(s);
    });
    refRows.forEach(f => {
      const o = sp(f["Sales Person"]);
      const amt = RS.num(f["Sales Commission Reduced Amount"]);
      o.reduced += amt; bucket(o, mkOf(f)).reduced += amt;
    });
    const spList = [...spMap.values()];
    spList.forEach(o => {
      o.jobs = M["Total Jobs"].fn(o.rows);
      o.bill = M["Total Bill"].fn(o.rows);
      o.net = M["Net Cash"].fn(o.rows);
      o.comm = M["Sales Commission"].fn(o.sal);
      o.commFinal = o.comm - o.reduced;   // PBI 'Sales Commission Final'-style: commission − reduced
      // PBI 'Total Bill Normalized For Sales' — SUMX over SP slots of
      // Bill Distribution × the job's raw Total Bill (splits multi-SP jobs fairly).
      o.normBill = o.sal.reduce((a, s) =>
        a + distScale * RS.num(s["Bill Distribution"]) * (keyBill.get(s["Unique Key"]) || 0), 0);
    });

    // ---- Calculate-by registry (PBI field param 'Calculate by - Sales Person Analysis' subset)
    const CALCS = {
      "Total Jobs":          { key: "jobs", fmt: RS.fmtN, of: b => M["Total Jobs"].fn(b.rows) },
      "Total Bill":          { key: "bill", fmt: RS.money, of: b => M["Total Bill"].fn(b.rows) },
      "Net Cash":            { key: "net", fmt: RS.money, of: b => M["Net Cash"].fn(b.rows) },
      "Sales Commission":    { key: "comm", fmt: RS.money, of: b => M["Sales Commission"].fn(b.sal) },
      "Commission Final":    { key: "commFinal", fmt: RS.money,   // PBI 'Sales Commission Final'-style
        of: b => M["Sales Commission"].fn(b.sal) - b.reduced },
    };
    let calcBy = "Total Bill";

    // ---- MoM delta window: last two COMPLETE months in scope (partial month excluded)
    const now = new Date();
    const curKey = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);
    const deltaMonths = [...new Set(rows.map(mkOf))].sort().filter(k => k !== curKey).slice(-2);
    const dPrev = deltaMonths.length === 2 ? deltaMonths[0] : null;
    const dLast = deltaMonths.length === 2 ? deltaMonths[1] : null;
    const fmtDelta = v => v == null ? "—" :
      `<span class="${v >= 0 ? "spa-up" : "spa-down"}">${v >= 0 ? "+" : ""}${(100 * v).toFixed(1)}%</span>`;
    const momOf = o => {   // per-SP MoM growth for the chosen calc
      if (!dLast) return null;
      const c = CALCS[calcBy];
      const cur = o.mm[dLast] ? c.of(o.mm[dLast]) : 0;
      const prev = o.mm[dPrev] ? c.of(o.mm[dPrev]) : 0;
      return prev ? (cur - prev) / Math.abs(prev) : null;
    };
    const kpiMom = of => {   // page-level MoM badge appended to a KPI value
      if (!dLast) return "";
      const agg = mk => spList.reduce((a, o) => a + (o.mm[mk] ? of(o.mm[mk]) : 0), 0);
      const prev = agg(dPrev), cur = agg(dLast);
      const g = prev ? (cur - prev) / Math.abs(prev) : null;
      return g == null ? "" : ` <span class="spa-kd">${fmtDelta(g)}</span>`;
    };

    host.innerHTML = `
      <style>
        .spa-up{color:#b7e23b;font-weight:700}.spa-down{color:#f87171;font-weight:700}
        .spa-kd{font-size:12px;font-weight:600;margin-left:2px;vertical-align:2px}
      </style>
      <div class="rs-page-head">
        <h1>Sales Person Analysis</h1>
        <p>Jobs, revenue &amp; commission per sales person · <b>${RS.fmtN(rows.length)}</b> jobs ·
           <b>${RS.fmtN(salRows.length)}</b> commission rows in scope
           <span class="freshness">· commissions time-sliced via the closing Unique Key link
           · MoM deltas compare ${dLast ? RSC.esc(mLabel(dPrev)) + " → " + RSC.esc(mLabel(dLast)) : "n/a (needs 2 complete months)"}</span></p>
      </div>
      <div class="rs-kpis" id="spaKpis"></div>
      <div id="spaMain"></div>
      <div class="rs-grid2" id="spaGrid"></div>`;

    RSC.kpis(document.getElementById("spaKpis"), [
      { label: "Total Bill", value: RS.money(totBill) + kpiMom(b => M["Total Bill"].fn(b.rows)), sub: "incl. trips extra bill" },
      { label: "Total Jobs", value: RS.fmtN(totJobs) + kpiMom(b => M["Total Jobs"].fn(b.rows)), sub: "closings in scope" },
      { label: "Sales Commission", value: RS.money(totComm) + kpiMom(b => M["Sales Commission"].fn(b.sal)), sub: "salaries via Unique Key join" },
      { label: "Amount Reduced", value: RS.money(totReduced), sub: "refund deductions from SP" },
      { label: "Commission Final", value: RS.money(totFinal), sub: "commission − reduced" },
      { label: "Avg Commission / Job", value: totJobs ? RS.money(totComm / totJobs) : "—", sub: "commission ÷ total jobs" },
      { label: "Commission % of Bill", value: totBill ? RS.fmtPct(totComm / totBill) : "—", sub: "cost-of-sales share" },
    ]);

    // ---- main card: measure by sales person (Calculate-by switcher, top 20 + rest)
    const listFor = () => {
      const c = CALCS[calcBy];
      return spList.slice().sort((a, b) => (b[c.key] || 0) - (a[c.key] || 0));
    };
    const mainCard = RSC.chartCard(document.getElementById("spaMain"), {
      title: "By Sales Person",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="spaCalc">` +
        Object.keys(CALCS).map(c => `<option ${c === calcBy ? "selected" : ""}>${c}</option>`).join("") +
        `</select>`,
      buildChart(canvas) {
        const c = CALCS[calcBy];
        // PBI hides blank Full Name on the chart — same here (blanks stay in the table).
        const ranked = listFor().filter(x => x.name !== "—");
        const top = ranked.slice(0, 20), rest = ranked.slice(20);
        const labels = top.map(x => x.name);
        const data = top.map(x => +((x[c.key] || 0).toFixed(2)));
        const colors = top.map(() => "#b7e23b");
        if (rest.length) {   // "everything else" bucket
          labels.push(`All others (${rest.length})`);
          data.push(+rest.reduce((a, x) => a + (x[c.key] || 0), 0).toFixed(2));
          colors.push("#5b8cff");
        }
        return new Chart(canvas, {
          type: "bar",
          data: { labels, datasets: [{ label: calcBy, data, backgroundColor: colors, borderRadius: 4 }] },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: t => `${calcBy}: ${c.fmt(t.raw)}` } },
            },
            scales: {
              y: { ticks: { font: { size: 11 }, autoSkip: false,
                callback(v) { const l = this.getLabelForValue(v); return l.length > 18 ? l.slice(0, 17) + "…" : l; } } },
            },
          },
        });
      },
      buildTable() {
        const c = CALCS[calcBy];
        const ranked = listFor();
        const total = ranked.reduce((a, x) => a + (x[c.key] || 0), 0);
        const top = ranked.slice(0, 40), rest = ranked.slice(40);
        const out = top.map((x, i) => ({
          rk: i + 1, name: x.name, v: x[c.key],
          sh: total ? (x[c.key] || 0) / total : null,
          jobs: x.jobs, comm: x.comm, red: x.reduced, fin: x.commFinal, mom: momOf(x),
        }));
        if (rest.length) out.push({
          rk: null, name: `All others (${rest.length})`,
          v: rest.reduce((a, x) => a + (x[c.key] || 0), 0),
          sh: total ? rest.reduce((a, x) => a + (x[c.key] || 0), 0) / total : null,
          jobs: rest.reduce((a, x) => a + x.jobs, 0),
          comm: rest.reduce((a, x) => a + x.comm, 0),
          red: rest.reduce((a, x) => a + x.reduced, 0),
          fin: rest.reduce((a, x) => a + x.commFinal, 0), mom: null,
        });
        return RSC.table(
          [{ key: "rk", label: "#" },
           { key: "name", label: "Sales Person" },
           { key: "v", label: calcBy, fmt: c.fmt },
           { key: "sh", label: "% of total", fmt: RS.fmtPct },
           { key: "jobs", label: "Total Jobs", fmt: RS.fmtN },
           { key: "comm", label: "Sales Commission", fmt: RS.money },
           { key: "red", label: "Reduced", fmt: RS.money },
           { key: "fin", label: "Commission Final", fmt: RS.money },
           { key: "mom", label: dLast ? `Δ ${mLabel(dLast)} vs ${mLabel(dPrev)}` : "Δ MoM", fmt: fmtDelta }],
          out,
          { rk: null, name: "Total", v: total, sh: total ? 1 : null, jobs: totJobs,
            comm: totComm, red: totReduced, fin: totFinal, mom: null });
      },
    });
    document.getElementById("spaCalc").onchange = e => { calcBy = e.target.value; mainCard.rerender(); };

    const grid = document.getElementById("spaGrid");

    // ---- grid (a): normalized revenue — PBI 'Total Bill Normalized For Sales'
    // (job bill split across SP slots by Bill Distribution) vs primary-SP attribution.
    {
      const ranked = spList.filter(x => x.sal.length || x.normBill)
        .sort((a, b) => (b.normBill || 0) - (a.normBill || 0));
      const totNorm = ranked.reduce((a, x) => a + (x.normBill || 0), 0);
      const totPrim = ranked.reduce((a, x) => a + (x.bill || 0), 0);
      const top = ranked.slice(0, 20), rest = ranked.slice(20);
      const fmtDiff = v => v == null ? "—" :
        `<span class="${v >= 0 ? "spa-up" : "spa-down"}">${v >= 0 ? "+" : "−"}${RS.money(Math.abs(v))}</span>`;
      const trows = top.map((x, i) => ({
        rk: i + 1, name: x.name, nb: x.normBill,
        sh: totNorm ? x.normBill / totNorm : null, pb: x.bill, d: x.normBill - x.bill,
      }));
      if (rest.length) trows.push({
        rk: null, name: `All others (${rest.length})`,
        nb: rest.reduce((a, x) => a + x.normBill, 0),
        sh: totNorm ? rest.reduce((a, x) => a + x.normBill, 0) / totNorm : null,
        pb: rest.reduce((a, x) => a + x.bill, 0),
        d: rest.reduce((a, x) => a + (x.normBill - x.bill), 0),
      });
      const panel = RSC.el("div", "panel", `
        <div class="panel-head"><span class="panel-title">Normalized revenue</span>
          <span class="spacer"></span>
          <span class="rs-ctl"><span class="lbl">bill × SP bill-distribution share</span></span></div>
        <div class="tabwrap" id="spaNorm"></div>`);
      panel.querySelector("#spaNorm").innerHTML = RSC.table(
        [{ key: "rk", label: "#" }, { key: "name", label: "Sales Person" },
         { key: "nb", label: "Normalized Bill", fmt: RS.money },
         { key: "sh", label: "% of total", fmt: RS.fmtPct },
         { key: "pb", label: "Primary-SP Bill", fmt: RS.money },
         { key: "d", label: "Δ norm − primary", fmt: fmtDiff }],
        trows,
        { rk: null, name: "Total", nb: totNorm, sh: totNorm ? 1 : null,
          pb: totPrim, d: totNorm - totPrim });
      grid.appendChild(panel);
    }

    // ---- grid (b): SP × month matrix on Total Bill (top 12 keeps rows scannable)
    {
      const topSet = new Set(spList.filter(x => x.name !== "—")
        .sort((a, b) => (b.bill || 0) - (a.bill || 0)).slice(0, 12).map(x => x.name));
      const mrows = rows.filter(r => topSet.has(String(r["Sales Person"] || "")));
      const panel = RSC.el("div", "panel", `
        <div class="panel-head"><span class="panel-title">Sales Person × Month — Total Bill</span>
          <span class="spacer"></span>
          <span class="rs-ctl"><span class="lbl">top 12 by Total Bill · last 8 months</span></span></div>
        <div class="tabwrap" id="spaMx"></div>`);
      panel.querySelector("#spaMx").innerHTML =
        RSC.matrix(mrows, "Sales Person", "Total Bill", { rowLabel: "Sales Person", lastN: 8 });
      grid.appendChild(panel);
    }
  },
});
