/* Reporting System — core: data layer, filter context, measure library.
   Measures are registered by their EXACT Power BI name (see docs/pbix-coverage-audit.md §4)
   so the audit files double as the implementation checklist. */
window.RS = (function () {
  const num = ZTZ.num, fmtN = ZTZ.fmtN, money = ZTZ.money;
  const fmtPct = v => (v == null || isNaN(v)) ? "—" : (100 * v).toFixed(1) + "%";
  const fmt1 = v => (v == null || isNaN(v)) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 });

  /* ---------------- data layer (fetch once, cache in memory) ---------------- */
  const DATASETS = {
    closing: {
      table: "fct_closing",
      cols: ["Unique Key", "Record Source", "Company", "Date", "Customer", "Request #",
        "Source", "Move Type", "Pickup Zip", "Net Cash", "Total Bill", "Card Payment",
        "Balance Due", "Deposit", "Sales Person", "SP 2", "SP 3", "Foreman", "Foreman Hours",
        "Driver", "Material Total", "Material $", "Tip from Company",
        "Tip From the Customers", "Review", "Satisfaction Score", "Total Expense",
        "Profit per Job", "State", "State Name", "Moving Type", "Size of Move",
        "Bill Range", "Commission Bucket Range", "Extra Bill From Trips", "Net Cash From Trips",
        "Crew Size", "Request Encounter", "Is Last Encounter", "Job Part of the Day",
        "Forman Job Order", "Request Joinkey"],
      dateCols: { "Date": "Date" }, defaultDate: "Date",
    },
    moveboard: {
      table: "fct_moveboard",
      cols: ["Company", "Job No", "Status", "Status Category", "Create Date", "Booked Date",
        "Move Date", "Service Type", "Size of Move", "Customer", "State", "State Name",
        "County Name", "City Name", "Source", "Source Connector", "Min Quote", "Max Quote",
        "Average Quote", "Total CF", "Total Lbs", "Big Job Status", "CF Range", "Bill Range",
        "Assigned", "Request Joinkey", "Closing Sheet Connector"],
      dateCols: { "Create Date": "Create Date", "Booked Date": "Booked Date", "Move Date": "Move Date" },
      defaultDate: "Create Date",
    },
    storage: {
      table: "fct_storage",
      cols: ["Company", "Payment Date", "Job Code", "Customer", "Amount", "Payment Type",
        "Request No", "Closing Sheet Connector"],
      dateCols: { "Payment Date": "Payment Date" }, defaultDate: "Payment Date",
    },
    refunds: {
      table: "fct_refunds",
      cols: ["Company", "Refund Date", "Move Date", "Customer", "Request No", "Source",
        "Sales Person", "Foreman", "Total refund", "Sales Responsibility",
        "Sales Commission Reduced Amount", "Reason", "Request Joinkey"],
      dateCols: { "Refund Date": "Refund Date" }, defaultDate: "Refund Date",
    },
    long_distance: {
      table: "fct_long_distance",
      cols: ["Unique Key", "Company", "Job No", "Date", "Customer", "Status", "Source",
        "Moving From", "Moving To", "Carrier Company", "Straight", "CF", "Rate",
        "Total To Carrier", "Total Bill", "Card Payment", "Balance Due", "Sales Person"],
      dateCols: { "Date": "Date" }, defaultDate: "Date",
    },
    claims: {
      table: "fct_claims",
      cols: ["Created Date", "Customer", "Request No", "Group", "Status", "Reason",
        "Responsibility", "Request Joinkey"],
      dateCols: { "Created Date": "Created Date" }, defaultDate: "Created Date",
    },
    negative_reviews: {
      table: "fct_negative_reviews",
      cols: ["Negative Review Id", "Company", "Group", "Customer", "Request No",
        "Is Identified", "Status", "Review Score", "Source", "Written Date", "Date ID",
        "Request Joinkey"],
      dateCols: { "Date ID": "Date ID", "Written Date": "Written Date" }, defaultDate: "Date ID",
    },
    rollup: {   // per-Request support rollup — lookup table, do NOT RS.filter it
      table: "rollup_support",
      cols: ["Request Joinkey", "Number of Claims Written", "Number of Negative Reviews Written",
        "Amount Refunded", "Claim Date", "Negative Review Date", "Refund Date",
        "Amount Reduced from Sales Person", "Amount Refunded Because of Negative Reviews",
        "Refunds Reason Category", "Negative Reviews Status", "Negative Reviews Source",
        "Responsibility", "Claims Reason"],
      dateCols: {}, defaultDate: null,
    },
    sales_salaries: {  // keyed by closing Unique Key — time-slice via closing membership
      table: "fct_sales_salaries",
      cols: ["Unique Key", "SP Slot", "Sales Person", "Rate", "Salary", "Bill Distribution"],
      dateCols: {}, defaultDate: null,
    },
    helper_salaries: {
      table: "fct_helper_salaries",
      cols: ["Unique Key", "Helper Slot", "Helper Name", "Hours Worked", "Helper Rate",
        "Amount Received", "Tip for Helper"],
      dateCols: {}, defaultDate: null,
    },
    reviews_breakdown: {
      table: "fct_reviews_breakdown",
      cols: ["Review Id", "Company", "Event Date", "Request Joinkey", "Counts", "Source",
        "With Image", "Number of Reviews", "Review Score", "Sales Person"],
      dateCols: { "Event Date": "Event Date" }, defaultDate: "Event Date",
    },
    card_expenses: {
      table: "fct_card_expenses",
      cols: ["Company", "Transaction Date", "Expense Category", "Provider", "Amount",
        "Is Advertising", "Source", "Record Source"],
      dateCols: { "Transaction Date": "Transaction Date" }, defaultDate: "Transaction Date",
    },
    callrail: {
      table: "fct_callrail",
      cols: ["Call Status", "Number Name", "Start Time", "Duration Seconds", "Name",
        "Phone Number", "First-Time Caller", "Source", "Company"],
      dateCols: { "Start Time": "Start Time" }, defaultDate: "Start Time",
    },
    leads: {
      table: "fct_leads",
      cols: ["Source", "Lead Date", "Customer", "Status", "Category", "State",
        "Lead Cost", "Net Cost", "Company", "Request # From Moveboard", "Matching Status"],
      dateCols: { "Lead Date": "Lead Date" }, defaultDate: "Lead Date",
    },
    scorecard: {
      table: "mart_forman_scorecard",
      cols: ["Foreman", "Month", "Month Year", "Total Jobs", "Total Packing Written",
        "Total CF", "Total Packing Estimate", "Total Bill Estimate", "Total Reviews Written",
        "Forman Fault Claims", "Packing per 100 CF", "Packing per 100 CF Score",
        "Packing Difference %", "Packing Vs Estimate Score", "Reviews to Jobs Ratio",
        "Review Score", "Claim Score", "Forman Score", "Forman Score Rank",
        "Forman Score Prev Month"],
      dateCols: { "Month": "Month" }, defaultDate: "Month",
    },
    review_counts: {
      table: "fct_review_counts",
      cols: ["Company", "Platform", "Date", "Number of Reviews"],
      dateCols: { "Date": "Date" }, defaultDate: "Date",
    },
    review_goals: {
      table: "fct_review_goals",
      cols: ["Company", "Platform", "Date", "Number of Reviews"],
      dateCols: { "Date": "Date" }, defaultDate: "Date",
    },
  };
  const _cache = {};
  const _loading = {};
  async function load(ds) {
    if (_cache[ds]) return _cache[ds];
    if (_loading[ds]) return _loading[ds];
    const spec = DATASETS[ds];
    _loading[ds] = ZTZ.api("/api/" + encodeURIComponent(spec.table) +
      "?limit=1000000&cols=" + encodeURIComponent(spec.cols.join(",")))
      .then(j => {
        const rows = j.rows || [];
        if (spec.defaultDate) rows.forEach(r => {   // pre-derive default date parts
          const d = String(r[spec.defaultDate] || "").slice(0, 10);
          r._d = d; r._y = d.slice(0, 4); r._m = parseInt(d.slice(5, 7), 10) || 0;
          r._day = parseInt(d.slice(8, 10), 10) || 0;
        });
        _cache[ds] = rows; delete _loading[ds];
        return rows;
      })
      .catch(e => {
        delete _loading[ds];   // never cache a failed load (e.g. expired token)
        throw e;
      });
    return _loading[ds];
  }

  /* ---------------- filter context ---------------- */
  // Global state: { dateFrom, dateTo, dayFrom, dayTo, multi: { fieldKey: Set } }
  const state = { dateFrom: null, dateTo: null, dayFrom: null, dayTo: null, multi: {} };

  // Global slicer fields → per-dataset column mapping (null = not applicable).
  const FIELDS = {
    year:        { label: "Year",         closing: "_y",            moveboard: "_y",             storage: "_y", refunds: "_y", long_distance: "_y", claims: "_y", negative_reviews: "_y", reviews_breakdown: "_y", card_expenses: "_y", callrail: "_y", leads: "_y", scorecard: "_y", review_counts: "_y", review_goals: "_y" },
    month:       { label: "Month",        closing: "_m",            moveboard: "_m",             storage: "_m", refunds: "_m", long_distance: "_m", claims: "_m", negative_reviews: "_m", reviews_breakdown: "_m", card_expenses: "_m", callrail: "_m", leads: "_m", scorecard: "_m", review_counts: "_m", review_goals: "_m" },
    company:     { label: "Company",      closing: "Company",       moveboard: "Company",        storage: "Company", refunds: "Company", long_distance: "Company", negative_reviews: "Company", reviews_breakdown: "Company", card_expenses: "Company", callrail: "Company", leads: "Company", review_counts: "Company", review_goals: "Company" },
    source:      { label: "Source",       closing: "Source",        moveboard: "Source",         refunds: "Source", long_distance: "Source", negative_reviews: "Source", reviews_breakdown: "Source", card_expenses: "Source", callrail: "Source", leads: "Source" },
    state:       { label: "State",        closing: "State",         moveboard: "State",          leads: "State" },
    foreman:     { label: "Foreman",      closing: "Foreman",       refunds: "Foreman",          scorecard: "Foreman" },
    sales:       { label: "Sales Person", closing: "Sales Person",  moveboard: "Assigned",       refunds: "Sales Person", long_distance: "Sales Person", reviews_breakdown: "Sales Person" },
    cfRange:     { label: "CF Range",     moveboard: "CF Range" },
    billRange:   { label: "Bill Range",   closing: "Bill Range",    moveboard: "Bill Range" },
    movingType:  { label: "Moving Type",  closing: "Moving Type" },
    sizeOfMove:  { label: "Size of Move", closing: "Size of Move",  moveboard: "Size of Move" },
    statusCat:   { label: "Lead Status",  moveboard: "Status Category" },
  };

  function monthName(m) { return ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m] || String(m); }

  /* Apply the global filter state to a dataset's rows.
     opts.dateColumn overrides which date column the range filters (USERELATIONSHIP). */
  function filtered(ds, rows, opts) {
    opts = opts || {};
    const spec = DATASETS[ds];
    const dcol = opts.dateColumn || spec.defaultDate;
    const useDerived = dcol === spec.defaultDate;
    const active = Object.entries(state.multi)
      .map(([k, set]) => ({ col: FIELDS[k] && FIELDS[k][ds], set }))
      .filter(f => f.col && f.set && f.set.size);
    return rows.filter(r => {
      let d = useDerived ? r._d : String(r[dcol] || "").slice(0, 10);
      if (state.dateFrom && (!d || d < state.dateFrom)) return false;
      if (state.dateTo && (!d || d > state.dateTo)) return false;
      if (state.dayFrom != null || state.dayTo != null) {
        const day = useDerived ? r._day : parseInt(d.slice(8, 10), 10) || 0;
        if (state.dayFrom != null && day < state.dayFrom) return false;
        if (state.dayTo != null && day > state.dayTo) return false;
      }
      for (const f of active) {
        const v = r[f.col];
        if (!f.set.has(v == null ? "—" : String(v))) return false;
      }
      return true;
    });
  }

  /* Shift the current date window by N years/months (for time-intelligence). */
  function shiftedState(years, months) {
    const shift = (s) => {
      if (!s) return s;
      const d = new Date(s + "T00:00:00");
      d.setFullYear(d.getFullYear() + (years || 0));
      d.setMonth(d.getMonth() + (months || 0));
      return d.toISOString().slice(0, 10);
    };
    return { from: shift(state.dateFrom), to: shift(state.dateTo) };
  }

  /* ---------------- measure library ---------------- */
  // Each measure: { name (EXACT PBI name), ds, fmt, fn(rows) } — fn gets FILTERED rows.
  const M = {};
  function register(name, ds, fmt, fn) { M[name] = { name, ds, fmt, fn }; }
  const sum = (rows, col) => rows.reduce((a, r) => a + num(r[col]), 0);
  const cnt = rows => rows.length;

  // --- Core revenue / jobs (Calculations table) — trips-append semantics baked in.
  register("Total Jobs", "closing", fmtN, rows => cnt(rows));
  register("Total Bill", "closing", money, rows => sum(rows, "Total Bill") + sum(rows, "Extra Bill From Trips"));
  register("Net Cash", "closing", money, rows => sum(rows, "Net Cash") + sum(rows, "Net Cash From Trips"));
  register("Card Payment", "closing", money, rows => sum(rows, "Card Payment"));
  register("Net Cash + Card Payment", "closing", money,
    rows => M["Net Cash"].fn(rows) + M["Card Payment"].fn(rows));
  register("Hours Worked by Forman", "closing", fmtN, rows => sum(rows, "Foreman Hours"));
  register("Total Tips", "closing", money,
    rows => sum(rows, "Tip From the Customers") + sum(rows, "Tip from Company"));
  register("Material Total", "closing", money, rows => sum(rows, "Material Total"));
  register("Packing Sold", "closing", money, rows => sum(rows, "Material $"));
  register("Total Expenses", "closing", money, rows => sum(rows, "Total Expense"));
  register("Profit", "closing", money, rows => sum(rows, "Profit per Job"));
  register("Jobs per 100 Hours", "closing", fmt1, rows => {
    const h = sum(rows, "Foreman Hours"); return h ? 100 * cnt(rows) / h : null;
  });
  register("Average Bill", "closing", money, rows => {
    const n = cnt(rows); return n ? M["Total Bill"].fn(rows) / n : null;
  });

  // --- Leads funnel (Moveboard).
  register("Total Leads", "moveboard", fmtN, rows => cnt(rows));
  register("Qualified Leads", "moveboard", fmtN,
    rows => rows.filter(r => r["Status Category"] !== "Bad Lead").length);
  register("Confirmed Leads", "moveboard", fmtN,
    rows => rows.filter(r => r["Status Category"] === "Confirmed").length);
  register("Dead Leads", "moveboard", fmtN,
    rows => rows.filter(r => r["Status Category"] === "Bad Lead").length);
  register("Booking Rate", "moveboard", fmtPct, rows => {
    const q = M["Qualified Leads"].fn(rows), c = M["Confirmed Leads"].fn(rows);
    if (!q) return null; return Math.min(1, c / q);
  });
  register("Average Quote (avg)", "moveboard", money, rows => {
    const v = rows.map(r => num(r["Average Quote"])).filter(x => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });
  register("Total Estimated CF", "moveboard", fmtN, rows => sum(rows, "Total CF"));
  register("Big Jobs", "moveboard", fmtN,
    rows => rows.filter(r => r["Big Job Status"] === "Yes").length);

  // --- Storage (exact DAX: split on Payment Type = 'Paid at Pickup').
  register("Storage Additional Revenue", "storage", money,
    rows => sum(rows.filter(r => String(r["Payment Type"] || "") !== "Paid at Pickup"), "Amount"));
  register("Storage Revenue Included in Total Bill", "storage", money,
    rows => sum(rows.filter(r => String(r["Payment Type"] || "") === "Paid at Pickup"), "Amount"));
  register("Total Storage Jobs", "closing", fmtN,
    rows => rows.filter(r => r["Storage"] === "Our Storage").length);

  // --- Refunds.
  register("Total Refunds", "refunds", money, rows => sum(rows, "Total refund"));
  register("Number of Refunds", "refunds", fmtN, rows => cnt(rows));

  // --- Claims & negative reviews.
  register("Number of Claims", "claims", fmtN, rows => cnt(rows));
  register("Number of Negative Reviews", "negative_reviews", fmtN, rows => cnt(rows));
  register("Identified Negative Reviews", "negative_reviews", fmtN,
    rows => rows.filter(r => num(r["Is Identified"]) === 1).length);

  // --- Card expenses (PBI: Advertising vs Other split on Expense Category).
  register("Advertisement Expense", "card_expenses", money,
    rows => sum(rows.filter(r => num(r["Is Advertising"]) === 1), "Amount"));
  register("Other Card Expenses", "card_expenses", money,
    rows => sum(rows.filter(r => num(r["Is Advertising"]) !== 1), "Amount"));

  // --- Salaries (join to closing via Unique Key for time slicing).
  register("Sales Commission", "sales_salaries", money, rows => sum(rows, "Salary"));
  register("Helper Salary", "helper_salaries", money, rows => sum(rows, "Amount Received"));
  register("Hours Worked by Helpers", "helper_salaries", fmtN, rows => sum(rows, "Hours Worked"));

  // --- Reviews (breakdown = per-platform parsed tokens; counts = factual monthly).
  register("Total Reviews Written", "reviews_breakdown", fmtN,
    rows => sum(rows.filter(r => num(r["Counts"]) === 1), "Number of Reviews"));
  register("Reviews Written (not counted)", "reviews_breakdown", fmtN,
    rows => sum(rows.filter(r => num(r["Counts"]) !== 1), "Number of Reviews"));
  register("Review Score (avg)", "reviews_breakdown", fmt1, rows => {
    const c = rows.filter(r => num(r["Counts"]) === 1 && r["Review Score"] != null);
    const n = c.reduce((a, r) => a + num(r["Number of Reviews"]), 0);
    if (!n) return null;
    return c.reduce((a, r) => a + num(r["Review Score"]) * num(r["Number of Reviews"]), 0) / n;
  });
  register("Total Factual Reviews", "review_counts", fmtN, rows => sum(rows, "Number of Reviews"));
  register("Review Goal", "review_goals", fmtN, rows => sum(rows, "Number of Reviews"));

  // --- CallRail.
  register("Total Calls", "callrail", fmtN, rows => cnt(rows));
  register("First-Time Callers", "callrail", fmtN,
    rows => rows.filter(r => String(r["First-Time Caller"]) === "1" ||
      String(r["First-Time Caller"]).toLowerCase() === "true").length);
  register("Avg Call Duration (s)", "callrail", fmt1, rows => {
    const v = rows.map(r => num(r["Duration Seconds"])).filter(x => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  });

  // --- Provider leads.
  register("Provider Leads", "leads", fmtN, rows => cnt(rows));
  register("Lead Cost", "leads", money, rows => sum(rows, "Lead Cost"));

  /* Generic evaluator: measure over the CURRENT global filters. */
  async function value(name, opts) {
    const m = M[name]; if (!m) return null;
    const rows = await load(m.ds);
    return m.fn(filtered(m.ds, rows, opts));
  }

  /* Time-intelligence: same measure, date window shifted -1 year (DATEADD).
     If no explicit range is set, compares calendar years via the year grouping instead. */
  async function yoy(name, opts) {
    const m = M[name]; if (!m) return null;
    const rows = await load(m.ds);
    const cur = m.fn(filtered(m.ds, rows, opts));
    const save = { f: state.dateFrom, t: state.dateTo };
    const sh = shiftedState(-1, 0);
    if (!save.f && !save.t) return { cur, prev: null, growth: null };
    state.dateFrom = sh.from; state.dateTo = sh.to;
    const prev = m.fn(filtered(m.ds, rows, opts));
    state.dateFrom = save.f; state.dateTo = save.t;
    return { cur, prev, growth: prev ? (cur - prev) / Math.abs(prev) : null };
  }

  /* Group rows by a column, evaluate a measure per group. Returns sorted [{k, v}]. */
  function groupBy(rows, col, measureName, topN) {
    const m = M[measureName];
    const g = {};
    rows.forEach(r => {
      const k = (col === "_month") ? (r._y + "-" + String(r._m).padStart(2, "0"))
        : (r[col] == null || r[col] === "" ? "—" : String(r[col]));
      (g[k] = g[k] || []).push(r);
    });
    let out = Object.entries(g).map(([k, rs]) => ({ k, v: m.fn(rs), n: rs.length }));
    out.sort(col === "_month" ? (a, b) => a.k.localeCompare(b.k) : (a, b) => (b.v || 0) - (a.v || 0));
    if (topN) out = out.slice(0, topN);
    return out;
  }

  return { DATASETS, FIELDS, state, load, filtered, monthName, M, value, yoy, groupBy,
           fmtN, money, fmtPct, fmt1, num };
})();
