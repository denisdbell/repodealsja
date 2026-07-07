#!/usr/bin/env python3
"""
extract.py
==========

Runs on YOUR computer. It visits every bank / credit union listed in
sources.py, downloads their repossessed car & property lists, reads the
useful bits out of each Excel sheet, PDF or web page, and saves two tidy
files that the website reads:

    ../site/data/vehicles.json      <- all the cars / trucks / bikes
    ../site/data/properties.json    <- all the houses / land / buildings

It ALSO keeps a copy of every original file it downloads in:

    ../site/files/

...so the website can offer a real "Download" button for each source, and
so you always have the paperwork even if a bank takes their file down.

--------------------------------------------------------------------
HOW TO RUN IT  (copy/paste, one line at a time)
--------------------------------------------------------------------
    cd scraper
    python3 -m venv venv
    source venv/bin/activate           (on Windows:  venv\\Scripts\\activate)
    pip install -r requirements.txt
    python extract.py

When it finishes it prints a summary on the screen and the website is
ready to open (see ../README.md).
--------------------------------------------------------------------
"""

import json
import re
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sources import SOURCES

# ---------------------------------------------------------------------------
# Optional libraries. We import them softly so the script gives a friendly
# message instead of an ugly crash if something is not installed yet.
# ---------------------------------------------------------------------------
try:
    import requests
except ImportError:
    requests = None

try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None


# ---------------------------------------------------------------------------
# Where things live (works no matter which folder you run it from)
# ---------------------------------------------------------------------------
HERE = Path(__file__).resolve().parent
SITE_DIR = HERE.parent / "site"
DATA_DIR = SITE_DIR / "data"
FILES_DIR = SITE_DIR / "files"
DATA_DIR.mkdir(parents=True, exist_ok=True)
FILES_DIR.mkdir(parents=True, exist_ok=True)

# Pretend to be a normal web browser so the banks don't block us.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    )
}

# Words that hint a column/value is a price, location, year, etc.
PRICE_HINTS = ["price", "amount", "value", "asking", "cost", "reserve", "j$", "us$"]
LOCATION_HINTS = ["location", "parish", "address", "town", "situated", "area"]
TITLE_HINTS = ["make", "model", "vehicle", "property", "description", "type", "item", "lot"]
YEAR_HINTS = ["year", "yr"]

# ---------------------------------------------------------------------------
# Sanitiser knowledge — turns each bank's messy row into clean fields
# (make / model / year / price for cars; location / price for houses).
# ---------------------------------------------------------------------------

# Car makes we know about (longest first so "Mercedes Benz" beats "Benz").
CAR_MAKES = sorted([
    "Mercedes Benz", "Land Rover", "Great Wall", "Alfa Romeo",
    "Mercedes", "Benz", "Toyota", "Honda", "Nissan", "Mazda", "Suzuki",
    "Mitsubishi", "Subaru", "BMW", "Audi", "Ford", "Kia", "Hyundai",
    "Jeep", "Lexus", "Volkswagen", "Porsche", "Porshe", "Mini", "Isuzu",
    "Foton", "Sinotruk", "Greatwall", "Volvo", "Peugeot", "Chevrolet",
    "Daihatsu", "Infiniti",
], key=len, reverse=True)

# Words that are NOT a model name (so we stop reading the model there).
MODEL_STOP = set((
    "chassis cc plate location colour color mr mrs original auto source msrp "
    "mi automatic manual white black grey gray red blue brown silver green "
    "gold engine available under contract sold"
).split())

# Jamaican parishes / towns — a last resort to guess a car's location.
PLACES = [
    "Kingston", "St. Andrew", "St Andrew", "Portmore", "St. Catherine",
    "St Catherine", "Spanish Town", "Montego Bay", "Manchester", "Mandeville",
    "May Pen", "Clarendon", "St. Ann", "Ocho Rios", "Portland", "St. Mary",
    "St. Thomas", "Westmoreland", "Hanover", "Trelawny", "St. Elizabeth",
    "St. James", "Negril", "Old Harbour", "Linstead", "Ewarton",
]

# A single money token, e.g. "J$1,234,567", "$3.58M", "US$20,000".
# The trailing (M|K) only counts if it stands alone — this stops us grabbing
# the "M" from "MSRP" or the "K" from "Kgn.".
MONEY_RE = re.compile(r"(?:J\$|US\$|\$)\s?[\d,]+(?:\.\d+)?(?:\s?[MK]\b)?", re.I)


