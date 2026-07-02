/* GO page: Forman Analysis — deep foreman comparison (PBI GO-4).
   PBI has a 22-option "Calculate by - Forman Analysis" field parameter; the
   meaningful closing-sheet subset is implemented here (the scorecard-derived
   options — Forman Scores, Packing per 100 CF, claims/refunds — live on their
   own pages). Helper cost is membership-joined from fct_helper_salaries via
   the closing row's Unique Key, so it inherits the global date/slicer scope. */

/* "Tip for Forman" (curated calc column, PBI: 'Forman Tip Part' = SUM(Tip for Forman))
   is not in rs-core's closing column list yet — append it at script load, before
   any RS.load("closing") caches the fetch (same pattern as storage.js). */
if (RS.DATASETS.closing.cols.indexOf("Tip for Forman") < 0)
  RS.DATASETS.closing.cols.push("Tip for Forman");

registerPage({
  id: "forman-analysis",
  group: "ops",
  title: "Forman Analysis",
  async render(host) {
    const [closingAll, helpersAll] = await Promise.all([
      RS.load("closing"), RS.load("helper_salaries"),
    ]);
    const rows = RS.filtered("closing", closingAll);
    const M = RS.M;

    // ---- helper_salaries is a lookup (no date column): Unique Key -> helper cost.
    // Time slicing happens through the FILTERED closing rows' key membership.
    const helperByKey = new Map();
    helpersAll.forEach(r => {
      const k = r["Unique Key"];
      if (k) helperByKey.set(k, (helperByKey.get(k) || 0) + RS.num(r["Amount Received"]));
    });
    const helperCost = rs => rs.reduce((a, r) => a + (helperByKey.get(r["Unique Key"]) || 0), 0);

    // ---- the Calculate-by registry (subset of PBI's 22 Forman-Analysis options).
    // add=true → additive, share-of-total is meaningful.
    const CALC = {
      "Total Jobs":             { fmt: RS.fmtN,   add: true,  fn: rs => M["Total Jobs"].fn(rs) },
      "Total Bill":             { fmt: RS.money,  add: true,  fn: rs => M["Total Bill"].fn(rs) },
      "Net Cash":               { fmt: RS.money,  add: true,  fn: rs => M["Net Cash"].fn(rs) },
      "Hours Worked by Forman": { fmt: RS.fmtN,   add: true,  fn: rs => M["Hours Worked by Forman"].fn(rs) },
      "Total Tips":             { fmt: RS.money,  add: true,  fn: rs => M["Total Tips"].fn(rs) },
      // PBI measure 'Forman Tip Part' = SUM('Closing Sheet'[Tip for Forman])
      "Tip for Forman":         { fmt: RS.money,  add: true,
        fn: rs => rs.reduce((a, r) => a + RS.num(r["Tip for Forman"]), 0) },
      // PBI calc column 'Crew Size' (count of non-blank crew roles), averaged per job
      "Crew Size (avg)":        { fmt: RS.fmt1,   add: false,
        fn: rs => rs.length ? rs.reduce((a, r) => a + RS.num(r["Crew Size"]), 0) / rs.length : null },
      // PBI calc column 'Job Part of the Day' — share of jobs flagged 'Morning Job'
      "Morning Jobs %":         { fmt: RS.fmtPct, add: false,
        fn: rs => rs.length ? rs.filter(r => r["Job Part of the Day"] === "Morning Job").length / rs.length : null },
      // PBI measure 'Helper Salary' = SUM(Amount Received), attributed to the job's foreman
      "Helper Cost":            { fmt: RS.money,  add: true,  fn: helperCost },
    };
    let calcBy = "Total Bill";

    // ---- previous period (same-length window immediately before the date range) —
    // KPI deltas, computed only when an explicit date range is active.
    const prevRows = () => {
      const s = RS.state;
      if (!s.dateFrom || !s.dateTo) return null;
      const from = new Date(s.dateFrom + "T00:00:00"), to = new Date(s.dateTo + "T00:00:00");
      const span = Math.round((to - from) / 864e5) + 1;
      // local-date ISO (toISOString shifts a local midnight back a day in UTC+ zones)
      const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
      const pf = new Date(from); pf.setDate(pf.getDate() - span);
      const pt = new Date(from); pt.setDate(pt.getDate() - 1);
      const save = { f: s.dateFrom, t: s.dateTo };
      s.dateFrom = iso(pf); s.dateTo = iso(pt);
      const out = RS.filtered("closing", closingAll);
      s.dateFrom = save.f; s.dateTo = save.t;
      return out;
    };
    const delta = (cur, prev) => {
      if (prev == null || cur == null || !isFinite(prev) || prev === 0) return "";
      const g = (cur - prev) / Math.abs(prev);
      return ` <span class="${g >= 0 ? "up" : "down"}">${g >= 0 ? "▲" : "▼"} ${(100 * Math.abs(g)).toFixed(1)}%</span>`;
    };
    const prev = prevRows();

    host.innerHTML = `
      <style>#faKpis .up{color:var(--brand)}#faKpis .down{color:var(--red)}</style>
      <div class="rs-page-head">
        <h1>Forman Analysis</h1>
        <p>Foreman performance comparison · <b>${RS.fmtN(rows.length)}</b> jobs in scope
           <span class="freshness">· helper cost joined from helper salaries via Unique Key
           ${prev ? "· KPI deltas vs previous period of equal length" : "· set a date range for period deltas"}</span></p>
      </div>
      <div class="rs-kpis" id="faKpis"></div>
      <div id="faMain"></div>
      <div class="rs-grid2" id="faGrid"></div>`;

    const kpiDef = [
      { label: "Total Jobs", c: "Total Jobs", sub: "closed jobs (incl. trips)" },
      { label: "Total Bill", c: "Total Bill", sub: "revenue + trips extra" },
      { label: "Hours Worked", c: "Hours Worked by Forman", sub: "foreman hours" },
      { label: "Avg Crew Size", c: "Crew Size (avg)", sub: "crew members / job" },
      { label: "Total Tips", c: "Total Tips", sub: "customer + company tips" },
      { label: "Helper Cost", c: "Helper Cost", sub: "helper salaries in scope" },
    ];
    RSC.kpis(document.getElementById("faKpis"), kpiDef.map(k => {
      const c = CALC[k.c], cur = c.fn(rows);
      return { label: k.label, sub: k.sub,
        value: c.fmt(cur) + (prev ? delta(cur, c.fn(prev)) : "") };
    }));

    // ---- group closing rows by foreman once per render pass
    const byForeman = () => {
      const g = {};
      rows.forEach(r => {
        const f = (r.Foreman == null || r.Foreman === "") ? "—" : String(r.Foreman);
        (g[f] = g[f] || []).push(r);
      });
      const c = CALC[calcBy];
      return Object.entries(g).map(([f, rs]) => ({ f, rs, v: c.fn(rs) }))
        .sort((a, b) => (b.v || 0) - (a.v || 0));
    };

    // ---- main card: foreman comparison bar + the full tabular breakdown
    const mainCard = RSC.chartCard(document.getElementById("faMain"), {
      title: "Foreman comparison",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="faCalc">` +
        Object.keys(CALC).map(c => `<option ${c === calcBy ? "selected" : ""}>${c}</option>`).join("") +
        `</select>`,
      buildChart(canvas) {
        const c = CALC[calcBy];
        const list = byForeman().slice(0, 20);
        const isMoney = c.fmt === RS.money, isPct = c.fmt === RS.fmtPct;
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.f),
            datasets: [{ label: calcBy,
              data: list.map(x => x.v == null ? 0 : +(+x.v).toFixed(isPct ? 4 : 2)),
              backgroundColor: "#b7e23b", borderRadius: 4 }],
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: ct => `${calcBy}: ${c.fmt(ct.raw)}` } } },
            scales: {
              x: { ticks: { callback: v => isMoney ? "$" + (v / 1000) + "k" : isPct ? (100 * v).toFixed(0) + "%" : RS.fmtN(v) } },
              y: { ticks: { font: { size: 11 },
                callback(v) { const l = this.getLabelForValue(v);
                  return l.length > 16 ? l.slice(0, 15) + "…" : l; } } },
            },
          },
        });
      },
      buildTable() {
        const c = CALC[calcBy];
        const total = c.add ? c.fn(rows) : null;
        const mk = rs => ({
          jobs: CALC["Total Jobs"].fn(rs), bill: CALC["Total Bill"].fn(rs),
          net: CALC["Net Cash"].fn(rs), hrs: CALC["Hours Worked by Forman"].fn(rs),
          tips: CALC["Total Tips"].fn(rs), tipf: CALC["Tip for Forman"].fn(rs),
          crew: CALC["Crew Size (avg)"].fn(rs), morn: CALC["Morning Jobs %"].fn(rs),
          help: CALC["Helper Cost"].fn(rs),
        });
        const all = byForeman();
        const shown = all.slice(0, 40);
        const data = shown.map((x, i) => Object.assign(
          { rk: i + 1, f: x.f, sh: (c.add && total) ? (x.v || 0) / total : null }, mk(x.rs)));
        if (all.length > 40) {              // "everything else" bucket
          const restRows = all.slice(40).flatMap(x => x.rs);
          data.push(Object.assign(
            { rk: null, f: `All others (${all.length - 40})`,
              sh: (c.add && total) ? (c.fn(restRows) || 0) / total : null }, mk(restRows)));
        }
        return RSC.table(
          [{ key: "rk", label: "#", fmt: v => v == null ? "—" : RS.fmtN(v) },
           { key: "f", label: "Foreman" },
           { key: "sh", label: "% of " + calcBy, fmt: RS.fmtPct },
           { key: "jobs", label: "Jobs", fmt: RS.fmtN },
           { key: "bill", label: "Total Bill", fmt: RS.money },
           { key: "net", label: "Net Cash", fmt: RS.money },
           { key: "hrs", label: "Hours", fmt: RS.fmtN },
           { key: "tips", label: "Total Tips", fmt: RS.money },
           { key: "tipf", label: "Tip for Forman", fmt: RS.money },
           { key: "crew", label: "Avg Crew", fmt: RS.fmt1 },
           { key: "morn", label: "Morning %", fmt: RS.fmtPct },
           { key: "help", label: "Helper Cost", fmt: RS.money }],
          data,
          Object.assign({ rk: null, f: "Total", sh: (c.add && total) ? 1 : null }, mk(rows)));
      },
    });
    document.getElementById("faCalc").onchange = e => {
      calcBy = e.target.value; mainCard.rerender();
    };

    const grid = document.getElementById("faGrid");

    // ---- grid (a): Foreman × month matrix (PBI "Forman Tabular Analysis" pivot —
    // Rows: Forman Full Name; Columns: End of Month; Values: chosen Calculate-by).
    // Custom matrix (not RSC.matrix) because the calc registry is page-local.
    let mxBy = "Total Jobs";
    const mx = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Foreman × Month</span>
         <span class="rs-ctl"><span class="lbl">Measure</span><select id="faMxCalc">` +
        Object.keys(CALC).map(c => `<option ${c === mxBy ? "selected" : ""}>${c}</option>`).join("") +
        `</select></span><span class="spacer"></span>
         <span class="rs-ctl"><span class="lbl">top 15 · last 13 mo</span></span></div>
       <div class="tabwrap" id="faMx"></div>`);
    grid.appendChild(mx);
    const paintMatrix = () => {
      const c = CALC[mxBy];
      const months = [...new Set(rows.map(r => r._y + "-" + String(r._m).padStart(2, "0")))]
        .sort().slice(-13);
      const byF = {};
      rows.forEach(r => {
        const f = (r.Foreman == null || r.Foreman === "") ? "—" : String(r.Foreman);
        const mm = r._y + "-" + String(r._m).padStart(2, "0");
        const e = byF[f] = byF[f] || { all: [], mm: {} };
        e.all.push(r); (e.mm[mm] = e.mm[mm] || []).push(r);
      });
      const entries = Object.entries(byF)
        .map(([f, e]) => ({ f, total: c.fn(e.all), mm: e.mm }))
        .sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, 15);
      const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);
      let html = `<table class="tab"><thead><tr><th>Foreman</th>` +
        months.map(k => `<th>${mLabel(k)}</th>`).join("") + `<th>Total</th></tr></thead><tbody>`;
      entries.forEach(e => {
        html += `<tr><td>${RSC.esc(e.f)}</td>` +
          months.map(k => `<td>${e.mm[k] ? c.fmt(c.fn(e.mm[k])) : "—"}</td>`).join("") +
          `<td><b>${c.fmt(e.total)}</b></td></tr>`;
      });
      html += `</tbody><tfoot><tr><td>Total (all foremen)</td>` + months.map(k => {
        const rs = rows.filter(r => (r._y + "-" + String(r._m).padStart(2, "0")) === k);
        return `<td>${c.fmt(c.fn(rs))}</td>`;
      }).join("") + `<td>${c.fmt(c.fn(rows))}</td></tr></tfoot></table>`;
      document.getElementById("faMx").innerHTML = html;
    };
    paintMatrix();
    document.getElementById("faMxCalc").onchange = e => { mxBy = e.target.value; paintMatrix(); };

    // ---- grid (b): Morning vs Afternoon jobs by foreman (stacked, top 12) —
    // PBI 'Job Part of the Day' split ('Forman Job Order' = 1 → Morning Job).
    const partSplit = () => {
      const g = {};
      rows.forEach(r => {
        const f = (r.Foreman == null || r.Foreman === "") ? "—" : String(r.Foreman);
        const e = g[f] = g[f] || { f, am: 0, pm: 0 };
        if (r["Job Part of the Day"] === "Morning Job") e.am++; else e.pm++;
      });
      return Object.values(g).sort((a, b) => (b.am + b.pm) - (a.am + a.pm));
    };
    RSC.chartCard(grid, {
      title: "Morning vs Afternoon jobs",
      controlsHtml: `<span class="lbl">top 12 foremen · by job count</span>`,
      buildChart(canvas) {
        const list = partSplit().slice(0, 12);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.f),
            datasets: [
              { label: "Morning Job", data: list.map(x => x.am), backgroundColor: "#b7e23b", borderRadius: 3 },
              { label: "Afternoon Job", data: list.map(x => x.pm), backgroundColor: "#5b8cff", borderRadius: 3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { footer: items => {
                const t = items.reduce((a, i) => a + i.raw, 0);
                return t ? "Morning share: " + (100 * items.find(i => i.dataset.label === "Morning Job").raw / t).toFixed(1) + "%" : "";
              } } },
            },
            scales: {
              x: { stacked: true, ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
              y: { stacked: true },
            },
          },
        });
      },
      buildTable() {
        const all = partSplit();
        const shown = all.slice(0, 12);
        const data = shown.map(x => ({ f: x.f, am: x.am, pm: x.pm, t: x.am + x.pm,
          sh: (x.am + x.pm) ? x.am / (x.am + x.pm) : null }));
        if (all.length > 12) {
          const rest = all.slice(12);
          const am = rest.reduce((a, x) => a + x.am, 0), pm = rest.reduce((a, x) => a + x.pm, 0);
          data.push({ f: `All others (${rest.length})`, am, pm, t: am + pm,
            sh: (am + pm) ? am / (am + pm) : null });
        }
        const tam = all.reduce((a, x) => a + x.am, 0), tpm = all.reduce((a, x) => a + x.pm, 0);
        return RSC.table(
          [{ key: "f", label: "Foreman" },
           { key: "am", label: "Morning Jobs", fmt: RS.fmtN },
           { key: "pm", label: "Afternoon Jobs", fmt: RS.fmtN },
           { key: "t", label: "Total", fmt: RS.fmtN },
           { key: "sh", label: "Morning %", fmt: RS.fmtPct }],
          data,
          { f: "Total", am: tam, pm: tpm, t: tam + tpm, sh: (tam + tpm) ? tam / (tam + tpm) : null });
      },
    });
  },
});
