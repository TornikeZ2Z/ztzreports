/* GO page: Forman — the foreman composite scorecard (PBI GO-11 "Forman").
   Dataset: mart_forman_scorecard (Month grain, one row per Foreman × Month; the global
   Foreman slicer maps onto it). PBI shows a single pivot (Forman × End of Month ×
   Forman Score); improved here with a latest-month leaderboard, MoM deltas, a score
   trend and a weighted component-mix decomposition (0.4/0.2/0.2/0.2). */

/* Page-local measure so RSC.matrix can pivot Foreman × Month on the score.
   (PBI: Forman Score — mart column; avg over the cell's rows, i.e. the score itself
   at Foreman × Month grain.) */
if (!RS.M["Forman Score (avg)"]) RS.M["Forman Score (avg)"] = {
  name: "Forman Score (avg)", ds: "scorecard",
  fmt: v => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(2),
  fn(rows) {
    const v = rows.filter(r => r["Forman Score"] != null && r["Forman Score"] !== "")
      .map(r => RS.num(r["Forman Score"]));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  },
};

registerPage({
  id: "forman",
  group: "ops",
  title: "Forman",
  async render(host) {
    const all = await RS.load("scorecard");
    const rows = RS.filtered("scorecard", all);
    const num = RS.num;
    const fS = v => (v == null || isNaN(v)) ? "—" : Number(v).toFixed(2);   // score format

    const mk = r => r._y + "-" + String(r._m).padStart(2, "0");
    const months = [...new Set(rows.map(mk))].sort();
    const latest = months[months.length - 1];
    const mLabel = k => k ? RS.monthName(+k.slice(5)) + " " + k.slice(0, 4) : "—";

    if (!rows.length) {
      host.innerHTML = `
        <div class="rs-page-head"><h1>Forman</h1>
          <p>Foreman composite scorecard — no scorecard months match the current filters.</p></div>`;
      return;
    }

    // ---- latest-month leaderboard rows (one per foreman; mart is Month-grain)
    const board = rows.filter(r => mk(r) === latest).map(r => ({
      f: String(r.Foreman || "—"),
      score: num(r["Forman Score"]),
      rank: num(r["Forman Score Rank"]),
      prev: (r["Forman Score Prev Month"] == null || r["Forman Score Prev Month"] === "")
        ? null : num(r["Forman Score Prev Month"]),
      s1: num(r["Packing per 100 CF Score"]),      // weight 0.4
      s2: num(r["Packing Vs Estimate Score"]),      // weight 0.2
      s3: num(r["Review Score"]),                   // weight 0.2
      s4: num(r["Claim Score"]),                    // weight 0.2
      p100: num(r["Packing per 100 CF"]),
      jobs: num(r["Total Jobs"]),
    })).sort((a, b) => (b.score || 0) - (a.score || 0));
    board.forEach((x, i) => {
      x.d = x.prev == null ? null : x.score - x.prev;
      if (!x.rank) x.rank = i + 1;                  // fallback if mart rank is blank
    });
    const best = board[0];
    const improved = board.filter(x => x.d != null)
      .sort((a, b) => b.d - a.d)[0] || null;

    host.innerHTML = `
      <div class="rs-page-head">
        <h1>Forman</h1>
        <p>Foreman composite scorecard · <b>${RS.fmtN(board.length)}</b> foremen in ${RSC.esc(mLabel(latest))}
           · <b>${RS.fmtN(months.length)}</b> months in scope
           <span class="freshness">· Forman Score = 0.4×Packing/100CF + 0.2×Packing vs Estimate + 0.2×Review + 0.2×Claim</span></p>
      </div>
      <div class="rs-kpis" id="fmKpis"></div>
      <div id="fmMain"></div>
      <div class="rs-grid2" id="fmGrid"></div>`;

    // ---- KPIs (latest month for the score ones, full scope for the ratios)
    const avgScore = board.length                                     // PBI: Forman Score
      ? board.reduce((a, x) => a + (x.score || 0), 0) / board.length : null;
    const cf = rows.reduce((a, r) => a + num(r["Total CF"]), 0);
    const pack = rows.reduce((a, r) => a + num(r["Total Packing Written"]), 0);
    const p100 = cf ? 100 * pack / cf : null;                         // PBI: Packing per 100 CF
    const revs = rows.reduce((a, r) => a + num(r["Total Reviews Written"]), 0);
    const jobs = rows.reduce((a, r) => a + num(r["Total Jobs"]), 0);
    const r2j = jobs ? revs / jobs : null;                            // PBI: Reviews to Jobs Ratio
    RSC.kpis(document.getElementById("fmKpis"), [
      { label: "Active Foremen", value: RS.fmtN(board.length), sub: mLabel(latest) },
      { label: "Avg Forman Score", value: fS(avgScore), sub: "latest month, all foremen" },
      { label: "Best Foreman", value: best ? RSC.esc(best.f) : "—",
        sub: best ? "score " + fS(best.score) + " · rank 1" : "" },
      { label: "Most Improved", value: improved ? RSC.esc(improved.f) : "—",
        sub: improved ? (improved.d >= 0 ? "+" : "") + fS(improved.d) + " vs prev month"
                      : "no prior month in scope" },
      { label: "Avg Packing / 100 CF", value: p100 == null ? "—" : RS.money(p100),
        sub: "Σ packing $ / Σ CF × 100 · scope" },
      { label: "Reviews / Jobs", value: RS.fmtPct(r2j), sub: "reviews written per job · scope" },
    ]);

    // ---- main: leaderboard, latest month (PBI pivot values = Forman Score; improved
    //      with MoM direction coloring + a full component/rank tabular)
    const deltaHtml = v => v == null ? "new"
      : v === 0 ? "0.00"
      : `<span class="${v > 0 ? "up" : "down"}" style="color:var(${v > 0 ? "--brand" : "--red"})">${v > 0 ? "▲" : "▼"} ${Math.abs(v).toFixed(2)}</span>`;
    RSC.chartCard(document.getElementById("fmMain"), {
      title: "Leaderboard — " + mLabel(latest),
      controlsHtml: `<span class="lbl">top ${Math.min(25, board.length)} of ${board.length}
        · bar color = vs prev month (lime up, red down, blue new)</span>`,
      buildChart(canvas) {
        const list = board.slice(0, 25);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.f),
            datasets: [{
              label: "Forman Score",
              data: list.map(x => +(x.score || 0).toFixed(2)),
              backgroundColor: list.map(x =>
                x.d == null ? "#5b8cff" : x.d >= 0 ? "#b7e23b" : "#f87171"),
              borderRadius: 4,
            }],
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: c => {
                const b = list[c.dataIndex];
                return [`Score: ${fS(b.score)} (rank ${b.rank})`,
                        `Prev month: ${fS(b.prev)}`,
                        `Jobs: ${RS.fmtN(b.jobs)}`];
              } } },
            },
            scales: {
              x: { beginAtZero: true },
              y: { ticks: { callback(v) {
                const l = this.getLabelForValue ? this.getLabelForValue(v) : v;
                return typeof l === "string" && l.length > 16 ? l.slice(0, 15) + "…" : l;
              } } },
            },
          },
        });
      },
      buildTable() {
        return RSC.table(
          [{ key: "rank", label: "Rank", fmt: RS.fmtN },
           { key: "f", label: "Foreman" },
           { key: "score", label: "Forman Score", fmt: fS },
           { key: "prev", label: "Prev Month", fmt: fS },
           { key: "d", label: "Δ MoM", fmt: deltaHtml },
           { key: "s1", label: "Packing/100CF Score", fmt: fS },
           { key: "s2", label: "Packing vs Estimate Score", fmt: fS },
           { key: "s3", label: "Review Score", fmt: fS },
           { key: "s4", label: "Claim Score", fmt: fS },
           { key: "jobs", label: "Jobs", fmt: RS.fmtN }],
          board.slice(0, 60),
          { rank: null, f: "Average", score: avgScore,
            prev: (() => { const p = board.filter(x => x.prev != null);
              return p.length ? p.reduce((a, x) => a + x.prev, 0) / p.length : null; })(),
            d: null,
            s1: board.length ? board.reduce((a, x) => a + x.s1, 0) / board.length : null,
            s2: board.length ? board.reduce((a, x) => a + x.s2, 0) / board.length : null,
            s3: board.length ? board.reduce((a, x) => a + x.s3, 0) / board.length : null,
            s4: board.length ? board.reduce((a, x) => a + x.s4, 0) / board.length : null,
            jobs: board.reduce((a, x) => a + x.jobs, 0) });
      },
    });

    // ---- grid2 (a): score trend — line per foreman, top 6 by latest score.
    //      Tabular = the literal PBI pivot: Forman × End of Month × Forman Score.
    const grid = document.getElementById("fmGrid");
    const PAL = ["#b7e23b", "#5b8cff", "#a78bfa", "#fbbf24", "#f87171", "#38b2ac"];
    const byF = {};
    rows.forEach(r => {
      const f = String(r.Foreman || "—");
      (byF[f] = byF[f] || {})[mk(r)] =
        (r["Forman Score"] == null || r["Forman Score"] === "") ? null : num(r["Forman Score"]);
    });
    RSC.chartCard(grid, {
      title: "Score trend — top 6 foremen",
      controlsHtml: `<span class="lbl">ranked by latest score · last 18 mo</span>`,
      buildChart(canvas) {
        const shown = months.slice(-18);
        const datasets = board.slice(0, 6).map((x, i) => ({
          type: "line", label: x.f,
          data: shown.map(k => {
            const v = byF[x.f] && byF[x.f][k];
            return v == null ? null : +v.toFixed(2);
          }),
          borderColor: PAL[i], backgroundColor: PAL[i],
          borderWidth: 2, pointRadius: 2, tension: .3, spanGaps: true,
        }));
        return new Chart(canvas, {
          data: { labels: shown.map(k => RS.monthName(+k.slice(5)) + " " + k.slice(2, 4)), datasets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fS(c.raw)}` } },
            },
            scales: { x: { ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 18 } } },
          },
        });
      },
      buildTable() {
        // PBI parity: pivotTable "Forman Tabular Analysis" (all foremen, not just top 6;
        // Total column = avg score across all months in scope).
        return RSC.matrix(rows, "Foreman", "Forman Score (avg)", { rowLabel: "Foreman", lastN: 13 });
      },
    });

    // ---- grid2 (b): component mix — weighted contribution stack, latest month.
    //      Contribution = weight × component score, so each stack sums to Forman Score.
    const W = { s1: 0.4, s2: 0.2, s3: 0.2, s4: 0.2 };
    const COMP = [
      { key: "s1", label: "Packing/100CF (0.4)", color: "#b7e23b" },
      { key: "s2", label: "Packing vs Estimate (0.2)", color: "#5b8cff" },
      { key: "s3", label: "Review (0.2)", color: "#a78bfa" },
      { key: "s4", label: "Claim (0.2)", color: "#fbbf24" },
    ];
    RSC.chartCard(grid, {
      title: "Component mix — " + mLabel(latest),
      controlsHtml: `<span class="lbl">weights 0.4 / 0.2 / 0.2 / 0.2 · stack = Forman Score</span>`,
      buildChart(canvas) {
        const list = board.slice(0, 20);
        return new Chart(canvas, {
          type: "bar",
          data: {
            labels: list.map(x => x.f),
            datasets: COMP.map(c => ({
              label: c.label,
              data: list.map(x => +(W[c.key] * (x[c.key] || 0)).toFixed(2)),
              backgroundColor: c.color, borderRadius: 2,
            })),
          },
          options: {
            indexAxis: "y",
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } },
              tooltip: { callbacks: { label: c => {
                const b = list[c.dataIndex], comp = COMP[c.datasetIndex];
                return `${comp.label}: ${fS(c.raw)} (score ${fS(b[comp.key])})`;
              } } },
            },
            scales: {
              x: { stacked: true, beginAtZero: true },
              y: { stacked: true, ticks: { callback(v) {
                const l = this.getLabelForValue ? this.getLabelForValue(v) : v;
                return typeof l === "string" && l.length > 16 ? l.slice(0, 15) + "…" : l;
              } } },
            },
          },
        });
      },
      buildTable() {
        // Raw (unweighted) component scores + the mart score and the recomputed
        // weighted sum, so any drift between the two is visible.
        return RSC.table(
          [{ key: "f", label: "Foreman" },
           { key: "s1", label: "Packing/100CF (0.4)", fmt: fS },
           { key: "s2", label: "Packing vs Est (0.2)", fmt: fS },
           { key: "s3", label: "Review (0.2)", fmt: fS },
           { key: "s4", label: "Claim (0.2)", fmt: fS },
           { key: "w", label: "Weighted Sum", fmt: fS },
           { key: "score", label: "Forman Score", fmt: fS }],
          board.slice(0, 60).map(x => ({
            f: x.f, s1: x.s1, s2: x.s2, s3: x.s3, s4: x.s4,
            w: 0.4 * x.s1 + 0.2 * x.s2 + 0.2 * x.s3 + 0.2 * x.s4, score: x.score,
          })),
          { f: "Average",
            s1: board.length ? board.reduce((a, x) => a + x.s1, 0) / board.length : null,
            s2: board.length ? board.reduce((a, x) => a + x.s2, 0) / board.length : null,
            s3: board.length ? board.reduce((a, x) => a + x.s3, 0) / board.length : null,
            s4: board.length ? board.reduce((a, x) => a + x.s4, 0) / board.length : null,
            w: board.length ? board.reduce((a, x) =>
              a + 0.4 * x.s1 + 0.2 * x.s2 + 0.2 * x.s3 + 0.2 * x.s4, 0) / board.length : null,
            score: avgScore });
      },
    });
  },
});
