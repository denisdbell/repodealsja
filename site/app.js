/* ================================================================
   app.js — makes the website work.
   It reads the lists (window.REPO_DATA if the program has run, otherwise
   it tries to fetch the .json files), SANITISES each messy row into clean
   fields (make / model / year / price for cars; location / price for
   houses), then draws big friendly cards. Clicking "See all details"
   opens a tidy modal window.
   ================================================================ */

const state = {
  view: "properties",   // which big button is chosen
  search: "",
  data: { vehicles: [], properties: [], sources: [], generated: "" },
  isExample: false,
};

/* ================================================================
   1. SANITISER  — turn every bank's different shape into clean fields
   ----------------------------------------------------------------
   Every bank publishes in a different layout:
     • NCB cars      -> unnamed columns col2=Year, col3=Make, col4=Model,
                        col8=Address, col10=Asking Price
     • JMMB cars     -> named columns "Vehicle (Type)", "Market Value"…
     • JN / Sagicor  -> one long "Description" blob per row
     • NCB houses    -> "PROPERTY ADDRESS", "PARISH", "…MARKET VALUE"
   The sanitiser reads all of them into ONE tidy shape:
     { kind, make, model, year, price, location, body, title, search }
   ================================================================ */

// Car makes we know about (longest first so "Mercedes Benz" beats "Benz").
const CAR_MAKES = [
  "Mercedes Benz", "Land Rover", "Great Wall", "Alfa Romeo",
  "Mercedes", "Benz", "Toyota", "Honda", "Nissan", "Mazda", "Suzuki",
  "Mitsubishi", "Subaru", "BMW", "Audi", "Ford", "Kia", "Hyundai",
  "Jeep", "Lexus", "Volkswagen", "Porsche", "Porshe", "Mini", "Isuzu",
  "Foton", "Sinotruk", "Greatwall", "Volvo", "Peugeot", "Chevrolet",
  "Daihatsu", "Infiniti",
].sort((a, b) => b.length - a.length);

// Words that are NOT a model name (so we stop reading the model there).
const MODEL_STOP = new Set(
  ("chassis cc plate location colour color mr mrs original auto source msrp " +
   "mi automatic manual white black grey gray red blue brown silver green " +
   "gold engine available under contract sold").split(" ")
);

// Jamaican parishes / towns — used as a last resort to guess a car's location.
const PLACES = [
  "Kingston", "St. Andrew", "St Andrew", "Portmore", "St. Catherine",
  "St Catherine", "Spanish Town", "Montego Bay", "Manchester", "Mandeville",
  "May Pen", "Clarendon", "St. Ann", "Ocho Rios", "Portland", "St. Mary",
  "St. Thomas", "Westmoreland", "Hanover", "Trelawny", "St. Elizabeth",
  "St. James", "Negril", "Old Harbour", "Linstead", "Ewarton",
];

function cleanStr(v) {
  return v == null ? "" : String(v).replace(/\s+/g, " ").trim();
}

// Turn any price-ish text into a friendly "J$1,234,567".
function formatPrice(raw) {
  const s = cleanStr(raw);
  if (!s) return "";
  if (s.indexOf("$") >= 0) {
    // The trailing (M|K) is only a magnitude if it stands alone — this stops
    // us grabbing the "M" from "MSRP" or the "K" from "Kgn.".
    const m = s.match(/(?:J\$|US\$|\$)\s?[\d,]+(?:\.\d+)?(?:\s?[MK]\b)?/i);
    if (m) {
      let out = m[0].replace(/\s+/g, " ").trim();
      if (/^US\$/i.test(out)) return "US$" + out.replace(/^US\$\s?/i, "");
      return out.replace(/^\$/, "J$").replace(/^J\$\s+/, "J$");
    }
    return s;
  }
  const digits = s.replace(/[^\d.]/g, "");
  if (/^\d{5,}(\.\d+)?$/.test(digits)) {           // 5+ digits => a real amount
    return "J$" + Math.round(parseFloat(digits)).toLocaleString("en-US");
  }
  return "";
}

// Largest "pure number" of 6+ digits in a set of values (NCB asking prices).
function bigNumberPrice(values) {
  let best = 0;
  values.forEach((v) => {
    const s = cleanStr(v).replace(/,/g, "");
    if (/^\d{6,}$/.test(s)) best = Math.max(best, parseInt(s, 10));
  });
  return best ? "J$" + best.toLocaleString("en-US") : "";
}

