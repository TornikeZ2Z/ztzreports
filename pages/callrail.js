/* GO page: CallRail — inbound call analytics by tracking number / ad source.
   PBI source: General Overview "CallRail" (05-dashboards.md GO-8). The PBI page is a
   single tableEx (Source, Incoming Calls, Unique Calls, Returning Users, Total Duration,
   Average Duration); rebuilt with the same measures plus monthly trend, call-status
   split and a busiest-weekday profile. */
registerPage({
  id: "callrail",
  group: "sales",
  title: "CallRail",
  async render(host) {
    const all = await RS.load("callrail");
    const rows = RS.filtered("callrail", all);
    const M = RS.M;

    /* ---- helpers (all Call Status / First-Time values handled defensively) ---- */
    const mmss = s => { if (s == null || isNaN(s)) return "—";
      const t = Math.round(s);   // round total secs first so :60 can never render
      return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
    const hm = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
      return h ? h + "h " + m + "m" : m + "m"; };
    // current statuses: 'Answered Call' / 'Abandoned Call' / 'Missed Call' — match by keyword
    const isAnswered = r => String(r["Call Status"] || "").toLowerCase().indexOf("answer") >= 0;
    const isFirst = r => { const v = String(r["First-Time Caller"]).toLowerCase();
      return v === "1" || v === "true"; };
    const durSum = rs => rs.reduce((a, r) => a + RS.num(r["Duration Seconds"]), 0); // PBI: Total Duration
    const avgDurOf = rs => M["Avg Call Duration (s)"].fn(rs);                       // PBI: Average Duration
    // PBI: Unique Calls = DISTINCTCOUNT(Name)
    const uniqueCalls = rs => { const s = new Set();
      rs.forEach(r => { if (r.Name != null && r.Name !== "") s.add(String(r.Name)); });
      return s.size; };
    // PBI: Returning Users = calls where First-Time Caller = FALSE
    const returning = rs => rs.filter(r => !isFirst(r)).length;
    const delta = v => v == null ? "" : v > 0
      ? `<span class="up" style="color:var(--brand)">+${RS.fmtN(v)}</span>`
      : v < 0 ? `<span class="down" style="color:var(--red)">-${RS.fmtN(-v)}</span>` : "0";

    const total = M["Total Calls"].fn(rows);           // PBI: Incoming Calls
    const ft = M["First-Time Callers"].fn(rows);
    const answered = rows.filter(isAnswered).length;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>CallRail</h1>
        <p>Inbound call tracking by ad number · <b>${RS.fmtN(rows.length)}</b> calls in scope
           <span class="freshness">· Source = tracking-number name via the source translator</span></p>
      </div>
      <div class="rs-kpis" id="crKpis"></div>
      <div id="crMain"></div>
      <div class="rs-grid2" id="crGrid"></div>`;

    RSC.kpis(document.getElementById("crKpis"), [
      { label: "Total Calls", value: RS.fmtN(total), sub: "PBI: Incoming Calls" },
      { label: "First-Time Callers", value: RS.fmtN(ft), sub: "new phone numbers" },
      { label: "First-Time Rate", value: RS.fmtPct(total ? ft / total : null), sub: "first-time / total calls" },
      { label: "Answered Rate", value: RS.fmtPct(total ? answered / total : null),
        sub: `${RS.fmtN(answered)} answered · ${RS.fmtN(total - answered)} lost` },
      { label: "Avg Call Duration", value: mmss(avgDurOf(rows)), sub: "m:ss · non-zero calls" },
      { label: "Unique Callers", value: RS.fmtN(uniqueCalls(rows)), sub: "PBI: Unique Calls (distinct name)" },
      { label: "Total Talk Time", value: hm(durSum(rows)), sub: "PBI: Total Duration" },
    ]);

    /* ---- month buckets (built once, reused by chart + tabular) ---- */
    const mk = r => r._y + "-" + String(r._m).padStart(2, "0");
    const byMonth = {};
    rows.forEach(r => { if (!r._d) return;   // skip undated rows — no "-00" bucket
      const k = mk(r); (byMonth[k] = byMonth[k] || []).push(r); });
    const months = Object.keys(byMonth).sort();
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);

    /* ---- main: calls by month (bars total + line first-time) ---- */
    RSC.chartCard(document.getElementById("crMain"), {
      title: "Calls by month",
      controlsHtml: `<span class="lbl">bars: total calls · line: first-time callers</span>`,
      buildChart(canvas) {
        const shown = months.slice(-24);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: shown.map(mLabel),
            datasets: [
              { type: "line", label: "First-Time Callers",
                data: shown.map(k => M["First-Time Callers"].fn(byMonth[k])),
                borderColor: "#5b8cff", backgroundColor: "#5b8cff",
                borderWidth: 2, pointRadius: 2.5, tension: .3 },
              { label: "Total Calls", data: shown.map(k => byMonth[k].length),
                backgroundColor: "#b7e23b", borderRadius: 4 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { afterBody: items => {
                const rs = byMonth[months.slice(-24)[items[0].dataIndex]] || [];
                const a = rs.filter(isAnswered).length;
                return [`Answered: ${RS.fmtN(a)} (${rs.length ? (100 * a / rs.length).toFixed(1) : 0}%)`,
                        `Avg duration: ${mmss(avgDurOf(rs))}`];
              } } },
            },
            scales: { x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } } },
          },
        });
      },
      buildTable() {
        const data = months.map((k, i) => {
          const rs = byMonth[k], f = M["First-Time Callers"].fn(rs);
          const prev = i ? byMonth[months[i - 1]].length : null;
          return { m: mLabel(k), c: rs.length, d: prev == null ? null : rs.length - prev,
                   f, fp: rs.length ? f / rs.length : null,
                   ap: rs.length ? rs.filter(isAnswered).length / rs.length : null,
                   avg: avgDurOf(rs) };
        });
        return RSC.table(
          [{ key: "m", label: "Month" }, { key: "c", label: "Total Calls", fmt: RS.fmtN },
           { key: "d", label: "Δ vs prev mo", fmt: delta },
           { key: "f", label: "First-Time", fmt: RS.fmtN },
           { key: "fp", label: "First-Time %", fmt: RS.fmtPct },
           { key: "ap", label: "Answered %", fmt: RS.fmtPct },
           { key: "avg", label: "Avg Duration", fmt: mmss }],
          data,
          { m: "Total", c: total, d: null, f: ft, fp: total ? ft / total : null,
            ap: total ? answered / total : null, avg: avgDurOf(rows) });
      },
    });

    /* ---- grid: by number-name/source · by call status · weekdays · recent ---- */
    const grid = document.getElementById("crGrid");

    // (a) PBI "Advertisement Tabular Analysis" — same measures, switchable dimension
    // (PBI groups by translated Source; raw Number Name kept as the default drill).
    let dim = "Number Name";
    const byDim = () => {
      const g = {};
      rows.forEach(r => { const k = (r[dim] == null || r[dim] === "") ? "—" : String(r[dim]);
        (g[k] = g[k] || []).push(r); });
      return Object.entries(g).map(([k, rs]) => ({ k, rs, n: rs.length }))
        .sort((a, b) => b.n - a.n);
    };
    const dimCard = RSC.chartCard(grid, {
      title: "Calls by ad number",
      controlsHtml: `<span class="lbl">Dimension</span>
        <select id="crDim"><option selected>Number Name</option><option>Source</option></select>`,
      buildChart(canvas) {
        const list = byDim();
        const top = list.slice(0, 15);
        const rest = list.slice(15);
        const labels = top.map(x => x.k);
        const data = top.map(x => x.n);
        if (rest.length) {   // "everything else" bucket keeps the top-N honest
          labels.push(`Everything else (${rest.length})`);
          data.push(rest.reduce((a, x) => a + x.n, 0));
        }
        return new Chart(canvas, {
          type: "bar",
          data: { labels, datasets: [{ label: "Calls", data,
            backgroundColor: labels.map((_, i) => i < top.length ? "#b7e23b" : "#6b7a88"),
            borderRadius: 4 }] },
          options: {
            indexAxis: "y", responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: c =>
                `${RS.fmtN(c.raw)} calls (${total ? (100 * c.raw / total).toFixed(1) : 0}%)` } } },
            scales: { y: { ticks: { font: { size: 10.5 },
              callback(v) { const l = this.getLabelForValue(v);
                return l.length > 20 ? l.slice(0, 19) + "…" : l; } } } },
          },
        });
      },
      buildTable() {
        const list = byDim();
        return RSC.table(
          [{ key: "r", label: "#" }, { key: "k", label: dim },
           { key: "c", label: "Calls", fmt: RS.fmtN },          // PBI: Incoming Calls
           { key: "sh", label: "% of Calls", fmt: RS.fmtPct },
           { key: "u", label: "Unique", fmt: RS.fmtN },          // PBI: Unique Calls
           { key: "ret", label: "Returning", fmt: RS.fmtN },     // PBI: Returning Users
           { key: "td", label: "Total Dur", fmt: hm },           // PBI: Total Duration
           { key: "avg", label: "Avg Dur", fmt: mmss }],         // PBI: Average Duration
          list.slice(0, 60).map((x, i) => ({
            r: i + 1, k: x.k, c: x.n, sh: total ? x.n / total : null,
            u: uniqueCalls(x.rs), ret: returning(x.rs), td: durSum(x.rs), avg: avgDurOf(x.rs),
          })),
          { r: "", k: "Total", c: total, sh: total ? 1 : null, u: uniqueCalls(rows),
            ret: returning(rows), td: durSum(rows), avg: avgDurOf(rows) });
      },
    });
    dimCard.card.querySelector("#crDim").onchange = e => { dim = e.target.value; dimCard.rerender(); };

    // (b) call-status split (doughnut + tabular) — colors keyed by status keyword
    const statColor = s => { const t = String(s).toLowerCase();
      return t.indexOf("answer") >= 0 ? "#b7e23b" : t.indexOf("abandon") >= 0 ? "#fbbf24"
        : t.indexOf("miss") >= 0 ? "#f87171" : t.indexOf("voice") >= 0 ? "#a78bfa" : "#5b8cff"; };
    const byStatus = (() => {
      const g = {};
      rows.forEach(r => { const k = (r["Call Status"] == null || r["Call Status"] === "")
        ? "—" : String(r["Call Status"]); (g[k] = g[k] || []).push(r); });
      return Object.entries(g).map(([k, rs]) => ({ k, rs, n: rs.length }))
        .sort((a, b) => b.n - a.n);
    })();
    RSC.chartCard(grid, {
      title: "By call status",
      buildChart(canvas) {
        return new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: byStatus.map(x => x.k),
            datasets: [{ data: byStatus.map(x => x.n),
              backgroundColor: byStatus.map(x => statColor(x.k)), borderWidth: 1 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: "58%",
            plugins: {
              legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c =>
                `${c.label}: ${RS.fmtN(c.raw)} (${total ? (100 * c.raw / total).toFixed(1) : 0}%)` } },
            },
          },
        });
      },
      buildTable() {
        return RSC.table(
          [{ key: "k", label: "Call Status" }, { key: "c", label: "Calls", fmt: RS.fmtN },
           { key: "sh", label: "% of Calls", fmt: RS.fmtPct },
           { key: "f", label: "First-Time", fmt: RS.fmtN },
           { key: "avg", label: "Avg Dur", fmt: mmss }],
          byStatus.map(x => ({ k: x.k, c: x.n, sh: total ? x.n / total : null,
            f: M["First-Time Callers"].fn(x.rs), avg: avgDurOf(x.rs) })),
          { k: "Total", c: total, sh: total ? 1 : null, f: ft, avg: avgDurOf(rows) });
      },
    });

    // (c) busiest weekdays (improvement — not in PBI): derived from the pre-sliced _d
    const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const wdGroups = {};
    rows.forEach(r => {
      const d = new Date(r._d + "T00:00:00"); if (isNaN(d)) return;
      const k = WD[d.getDay()]; (wdGroups[k] = wdGroups[k] || []).push(r);
    });
    const wdList = Object.entries(wdGroups).map(([k, rs]) => ({ k, rs, n: rs.length }))
      .sort((a, b) => b.n - a.n);
    const wdPanel = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Busiest weekdays</span>
         <span class="spacer"></span>
         <span class="rs-ctl"><span class="lbl">ranked by call volume</span></span></div>
       <div class="tabwrap"></div>`);
    wdPanel.querySelector(".tabwrap").innerHTML = RSC.table(
      [{ key: "r", label: "#" }, { key: "k", label: "Weekday" },
       { key: "c", label: "Calls", fmt: RS.fmtN },
       { key: "sh", label: "% of Calls", fmt: RS.fmtPct },
       { key: "ap", label: "Answered %", fmt: RS.fmtPct },
       { key: "avg", label: "Avg Dur", fmt: mmss }],
      wdList.map((x, i) => ({ r: i + 1, k: x.k, c: x.n, sh: total ? x.n / total : null,
        ap: x.n ? x.rs.filter(isAnswered).length / x.n : null, avg: avgDurOf(x.rs) })));
    grid.appendChild(wdPanel);

    // (d) most recent calls — drill-to-detail (mirrors the Storage page's payments list)
    const recPanel = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Recent calls</span>
         <span class="spacer"></span>
         <span class="rs-ctl"><span class="lbl">most recent 30 of ${RS.fmtN(rows.length)}</span></span></div>
       <div class="tabwrap"></div>`);
    {
      const recent = rows.slice()   // full timestamp, not _d: intraday order matters here
        .sort((a, b) => String(b["Start Time"] || "").localeCompare(String(a["Start Time"] || "")))
        .slice(0, 30);
      recPanel.querySelector(".tabwrap").innerHTML = RSC.table(
        [{ key: "d", label: "Date" }, { key: "n", label: "Caller" },
         { key: "nn", label: "Number Name" }, { key: "s", label: "Status" },
         { key: "f", label: "First-Time" }, { key: "dur", label: "Duration", fmt: mmss }],
        recent.map(r => ({
          d: r._d || "—", n: r.Name || "—", nn: r["Number Name"] || "—",
          s: r["Call Status"] || "—", f: isFirst(r) ? "Yes" : "—",
          dur: RS.num(r["Duration Seconds"]),
        })));
    }
    grid.appendChild(recPanel);
  },
});
