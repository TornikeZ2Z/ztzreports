/* GO page: Ads Analysis — advertisement spend, funnel and ROI by source.
   PBI source: General Overview "Ads Analysis" (05-dashboards.md GO-5) + the
   ROI-by-source idea from GO-15 "YoY Diff". Closing revenue and moveboard leads
   are matched to advertising card-expense rows by Source (case/space-insensitive)
   — the client-side equivalent of the PBI Source relationships. */
registerPage({
  id: "ads-analysis",
  group: "sales",
  title: "Ads Analysis",
  async render(host) {
    const [cardAll, closingAll, moveboardAll] = await Promise.all([
      RS.load("card_expenses"), RS.load("closing"), RS.load("moveboard")]);
    const cards = RS.filtered("card_expenses", cardAll);
    const closing = RS.filtered("closing", closingAll);
    // moveboard default date = Create Date → matches PBI "Total Leads by Created Date"
    const moveboard = RS.filtered("moveboard", moveboardAll);
    const M = RS.M;

    // ---- the ad-source universe: Source values on advertising transactions
    const adRows = cards.filter(r => RS.num(r["Is Advertising"]) === 1);
    const norm = v => String(v == null ? "" : v).trim().toLowerCase();
    const adSources = new Map();               // norm key → display casing
    adRows.forEach(r => {
      const k = norm(r.Source);
      if (k && !adSources.has(k)) adSources.set(k, String(r.Source).trim());
    });

    // ---- membership joins (Source): closing / moveboard rows on ad sources
    const closingAds = closing.filter(r => adSources.has(norm(r.Source)));
    const mbAds = moveboard.filter(r => adSources.has(norm(r.Source)));

    const adSpend = M["Advertisement Expense"].fn(cards);
    const revenue = M["Total Bill"].fn(closingAds);        // revenue on ad sources
    const jobs = M["Total Jobs"].fn(closingAds);
    const leads = M["Total Leads"].fn(mbAds);
    const roi = adSpend ? revenue / adSpend : null;        // inline: PBI "Ads Analysis - ROI"

    const fmtX = v => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(2) + "x";
    // RS.money/RS.fmtN render null as "$0"/"0" — null-safe wrappers for nullable cells
    const moneyNS = v => v == null ? "—" : RS.money(v);
    const intNS = v => v == null ? "—" : RS.fmtN(v);
    const roiCell = v => v == null ? "—" :
      `<span class="${v >= 1 ? "up" : "down"}">${fmtX(v)}</span>`;
    const deltaCell = g => g == null ? "—" :
      `<span class="${g >= 0 ? "up" : "down"}">${(g >= 0 ? "▲ " : "▼ ") + RS.fmtPct(Math.abs(g))}</span>`;

    host.innerHTML = `
      <div id="adsWrap">
      <style>#adsWrap .up{color:var(--brand)}#adsWrap .down{color:var(--red)}</style>
      <div class="rs-page-head">
        <h1>Ads Analysis</h1>
        <p>Advertisement spend, funnel and ROI ·
           <b>${RS.fmtN(adRows.length)}</b> ad transactions across
           <b>${RS.fmtN(adSources.size)}</b> sources in scope
           <span class="freshness">· closing & moveboard matched to ad sources via Source</span></p>
      </div>
      <div class="rs-kpis" id="adsKpis"></div>
      <div id="adsMain"></div>
      <div class="rs-grid2" id="adsGrid"></div>
      </div>`;

    RSC.kpis(document.getElementById("adsKpis"), [
      { label: "Advertisement Expense", value: RS.money(adSpend),
        sub: RS.fmtN(adRows.length) + " advertising transactions" },
      { label: "Revenue on Ad Sources", value: RS.money(revenue),
        sub: "Total Bill · " + RS.fmtN(closingAds.length) + " matched jobs" },
      { label: "ROI", value: roiCell(roi), sub: "revenue per $1 of ad spend" },
      { label: "Leads on Ad Sources", value: RS.fmtN(leads),
        sub: "moveboard requests · created date" },
      // inline: no exact PBI measure — portal addition alongside "Expense per 1 Job"
      { label: "Cost per Lead", value: leads ? RS.money(adSpend / leads) : "—",
        sub: "ad spend / lead" },
      // inline: PBI "Expense per 1 Job"
      { label: "Cost per Job", value: jobs ? RS.money(adSpend / jobs) : "—",
        sub: "ad spend / closed job" },
    ]);

    /* ================= main: Spend by Provider (PBI "Analysis" column chart,
       Calculate by - Advertisement Analysis reduced to Ad Spend / # transactions) */
    const provAgg = (() => {
      const g = {};
      adRows.forEach(r => {
        const k = (r.Provider == null || String(r.Provider).trim() === "") ? "—" : String(r.Provider).trim();
        const o = g[k] = g[k] || { k, v: 0, n: 0 };
        o.v += RS.num(r.Amount); o.n += 1;
      });
      return Object.values(g);
    })();
    const PROV_CALC = ["Ad Spend", "# Transactions"];
    let provCalc = PROV_CALC[0];
    const provSorted = () => provAgg.slice().sort((a, b) =>
      provCalc === "Ad Spend" ? (b.v - a.v) : (b.n - a.n));
    const provVal = x => provCalc === "Ad Spend" ? x.v : x.n;
    const provFmt = v => provCalc === "Ad Spend" ? RS.money(v) : RS.fmtN(v);

    const mainCard = RSC.chartCard(document.getElementById("adsMain"), {
      title: "Spend by Provider",
      controlsHtml: `<span class="lbl">Calculate by</span><select id="adsProvCalc">` +
        PROV_CALC.map(c => `<option ${c === provCalc ? "selected" : ""}>${c}</option>`).join("") + `</select>`,
      buildChart(canvas) {
        const list = provSorted();
        const top = list.slice(0, 15);
        const rest = list.slice(15);
        if (rest.length) top.push({
          k: `Everything else (${rest.length})`,
          v: rest.reduce((a, x) => a + x.v, 0), n: rest.reduce((a, x) => a + x.n, 0),
        });
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: top.map(x => x.k),
            datasets: [{ label: provCalc,
              data: top.map(x => +provVal(x).toFixed(2)),
              backgroundColor: top.map((x, i) => i === 15 ? "#6b7a88" : "#b7e23b"),
              borderRadius: 4 }],
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: c => `${provCalc}: ${provFmt(c.raw)}` } } },
            scales: {
              x: { ticks: { callback: v => provCalc === "Ad Spend" ? "$" + (v / 1000) + "k" : RS.fmtN(v) } },
              y: { ticks: { font: { size: 11 }, callback(v) {
                const l = this.getLabelForValue ? this.getLabelForValue(v) : v;
                return typeof l === "string" && l.length > 24 ? l.slice(0, 23) + "…" : l; } } },
            },
          },
        });
      },
      buildTable() {
        const list = provSorted();
        const totV = list.reduce((a, x) => a + x.v, 0);
        const totN = list.reduce((a, x) => a + x.n, 0);
        const top = list.slice(0, 25);
        const rest = list.slice(25);
        const data = top.map((x, i) => ({
          r: i + 1, k: x.k, v: x.v, sh: totV ? x.v / totV : null,
          n: x.n, avg: x.n ? x.v / x.n : null,
        }));
        if (rest.length) data.push({
          r: "", k: `Everything else (${rest.length} providers)`,
          v: rest.reduce((a, x) => a + x.v, 0),
          sh: totV ? rest.reduce((a, x) => a + x.v, 0) / totV : null,
          n: rest.reduce((a, x) => a + x.n, 0),
          avg: null,
        });
        return RSC.table(
          [{ key: "r", label: "#" }, { key: "k", label: "Provider" },
           { key: "v", label: "Ad Spend", fmt: RS.money },
           { key: "sh", label: "% of Spend", fmt: RS.fmtPct },
           { key: "n", label: "# Transactions", fmt: RS.fmtN },
           { key: "avg", label: "Avg / Transaction", fmt: moneyNS }],
          data,
          { r: "", k: "Total", v: totV, sh: totV ? 1 : null, n: totN, avg: totN ? totV / totN : null });
      },
    });
    document.getElementById("adsProvCalc").onchange = e => { provCalc = e.target.value; mainCard.rerender(); };

    /* ================= grid2 (a): Spend vs Revenue by Source ================= */
    // Aggregate the three datasets per ad source once.
    const spendBySrc = {}, mbCntBySrc = {}, closBySrc = {};
    adRows.forEach(r => { const k = norm(r.Source); if (k) spendBySrc[k] = (spendBySrc[k] || 0) + RS.num(r.Amount); });
    mbAds.forEach(r => { const k = norm(r.Source); mbCntBySrc[k] = (mbCntBySrc[k] || 0) + 1; });
    closingAds.forEach(r => { const k = norm(r.Source); (closBySrc[k] = closBySrc[k] || []).push(r); });
    const srcList = [...adSources].map(([k, disp]) => {
      const spend = spendBySrc[k] || 0;
      const cl = closBySrc[k] || [];
      const rev = M["Total Bill"].fn(cl);
      return { k, disp, spend, rev, jobs: cl.length, leads: mbCntBySrc[k] || 0,
               roi: spend ? rev / spend : null };  // inline: PBI "Ads Analysis - ROI"
    }).sort((a, b) => b.spend - a.spend);
    // spend on advertising rows with NO Source tag — table-only line, no join possible
    const unattributed = adSpend - srcList.reduce((a, x) => a + x.spend, 0);

    const grid = document.getElementById("adsGrid");
    RSC.chartCard(grid, {
      title: "Spend vs Revenue by Source",
      controlsHtml: `<span class="lbl">top 12 sources by spend</span>`,
      buildChart(canvas) {
        const top = srcList.slice(0, 12);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: top.map(x => x.disp),
            datasets: [
              { label: "Ad Spend", data: top.map(x => Math.round(x.spend)), backgroundColor: "#b7e23b", borderRadius: 4 },
              { label: "Revenue (Total Bill)", data: top.map(x => Math.round(x.rev)), backgroundColor: "#5b8cff", borderRadius: 4 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: {
                label: c => `${c.dataset.label}: ${RS.money(c.raw)}`,
                afterBody: items => {
                  const s = top[items[0].dataIndex];
                  return `ROI: ${fmtX(s.roi)} · Leads: ${RS.fmtN(s.leads)} · Jobs: ${RS.fmtN(s.jobs)}`;
                } } },
            },
            scales: {
              y: { ticks: { callback: v => "$" + (v / 1000) + "k" } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40, callback(v) {
                const l = this.getLabelForValue ? this.getLabelForValue(v) : v;
                return typeof l === "string" && l.length > 14 ? l.slice(0, 13) + "…" : l; } } },
            },
          },
        });
      },
      buildTable() {
        const totSpend = srcList.reduce((a, x) => a + x.spend, 0) + Math.max(0, unattributed);
        const data = srcList.slice(0, 40).map((x, i) => ({
          r: i + 1, s: x.disp, sp: x.spend, sh: totSpend ? x.spend / totSpend : null,
          rev: x.rev, roi: x.roi, l: x.leads, j: x.jobs,
        }));
        if (unattributed > 0.005) data.push({
          r: "", s: "(no source tag)", sp: unattributed,
          sh: totSpend ? unattributed / totSpend : null, rev: null, roi: null, l: null, j: null,
        });
        return RSC.table(
          [{ key: "r", label: "#" }, { key: "s", label: "Source" },
           { key: "sp", label: "Ad Spend", fmt: RS.money },
           { key: "sh", label: "% of Spend", fmt: RS.fmtPct },
           { key: "rev", label: "Revenue", fmt: moneyNS },
           { key: "roi", label: "ROI", fmt: roiCell },
           { key: "l", label: "Leads", fmt: intNS },
           { key: "j", label: "Jobs", fmt: intNS }],
          data,
          { r: "", s: "Total", sp: totSpend, sh: totSpend ? 1 : null,
            rev: revenue, roi: roi, l: leads, j: jobs });
      },
    });

    /* ================= grid2 (b): monthly ad spend vs revenue ================= */
    const spendByM = {}, closAdsByM = {};
    adRows.forEach(r => { const k = r._y + "-" + String(r._m).padStart(2, "0");
      spendByM[k] = (spendByM[k] || 0) + RS.num(r.Amount); });
    closingAds.forEach(r => { const k = r._y + "-" + String(r._m).padStart(2, "0");
      (closAdsByM[k] = closAdsByM[k] || []).push(r); });
    const months = [...new Set([...Object.keys(spendByM), ...Object.keys(closAdsByM)])]
      .filter(k => /^\d{4}-\d{2}$/.test(k)).sort().slice(-24);
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);
    const revOfM = k => M["Total Bill"].fn(closAdsByM[k] || []);

    RSC.chartCard(grid, {
      title: "Monthly ad spend vs revenue",
      controlsHtml: `<span class="lbl">last 24 mo · revenue on ad sources</span>`,
      buildChart(canvas) {
        return new Chart(canvas, {
          data: {
            labels: months.map(mLabel),
            datasets: [
              { type: "line", label: "Ad Spend", data: months.map(k => Math.round(spendByM[k] || 0)),
                borderColor: "#b7e23b", backgroundColor: "#b7e23b", borderWidth: 2,
                pointRadius: 2, tension: .3, yAxisID: "y" },
              { type: "line", label: "Revenue on Ad Sources", data: months.map(k => Math.round(revOfM(k))),
                borderColor: "#5b8cff", backgroundColor: "#5b8cff", borderWidth: 2,
                pointRadius: 2, tension: .3, yAxisID: "y1" },
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
              y: { position: "left", title: { display: true, text: "Ad Spend" },
                   ticks: { callback: v => "$" + (v / 1000) + "k" } },
              y1: { position: "right", title: { display: true, text: "Revenue" },
                    grid: { drawOnChartArea: false }, ticks: { callback: v => "$" + (v / 1000) + "k" } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        const data = months.map((k, i) => {
          const sp = spendByM[k] || 0;
          const prev = i > 0 ? (spendByM[months[i - 1]] || 0) : null;
          const rev = revOfM(k);
          return { m: mLabel(k), sp,
            // inline: PBI "Calculate by - Yearly Growth Rate" family — here MoM on spend
            d: (prev != null && prev) ? (sp - prev) / Math.abs(prev) : null,
            rev, roi: sp ? rev / sp : null };
        });
        const totSp = data.reduce((a, x) => a + x.sp, 0);
        const totRev = data.reduce((a, x) => a + x.rev, 0);
        return RSC.table(
          [{ key: "m", label: "Month" },
           { key: "sp", label: "Ad Spend", fmt: RS.money },
           { key: "d", label: "MoM Δ", fmt: deltaCell },
           { key: "rev", label: "Revenue", fmt: RS.money },
           { key: "roi", label: "ROI", fmt: roiCell }],
          data,
          { m: "Total", sp: totSp, d: null, rev: totRev, roi: totSp ? totRev / totSp : null });
      },
    });
  },
});
