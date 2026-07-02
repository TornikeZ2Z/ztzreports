/* GO page: Claims — claims registry: volume by month, responsibility split,
   reason breakdown, refund impact. PBI source: General Overview "Claims"
   (05-dashboards.md GO-12: two side-by-side detail tables split on
   'Number of Claims Written Because of Forman' — reproduced compactly as a
   responsibility doughnut + a foreman-fault filter on the recent-claims panel). */
registerPage({
  id: "claims",
  group: "ops",
  title: "Claims",
  async render(host) {
    const [claimsAll, scorecardAll, rollupAll, closingAll] = await Promise.all([
      RS.load("claims"), RS.load("scorecard"), RS.load("rollup"), RS.load("closing")]);
    const rows = RS.filtered("claims", claimsAll);
    const scRows = RS.filtered("scorecard", scorecardAll);
    const closingRows = RS.filtered("closing", closingAll);
    const M = RS.M;

    /* rollup_support has NO date column — never RS.filtered. Time-slice it via
       membership joins: request keys from the FILTERED claims / closing rows. */
    const claimKeys = new Set(rows.map(r => r["Request Joinkey"]).filter(Boolean));
    const closingKeys = new Set(closingRows.map(r => r["Request Joinkey"]).filter(Boolean));
    const rollupByKey = new Map();
    rollupAll.forEach(r => {
      const k = r["Request Joinkey"];
      if (k && !rollupByKey.has(k)) rollupByKey.set(k, r);
    });
    const refundOf = k => { const ru = rollupByKey.get(k); return ru ? RS.num(ru["Amount Refunded"]) : 0; };

    // PBI 'Amount Refunded' — rollup summed over the filtered closing request set.
    let amtRefunded = 0, amtRefundedNR = 0;
    rollupAll.forEach(r => {
      if (!closingKeys.has(r["Request Joinkey"])) return;
      amtRefunded += RS.num(r["Amount Refunded"]);
      // PBI 'Amount Refunded Because of Negative Reviews'
      amtRefundedNR += RS.num(r["Amount Refunded Because of Negative Reviews"]);
    });
    // Claim requests that ended in money out — rollup joined via the claim request set.
    let refundedClaimReqs = 0;
    rollupAll.forEach(r => {
      if (claimKeys.has(r["Request Joinkey"]) && RS.num(r["Amount Refunded"]) > 0) refundedClaimReqs++;
    });

    const nClaims = M["Number of Claims"].fn(rows);
    const totalJobs = M["Total Jobs"].fn(closingRows);
    // Scorecard 'Forman Fault Claims' — feeds the PBI filter measure
    // 'Number of Claims Written Because of Forman' (GO-12 left table).
    const foremanFault = scRows.reduce((a, r) => a + RS.num(r["Forman Fault Claims"]), 0);

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Claims</h1>
        <p>Claims registry with responsibility split and refund impact ·
           <b>${RS.fmtN(nClaims)}</b> claims in scope
           <span class="freshness">· refund amounts joined from the support rollup via request membership</span></p>
      </div>
      <div class="rs-kpis" id="clmKpis"></div>
      <div id="clmMain"></div>
      <div class="rs-grid2" id="clmSubs"></div>
      <div id="clmRecent"></div>`;

    RSC.kpis(document.getElementById("clmKpis"), [
      { label: "Number of Claims", value: RS.fmtN(nClaims), sub: "claims in scope" },
      { label: "Foreman-Fault Claims", value: RS.fmtN(foremanFault), sub: "scorecard: Forman Fault Claims" },
      { label: "Requests w/ Refunds", value: RS.fmtN(refundedClaimReqs),
        sub: `${RS.fmtPct(claimKeys.size ? refundedClaimReqs / claimKeys.size : null)} of ${RS.fmtN(claimKeys.size)} claim requests` },
      { label: "Amount Refunded", value: RS.money(amtRefunded), sub: "rollup over filtered closing requests" },
      { label: "Refunded for Neg. Reviews", value: RS.money(amtRefundedNR),
        sub: `${RS.fmtPct(amtRefunded ? amtRefundedNR / amtRefunded : null)} of amount refunded` },
      // portal-added density metric (no PBI counterpart)
      { label: "Claims per 100 Jobs", value: RS.fmt1(totalJobs ? 100 * nClaims / totalJobs : null),
        sub: `vs ${RS.fmtN(totalJobs)} closed jobs` },
    ]);

    /* ---------------- month buckets ---------------- */
    const mk = r => r._y + "-" + String(r._m).padStart(2, "0");
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);
    const clByMonth = RS.groupBy(rows, "_month", "Number of Claims");   // asc by month key
    const jobsByMonth = {};
    closingRows.forEach(r => { const k = mk(r); jobsByMonth[k] = (jobsByMonth[k] || 0) + 1; });
    const ffByMonth = {};
    scRows.forEach(r => { const k = mk(r); ffByMonth[k] = (ffByMonth[k] || 0) + RS.num(r["Forman Fault Claims"]); });

    /* ---------------- main: claims by month ---------------- */
    RSC.chartCard(document.getElementById("clmMain"), {
      title: "Claims by month",
      controlsHtml: `<span class="lbl">bars: claims · line: foreman-fault (scorecard) · last 24 mo</span>`,
      buildChart(canvas) {
        const shown = clByMonth.slice(-24);
        return new Chart(canvas, {
          data: {
            labels: shown.map(x => mLabel(x.k)),
            datasets: [
              { type: "bar", label: "Number of Claims", data: shown.map(x => x.v),
                backgroundColor: "#fbbf24", borderRadius: 4, order: 2 },
              { type: "line", label: "Foreman-Fault Claims", data: shown.map(x => ffByMonth[x.k] || 0),
                borderColor: "#f87171", backgroundColor: "#f87171",
                borderWidth: 2, pointRadius: 2, tension: .3, order: 1 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${RS.fmtN(c.raw)}` } },
            },
            scales: {
              y: { beginAtZero: true, ticks: { precision: 0 } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        // more claims = worse, so an increase paints red (.down) and a drop green (.up).
        // rs.css scopes .up/.down colors to KPI subs only, so inline colors are
        // required inside tables (same workaround as callrail.js).
        const delta = d => d == null ? "—"
          : d === 0 ? "±0"
          : d > 0 ? `<span class="down" style="color:var(--red)">+${RS.fmtN(d)}</span>`
                  : `<span class="up" style="color:var(--brand)">-${RS.fmtN(-d)}</span>`;
        const data = clByMonth.map((x, i) => {
          const jobs = jobsByMonth[x.k] || 0;
          return {
            m: mLabel(x.k), c: x.v,
            d: delta(i ? x.v - clByMonth[i - 1].v : null),
            sh: nClaims ? x.v / nClaims : null,
            ff: ffByMonth[x.k] || 0,
            jobs, per100: jobs ? 100 * x.v / jobs : null,
          };
        });
        return RSC.table(
          [{ key: "m", label: "Month" }, { key: "c", label: "Claims", fmt: RS.fmtN },
           { key: "d", label: "Δ vs prev mo", fmt: v => v },
           { key: "sh", label: "% of claims", fmt: RS.fmtPct },
           { key: "ff", label: "Foreman-Fault", fmt: RS.fmtN },
           { key: "jobs", label: "Total Jobs", fmt: RS.fmtN },
           { key: "per100", label: "Claims / 100 Jobs", fmt: RS.fmt1 }],
          data,
          { m: "Total", c: nClaims, sh: nClaims ? 1 : null, ff: foremanFault,
            jobs: totalJobs, per100: totalJobs ? 100 * nClaims / totalJobs : null });
      },
    });

    /* ---------------- responsibility groups (normalized for display) ----------------
       The registry carries two spellings of 'Forman + Sales Fault' (Forman/Foreman,
       casing). Grouped on a normalized key for DISPLAY; raw spellings kept and shown
       in the table tooltip. */
    const respGroups = (() => {
      const g = new Map();
      rows.forEach(r => {
        const raw = String(r.Responsibility || "").trim() || "—";
        const key = raw.toLowerCase().replace(/\s+/g, " ").replace(/foreman/g, "forman");
        let e = g.get(key);
        if (!e) g.set(key, e = { key, rows: [], raws: new Map() });
        e.rows.push(r);
        e.raws.set(raw, (e.raws.get(raw) || 0) + 1);
      });
      const out = [...g.values()].map(e => {
        let disp = "—", best = -1;
        e.raws.forEach((n, raw) => { if (n > best) { best = n; disp = raw; } });
        const reqs = [...new Set(e.rows.map(r => r["Request Joinkey"]).filter(Boolean))];
        return { key: e.key, k: disp, raws: [...e.raws.keys()], n: e.rows.length,
                 refunded: reqs.reduce((a, k) => a + refundOf(k), 0),
                 isForeman: e.key.indexOf("forman") >= 0 };
      });
      out.sort((a, b) => b.n - a.n);
      return out;
    })();
    const PAL = ["#b7e23b", "#5b8cff", "#a78bfa", "#fbbf24", "#f87171",
                 "#38b2ac", "#c05299", "#6b7a88", "#8a9a5b", "#4a5568"];

    const subs = document.getElementById("clmSubs");
    RSC.chartCard(subs, {
      title: "By responsibility",
      buildChart(canvas) {
        let list = respGroups;
        if (list.length > 9) {
          const rest = list.slice(9);
          list = list.slice(0, 9).concat([{ k: "Other",
            n: rest.reduce((a, x) => a + x.n, 0) }]);
        }
        return new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: list.map(x => x.k),
            datasets: [{ data: list.map(x => x.n),
              backgroundColor: list.map((_, i) => PAL[i % PAL.length]), borderWidth: 1 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: "58%",
            plugins: {
              legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => {
                const tot = c.dataset.data.reduce((a, b) => a + b, 0);
                return `${c.label}: ${RS.fmtN(c.raw)} claims (${tot ? (100 * c.raw / tot).toFixed(1) : 0}%)`;
              } } },
            },
          },
        });
      },
      buildTable() {
        const refTot = respGroups.reduce((a, x) => a + x.refunded, 0);
        return RSC.table(
          [{ key: "k", label: "Responsibility", fmt: v => v },  // pre-escaped HTML w/ raw-spelling tooltip
           { key: "n", label: "Claims", fmt: RS.fmtN },
           { key: "sh", label: "% of claims", fmt: RS.fmtPct },
           { key: "ref", label: "Amount Refunded", fmt: RS.money }],
          respGroups.map(x => ({
            k: `<span title="raw: ${RSC.esc(x.raws.join(" · "))}">${RSC.esc(x.k)}</span>`,
            n: x.n, sh: nClaims ? x.n / nClaims : null, ref: x.refunded,
          })),
          { k: "Total", n: nClaims, sh: nClaims ? 1 : null, ref: refTot });
      },
    });

    /* ---------------- by reason: top-12 bar + everything-else bucket ---------------- */
    const byReason = RS.groupBy(rows, "Reason", "Number of Claims"); // desc by count
    RSC.chartCard(subs, {
      title: "By reason — top 12",
      buildChart(canvas) {
        let list = byReason.slice(0, 12);
        const rest = byReason.slice(12);
        if (rest.length)
          list = list.concat([{ k: `Everything else (${rest.length})`,
            v: rest.reduce((a, x) => a + (x.v || 0), 0) }]);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.k),
            datasets: [{ label: "Claims", data: list.map(x => x.v),
              backgroundColor: list.map((x, i) =>
                i < 12 && byReason.length > i ? "#5b8cff" : "#6b7a88"), borderRadius: 4 }],
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c =>
                `Claims: ${RS.fmtN(c.raw)} (${nClaims ? (100 * c.raw / nClaims).toFixed(1) : 0}%)` } },
            },
            scales: {
              x: { beginAtZero: true, ticks: { precision: 0 } },
              y: { ticks: { font: { size: 11 }, callback(v) {
                const l = this.getLabelForValue ? this.getLabelForValue(v) : v;
                return typeof l === "string" && l.length > 24 ? l.slice(0, 23) + "…" : l;
              } } },
            },
          },
        });
      },
      buildTable() {
        const top = byReason.slice(0, 30), rest = byReason.slice(30);
        const data = top.map((x, i) => ({
          r: i + 1, k: x.k, n: x.v, sh: nClaims ? x.v / nClaims : null }));
        if (rest.length) data.push({
          r: null, k: `Everything else (${rest.length} reasons)`,
          n: rest.reduce((a, x) => a + (x.v || 0), 0),
          sh: nClaims ? rest.reduce((a, x) => a + (x.v || 0), 0) / nClaims : null });
        return RSC.table(
          [{ key: "r", label: "#", fmt: v => v == null ? "—" : RS.fmtN(v) },
           { key: "k", label: "Reason" },
           { key: "n", label: "Claims", fmt: RS.fmtN },
           { key: "sh", label: "% of claims", fmt: RS.fmtPct }],
          data,
          { k: "Total", n: nClaims, sh: nClaims ? 1 : null });
      },
    });

    /* ---------------- recent claims panel (PBI detail tables, compact) ----------------
       GO-12 splits detail rows on foreman-caused vs not — reproduced as one table
       with a responsibility filter instead of two side-by-side visuals. */
    const recent = RSC.el("div", "panel",
      `<div class="panel-head"><span class="panel-title">Recent claims</span>
         <span class="rs-ctl"><span class="lbl">Show</span>
           <select id="clmRespF">
             <option value="all">All responsibilities</option>
             <option value="fore">Foreman-fault only</option>
             <option value="other">Non-foreman only</option>
           </select></span>
         <span class="spacer"></span>
         <span class="rs-ctl"><span class="lbl" id="clmRecentN"></span></span></div>
       <div class="tabwrap"></div>`);
    document.getElementById("clmRecent").appendChild(recent);
    const isForemanRow = r => String(r.Responsibility || "")
      .toLowerCase().replace(/foreman/g, "forman").indexOf("forman") >= 0;
    const paintRecent = mode => {
      const pool = mode === "fore" ? rows.filter(isForemanRow)
                 : mode === "other" ? rows.filter(r => !isForemanRow(r))
                 : rows;
      const latest = pool.slice()
        .sort((a, b) => (b._d || "").localeCompare(a._d || "")).slice(0, 40);
      // count label must track the active responsibility filter, not the full page scope
      recent.querySelector("#clmRecentN").textContent =
        `latest ${RS.fmtN(latest.length)} of ${RS.fmtN(pool.length)}`;
      recent.querySelector(".tabwrap").innerHTML = RSC.table(
        [{ key: "d", label: "Created Date" }, { key: "c", label: "Customer" },
         { key: "q", label: "Request No" }, { key: "s", label: "Status" },
         { key: "re", label: "Reason" }, { key: "rp", label: "Responsibility" },
         { key: "amt", label: "Refunded (request)", fmt: RS.money }],
        latest.map(r => ({
          d: r._d || "—", c: r.Customer || "—", q: r["Request No"] || "—",
          s: r.Status || "—", re: r.Reason || "—", rp: r.Responsibility || "—",
          // request-level rollup amount — repeats if a request carries several claims
          amt: refundOf(r["Request Joinkey"]),
        })));
    };
    recent.querySelector("#clmRespF").onchange = e => paintRecent(e.target.value);
    paintRecent("all");
  },
});