# ===========================================================================
# Small helpers
# ===========================================================================
def log(msg):
    print(msg, flush=True)


def clean(text):
    """Tidy up whitespace in a piece of text."""
    if text is None:
        return ""
    return re.sub(r"\s+", " ", str(text)).strip()


def looks_like_money(text):
    return bool(re.search(r"(?:J?\$|US\$)\s?[\d,]+(?:\.\d+)?", str(text)))


def guess_field(row_dict, hints):
    """Look through a record's keys for one that matches any hint word."""
    for key, value in row_dict.items():
        low = str(key).lower()
        if any(h in low for h in hints):
            v = clean(value)
            if v:
                return v
    return ""


def download(url, dest_path):
    """Download a file to disk. Returns True on success."""
    if requests is None:
        log("   ! 'requests' not installed - cannot download. Run: pip install -r requirements.txt")
        return False
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60, verify=True)
        resp.raise_for_status()
        dest_path.write_bytes(resp.content)
        return True
    except Exception as exc:  # noqa: BLE001  (friendly catch-all on purpose)
        log(f"   ! Could not download ({exc})")
        return False


def fetch_text(url):
    """Download a web page and return its HTML text (or None)."""
    if requests is None:
        return None
    try:
        resp = requests.get(url, headers=HEADERS, timeout=60)
        resp.raise_for_status()
        return resp.text
    except Exception as exc:  # noqa: BLE001
        log(f"   ! Could not open page ({exc})")
        return None


def file_extension_for(source):
    return {"xlsx": ".xlsx", "pdf": ".pdf", "html": ".html"}.get(source["format"], "")


# ===========================================================================
# Readers - turn a downloaded file into a list of "raw rows" (dictionaries)
# ===========================================================================
def read_xlsx(path):
    """Read every sheet of an Excel file into a list of {column: value} rows."""
    rows = []
    if openpyxl is None:
        log("   ! 'openpyxl' not installed - skipping Excel reading.")
        return rows
    try:
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        log(f"   ! Could not open Excel file ({exc})")
        return rows

    for sheet in wb.worksheets:
        grid = [[clean(c) for c in r] for r in sheet.iter_rows(values_only=True)]
        header_idx = _find_header_row(grid)
        if header_idx is None:
            continue
        headers = grid[header_idx]
        for raw in grid[header_idx + 1:]:
            if not any(raw):
                continue
            record = {}
            for i, val in enumerate(raw):
                key = headers[i] if i < len(headers) and headers[i] else f"col{i + 1}"
                if val:
                    record[key] = val
            if record:
                rows.append(record)
    return rows


def _find_header_row(grid):
    """
    The first few rows of a bank spreadsheet are often a logo / title.
    Find the row that actually looks like column headings.
    """
    for idx, row in enumerate(grid[:15]):
        filled = [c for c in row if c]
        if len(filled) < 2:
            continue
        joined = " ".join(filled).lower()
        if any(h in joined for h in TITLE_HINTS + PRICE_HINTS + LOCATION_HINTS + YEAR_HINTS):
            return idx
    # fall back to first row that has at least 2 filled cells
    for idx, row in enumerate(grid):
        if len([c for c in row if c]) >= 2:
            return idx
    return None


def read_pdf(path):
    """Pull tables (and loose text as a backup) out of a PDF."""
    rows = []
    if pdfplumber is None:
        log("   ! 'pdfplumber' not installed - skipping PDF reading.")
        return rows
    try:
        pdf = pdfplumber.open(path)
    except Exception as exc:  # noqa: BLE001
        log(f"   ! Could not open PDF ({exc})")
        return rows

    with pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                grid = [[clean(c) for c in r] for r in table]
                header_idx = _find_header_row(grid)
                if header_idx is None:
                    continue
                headers = grid[header_idx]
                for raw in grid[header_idx + 1:]:
                    if not any(raw):
                        continue
                    record = {}
                    for i, val in enumerate(raw):
                        key = headers[i] if i < len(headers) and headers[i] else f"col{i + 1}"
                        if val:
                            record[key] = val
                    if record:
                        rows.append(record)

            # Backup: if a page had no clean table, keep money-looking lines.
            if not (page.extract_tables() or []):
                text = page.extract_text() or ""
                for line in text.splitlines():
                    line = clean(line)
                    if len(line) > 12 and (looks_like_money(line) or re.search(r"\b(19|20)\d{2}\b", line)):
                        rows.append({"Description": line})
    return rows


