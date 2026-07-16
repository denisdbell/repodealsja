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
  filters: {},          // chosen dropdown criteria, e.g. { make: "Toyota" }
  data: { vehicles: [], properties: [], sources: [], generated: "" },
  isExample: false,
};

/* ---- Google AdSense in-feed ads --------------------------------
   Create an "In-feed" ad unit in your AdSense dashboard (Ads → By ad
   unit → In-feed ads). Style it to match these listing cards, then
   paste the two values it gives you — the slot ID (data-ad-slot) and
   the layout key (data-ad-layout-key) — below. In-feed ad tiles are
   injected after every AD_EVERY listings. */
const AD_CLIENT     = "ca-pub-9430876049469822";
const AD_SLOT       = "REPLACE_WITH_SLOT_ID";    // <-- data-ad-slot
const AD_LAYOUT_KEY = "REPLACE_WITH_LAYOUT_KEY"; // <-- data-ad-layout-key
const AD_EVERY      = 8;                          // insert an ad after every N cards
const AD_ENABLED = () =>
  AD_SLOT && AD_LAYOUT_KEY && !/^REPLACE/.test(AD_SLOT) && !/^REPLACE/.test(AD_LAYOUT_KEY);

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

/* ================================================================
   1b. FACETS & FILTERS — turn each clean row into a few pick-lists
       (make / year / body / parish / bank / price) so the search bar
       can offer real dropdowns, pre-filled from the data itself.
   ================================================================ */

// Jamaican parishes, plus common towns/spellings that map onto one, so the
// "parish" dropdown stays short and tidy instead of one row per street.
const PARISHES = [
  "Kingston", "St. Andrew", "St. Catherine", "Clarendon", "Manchester",
  "St. Elizabeth", "Westmoreland", "Hanover", "St. James", "Trelawny",
  "St. Ann", "St. Mary", "Portland", "St. Thomas",
];
const PLACE_TO_PARISH = {
  "st andrew": "St. Andrew", "portmore": "St. Catherine",
  "st catherine": "St. Catherine", "spanish town": "St. Catherine",
  "old harbour": "St. Catherine", "linstead": "St. Catherine",
  "ewarton": "St. Catherine", "may pen": "Clarendon",
  "mandeville": "Manchester", "montego bay": "St. James",
  "mobay": "St. James", "ocho rios": "St. Ann", "negril": "Westmoreland",
  "st ann": "St. Ann", "st mary": "St. Mary", "st thomas": "St. Thomas",
  "st elizabeth": "St. Elizabeth", "st james": "St. James", "kgn": "Kingston",
};
function toParish(text) {
  const low = " " + cleanStr(text).toLowerCase() + " ";
  for (const p of PARISHES) if (low.includes(p.toLowerCase())) return p;
  for (const k in PLACE_TO_PARISH) if (low.includes(k)) return PLACE_TO_PARISH[k];
  return "";
}

// Read a price string ("J$2.6M", "J$1,200,000") into a plain number so we can
// sort it into a price band. US$ prices are left out of the bands.
function priceNumber(raw) {
  const s = cleanStr(raw);
  if (!s || /US\$/i.test(s)) return null;
  const m = s.match(/([\d,]+(?:\.\d+)?)\s*([MK])?/i);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (isNaN(n) || n < 1000) return null;
  const suf = (m[2] || "").toUpperCase();
  if (suf === "M") n *= 1e6; else if (suf === "K") n *= 1e3;
  return n;
}

// Friendly price bands for the dropdown (different scales for cars vs houses).
const PRICE_BANDS = {
  vehicles: [
    { label: "Under J$1M", test: (n) => n < 1e6 },
    { label: "J$1M – 2M", test: (n) => n >= 1e6 && n < 2e6 },
    { label: "J$2M – 3M", test: (n) => n >= 2e6 && n < 3e6 },
    { label: "J$3M – 5M", test: (n) => n >= 3e6 && n < 5e6 },
    { label: "J$5M – 8M", test: (n) => n >= 5e6 && n < 8e6 },
    { label: "Over J$8M", test: (n) => n >= 8e6 },
  ],
  properties: [
    { label: "Under J$10M", test: (n) => n < 10e6 },
    { label: "J$10M – 25M", test: (n) => n >= 10e6 && n < 25e6 },
    { label: "J$25M – 50M", test: (n) => n >= 25e6 && n < 50e6 },
    { label: "J$50M – 100M", test: (n) => n >= 50e6 && n < 100e6 },
    { label: "Over J$100M", test: (n) => n >= 100e6 },
  ],
};

