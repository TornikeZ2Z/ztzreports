/* Insights & Recommendations — auto-computed monthly pulse.
   Always renders the CURRENT-MONTH perspective from the full warehouse
   (global filter bar is intentionally NOT applied — noted in the header).
   Everything below is rule-based and computed live; no hand-written numbers. */
registerPage({
  id: "insights",
  group: "pulse",
  title: "Insights & Recommendations",
  async render(host) {
    const [closing, moveboard, scorecard, cardExp, claims, refunds] = await Promise.all([
      RS.load("closing"), RS.load("moveboard"), RS.load("scorecard"),
      RS.load("card_expenses"), RS.load("claims"), RS.load("refunds")]);
    const M = RS.M, num = RS.num;

    /* ---------- month helpers (anchored to the freshest closing date) ---------- */
    const maxD = closing.reduce((a, r) => (r._d > a ? r._d : a), "");
    const anchor = new Date(maxD + "T00:00:00");
    const mk = d => d.toISOString().slice(0, 7);                     // "YYYY-MM"
    const CUR = maxD.slice(0, 7);                                    // current month
    const dayOf = +maxD.slice(8, 10);                                // days elapsed
    const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
    const prevM = mk(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 15));
    const prev2M = mk(new Date(anchor.getFullYear(), anchor.getMonth() - 2, 15));
    const lyM = (anchor.getFullYear() - 1) + "-" + CUR.slice(5);     // same month LY
    const monthLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(0, 4);
    const inMonth = (rows, m) => rows.filter(r => r._d && r._d.slice(0, 7) === m);
    const mtdOf = (rows, m) => inMonth(rows, m).filter(r => +r._d.slice(8, 10) <= dayOf);
    const pct = (a, b) => (b ? (a - b) / Math.abs(b) : null);
    const chip = (g, inv) => g == null ? "" :
      `<span class="${(inv ? g <= 0 : g >= 0) ? "up" : "down"}">${g >= 0 ? "▲" : "▼"} ${Math.abs(100 * g).toFixed(1)}%</span>`;

    /* ---------- current-month pulse ---------- */
    const curRows = inMonth(closing, CUR);
    const prevMtd = mtdOf(closing, prevM), lyMtd = mtdOf(closing, lyM);
    const bill = M["Total Bill"].fn(curRows), jobs = curRows.length;
    const projBill = dayOf ? bill / dayOf * daysInMonth : null;
    const projJobs = dayOf ? Math.round(jobs / dayOf * daysInMonth) : null;
    const lyFull = M["Total Bill"].fn(inMonth(closing, lyM));

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Insights & Recommendations</h1>
        <p>Auto-generated monthly pulse · data through <b>${maxD}</b> (day ${dayOf} of ${daysInMonth})</p>
      </div>
      <div class="insight-note">This page always shows the current-month perspective across the whole business — the global filter bar does not apply here.</div>
      <div class="rs-kpis" id="kpis"></div>
      <div class="rs-grid2">
        <div class="panel"><div class="panel-head"><span class="panel-title">Recommendations — ${monthLabel(CUR)}</span></div><div id="recs"></div></div>
        <div class="panel"><div class="panel-head"><span class="panel-title">What moved last month (${monthLabel(prevM)} vs ${monthLabel(prev2M)})</span></div><div class="tabwrap" id="movers"></div></div>
      </div>
      <div class="rs-grid2">
        <div class="panel"><div class="panel-head"><span class="panel-title">Foreman pulse — ${monthLabel(prevM)}</span></div><div class="tabwrap" id="foreman"></div></div>
        <div class="panel"><div class="panel-head"><span class="panel-title">Ad efficiency — ${monthLabel(prevM)}</span></div><div class="tabwrap" id="ads"></div></div>
      </div>`;

    RSC.kpis(document.getElementById("kpis"), [
      { label: "Jobs — " + monthLabel(CUR), value: RS.fmtN(jobs),
        sub: `vs LY same days: ${RS.fmtN(lyMtd.length)} ` + chip(pct(jobs, lyMtd.length)) },
      { label: "Revenue MTD", value: RS.money(bill),
        sub: `vs LY same days ` + chip(pct(bill, M["Total Bill"].fn(lyMtd))) },
      { label: "Pace vs last month", value: RS.money(M["Total Bill"].fn(prevMtd)),
        sub: `${monthLabel(prevM)} by day ${dayOf} ` + chip(pct(bill, M["Total Bill"].fn(prevMtd))) },
      { label: "Projected month-end", value: projBill ? RS.money(projBill) : "—",
        sub: `~${RS.fmtN(projJobs || 0)} jobs at current run-rate` },
      { label: monthLabel(lyM) + " (full)", value: RS.money(lyFull),
        sub: projBill ? "projection " + chip(pct(projBill, lyFull)) + " vs LY" : "" },
    ]);

    /* ---------- recommendations (rule-based, live) ---------- */
    const recs = [];
    const push = (sev, t, d) => recs.push({ sev, t, d });

    // 1. booking-rate move (moveboard, last full month vs the one before)
    const br = m => { const rows = inMonth(moveboard, m);
      return { q: M["Qualified Leads"].fn(rows), r: M["Booking Rate"].fn(rows) }; };
    const brNow = br(prevM), brPrev = br(prev2M);
    if (brNow.r != null && brPrev.r != null) {
      const diff = 100 * (brNow.r - brPrev.r);
      if (diff <= -2) push("high", `Booking rate fell ${Math.abs(diff).toFixed(1)}pp in ${monthLabel(prevM)}`,
        `${(100 * brNow.r).toFixed(1)}% vs ${(100 * brPrev.r).toFixed(1)}% the month before (${RS.fmtN(brNow.q)} qualified leads). Review lead follow-up speed and quote levels.`);
      else if (diff >= 2) push("info", `Booking rate up ${diff.toFixed(1)}pp in ${monthLabel(prevM)}`,
        `${(100 * brNow.r).toFixed(1)}% conversion of qualified leads — whatever changed, keep doing it.`);
    }
    // 2. ad providers with poor ROI last month
    const adsLast = inMonth(cardExp, prevM).filter(r => num(r["Is Advertising"]) === 1);
    const spendBySrc = {};
    adsLast.forEach(r => { const s = r.Source || r.Provider || "—";
      spendBySrc[s] = (spendBySrc[s] || 0) + num(r.Amount); });
    const revBySrc = {};
    inMonth(closing, prevM).forEach(r => { const s = r.Source || "—";
      revBySrc[s] = (revBySrc[s] || 0) + num(r["Total Bill"]) + num(r["Extra Bill From Trips"]); });
    Object.entries(spendBySrc).filter(([s, v]) => v >= 500).forEach(([s, v]) => {
      const roi = (revBySrc[s] || 0) / v;
      if (roi < 1) push("high", `${s}: $${Math.round(v).toLocaleString()} ad spend returned ${roi.toFixed(2)}× last month`,
        `Revenue attributed to '${s}' was ${RS.money(revBySrc[s] || 0)}. Consider reallocating budget or checking source attribution.`);
    });
    // 3. foreman score decline 2 months running
    const scByF = {};
    scorecard.forEach(r => { (scByF[r.Foreman] = scByF[r.Foreman] || {})[r._d ? r._d.slice(0, 7) : ""] = num(r["Forman Score"]); });
    Object.entries(scByF).forEach(([f, mm]) => {
      const a = mm[prevM], b = mm[prev2M], c = mm[mk(new Date(anchor.getFullYear(), anchor.getMonth() - 3, 15))];
      if (a != null && b != null && c != null && a < b && b < c)
        push("med", `${f}: score declining two months in a row`,
          `${c.toFixed(1)} → ${b.toFixed(1)} → ${a.toFixed(1)}. Worth a check-in; components are on the Forman page.`);
    });
    // 4. claims spike vs 6-month average
    const claimMonths = [1, 2, 3, 4, 5, 6].map(i => inMonth(claims, mk(new Date(anchor.getFullYear(), anchor.getMonth() - i, 15))).length);
    const claimAvg = claimMonths.reduce((a, b) => a + b, 0) / 6;
    if (claimAvg > 0 && claimMonths[0] > 1.5 * claimAvg)
      push("high", `Claims spiked in ${monthLabel(prevM)}: ${claimMonths[0]} vs ~${claimAvg.toFixed(1)}/mo average`,
        `Check the Claims page for responsibility split — foreman-fault claims feed the scorecard.`);
    // 5. refunds spike
    const refByM = i => M["Total Refunds"].fn(inMonth(refunds, mk(new Date(anchor.getFullYear(), anchor.getMonth() - i, 15))));
    const refAvg = [1, 2, 3, 4, 5, 6].map(refByM).reduce((a, b) => a + b, 0) / 6;
    if (refAvg > 0 && refByM(1) > 1.5 * refAvg)
      push("med", `Refunds ran hot in ${monthLabel(prevM)}: ${RS.money(refByM(1))}`,
        `~${RS.money(refAvg)} is the 6-month average. The Sales Person page shows commission deductions tied to refunds.`);
    // 6. big source declines MoM (jobs)
    const jobsBySrc = m => { const g = {}; inMonth(closing, m).forEach(r => { const s = r.Source || "—"; g[s] = (g[s] || 0) + 1; }); return g; };
    const jNow = jobsBySrc(prevM), jPrev = jobsBySrc(prev2M);
    Object.keys(jPrev).filter(s => jPrev[s] >= 20).forEach(s => {
      const g = pct(jNow[s] || 0, jPrev[s]);
      if (g != null && g <= -0.3) push("med", `${s} jobs down ${Math.abs(100 * g).toFixed(0)}% month-over-month`,
        `${jPrev[s]} → ${jNow[s] || 0} closed jobs. If spend didn't change, the funnel for this source needs a look.`);
    });
    // 7. pace vs LY
    if (projBill != null && lyFull > 0 && projBill < lyFull * 0.95)
      push("med", `${monthLabel(CUR)} is pacing ${(100 * (1 - projBill / lyFull)).toFixed(0)}% below ${monthLabel(lyM)}`,
        `Projected ${RS.money(projBill)} vs ${RS.money(lyFull)} last year. Early-month projections are noisy — watch this after day 10.`);
    if (!recs.length) push("info", "No alerts this month", "All monitored signals (booking rate, ad ROI, foreman scores, claims, refunds, source volumes, revenue pace) are within normal ranges.");
    recs.sort((a, b) => ({ high: 0, med: 1, info: 2 }[a.sev] - { high: 0, med: 1, info: 2 }[b.sev]));
    document.getElementById("recs").innerHTML = recs.slice(0, 10).map(r =>
      `<div class="rec"><span class="sev ${r.sev}"></span><div><div class="t">${RSC.esc(r.t)}</div><div class="d">${RSC.esc(r.d)}</div></div></div>`).join("");

    /* ---------- movers table (sources by revenue, MoM) ---------- */
    {
      const revNow = {}, revPrev = {};
      inMonth(closing, prevM).forEach(r => { const s = r.Source || "—"; revNow[s] = (revNow[s] || 0) + num(r["Total Bill"]); });
      inMonth(closing, prev2M).forEach(r => { const s = r.Source || "—"; revPrev[s] = (revPrev[s] || 0) + num(r["Total Bill"]); });
      const rows = [...new Set([...Object.keys(revNow), ...Object.keys(revPrev)])]
        .map(s => ({ s, now: revNow[s] || 0, prev: revPrev[s] || 0, g: pct(revNow[s] || 0, revPrev[s] || 0) }))
        .filter(x => x.now >= 5000 || x.prev >= 5000)
        .sort((a, b) => Math.abs(b.now - b.prev) - Math.abs(a.now - a.prev)).slice(0, 12);
      document.getElementById("movers").innerHTML = RSC.table(
        [{ key: "s", label: "Source" }, { key: "now", label: monthLabel(prevM), fmt: RS.money },
         { key: "prev", label: monthLabel(prev2M), fmt: RS.money },
         { key: "g", label: "Δ", fmt: g => g == null ? "—" : chip(g) }], rows);
    }
    /* ---------- foreman pulse (last full month leaderboard + delta) ---------- */
    {
      const rows = scorecard.filter(r => r._d && r._d.slice(0, 7) === prevM)
        .map(r => ({ f: r.Foreman, sc: num(r["Forman Score"]), rk: num(r["Forman Score Rank"]),
          d: r["Forman Score Prev Month"] == null ? null : num(r["Forman Score"]) - num(r["Forman Score Prev Month"]) }))
        .sort((a, b) => a.rk - b.rk).slice(0, 12);
      document.getElementById("foreman").innerHTML = RSC.table(
        [{ key: "rk", label: "#" }, { key: "f", label: "Foreman" },
         { key: "sc", label: "Score", fmt: v => v.toFixed(1) },
         { key: "d", label: "vs prior", fmt: v => v == null ? "—" :
           `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(1)} pts</span>` }], rows);
    }
    /* ---------- ad efficiency table ---------- */
    {
      const rows = Object.entries(spendBySrc).map(([s, v]) => ({
        s, v, rev: revBySrc[s] || 0, roi: v ? (revBySrc[s] || 0) / v : null }))
        .sort((a, b) => b.v - a.v).slice(0, 12);
      document.getElementById("ads").innerHTML = RSC.table(
        [{ key: "s", label: "Provider / Source" }, { key: "v", label: "Ad Spend", fmt: RS.money },
         { key: "rev", label: "Attributed Revenue", fmt: RS.money },
         { key: "roi", label: "ROI", fmt: v => v == null ? "—" :
           `<span class="${v >= 3 ? "up" : v < 1 ? "down" : ""}">${v.toFixed(2)}×</span>` }], rows);
    }
  },
});