def read_html(html):
    """Pull every table row out of a web page. Falls back to list items."""
    rows = []
    if BeautifulSoup is None:
        log("   ! 'beautifulsoup4' not installed - skipping web page reading.")
        return rows
    soup = BeautifulSoup(html, "html.parser")

    for table in soup.find_all("table"):
        header_cells = [clean(th.get_text()) for th in table.find_all("th")]
        for tr in table.find_all("tr"):
            cells = [clean(td.get_text()) for td in tr.find_all("td")]
            if not any(cells):
                continue
            record = {}
            for i, val in enumerate(cells):
                key = header_cells[i] if i < len(header_cells) and header_cells[i] else f"col{i + 1}"
                if val:
                    record[key] = val
            if len(record) >= 2:
                rows.append(record)

    # If there were no useful tables, try common "card / listing" blocks.
    if not rows:
        for block in soup.select(".listing, .vehicle, .property, .card, article, li"):
            text = clean(block.get_text(" "))
            if len(text) > 25 and (looks_like_money(text) or re.search(r"\b(19|20)\d{2}\b", text)):
                rows.append({"Description": text[:400]})

    return rows


# ===========================================================================
# Sanitiser helpers - shared by the vehicle & property cleaners below
# ===========================================================================
def format_price(raw):
    """Turn any price-ish text into a friendly 'J$1,234,567'."""
    s = clean(raw)
    if not s:
        return ""
    if "$" in s:
        m = MONEY_RE.search(s)
        if not m:
            return s
        out = re.sub(r"\s+", " ", m.group(0)).strip()
        if re.match(r"^US\$", out, re.I):
            return "US$" + re.sub(r"^US\$\s?", "", out, flags=re.I)
        out = re.sub(r"^\$", "J$", out)
        return re.sub(r"^J\$\s+", "J$", out)
    digits = re.sub(r"[^\d.]", "", s)
    if re.match(r"^\d{5,}(\.\d+)?$", digits):          # 5+ digits => a real amount
        return "J$" + f"{round(float(digits)):,}"
    return ""


def big_number_price(values):
    """Largest 'pure number' of 6+ digits in a set of values (NCB prices)."""
    best = 0
    for v in values:
        s = clean(v).replace(",", "")
        if re.match(r"^\d{6,}$", s):
            best = max(best, int(s))
    return f"J${best:,}" if best else ""


def find_val(entries, hints):
    """First value whose column name contains any of the hint words."""
    for key, value in entries:
        low = key.lower()
        if value and any(h in low for h in hints):
            return value
    return ""


def find_year(text):
    m = re.search(r"\b(?:19|20)\d{2}\b", str(text))
    return m.group(0) if m else ""


def parse_make_model(text):
    """Pull 'Make + Model' out of a free-text blob using the known-makes list."""
    t = " " + text + " "
    for mk in CAR_MAKES:
        pat = re.escape(mk).replace(r"\ ", r"\s+").replace(" ", r"\s+")
        m = re.search(r"(?:^|\W)(" + pat + r")(?:\W|$)", t, re.I)
        if not m:
            continue
        tokens = t[m.end():].strip().split()
        model = ""
        if tokens:
            first = re.sub(r"[^\w\-]", "", tokens[0])
            if first and first.lower() not in MODEL_STOP:
                model = first
                second = re.sub(r"[^\w\-]", "", tokens[1]) if len(tokens) > 1 else ""
                if len(second) >= 2 and re.match(r"^[A-Za-z]+$", second) \
                        and second.lower() not in MODEL_STOP:
                    model += " " + second
        return {"make": mk, "model": model}
    return {"make": "", "model": ""}


def find_place(text):
    low = " " + text.lower() + " "
    for p in PLACES:
        if p.lower() in low:
            return p
    return ""


# ===========================================================================
# Normalise - turn a messy raw row into the clean shape the website wants
# ===========================================================================
def _common_fields(raw):
    """The bits every row shares: cleaned details + best-effort guesses + blob."""
    det = {clean(k): clean(v) for k, v in raw.items() if clean(v)}
    entries = list(det.items())
    values = [v for _, v in entries]
    title_guess = guess_field(raw, TITLE_HINTS)
    price_guess = guess_field(raw, PRICE_HINTS)
    loc_guess = guess_field(raw, LOCATION_HINTS)
    blob = " ".join([title_guess, loc_guess] + values)
    return det, entries, values, title_guess, price_guess, loc_guess, blob