// Which dropdowns each view shows, in order. `key` matches a field on _f.
const FILTER_DEFS = {
  vehicles: [
    { key: "make", label: "Any make", icon: "🏷️" },
    { key: "year", label: "Any year", icon: "📅", numDesc: true },
    { key: "body", label: "Any body type", icon: "🚙" },
    { key: "parish", label: "Any parish", icon: "📍" },
    { key: "bank", label: "Any bank", icon: "🏦" },
    { key: "price", label: "Any price", icon: "💰", price: true },
  ],
  properties: [
    { key: "parish", label: "Any parish", icon: "📍" },
    { key: "type", label: "Any type", icon: "🏘️" },
    { key: "bank", label: "Any bank", icon: "🏦" },
    { key: "price", label: "Any price", icon: "💰", price: true },
  ],
};

// Fold make spellings onto one canonical name so the dropdown isn't doubled up.
const MAKE_ALIAS = {
  "benz": "Mercedes-Benz", "mercedes": "Mercedes-Benz",
  "mercedes benz": "Mercedes-Benz", "greatwall": "Great Wall",
  "porshe": "Porsche",
};
function normMake(m) {
  m = cleanStr(m);
  if (!m) return "";
  const hit = MAKE_ALIAS[m.toLowerCase()];
  if (hit) return hit;
  return m[0].toUpperCase() + m.slice(1);
}

// Only keep recognised body types — some banks stuff a whole title into the
// "type" column, which we don't want cluttering the dropdown.
const BODY_TYPES = [
  { re: /\bsuv\b|crossover/i, name: "SUV" },
  { re: /pick.?up/i, name: "Pickup" },
  { re: /\btruck\b|tipper/i, name: "Truck" },
  { re: /station\s*wagon|\bwagon\b/i, name: "Station Wagon" },
  { re: /hatch/i, name: "Hatchback" },
  { re: /\bsedan\b/i, name: "Sedan" },
  { re: /\bcoupe\b/i, name: "Coupe" },
  { re: /\bvan\b|hiace|caravan/i, name: "Van" },
  { re: /\bbus\b|coaster/i, name: "Bus" },
  { re: /motor.?cycle|scooter|\bbike\b/i, name: "Motorcycle" },
  { re: /convertible/i, name: "Convertible" },
];
function normBody(text) {
  const t = cleanStr(text);
  for (const b of BODY_TYPES) if (b.re.test(t)) return b.name;
  return "";
}

// Property type: drop price/number junk, tidy the slashes so "Residential/
// Agricultural" and "Residential / Agricultural" become one option.
function normType(text) {
  const t = cleanStr(text);
  if (!t || /\$|\d|listing price/i.test(t)) return "";
  return t.replace(/\s*\/\s*/g, " / ").replace(/\s+/g, " ").trim();
}

// Build the tidy pick-list values used both for filtering and for the dropdowns.
function facetsFor(item, kind) {
  const s = item._s || {};
  const parish = toParish(s.location || "") || toParish(s.search || "");
  const bank = cleanStr(item.bank);
  const price = priceNumber(s.price);
  if (kind === "vehicle") {
    return { make: normMake(s.make), year: s.year || "", body: normBody(s.body),
             parish, bank, price };
  }
  return { type: normType(s.type), parish, bank, price };
}