// First value whose column name contains any of the hint words.
function findVal(entries, hints) {
  for (const [k, v] of entries) {
    const low = k.toLowerCase();
    if (hints.some((h) => low.includes(h)) && v) return v;
  }
  return "";
}

function findYear(text) {
  const m = String(text).match(/\b(?:19|20)\d{2}\b/);
  return m ? m[0] : "";
}

// Pull "Make + Model" out of a free-text blob using the known-makes list.
function parseMakeModel(text) {
  const t = " " + text + " ";
  for (const mk of CAR_MAKES) {
    const pat = mk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp("(?:^|\\W)(" + pat + ")(?:\\W|$)", "i");
    const m = t.match(re);
    if (!m) continue;
    const rest = t.slice(m.index + m[0].length).trim();
    const tokens = rest.split(/\s+/).filter(Boolean);
    let model = "";
    if (tokens[0]) {
      const first = tokens[0].replace(/[^\w\-]/g, "");
      if (first && !MODEL_STOP.has(first.toLowerCase())) {
        model = first;
        const second = (tokens[1] || "").replace(/[^\w\-]/g, "");
        if (second.length >= 2 && /^[A-Za-z]+$/.test(second) &&
            !MODEL_STOP.has(second.toLowerCase())) {
          model += " " + second;
        }
      }
    }
    return { make: mk, model };
  }
  return { make: "", model: "" };
}

function findPlace(text) {
  const low = " " + text.toLowerCase() + " ";
  for (const p of PLACES) {
    if (low.includes(p.toLowerCase())) return p;
  }
  return "";
}

function sanitizeVehicle(item) {
  const det = item.details || {};
  const entries = Object.entries(det).map(([k, v]) => [cleanStr(k), cleanStr(v)]);
  const values = entries.map((e) => e[1]);
  const blob = [cleanStr(item.title), cleanStr(item.location), ...values].join(" ");

  let year = "", make = "", model = "", price = "", location = "", body = "";

  // -- NCB layout: unnamed columns in a fixed order (col2=Year … col10=Price)
  const c2 = cleanStr(det.col2), c3 = cleanStr(det.col3), c4 = cleanStr(det.col4);
  if (/^(?:19|20)\d{2}$/.test(c2) && c3) {
    year = c2; make = c3; model = c4;
    price = formatPrice(det.col10);
    location = cleanStr(det.col8) || cleanStr(det.col7);
    body = cleanStr(det["Vehicles as at"]);
  }

  // -- Named columns (JMMB and friends)
  if (!make) make = findVal(entries, ["make"]);
  if (!model) model = findVal(entries, ["model"]);
  if (!year) year = findYear(findVal(entries, ["year"]) || "");
  if (!body) body = findVal(entries, ["type", "body"]);

  // -- Free-text blob (JN, Sagicor, Infiniti) — parse what we can
  if (!year) year = findYear(blob);
  if (!make || !model) {
    const mm = parseMakeModel(blob);
    if (!make) make = mm.make;
    if (!model && mm.make === make) model = mm.model;
  }

  // -- Price: top-level, then a price-ish column, then $ in text, then big number
  if (!price) price = formatPrice(item.price);
  if (!price) price = formatPrice(findVal(entries, ["price", "value", "amount",
    "asking", "cost", "reserve", "market"]));
  if (!price) {
    const m = blob.match(/(?:J\$|US\$|\$)\s?[\d,]+(?:\.\d+)?(?:\s?[MK]\b)?/i);
    if (m) price = formatPrice(m[0]);
  }
  if (!price) price = bigNumberPrice(values);

  // -- Location: top-level, then a location-ish column, then "Location:", place
  if (!location) location = cleanStr(item.location);
  if (!location) location = findVal(entries, ["location", "site", "parish",
    "address", "garage", "town"]);
  if (!location) {
    const m = blob.match(/Location:\s*(.+?)(?:\s+\d[\d,]*\s*mi\b|$)/i);
    if (m) location = cleanStr(m[1]);
  }
  if (!location) location = findPlace(blob);

  // NCB adds "_1", "_2"… to repeated models to keep them unique — drop that.
  model = model.replace(/_\d+$/, "").trim();

  const title = [year, make, model].filter(Boolean).join(" ").trim();
  return {
    kind: "vehicle", year, make, model, price, location, body,
    title: title || cleanStr(item.title) || "Vehicle",
    search: [title, make, model, year, price, location, body,
             item.bank, blob].join(" ").toLowerCase(),
    valid: !!(make || model || year || price),
  };
}