def sanitize_vehicle(raw):
    det, entries, values, title_guess, price_guess, loc_guess, blob = _common_fields(raw)

    year = make = model = price = location = body = ""

    # -- NCB layout: unnamed columns in a fixed order (col2=Year … col10=Price)
    c2, c3, c4 = det.get("col2", ""), det.get("col3", ""), det.get("col4", "")
    if re.match(r"^(?:19|20)\d{2}$", c2) and c3:
        year, make, model = c2, c3, c4
        price = format_price(det.get("col10", ""))
        location = det.get("col8", "") or det.get("col7", "")
        body = det.get("Vehicles as at", "")

    # -- Named columns (JMMB and friends)
    if not make:
        make = find_val(entries, ["make"])
    if not model:
        model = find_val(entries, ["model"])
    if not year:
        year = find_year(find_val(entries, ["year"]))
    if not body:
        body = find_val(entries, ["type", "body"])

    # -- Free-text blob (JN, Sagicor, Infiniti) — parse what we can
    if not year:
        year = find_year(blob)
    if not make or not model:
        mm = parse_make_model(blob)
        if not make:
            make = mm["make"]
        if not model and mm["make"] == make:
            model = mm["model"]

    # -- Price: guess, then a price-ish column, then $ in text, then big number
    if not price:
        price = format_price(price_guess)
    if not price:
        price = format_price(find_val(entries, ["price", "value", "amount",
                                                "asking", "cost", "reserve", "market"]))
    if not price:
        m = MONEY_RE.search(blob)
        if m:
            price = format_price(m.group(0))
    if not price:
        price = big_number_price(values)

    # -- Location: guess, then a location-ish column, then "Location:", place
    if not location:
        location = clean(loc_guess)
    if not location:
        location = find_val(entries, ["location", "site", "parish",
                                      "address", "garage", "town"])
    if not location:
        m = re.search(r"Location:\s*(.+?)(?:\s+\d[\d,]*\s*mi\b|$)", blob, re.I)
        if m:
            location = clean(m.group(1))
    if not location:
        location = find_place(blob)

    # NCB adds "_1", "_2"… to repeated models to keep them unique — drop that.
    model = re.sub(r"_\d+$", "", model).strip()
    title = " ".join(p for p in [year, make, model] if p).strip()

    return {
        "title": (title or title_guess or "Vehicle")[:160],
        "price": price,
        "location": location,
        "make": make, "model": model, "year": year, "body": body,
        "details": det,
        "valid": bool(make or model or year or price),
    }


def sanitize_property(raw):
    det, entries, values, title_guess, price_guess, loc_guess, blob = _common_fields(raw)

    # -- Location: address + parish where we can find them
    location = clean(loc_guess) or find_val(entries, ["property address", "address",
                                                      "location", "situated"])
    parish = find_val(entries, ["parish"])
    if parish and location and parish.lower() not in location.lower():
        location = location + ", " + parish
    elif parish and not location:
        location = parish
    if not location:
        location = find_place(blob)

    ptype = find_val(entries, ["type of property", "type", "description"])

    # -- Price
    price = format_price(price_guess) or format_price(
        find_val(entries, ["estimate", "market value", "value", "price",
                           "amount", "asking", "reserve", "listing"]))
    if not price:
        m = MONEY_RE.search(blob)
        if m:
            price = format_price(m.group(0))
    if not price:
        price = big_number_price(values)

    title = location or title_guess or "Property"
    return {
        "title": title[:160],
        "price": price,
        "location": location,
        "type": ptype,
        "details": det,
        "valid": bool(price or location),
    }


def normalise(raw, source, category):
    """Clean one raw row into the website's shape. Returns None for junk rows."""
    s = sanitize_vehicle(raw) if category == "vehicle" else sanitize_property(raw)
    if not s["valid"]:
        return None                       # header row / empty junk — skip it

    record = {
        "title": s["title"] or "See details",
        "price": s["price"],
        "location": s["location"],
        "details": s["details"],
        "bank": source["bank"],
        "category": category,
        "parent_url": source["parent_url"],
        "file_url": source["file_url"],
        "download_file": source.get("_local_file", ""),
    }
    if category == "vehicle":
        record.update({"make": s["make"], "model": s["model"],
                       "year": s["year"], "body": s["body"]})
    else:
        record["type"] = s["type"]
    return record


