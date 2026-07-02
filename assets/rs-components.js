/* Reporting System — shared UI components: multi-select slicers, date range,
   KPI strip, chart cards with Graph⇄Tabular toggle, matrix/pivot renderer. */
window.RSC = (function () {
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* ---------------- multi-select dropdown slicer ---------------- */
  function multiSelect(host, { key, label, values, onChange }) {
    const set = RS.state.multi[key] = RS.state.multi[key] || new Set();
    const wrap = el("div", "rs-slicer");
    const btn = el("button", "rs-slicer-btn");
    const pop = el("div", "rs-slicer-pop hidden");
    const paint = () => {
      const n = set.size;
      btn.innerHTML = `<span class="lbl">${esc(label)}</span><span class="val">${n ? n + " selected" : "All"}</span><span class="chev">▾</span>`;
      btn.classList.toggle("on", n > 0);
    };
    const rowsHtml = () => `
      <div class="tools"><input type="text" class="q" placeholder="Search…">
        <button class="mini" data-a="all">All</button><button class="mini" data-a="none">Clear</button></div>
      <div class="opts">` +
      values.map(v => `<label class="opt"><input type="checkbox" value="${esc(v)}" ${set.has(v) ? "checked" : ""}> ${esc(v)}</label>`).join("") +
      `</div>`;
    pop.innerHTML = rowsHtml();
    const sync = () => {
      set.clear();
      pop.querySelectorAll(".opt input:checked").forEach(cb => set.add(cb.value));
      paint(); onChange();
    };
    pop.addEventListener("change", sync);
    pop.querySelector(".q").addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      pop.querySelectorAll(".opt").forEach(o => o.classList.toggle("hidden", !o.textContent.toLowerCase().includes(q)));
    });
    pop.querySelectorAll(".mini").forEach(b => b.onclick = () => {
      const on = b.dataset.a === "all";
      pop.querySelectorAll(".opt:not(.hidden) input").forEach(cb => cb.checked = on);
      sync();
    });
    btn.onclick = (e) => {
      e.stopPropagation();
      document.querySelectorAll(".rs-slicer-pop").forEach(p => { if (p !== pop) p.classList.add("hidden"); });
      pop.classList.toggle("hidden");
    };
    pop.addEventListener("click", e => e.stopPropagation());
    wrap.appendChild(btn); wrap.appendChild(pop); host.appendChild(wrap);
    paint();
    return { repaint: paint };
  }

  /* ---------------- date range + presets + day slider ---------------- */
  function dateBar(host, onChange) {
    const wrap = el("div", "rs-daterange");
    wrap.innerHTML = `
      <span class="lbl">Date</span>
      <input type="date" class="from"><span class="dash">–</span><input type="date" class="to">
      <select class="preset">
        <option value="">Presets…</option>
        <option value="tm">This month</option><option value="lm">Last month</option>
        <option value="ytd">Year to date</option><option value="ly">Last year</option>
        <option value="12m">Last 12 months</option><option value="all">All time</option>
      </select>
      <span class="lbl" style="margin-left:10px">Day</span>
      <input type="number" class="dayf" min="1" max="31" placeholder="1">
      <span class="dash">–</span>
      <input type="number" class="dayt" min="1" max="31" placeholder="31">`;
    const from = wrap.querySelector(".from"), to = wrap.querySelector(".to");
    const dayf = wrap.querySelector(".dayf"), dayt = wrap.querySelector(".dayt");
    const sync = () => {
      RS.state.dateFrom = from.value || null;
      RS.state.dateTo = to.value || null;
      RS.state.dayFrom = dayf.value ? +dayf.value : null;
      RS.state.dayTo = dayt.value ? +dayt.value : null;
      onChange();
    };
    [from, to, dayf, dayt].forEach(i => i.onchange = sync);
    wrap.querySelector(".preset").onchange = e => {
      const now = new Date(); const p = e.target.value; e.target.value = "";
      const iso = d => d.toISOString().slice(0, 10);
      const som = new Date(now.getFullYear(), now.getMonth(), 1);
      if (p === "tm") { from.value = iso(som); to.value = iso(now); }
      else if (p === "lm") {
        from.value = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        to.value = iso(new Date(now.getFullYear(), now.getMonth(), 0));
      }
      else if (p === "ytd") { from.value = now.getFullYear() + "-01-01"; to.value = iso(now); }
      else if (p === "ly") { from.value = (now.getFullYear() - 1) + "-01-01"; to.value = (now.getFullYear() - 1) + "-12-31"; }
      else if (p === "12m") { from.value = iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())); to.value = iso(now); }
      else if (p === "all") { from.value = ""; to.value = ""; }
      sync();
    };
    host.appendChild(wrap);
    return {
      clear() { from.value = to.value = dayf.value = dayt.value = ""; sync(); },
    };
  }

  /* ---------------- KPI strip ---------------- */
  function kpis(host, items) {
    host.innerHTML = items.map(x =>
      `<div class="kpi"><div class="l">${esc(x.label)}</div><div class="v">${x.value}</div><div class="s">${esc(x.sub || "")}</div></div>`
    ).join("");
  }

  /* ---------------- chart card with Graph ⇄ Tabular toggle ---------------- */
  /* cfg: { title, controlsHtml?, buildChart(canvas) -> Chart, buildTable() -> html } */
  function chartCard(host, cfg) {
    const card = el("div", "panel");
    card.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">${esc(cfg.title)}</span>
        <span class="rs-ctl"></span>
        <span class="spacer"></span>
        <button class="btn on tg-g">▮ Graph</button><button class="btn tg-t">▤ Tabular</button>
        <button class="btn tg-csv" title="Download the tabular view as CSV">⬇ CSV</button>
      </div>
      <div class="gview"><div class="chartbox"><canvas></canvas></div></div>
      <div class="tview hidden"><div class="tabwrap"></div></div>`;
    host.appendChild(card);
    if (cfg.controlsHtml) card.querySelector(".rs-ctl").innerHTML = cfg.controlsHtml;
    let chart = null;
    const g = card.querySelector(".gview"), t = card.querySelector(".tview");
    const bg = card.querySelector(".tg-g"), bt = card.querySelector(".tg-t");
    const render = () => {
      if (t.classList.contains("hidden")) {
        if (chart) chart.destroy();
        chart = cfg.buildChart(card.querySelector("canvas"));
      } else {
        card.querySelector(".tabwrap").innerHTML = cfg.buildTable();
      }
    };
    bg.onclick = () => { g.classList.remove("hidden"); t.classList.add("hidden"); bg.classList.add("on"); bt.classList.remove("on"); render(); };
    bt.onclick = () => { t.classList.remove("hidden"); g.classList.add("hidden"); bt.classList.add("on"); bg.classList.remove("on"); render(); };
    card.querySelector(".tg-csv").onclick = () => {
      const tbl = el("div", "", cfg.buildTable()).querySelector("table");
      if (!tbl) return;
      const rows = [...tbl.rows].map(r => [...r.cells].map(c =>
        /[",\n]/.test(c.innerText) ? '"' + c.innerText.replace(/"/g, '""') + '"' : c.innerText).join(","));
      const b = new Blob([rows.join("\n")], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b); a.download = (cfg.title || "table") + ".csv"; a.click();
      URL.revokeObjectURL(a.href);
    };
    render();
    return { rerender: render, card };
  }

  /* ---------------- simple measure table ---------------- */
  /* rows: [{k, ...cols}], columns: [{key, label, fmt?, align?}] with a totals row. */
  function table(columns, rows, totals) {
    const th = "<tr>" + columns.map(c => `<th class="${c.align || ''}">${esc(c.label)}</th>`).join("") + "</tr>";
    const body = rows.map(r => "<tr>" + columns.map(c => {
      const v = r[c.key];
      return `<td class="${c.align || ''}">${c.fmt ? c.fmt(v) : (v == null ? "—" : esc(v))}</td>`;
    }).join("") + "</tr>").join("");
    const foot = totals ? "<tfoot><tr>" + columns.map(c => {
      const v = totals[c.key];
      return `<td class="${c.align || ''}">${v == null ? "" : (c.fmt ? c.fmt(v) : esc(v))}</td>`;
    }).join("") + "</tr></tfoot>" : "";
    return `<table class="tab"><thead>${th}</thead><tbody>${body}</tbody>${foot}</table>`;
  }

  /* ---------------- matrix: rowDim × month columns for one measure ---------------- */
  function matrix(rows, rowCol, measureName, opts) {
    opts = opts || {};
    const m = RS.M[measureName];
    const months = [...new Set(rows.map(r => r._y + "-" + String(r._m).padStart(2, "0")))].sort();
    const shown = months.slice(-(opts.lastN || 13));
    const byRow = {};
    rows.forEach(r => {
      const k = r[rowCol] == null || r[rowCol] === "" ? "—" : String(r[rowCol]);
      const mm = r._y + "-" + String(r._m).padStart(2, "0");
      ((byRow[k] = byRow[k] || {})[mm] = byRow[k][mm] || []).push(r);
    });
    const entries = Object.entries(byRow)
      .map(([k, mm]) => ({ k, total: m.fn(Object.values(mm).flat()), mm }))
      .sort((a, b) => (b.total || 0) - (a.total || 0));
    let html = `<table class="tab"><thead><tr><th>${esc(opts.rowLabel || rowCol)}</th>` +
      shown.map(s => `<th>${RS.monthName(+s.slice(5))} ${s.slice(2, 4)}</th>`).join("") +
      `<th>Total</th></tr></thead><tbody>`;
    entries.forEach(e => {
      html += `<tr><td>${esc(e.k)}</td>` + shown.map(s =>
        `<td>${e.mm[s] ? m.fmt(m.fn(e.mm[s])) : "—"}</td>`).join("") +
        `<td><b>${m.fmt(e.total)}</b></td></tr>`;
    });
    const all = Object.values(byRow).flatMap(mm => Object.values(mm)).flat();
    html += `</tbody><tfoot><tr><td>Total</td>` + shown.map(s => {
      const rs = rows.filter(r => (r._y + "-" + String(r._m).padStart(2, "0")) === s);
      return `<td>${m.fmt(m.fn(rs))}</td>`;
    }).join("") + `<td>${m.fmt(m.fn(all))}</td></tr></tfoot></table>`;
    return html;
  }

  document.addEventListener("click", () =>
    document.querySelectorAll(".rs-slicer-pop").forEach(p => p.classList.add("hidden")));

  return { el, esc, multiSelect, dateBar, kpis, chartCard, table, matrix };
})();
