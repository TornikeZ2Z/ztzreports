/* GO page: Reviews — platform review production, score quality, and goal tracking.
   PBI source: General Overview "Reviews" (05-dashboards.md GO-9). The PBI page is a
   Forman×Month pivot (Total Jobs / Total Reviews Written / Reviews to Jobs Ratio);
   rebuilt here around the review datasets themselves (platform breakdown + factual
   counts vs goals), which PBI never surfaced. */
registerPage({
  id: "reviews",
  group: "customers",
  title: "Reviews",
  async render(host) {
    const [bdAll, cntAll, goalAll] = await Promise.all([
      RS.load("reviews_breakdown"), RS.load("review_counts"), RS.load("review_goals")]);
    const bd = RS.filtered("reviews_breakdown", bdAll);
    const counts = RS.filtered("review_counts", cntAll);
    const goals = RS.filtered("review_goals", goalAll);
    const M = RS.M;

    const isCounted = r => RS.num(r["Counts"]) === 1;      // same predicate the registry uses
    const nRev = r => RS.num(r["Number of Reviews"]);
    const truthy = v => { const s = String(v == null ? "" : v).trim().toLowerCase();
      return s === "1" || s === "true" || s === "yes" || RS.num(v) > 0; };
    const mk = r => r._y + "-" + String(r._m).padStart(2, "0");
    const mLabel = k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4);

    const written = M["Total Reviews Written"].fn(bd);
    const avgScore = M["Review Score (avg)"].fn(bd);
    // No PBI measure exists for image share — portal addition (counted reviews w/ image).
    const withImage = bd.filter(r => isCounted(r) && truthy(r["With Image"]))
      .reduce((a, r) => a + nRev(r), 0);
    const factual = M["Total Factual Reviews"].fn(counts);
    const goalTotal = M["Review Goal"].fn(goals);

    // Goal attainment — portal addition (no PBI measure): factual vs goal, restricted to
    // Company|Platform|month buckets that actually carry a goal, so uncovered platforms
    // don't inflate the numerator.
    const gkey = r => (r.Company || "") + "|" + (r.Platform || "") + "|" + mk(r);
    const goalKeys = new Set(goals.filter(r => nRev(r) > 0).map(gkey));
    const factualInGoal = counts.filter(r => goalKeys.has(gkey(r)))
      .reduce((a, r) => a + nRev(r), 0);
    const attainment = goalTotal ? factualInGoal / goalTotal : null;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Reviews</h1>
        <p>Platform review production vs goals ·
           <b>${RS.fmtN(written)}</b> counted reviews in scope
           <span class="freshness">· factual counts are platform-reported monthly totals</span></p>
      </div>
      <div class="rs-kpis" id="rvKpis"></div>
      <div id="rvMain"></div>
      <div class="rs-grid2" id="rvSubs"></div>`;

    RSC.kpis(document.getElementById("rvKpis"), [
      { label: "Total Reviews Written", value: RS.fmtN(written), sub: "counted, from breakdown" },
      { label: "Review Score", value: RS.fmt1(avgScore), sub: "avg over counted reviews" },
      { label: "With Image", value: RS.fmtN(withImage),
        sub: RS.fmtPct(written ? withImage / written : null) + " of counted" },
      { label: "Total Factual Reviews", value: RS.fmtN(factual), sub: "platform-reported counts" },
      { label: "Review Goal", value: RS.fmtN(goalTotal), sub: "sum of platform monthly goals" },
      { label: "Goal Attainment", value: RS.fmtPct(attainment),
        sub: "factual / goal, goal-covered buckets only" },
    ]);

    /* ---------------- main: reviews by platform (breakdown Source, counted) ------- */
    const platG = {};
    bd.forEach(r => { const k = (r.Source == null || r.Source === "") ? "—" : String(r.Source);
      (platG[k] = platG[k] || []).push(r); });
    const plats = Object.entries(platG).map(([k, rs]) => ({
      k,
      v: M["Total Reviews Written"].fn(rs),
      score: M["Review Score (avg)"].fn(rs),
      img: rs.filter(x => isCounted(x) && truthy(x["With Image"])).reduce((a, x) => a + nRev(x), 0),
    })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);

    RSC.chartCard(document.getElementById("rvMain"), {
      title: "Reviews by platform",
      controlsHtml: `<span class="lbl">counted reviews · top 12 + everything else</span>`,
      buildChart(canvas) {
        let list = plats.slice(0, 12);
        const rest = plats.slice(12);
        if (rest.length) list = list.concat([{
          k: "Everything else (" + rest.length + ")",
          v: rest.reduce((a, x) => a + x.v, 0),
        }]);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.k),
            datasets: [{ label: "Reviews Written", data: list.map(x => x.v),
              backgroundColor: list.map((x, i) => (rest.length && i === list.length - 1) ? "#6b7a88" : "#b7e23b"),
              borderRadius: 5 }],
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c => {
                const p = plats.find(x => x.k === c.label);
                return "Reviews: " + RS.fmtN(c.raw) +
                  (p && p.score != null ? " · avg score " + RS.fmt1(p.score) : "") +
                  (written ? " · " + (100 * c.raw / written).toFixed(1) + "%" : "");
              } } },
            },
            scales: { x: { ticks: { precision: 0 } } },
          },
        });
      },
      buildTable() {
        return RSC.table(
          [{ key: "r", label: "#" },
           { key: "k", label: "Platform" },
           { key: "v", label: "Reviews Written", fmt: RS.fmtN },
           { key: "sh", label: "% of total", fmt: RS.fmtPct },
           { key: "score", label: "Avg Score", fmt: RS.fmt1 },
           { key: "img", label: "With Image", fmt: RS.fmtN },
           { key: "imgsh", label: "% w/ image", fmt: RS.fmtPct }],
          plats.slice(0, 60).map((x, i) => ({
            r: i + 1, k: x.k, v: x.v,
            sh: written ? x.v / written : null,
            score: x.score, img: x.img,
            imgsh: x.v ? x.img / x.v : null,
          })),
          { r: "", k: "Total", v: written, sh: written ? 1 : null,
            score: avgScore, img: withImage, imgsh: written ? withImage / written : null });
      },
    });

    /* ---------------- month buckets shared by both sub-cards ---------------- */
    const factByM = {};
    counts.forEach(r => { const k = mk(r); factByM[k] = (factByM[k] || 0) + nRev(r); });
    const goalByM = {};
    goals.forEach(r => { const k = mk(r); goalByM[k] = (goalByM[k] || 0) + nRev(r); });
    const bdByM = {};
    bd.forEach(r => { const k = mk(r); (bdByM[k] = bdByM[k] || []).push(r); });

    const subs = document.getElementById("rvSubs");

    /* ---------------- sub a: factual vs goal by month ---------------- */
    const goalMonths = Object.keys(goalByM).filter(k => goalByM[k] > 0).sort();
    RSC.chartCard(subs, {
      title: "Factual vs Goal by month",
      controlsHtml: `<span class="lbl">last 12 months with goals</span>`,
      buildChart(canvas) {
        const shown = goalMonths.slice(-12);
        return new Chart(canvas, {
          data: {
            labels: shown.map(mLabel),
            datasets: [
              { type: "bar", label: "Total Factual Reviews", data: shown.map(k => factByM[k] || 0),
                backgroundColor: "#b7e23b", borderRadius: 4 },
              { type: "bar", label: "Review Goal", data: shown.map(k => goalByM[k] || 0),
                backgroundColor: "#5b8cff", borderRadius: 4 },
              { type: "line", label: "Attainment %", yAxisID: "y1",
                data: shown.map(k => goalByM[k] ? +(100 * (factByM[k] || 0) / goalByM[k]).toFixed(1) : null),
                borderColor: "#a78bfa", backgroundColor: "#a78bfa",
                borderWidth: 2, pointRadius: 2, tension: .3 },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c =>
                c.dataset.label + ": " + (c.dataset.yAxisID === "y1"
                  ? (c.raw == null ? "—" : c.raw + "%") : RS.fmtN(c.raw)) } },
            },
            scales: {
              y: { ticks: { precision: 0 } },
              y1: { position: "right", grid: { drawOnChartArea: false },
                    ticks: { callback: v => v + "%" } },
              x: { ticks: { font: { size: 11 }, maxRotation: 60, minRotation: 40 } },
            },
          },
        });
      },
      buildTable() {
        // All months carrying either a goal or factual counts (last 24), MoM delta added.
        const months = [...new Set([...Object.keys(factByM), ...Object.keys(goalByM)])]
          .sort().slice(-24);
        const delta = d => d == null ? "—" :
          `<span class="${d >= 0 ? "up" : "down"}">${(d >= 0 ? "+" : "") + RS.fmtN(d)}</span>`;
        const data = months.map((k, i) => {
          const prev = i > 0 ? (factByM[months[i - 1]] || 0) : null;
          const f = factByM[k] || 0, g = goalByM[k] || 0;
          return { m: mLabel(k), f, g: g || null,
            att: g ? f / g : null,
            d: prev == null ? null : f - prev };
        });
        return RSC.table(
          [{ key: "m", label: "Month" },
           { key: "f", label: "Factual Reviews", fmt: RS.fmtN },
           { key: "d", label: "Δ vs prev mo", fmt: v => v == null ? "—" : delta(v) },
           { key: "g", label: "Goal", fmt: v => v == null ? "—" : RS.fmtN(v) },
           { key: "att", label: "Attainment", fmt: RS.fmtPct }],
          data,
          { m: "Total", f: data.reduce((a, x) => a + x.f, 0), d: null,
            g: data.reduce((a, x) => a + (x.g || 0), 0),
            att: (function () { const g = data.reduce((a, x) => a + (x.g || 0), 0);
              const f = data.filter(x => x.g).reduce((a, x) => a + x.f, 0);
              return g ? f / g : null; })() });
      },
    });

    /* ---------------- sub b: score mix (doughnut) + monthly avg score ---------------- */
    const scoreG = {};
    bd.filter(isCounted).forEach(r => {
      const s = r["Review Score"];
      const k = (s == null || s === "") ? "—" : String(RS.num(s));
      scoreG[k] = (scoreG[k] || 0) + nRev(r);
    });
    const scores = Object.entries(scoreG).map(([k, v]) => ({ k, v }))
      .sort((a, b) => (RS.num(b.k) || 0) - (RS.num(a.k) || 0));
    const SCORE_COLOR = { "5": "#b7e23b", "4": "#5b8cff", "3": "#a78bfa", "2": "#fbbf24", "1": "#f87171" };

    RSC.chartCard(subs, {
      title: "Score mix",
      controlsHtml: `<span class="lbl">counted reviews by score</span>`,
      buildChart(canvas) {
        return new Chart(canvas, {
          type: "doughnut",
          data: {
            labels: scores.map(x => x.k === "—" ? "No score" : "Score " + x.k),
            datasets: [{ data: scores.map(x => x.v),
              backgroundColor: scores.map(x => SCORE_COLOR[x.k] || "#6b7a88"), borderWidth: 1 }],
          },
          options: {
            responsive: true, maintainAspectRatio: false, cutout: "58%",
            plugins: {
              legend: { position: "right", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => {
                const tot = c.dataset.data.reduce((a, b) => a + b, 0);
                return c.label + ": " + RS.fmtN(c.raw) +
                  (tot ? " (" + (100 * c.raw / tot).toFixed(1) + "%)" : "");
              } } },
            },
          },
        });
      },
      buildTable() {
        const tot = scores.reduce((a, x) => a + x.v, 0);
        const mix = RSC.table(
          [{ key: "k", label: "Review Score" },
           { key: "v", label: "Reviews", fmt: RS.fmtN },
           { key: "sh", label: "% of counted", fmt: RS.fmtPct }],
          scores.map(x => ({ k: x.k === "—" ? "No score" : x.k, v: x.v, sh: tot ? x.v / tot : null })),
          { k: "Total", v: tot, sh: tot ? 1 : null });
        // Monthly avg-score trend (the "line" of this card lives in the tabular view).
        const bdMonths = Object.keys(bdByM).sort();
        const shown = bdMonths.slice(-13);
        const dScore = d => d == null ? "—" :
          `<span class="${d >= 0 ? "up" : "down"}">${(d >= 0 ? "+" : "") + d.toFixed(2)}</span>`;
        const trend = shown.map(k => {
          const i = bdMonths.indexOf(k);
          const avg = M["Review Score (avg)"].fn(bdByM[k]);
          const prev = i > 0 ? M["Review Score (avg)"].fn(bdByM[bdMonths[i - 1]]) : null;
          return { m: mLabel(k), w: M["Total Reviews Written"].fn(bdByM[k]), avg,
            d: (avg == null || prev == null) ? null : avg - prev };
        });
        return mix + `<div style="height:10px"></div>` + RSC.table(
          [{ key: "m", label: "Month" },
           { key: "w", label: "Reviews Written", fmt: RS.fmtN },
           { key: "avg", label: "Avg Score", fmt: RS.fmt1 },
           { key: "d", label: "Δ score vs prev mo", fmt: v => v == null ? "—" : dScore(v) }],
          trend,
          { m: "Total", w: written, avg: avgScore, d: null });
      },
    });
  },
});