function sanitizeProperty(item) {
  const det = item.details || {};
  const entries = Object.entries(det).map(([k, v]) => [cleanStr(k), cleanStr(v)]);
  const values = entries.map((e) => e[1]);
  const blob = [cleanStr(item.title), cleanStr(item.location), ...values].join(" ");

  // -- Location: address + parish where we can find them
  let location = cleanStr(item.location) ||
    findVal(entries, ["property address", "address", "location", "situated"]);
  const parish = findVal(entries, ["parish"]);
  if (parish && location && !location.toLowerCase().includes(parish.toLowerCase())) {
    location = location + ", " + parish;
  } else if (parish && !location) {
    location = parish;
  }
  if (!location) location = findPlace(blob);

  const type = findVal(entries, ["type of property", "type", "description"]);

  // -- Price
  let price = formatPrice(item.price) ||
    formatPrice(findVal(entries, ["estimate", "market value", "value", "price",
      "amount", "asking", "reserve", "listing"]));
  if (!price) {
    const m = blob.match(/(?:J\$|US\$|\$)\s?[\d,]+(?:\.\d+)?(?:\s?[MK]\b)?/i);
    if (m) price = formatPrice(m[0]);
  }
  if (!price) price = bigNumberPrice(values);

  const title = location || cleanStr(item.title) || "Property";
  return {
    kind: "property", location, price, type,
    title,
    search: [title, location, price, type, item.bank, blob].join(" ").toLowerCase(),
    valid: !!(price || location),
  };
}

function sanitizeAll(list, kind) {
  const out = [];
  (list || []).forEach((item) => {
    const s = kind === "vehicle" ? sanitizeVehicle(item) : sanitizeProperty(item);
    if (!s.valid) return;               // drop header rows / empty junk
    item._s = s;
    out.push(item);
  });
  return out;
}

// ---- Emojis so every card has a picture, even without a photo ----
function pickEmoji(item) {
  const s = item._s || {};
  if (item.category === "vehicle") {
    // Use the tidy fields only — the raw details hold noise like garage names
    // ("Nihon Trucking") that would wrongly trip the "truck" test.
    const t = [s.body, s.title, s.make, s.model].join(" ").toLowerCase();
    if (/truck|pick.?up|hilux|tipper|ranger/.test(t)) return "🛻";
    if (/bus|coaster|hiace|van|wagon/.test(t)) return "🚐";
    if (/bike|motor.?cycle|scooter/.test(t)) return "🏍️";
    return "🚗";
  }
  const t = (item.title + " " + JSON.stringify(item.details || {})).toLowerCase();
  if (/land|lot|acre/.test(t)) return "🌳";
  if (/apartment|townhouse|condo/.test(t)) return "🏢";
  if (/commercial|shop|office|building/.test(t)) return "🏬";
  return "🏠";
}

// ---- Load data: prefer the .js file, fall back to fetching .json ----
async function loadData() {
  if (window.REPO_DATA) {
    state.data = normalise(window.REPO_DATA);
    return;
  }
  // Fallback for when the site is served over http (not double-clicked).
  try {
    const [v, p, s] = await Promise.all([
      fetch("data/vehicles.json").then((r) => r.json()).catch(() => null),
      fetch("data/properties.json").then((r) => r.json()).catch(() => null),
      fetch("data/sources.json").then((r) => r.json()).catch(() => null),
    ]);
    if (v || p) {
      state.data = normalise({
        vehicles: (v && v.items) || [],
        properties: (p && p.items) || [],
        sources: (s && s.items) || [],
        generated: (v && v.generated) || (p && p.generated) || "",
      });
      return;
    }
  } catch (e) { /* ignore, use example */ }

  // Nothing found — use the little example set so the page is not blank.
  state.isExample = true;
  state.data = normalise(window.EXAMPLE_DATA || { vehicles: [], properties: [], sources: [] });
}

function normalise(d) {
  return {
    vehicles: sanitizeAll(d.vehicles || [], "vehicle"),
    properties: sanitizeAll(d.properties || [], "property"),
    sources: d.sources || [],
    generated: d.generated || "",
  };
}

