/* ================================================================
   stats.js — works out friendly statistics from the same lists the
   main page shows (window.REPO_DATA, or the data/*.json files as a
   fallback, or the little example set).

   It turns each messy row into a few clean numbers — price, make,
   year, body type, parish, bank — then draws simple bar charts with
   plain <div>s (no chart library, so it works offline).
   ================================================================ */

const state = {
  view: "vehicles",
  data: { vehicles: [], properties: [], generated: "" },
  isExample: false,
};

/* ---------------- Little helpers ---------------- */

function cleanStr(v) {
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}

// Turn any price text ("J$2.6M", "J$1,200,000", "3300000.00") into a plain
// number of Jamaican dollars. Returns null when we cannot read one.
// US$ prices are skipped from the money totals so we don't mix currencies.
function priceToNumber(raw) {
  const s = cleanStr(raw);
  if (!s) return null;
  if (/US\$/i.test(s)) return null;                 // skip US-dollar prices
  const m = s.match(/([\d,]+(?:\.\d+)?)\s*([MK])?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n) || n <= 0) return null;
  const suf = (m[2] || "").toUpperCase();
  if (suf === "M") n *= 1e6;
  else if (suf === "K") n *= 1e3;
  // A bare number under 1000 is almost certainly not a real asking price.
  if (n < 1000) return null;
  return n;
}

// Short money label for chart rows / small spaces: J$2.6M, J$950K.
function shortMoney(n) {
  if (n == null) return "—";
  if (n >= 1e6) return "J$" + trim(n / 1e6) + "M";
  if (n >= 1e3) return "J$" + trim(n / 1e3) + "K";
  return "J$" + Math.round(n);
}
function trim(x) {
  return (Math.round(x * 10) / 10).toString();
}
// Full money label for the big summary cards.
function fullMoney(n) {
  if (n == null) return "—";
  return "J$" + Math.round(n).toLocaleString("en-US");
}

// Jamaican parishes — used to pull a parish out of a free-text address.
const PARISHES = [
  "Kingston", "St. Andrew", "St. Catherine", "Clarendon", "Manchester",
  "St. Elizabeth", "Westmoreland", "Hanover", "St. James", "Trelawny",
  "St. Ann", "St. Mary", "Portland", "St. Thomas",
];
// Some spellings / towns that map onto a parish.
const PLACE_TO_PARISH = {
  "st andrew": "St. Andrew", "portmore": "St. Catherine",
  "st catherine": "St. Catherine", "spanish town": "St. Catherine",
  "old harbour": "St. Catherine", "linstead": "St. Catherine",
  "ewarton": "St. Catherine", "may pen": "Clarendon",
  "mandeville": "Manchester", "montego bay": "St. James",
  "mobay": "St. James", "ocho rios": "St. Ann", "negril": "Westmoreland",
  "st ann": "St. Ann", "st mary": "St. Mary", "st thomas": "St. Thomas",
  "st elizabeth": "St. Elizabeth", "st james": "St. James",
  "kgn": "Kingston",
};
function findParish(text) {
  const low = " " + cleanStr(text).toLowerCase() + " ";
  for (const p of PARISHES) {
    if (low.includes(p.toLowerCase())) return p;
  }
  for (const key in PLACE_TO_PARISH) {
    if (low.includes(key)) return PLACE_TO_PARISH[key];
  }
  return "";
}

// Known car makes (longest first so "Mercedes Benz" beats "Benz"). We only
// count a make when it actually matches this list — that keeps junk titles
// like "Estimated M.V. $2.8M…" or a bare "2013" out of the makes chart.
const CAR_MAKES = [
  "Mercedes Benz", "Land Rover", "Great Wall", "Alfa Romeo", "Mercedes",
  "Benz", "Toyota", "Honda", "Nissan", "Mazda", "Suzuki", "Mitsubishi",
  "Subaru", "BMW", "Audi", "Ford", "Kia", "Hyundai", "Jeep", "Lexus",
  "Volkswagen", "Porsche", "Porshe", "Mini", "Isuzu", "Foton", "Sinotruk",
  "Greatwall", "Volvo", "Peugeot", "Chevrolet", "Daihatsu", "Infiniti",
].sort((a, b) => b.length - a.length);

// Fold spelling / spacing variants onto one canonical name.
const MAKE_ALIAS = {
  "Benz": "Mercedes-Benz", "Mercedes": "Mercedes-Benz",
  "Mercedes Benz": "Mercedes-Benz", "Greatwall": "Great Wall",
  "Porshe": "Porsche",
};

function findMake(text) {
  const t = " " + cleanStr(text) + " ";
  for (const mk of CAR_MAKES) {
    const pat = mk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp("(?:^|\\W)(" + pat + ")(?:\\W|$)", "i");
    if (re.test(t)) return MAKE_ALIAS[mk] || mk;
  }
  return "";
}