function sanitizeAll(list, kind) {
  const out = [];
  (list || []).forEach((item) => {
    const s = kind === "vehicle" ? sanitizeVehicle(item) : sanitizeProperty(item);
    if (!s.valid) return;               // drop header rows / empty junk
    item._s = s;
    item._f = facetsFor(item, kind);
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

// ---- Build the dropdowns for the chosen view, pre-filled from the data ----
function buildFilters() {
  const wrap = document.getElementById("filters");
  if (!wrap) return;
  wrap.innerHTML = "";
  const defs = FILTER_DEFS[state.view] || [];
  const list = state.data[state.view] || [];

  defs.forEach((def) => {
    const sel = document.createElement("select");
    sel.className = "filter-select";
    sel.dataset.key = def.key;

    const first = document.createElement("option");
    first.value = "";
    first.textContent = def.icon + " " + def.label;
    sel.appendChild(first);

    // Gather the distinct, real values for this criterion.
    let values;
    if (def.price) {
      const present = new Set();
      list.forEach((it) => {
        const n = it._f.price;
        if (n == null) return;
        const band = PRICE_BANDS[state.view].find((b) => b.test(n));
        if (band) present.add(band.label);
      });
      // Keep the natural band order (cheapest first).
      values = PRICE_BANDS[state.view].map((b) => b.label).filter((l) => present.has(l));
    } else {
      const set = new Set();
      list.forEach((it) => {
        const v = cleanStr(it._f[def.key]);
        if (v) set.add(v);
      });
      values = [...set];
      if (def.numDesc) values.sort((a, b) => Number(b) - Number(a));
      else values.sort((a, b) => a.localeCompare(b));
    }

    values.forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });

    sel.addEventListener("change", () => {
      if (sel.value) state.filters[def.key] = sel.value;
      else delete state.filters[def.key];
      sel.classList.toggle("active", !!sel.value);
      render();
    });
    wrap.appendChild(sel);
  });
}

// ---- Does one item pass the free text + the chosen dropdowns? ----
function matchesFilters(it) {
  const term = state.search.trim().toLowerCase();
  if (term) {
    const hay = it._s ? it._s.search : JSON.stringify(it).toLowerCase();
    if (!hay.includes(term)) return false;
  }
  for (const key in state.filters) {
    const val = state.filters[key];
    if (!val) continue;
    if (key === "price") {
      const band = PRICE_BANDS[state.view].find((b) => b.label === val);
      const n = it._f.price;
      if (n == null || !band || !band.test(n)) return false;
    } else if (cleanStr(it._f[key]) !== val) {
      return false;
    }
  }
  return true;
}

// ---- Draw the cards for the chosen view ----
function render() {
  const list = state.data[state.view] || [];
  const filtered = list.filter(matchesFilters);

  const wrap = document.getElementById("cards");
  wrap.innerHTML = "";
  document.getElementById("emptyMsg").classList.toggle("hidden", filtered.length > 0);

  const ads = [];
  filtered.forEach((item, i) => {
    wrap.appendChild(makeCard(item));
    // Drop an in-feed ad after every AD_EVERY cards (never as the last tile).
    if (AD_ENABLED() && (i + 1) % AD_EVERY === 0 && i + 1 < filtered.length) {
      const ad = makeAdCard();
      wrap.appendChild(ad);
      ads.push(ad);
    }
  });
  // Ask AdSense to fill each freshly-inserted slot (elements are now in the DOM).
  ads.forEach(() => {
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); }
    catch (e) { /* AdSense not loaded (e.g. blocked) — ignore */ }
  });

  // Result count + clear button appear only when something is narrowing the list.
  const active = state.search.trim() || Object.keys(state.filters).length;
  const rc = document.getElementById("resultCount");
  if (rc) {
    rc.textContent = active
      ? `Showing ${filtered.length} of ${list.length}`
      : `${list.length} listed`;
  }
  const clear = document.getElementById("clearFilters");
  if (clear) clear.classList.toggle("hidden", !active);

  document.getElementById("countProps").textContent = state.data.properties.length;
  document.getElementById("countVehicles").textContent = state.data.vehicles.length;
}

// ---- Reset the free text box and every dropdown ----
function clearFilters() {
  state.search = "";
  state.filters = {};
  const box = document.getElementById("search");
  if (box) box.value = "";
  buildFilters();
  render();
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

  // One clear action per card. The full list to download lives once in the
  // "Download the full lists" section, so we don't repeat it on every tile.
  const btns = el("div", "card-btns");
  btns.appendChild(linkBtn("🌐 Visit site", item.parent_url, "btn-go"));
  card.appendChild(btns);

  return card;
}

// A full-width In-feed sponsored tile that AdSense fills once it's in the DOM.
// In-feed uses format="fluid" + the unit-specific layout key so the rendered
// ad mimics the shape of the surrounding listing cards.
function makeAdCard() {
  const card = el("div", "card card-ad");
  card.setAttribute("aria-label", "Advertisement");
  card.appendChild(el("div", "ad-label", "Sponsored"));

  const ins = document.createElement("ins");
  ins.className = "adsbygoogle";
  ins.style.display = "block";
  ins.setAttribute("data-ad-client", AD_CLIENT);
  ins.setAttribute("data-ad-slot", AD_SLOT);
  ins.setAttribute("data-ad-format", "fluid");
  ins.setAttribute("data-ad-layout-key", AD_LAYOUT_KEY);
  card.appendChild(ins);

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
  state.filters = {};          // the two views have different criteria
  buildFilters();
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

  // Support ?q=… deep links (matches the SearchAction declared in the page's
  // structured data, so Google can offer a search box straight to results).
  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    state.search = q;
    const box = document.getElementById("search");
    if (box) box.value = q;
    // Land on whichever tab actually has matches for the query.
    const term = q.toLowerCase();
    const hits = (l) => l.filter((it) => it._s && it._s.search.includes(term)).length;
    if (hits(state.data.vehicles) > hits(state.data.properties)) state.view = "vehicles";
  }

  document.getElementById("tabProps").addEventListener("click", () => setView("properties"));
  document.getElementById("tabVehicles").addEventListener("click", () => setView("vehicles"));
  document.getElementById("search").addEventListener("input", (e) => {
    state.search = e.target.value;
    render();
  });
  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);

  // Modal close: the ✕, the dark backdrop, or the Escape key.
  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.hasAttribute("data-close")) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  renderSources();
  setView(state.view);   // sets the active tab, builds filters, hint + renders
}

start();