// ---- Draw the cards for the chosen view ----
function render() {
  const list = state.data[state.view] || [];
  const term = state.search.trim().toLowerCase();
  const filtered = term
    ? list.filter((it) => (it._s ? it._s.search : JSON.stringify(it).toLowerCase())
        .includes(term))
    : list;

  const wrap = document.getElementById("cards");
  wrap.innerHTML = "";

  document.getElementById("emptyMsg").classList.toggle("hidden", filtered.length > 0);

  filtered.forEach((item) => wrap.appendChild(makeCard(item)));

  document.getElementById("countProps").textContent = state.data.properties.length;
  document.getElementById("countVehicles").textContent = state.data.vehicles.length;
}

function makeCard(item) {
  const s = item._s || {};
  const card = el("div", "card");

  const top = el("div", "card-top");
  top.appendChild(el("div", "card-emoji", pickEmoji(item)));
  card.appendChild(top);

  const body = el("div", "card-body");
  body.appendChild(el("div", "card-title", s.title || item.title || "See details"));

  const price = s.price || item.price;
  if (price) body.appendChild(el("div", "card-price", price));

  const location = s.location || item.location;
  if (location) {
    const loc = el("div", "card-line");
    loc.innerHTML = "📍 <b>" + escapeHtml(location) + "</b>";
    body.appendChild(loc);
  }
  if (item.category === "vehicle" && s.body) {
    body.appendChild(el("div", "card-line", "🚙 " + s.body));
  }
  body.appendChild(el("span", "bank-badge", "🏦 " + (item.bank || "Unknown")));

  // "See all details" now opens a tidy modal instead of a folded table.
  if (Object.keys(item.details || {}).length) {
    const more = el("button", "btn-details", "🔍 See all details");
    more.addEventListener("click", () => openModal(item));
    body.appendChild(more);
  }
  card.appendChild(body);

  // Two big buttons
  const btns = el("div", "card-btns");
  btns.appendChild(linkBtn("🌐 Visit site", item.parent_url, "btn-go"));
  btns.appendChild(downloadBtn(item));
  card.appendChild(btns);

  return card;
}

/* ================================================================
   2. DETAILS MODAL
   ================================================================ */

// Friendlier labels for cryptic column names (mainly NCB's unnamed columns).
function prettyLabel(key, item) {
  const isNcbVehicle = item.category === "vehicle" &&
    /^ncb/i.test(item.bank || "");
  if (isNcbVehicle) {
    const map = {
      col1: "#", col2: "Year", col3: "Make", col4: "Model",
      col5: "Body type", col6: "Colour", col7: "Location",
      col8: "Address", col9: "Status", col10: "Asking Price",
      "Vehicles as at": "Body type",
    };
    if (map[key]) return map[key];
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(key)) return "Colour";     // NCB's date-header column
  if (/^col\d+$/.test(key)) return "Detail " + key.replace("col", "");
  return key;
}

function openModal(item) {
  const s = item._s || {};
  const modal = document.getElementById("modal");
  const content = document.getElementById("modalContent");
  content.innerHTML = "";

  // ---- Header: title + price (built from the sanitised fields) ----
  const head = el("div", "modal-head");
  head.appendChild(el("div", "modal-emoji", pickEmoji(item)));
  const htext = el("div", "modal-headtext");
  const h = el("h2", "modal-title", s.title || item.title || "Details");
  h.id = "modalTitle";
  htext.appendChild(h);
  const price = s.price || item.price;
  if (price) htext.appendChild(el("div", "modal-price", price));
  htext.appendChild(el("span", "bank-badge", "🏦 " + (item.bank || "Unknown")));
  head.appendChild(htext);
  content.appendChild(head);

  // ---- Quick summary of the clean fields ----
  const summary = [];
  if (item.category === "vehicle") {
    summary.push(["Make", s.make], ["Model", s.model], ["Year", s.year],
                 ["Body type", s.body], ["Price", price], ["Location", s.location]);
  } else {
    summary.push(["Location", s.location], ["Type", s.type], ["Price", price]);
  }
  const clean = summary.filter(([, v]) => v);
  if (clean.length) {
    const sec = el("div", "modal-section");
    sec.appendChild(el("h3", "modal-subtitle", "Summary"));
    const grid = el("div", "modal-grid");
    clean.forEach(([k, v]) => {
      const row = el("div", "modal-cell");
      row.appendChild(el("span", "modal-key", k));
      row.appendChild(el("span", "modal-val", v));
      grid.appendChild(row);
    });
    sec.appendChild(grid);
    content.appendChild(sec);
  }

  // ---- Every raw detail, nicely labelled ----
  const det = item.details || {};
  const keys = Object.keys(det).filter((k) => cleanStr(det[k]));
  if (keys.length) {
    const sec = el("div", "modal-section");
    sec.appendChild(el("h3", "modal-subtitle", "All details"));
    const tbl = document.createElement("table");
    tbl.className = "modal-table";
    keys.forEach((k) => {
      const tr = document.createElement("tr");
      tr.appendChild(el("td", "modal-tkey", prettyLabel(k, item)));
      tr.appendChild(el("td", "", cleanStr(det[k])));
      tbl.appendChild(tr);
    });
    sec.appendChild(tbl);
    content.appendChild(sec);
  }

  // ---- Action buttons inside the modal too ----
  const btns = el("div", "modal-btns");
  btns.appendChild(linkBtn("🌐 Visit site", item.parent_url, "btn-go"));
  btns.appendChild(downloadBtn(item));
  content.appendChild(btns);

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  const closeBtn = modal.querySelector(".modal-close");
  if (closeBtn) closeBtn.focus();
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
  document.body.style.overflow = "";
}