/* ---------------- Pull clean facts off each row ---------------- */

function vehicleFacts(item) {
  const det = item.details || {};
  const blob = [item.title, item.location, ...Object.values(det)]
    .map(cleanStr).join(" ");
  // Prefer the given make, then look for a known make in the title, then in
  // the whole row. Unknown / junk makes become "Other" rather than nonsense.
  let make = findMake(item.make) || findMake(item.title) || findMake(blob);
  if (!make && cleanStr(item.make) && !/^\d+$/.test(cleanStr(item.make))) {
    make = cleanStr(item.make);      // a real name we just don't have listed
  }
  if (!make) make = "Other";
  const yearRaw = cleanStr(item.year) || (blob.match(/\b(?:19|20)\d{2}\b/) || [""])[0];
  const year = /^(?:19|20)\d{2}$/.test(yearRaw) ? parseInt(yearRaw, 10) : null;
  return {
    bank: cleanStr(item.bank) || "Unknown",
    make,
    year,
    body: cleanStr(item.body),
    parish: findParish(item.location || blob),
    price: priceToNumber(item.price),
  };
}

function propertyFacts(item) {
  const det = item.details || {};
  const blob = [item.title, item.location, ...Object.values(det)]
    .map(cleanStr).join(" ");
  const parish = cleanStr(det.PARISH) || findParish(item.location || blob);
  const type = cleanStr(det["TYPE OF PROPERTY"]) || cleanStr(item.type);
  let price = priceToNumber(item.price);
  if (price == null) {
    price = priceToNumber(det["OUR LAST ESTIMATE MARKET VALUE"]) ||
            priceToNumber(det["ESTIMATED MARKET VALUE"]);
  }
  return {
    bank: cleanStr(item.bank) || "Unknown",
    parish: parish || "",
    type: type || "",
    price,
  };
}

/* ---------------- Number crunching ---------------- */