def split_category(raw, source):
    """
    Some pages (Scotia) list BOTH cars and property together. Take a guess per
    row using keywords so each item lands in the right bucket.
    """
    if source["category"] in ("vehicle", "property"):
        return source["category"]
    blob = " ".join(str(v) for v in raw.values()).lower()
    car_words = ["toyota", "honda", "nissan", "mazda", "suzuki", "motor", "vehicle",
                 "car", "truck", "bus", "cc", "mileage", "sedan", "suv", "bmw", "benz"]
    prop_words = ["property", "land", "house", "apartment", "lot", "acre",
                  "bedroom", "parish", "premises", "dwelling", "commercial"]
    car_score = sum(w in blob for w in car_words)
    prop_score = sum(w in blob for w in prop_words)
    return "vehicle" if car_score >= prop_score else "property"


# ===========================================================================
# Main
# ===========================================================================
def main():
    log("=" * 64)
    log(" Repossessed Jamaica - data collector")
    log("=" * 64)

    _warn_missing_libraries()

    vehicles = []
    properties = []
    source_summary = []

    for source in SOURCES:
        log(f"\n-> {source['bank']}  [{source['category']}, {source['format']}]")

        # 1) Download / keep a copy of the original file for the website.
        local_name = source["id"] + file_extension_for(source)
        local_path = FILES_DIR / local_name
        got_file = download(source["file_url"], local_path)
        source["_local_file"] = f"files/{local_name}" if got_file else ""

        # 2) Read the raw rows out of it.
        raw_rows = []
        try:
            if source["format"] == "xlsx" and got_file:
                raw_rows = read_xlsx(local_path)
            elif source["format"] == "pdf" and got_file:
                raw_rows = read_pdf(local_path)
            elif source["format"] == "html":
                html = local_path.read_text(errors="ignore") if got_file else fetch_text(source["file_url"])
                raw_rows = read_html(html) if html else []
        except Exception as exc:  # noqa: BLE001
            log(f"   ! Problem reading this source ({exc})")

        # 3) Normalise + sort each row into cars or property.
        added = 0
        for raw in raw_rows:
            cat = split_category(raw, source)
            record = normalise(raw, source, cat)
            if record is None:            # header / junk row — the sanitiser dropped it
                continue
            (vehicles if cat == "vehicle" else properties).append(record)
            added += 1

        log(f"   found {added} item(s)"
            + ("" if got_file else "  (file could not be downloaded)"))
        source_summary.append({
            "bank": source["bank"],
            "category": source["category"],
            "parent_url": source["parent_url"],
            "file_url": source["file_url"],
            "download_file": source["_local_file"],
            "items": added,
        })

    # 4) Save everything the website needs.
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    _write_json(DATA_DIR / "vehicles.json", vehicles, generated)
    _write_json(DATA_DIR / "properties.json", properties, generated)
    _write_json(DATA_DIR / "sources.json", source_summary, generated)

    # Also write a plain .js version so the website opens by DOUBLE-CLICK
    # (browsers refuse to read local .json files, but a .js file is fine).
    _write_data_js(DATA_DIR / "data.js", vehicles, properties, source_summary, generated)

    # 5) Print a friendly summary on the screen (the user asked for this).
    log("\n" + "=" * 64)
    log(" DONE!")
    log("=" * 64)
    log(f"  Cars / vehicles saved : {len(vehicles):>4}   -> site/data/vehicles.json")
    log(f"  Houses / property saved: {len(properties):>4}   -> site/data/properties.json")
    log(f"  Original files kept    : {sum(1 for s in source_summary if s['download_file']):>4}   -> site/files/")
    log("\n  Now open the website:  see README.md  (just double-click site/index.html")
    log("  or run:  cd site && python3 -m http.server 8000  then visit http://localhost:8000)")
    log("")


def _write_json(path, items, generated):
    payload = {"generated": generated, "count": len(items), "items": items}
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))


def _write_data_js(path, vehicles, properties, sources, generated):
    payload = {
        "generated": generated,
        "vehicles": vehicles,
        "properties": properties,
        "sources": sources,
    }
    js = "window.REPO_DATA = " + json.dumps(payload, ensure_ascii=False) + ";\n"
    path.write_text(js)


def _warn_missing_libraries():
    missing = []
    if requests is None:
        missing.append("requests")
    if openpyxl is None:
        missing.append("openpyxl")
    if pdfplumber is None:
        missing.append("pdfplumber")
    if BeautifulSoup is None:
        missing.append("beautifulsoup4")
    if missing:
        log("\n  NOTE: these helpers are not installed yet: " + ", ".join(missing))
        log("        Install them first with:  pip install -r requirements.txt")
        log("        (The script will still run, but may skip some sources.)\n")


if __name__ == "__main__":
    main()