function linkBtn(text, url, cls) {
  const a = document.createElement("a");
  a.className = "btn " + cls + (url ? "" : " disabled");
  a.textContent = text;
  if (url) {
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
  }
  return a;
}

function downloadBtn(item) {
  // Prefer the saved local copy; otherwise link to the original file online.
  const href = item.download_file || item.file_url;
  const a = document.createElement("a");
  a.className = "btn btn-dl" + (href ? "" : " disabled");
  a.textContent = "⬇️ Download list";
  if (href) {
    a.href = href;
    if (item.download_file) a.setAttribute("download", "");
    a.target = "_blank";
    a.rel = "noopener";
  }
  return a;
}

// ---- Sources section ----
function renderSources() {
  const wrap = document.getElementById("sourceList");
  wrap.innerHTML = "";
  (state.data.sources || []).forEach((s) => {
    const c = el("div", "source-card");
    const name = el("div", "source-name");
    name.textContent = s.bank;
    const tagCls = s.category === "vehicle" ? "v" : s.category === "property" ? "p" : "b";
    const tagTxt = s.category === "vehicle" ? "Cars" : s.category === "property" ? "Houses" : "Both";
    const tag = el("span", "source-tag " + tagCls, tagTxt);
    name.appendChild(tag);
    c.appendChild(name);

    const btns = el("div", "source-btns");
    btns.appendChild(linkBtn("🌐 Visit", s.parent_url, "btn-go"));
    const dlHref = s.download_file || s.file_url;
    const dl = document.createElement("a");
    dl.className = "btn btn-dl" + (dlHref ? "" : " disabled");
    dl.textContent = "⬇️ Download";
    if (dlHref) {
      dl.href = dlHref;
      if (s.download_file) dl.setAttribute("download", "");
      dl.target = "_blank";
      dl.rel = "noopener";
    }
    btns.appendChild(dl);
    c.appendChild(btns);
    wrap.appendChild(c);
  });
}

// ---- Small helpers ----
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Wire up the buttons ----
function setView(view) {
  state.view = view;
  document.getElementById("tabProps").classList.toggle("tab-active", view === "properties");
  document.getElementById("tabVehicles").classList.toggle("tab-active", view === "vehicles");
  updateSearchHint();
  render();
}

function updateSearchHint() {
  const box = document.getElementById("search");
  if (!box) return;
  box.placeholder = state.view === "vehicles"
    ? "Search cars — try “Toyota”, “SUV”, “2020”…"
    : "Search houses — try a town, parish or “land”…";
}

async function start() {
  await loadData();

  document.getElementById("exampleBanner").classList.toggle("hidden", !state.isExample);
  if (state.data.generated) {
    document.getElementById("generated").textContent = "Lists last updated: " + state.data.generated;
  }

  document.getElementById("tabProps").addEventListener("click", () => setView("properties"));
  document.getElementById("tabVehicles").addEventListener("click", () => setView("vehicles"));
  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });

  // Modal close: the ✕, the dark backdrop, or the Escape key.
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  updateSearchHint();
  renderSources();
  render();
}

start();