function tally(rows, keyFn) {
  const counts = {};
  rows.forEach((r) => {
    const k = keyFn(r);
    if (!k) return;
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function priceStats(rows) {
  const nums = rows.map((r) => r.price).filter((n) => n != null).sort((a, b) => a - b);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  return {
    n: nums.length,
    min: nums[0],
    max: nums[nums.length - 1],
    avg: sum / nums.length,
    median,
  };
}

// Group prices into friendly buckets for a distribution chart.
function priceBuckets(rows, edges, labels) {
  const buckets = labels.map((label) => ({ label, count: 0 }));
  rows.forEach((r) => {
    if (r.price == null) return;
    let i = edges.findIndex((e) => r.price < e);
    if (i === -1) i = edges.length;      // above the top edge
    buckets[i].count++;
  });
  return buckets.filter((b) => b.count > 0 || true);   // keep order & gaps
}

/* ---------------- Drawing ---------------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function statCard(emoji, value, label) {
  const c = el("div", "stat-card");
  c.appendChild(el("div", "stat-emoji", emoji));
  c.appendChild(el("div", "stat-value", value));
  c.appendChild(el("div", "stat-label", label));
  return c;
}

// A titled block containing a horizontal bar chart.
function barChart(title, rows, opts) {
  opts = opts || {};
  const limit = opts.limit || rows.length;
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => r.count));

  const block = el("div", "chart-block");
  block.appendChild(el("h3", "chart-title", title));
  if (!shown.length) {
    block.appendChild(el("p", "chart-empty", "Not enough information for this chart."));
    return block;
  }
  const list = el("div", "bars");
  shown.forEach((r) => {
    const row = el("div", "bar-row");
    row.appendChild(el("span", "bar-label", r.label));
    const track = el("div", "bar-track");
    const fill = el("div", "bar-fill");
    fill.style.width = Math.max(6, (r.count / max) * 100) + "%";
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(el("span", "bar-count", opts.fmt ? opts.fmt(r) : r.count));
    list.appendChild(row);
  });
  block.appendChild(list);
  return block;
}

/* ---------------- Render a view ---------------- */

function render() {
  const summary = document.getElementById("summary");
  const charts = document.getElementById("charts");
  summary.innerHTML = "";
  charts.innerHTML = "";

  const isVeh = state.view === "vehicles";
  const raw = isVeh ? state.data.vehicles : state.data.properties;
  const rows = raw.map(isVeh ? vehicleFacts : propertyFacts);

  document.getElementById("emptyMsg").classList.toggle("hidden", rows.length > 0);
  if (!rows.length) return;

  const ps = priceStats(rows);

  // -- Summary cards ------------------------------------------------
  summary.appendChild(statCard(isVeh ? "🚗" : "🏠", rows.length,
    isVeh ? "Cars listed" : "Properties listed"));
  summary.appendChild(statCard("🏦",
    new Set(rows.map((r) => r.bank)).size, "Banks & unions"));
  if (ps) {
    summary.appendChild(statCard("⚖️", shortMoney(ps.median), "Typical price (median)"));
    summary.appendChild(statCard("📈", shortMoney(ps.avg), "Average price"));
    summary.appendChild(statCard("💚", shortMoney(ps.min), "Cheapest"));
    summary.appendChild(statCard("💎", shortMoney(ps.max), "Most expensive"));
  }

  // -- Charts -------------------------------------------------------
  if (isVeh) {
    charts.appendChild(barChart("🏷️ Most common makes",
      tally(rows, (r) => r.make), { limit: 12 }));

    charts.appendChild(barChart("🏦 Cars by bank",
      tally(rows, (r) => shortBank(r.bank))));

    charts.appendChild(barChart("📅 Cars by year",
      tally(rows, (r) => (r.year ? String(r.year) : ""))
        .sort((a, b) => b.label.localeCompare(a.label)), { limit: 15 }));

    charts.appendChild(barChart("🚙 Body types",
      tally(rows, (r) => r.body), { limit: 10 }));

    charts.appendChild(barChart("📍 Cars by parish",
      tally(rows, (r) => r.parish), { limit: 12 }));

    charts.appendChild(barChart("💰 Price ranges",
      priceBuckets(rows,
        [1e6, 2e6, 3e6, 5e6, 8e6],
        ["Under J$1M", "J$1M–2M", "J$2M–3M", "J$3M–5M", "J$5M–8M", "Over J$8M"])));
  } else {
    charts.appendChild(barChart("🏦 Properties by bank",
      tally(rows, (r) => shortBank(r.bank))));

    charts.appendChild(barChart("📍 Properties by parish",
      tally(rows, (r) => r.parish), { limit: 14 }));

    charts.appendChild(barChart("🏘️ Property types",
      tally(rows, (r) => r.type), { limit: 10 }));

    charts.appendChild(barChart("💰 Price ranges",
      priceBuckets(rows,
        [10e6, 25e6, 50e6, 100e6],
        ["Under J$10M", "J$10M–25M", "J$25M–50M", "J$50M–100M", "Over J$100M"])));
  }
}

// Shorten long bank names so they fit the chart labels.
function shortBank(name) {
  const n = cleanStr(name);
  if (/^ncb/i.test(n)) return "NCB";
  if (/jmmb/i.test(n)) return "JMMB";
  if (/jn\b/i.test(n)) return "JN Bank";
  if (/sagicor/i.test(n)) return "Sagicor";
  if (/infiniti/i.test(n)) return "Infiniti CU";
  if (/first ?global/i.test(n)) return "First Global";
  if (/scotia/i.test(n)) return "Scotia";
  return n.length > 18 ? n.slice(0, 17) + "…" : n;
}

/* ---------------- Load data (same approach as app.js) ---------------- */

async function loadData() {
  if (window.REPO_DATA) {
    state.data = pick(window.REPO_DATA);
    return;
  }
  try {
    const [v, p] = await Promise.all([
      fetch("data/vehicles.json").then((r) => r.json()).catch(() => null),
      fetch("data/properties.json").then((r) => r.json()).catch(() => null),
    ]);
    if (v || p) {
      state.data = {
        vehicles: (v && v.items) || [],
        properties: (p && p.items) || [],
        generated: (v && v.generated) || (p && p.generated) || "",
      };
      return;
    }
  } catch (e) { /* fall through to example */ }

  state.isExample = true;
  state.data = pick(window.EXAMPLE_DATA || { vehicles: [], properties: [] });
}
function pick(d) {
  return {
    vehicles: d.vehicles || [],
    properties: d.properties || [],
    generated: d.generated || "",
  };
}

/* ---------------- Wire up ---------------- */

function setView(view) {
  state.view = view;
  document.getElementById("tabVehicles").classList.toggle("tab-active", view === "vehicles");
  document.getElementById("tabProps").classList.toggle("tab-active", view === "properties");
  render();
}

async function start() {
  await loadData();

  document.getElementById("exampleBanner").classList.toggle("hidden", !state.isExample);
  document.getElementById("countVehicles").textContent = state.data.vehicles.length;
  document.getElementById("countProps").textContent = state.data.properties.length;
  if (state.data.generated) {
    document.getElementById("generated").textContent = "Lists last updated: " + state.data.generated;
  }

  document.getElementById("tabVehicles").addEventListener("click", () => setView("vehicles"));
  document.getElementById("tabProps").addEventListener("click", () => setView("properties"));

  render();
}

start();
