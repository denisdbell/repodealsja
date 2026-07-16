#!/usr/bin/env python3
"""
build_seo.py — pre-render listings into static HTML so search engines (and
social / AI crawlers that don't run JavaScript) can read them.

It reads the JSON the scraper produces and:
  1. injects static listing cards into site/index.html  (BUILD:CARDS markers)
  2. injects an ItemList JSON-LD block into site/index.html (BUILD:ITEMLIST markers)
  3. generates site/cars.html and site/houses.html — full, crawlable category pages
  4. regenerates site/sitemap.xml with <lastmod> and the category URLs

Run it after extract.py:  python build_seo.py
Safe to run repeatedly; it only rewrites the marked regions and generated pages.
"""

import html
import json
import re
from datetime import date
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site"
DATA = SITE / "data"
BASE_URL = "https://repodealsja.com"

# Google AdSense In-feed ads on the category pages. Create an "In-feed" ad unit
# in your AdSense dashboard (Ads → By ad unit → In-feed ads), style it to match
# the listing cards, then paste the slot ID and layout key below. An ad tile is
# injected after every AD_EVERY listings. Keep in sync with site/app.js.
AD_CLIENT = "ca-pub-9430876049469822"
AD_SLOT = "REPLACE_WITH_SLOT_ID"          # <-- data-ad-slot
AD_LAYOUT_KEY = "REPLACE_WITH_LAYOUT_KEY"  # <-- data-ad-layout-key
AD_EVERY = 8                               # insert an ad after every N cards

# How many of each type to pre-render on the homepage (the JS app replaces
# these on load; the full lists live on the category pages).
HOME_LIMIT = 40


# ---------------------------------------------------------------- helpers
def load(name):
    p = DATA / name
    if not p.exists():
        return []
    doc = json.loads(p.read_text(encoding="utf-8"))
    return doc.get("items", doc if isinstance(doc, list) else [])


def esc(s):
    return html.escape(str(s or ""), quote=True)


def pick_emoji(item):
    cat = item.get("category")
    if cat == "vehicle":
        # Only trust the title — raw details hold noise like garage names
        # ("Nihon Trucking") that would wrongly trip the "truck" test.
        t = (item.get("title", "")).lower()
        if re.search(r"truck|pick.?up|hilux|tipper|ranger", t):
            return "🛻"
        if re.search(r"bus|coaster|hiace|van|wagon", t):
            return "🚐"
        if re.search(r"bike|motor.?cycle|scooter", t):
            return "🏍️"
        return "🚗"
    blob = (item.get("title", "") + " " + json.dumps(item.get("details", {}))).lower()
    if re.search(r"land|lot|acre", blob):
        return "🌳"
    if re.search(r"apartment|townhouse|condo", blob):
        return "🏢"
    if re.search(r"commercial|shop|office|building", blob):
        return "🏬"
    return "🏠"


def card_html(item):
    title = esc(item.get("title") or "See details")
    price = esc(item.get("price") or "")
    location = esc(item.get("location") or "")
    bank = esc(item.get("bank") or "Unknown")
    url = esc(item.get("parent_url") or "#")
    parts = [
        '      <article class="card">',
        f'        <div class="card-top"><div class="card-emoji">{pick_emoji(item)}</div></div>',
        '        <div class="card-body">',
        f'          <h3 class="card-title">{title}</h3>',
    ]
    if price:
        parts.append(f'          <div class="card-price">{price}</div>')
    if location:
        parts.append(f'          <div class="card-line">📍 <b>{location}</b></div>')
    parts += [
        f'          <span class="bank-badge">🏦 {bank}</span>',
        '        </div>',
        '        <div class="card-btns">',
        f'          <a class="btn-go" href="{url}" rel="nofollow noopener" target="_blank">🌐 Visit site</a>',
        '        </div>',
        '      </article>',
    ]
    return "\n".join(parts)


def ad_card_html():
    """An In-feed AdSense tile matching the .card-ad style (format=fluid)."""
    return "\n".join([
        '      <div class="card card-ad" aria-label="Advertisement">',
        '        <div class="ad-label">Sponsored</div>',
        '        <ins class="adsbygoogle"',
        '             style="display:block"',
        f'             data-ad-client="{AD_CLIENT}"',
        f'             data-ad-slot="{AD_SLOT}"',
        '             data-ad-format="fluid"',
        f'             data-ad-layout-key="{AD_LAYOUT_KEY}"></ins>',
        '        <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>',
        '      </div>',
    ])


def cards_with_ads(items):
    """Render every listing, dropping an ad tile after every AD_EVERY cards."""
    ad_on = (AD_SLOT and not AD_SLOT.startswith("REPLACE")
             and AD_LAYOUT_KEY and not AD_LAYOUT_KEY.startswith("REPLACE"))
    out = []
    for i, it in enumerate(items):
        out.append(card_html(it))
        if ad_on and (i + 1) % AD_EVERY == 0 and i + 1 < len(items):
            out.append(ad_card_html())
    return "\n".join(out)


def item_list_jsonld(items, list_name, url):
    elements = []
    for i, it in enumerate(items, start=1):
        elements.append({
            "@type": "ListItem",
            "position": i,
            "name": it.get("title") or "Listing",
            "url": it.get("parent_url") or url,
        })
    doc = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": list_name,
        "url": url,
        "numberOfItems": len(items),
        "itemListElement": elements,
    }
    return json.dumps(doc, ensure_ascii=False, indent=2)


def replace_region(text, start_marker, end_marker, new_inner):
    pattern = re.compile(
        re.escape(start_marker) + r".*?" + re.escape(end_marker),
        re.DOTALL,
    )
    replacement = f"{start_marker}\n{new_inner}\n      {end_marker}"
    if not pattern.search(text):
        raise SystemExit(f"Marker not found: {start_marker}")
    return pattern.sub(lambda _: replacement, text)


# ---------------------------------------------------------------- pages
def category_page(kind, items, generated):
    if kind == "cars":
        title = "Repossessed Cars & Trucks for Sale in Jamaica"
        heading = "🚗 Repossessed Cars & Trucks"
        desc = ("Every repossessed car, truck and SUV for sale by Jamaican banks and "
                "credit unions — NCB, JMMB, Sagicor, JN Bank and more — in one place. "
                "Filter and compare, then buy direct from the lender.")
        canonical = f"{BASE_URL}/cars.html"
        crumb = "Cars & Trucks"
    else:
        title = "Repossessed Houses & Land for Sale in Jamaica"
        heading = "🏠 Repossessed Houses & Land"
        desc = ("Every repossessed house, apartment and plot of land for sale by Jamaican "
                "banks and credit unions — NCB, JMMB, Sagicor, JN Bank and more — in one "
                "place. Browse by parish and price, then buy direct from the lender.")
        canonical = f"{BASE_URL}/houses.html"
        crumb = "Houses & Land"

    cards = cards_with_ads(items)
    itemlist = item_list_jsonld(items, heading, canonical)
    breadcrumb = json.dumps({
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": f"{BASE_URL}/"},
            {"@type": "ListItem", "position": 2, "name": crumb, "item": canonical},
        ],
    }, ensure_ascii=False, indent=2)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc(title)} | Repossessed Jamaica</title>
  <meta name="description" content="{esc(desc)}" />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#009b3a" />
  <link rel="canonical" href="{canonical}" />

  <link rel="icon" href="/favicon.ico" sizes="any" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />

  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Repossessed Jamaica" />
  <meta property="og:title" content="{esc(title)}" />
  <meta property="og:description" content="{esc(desc)}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:image" content="{BASE_URL}/og-image.png" />
  <meta property="og:locale" content="en_JM" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{esc(title)}" />
  <meta name="twitter:description" content="{esc(desc)}" />
  <meta name="twitter:image" content="{BASE_URL}/og-image.png" />

  <link rel="stylesheet" href="style.css" />

  <script type="application/ld+json">
{breadcrumb}
  </script>
  <script type="application/ld+json">
{itemlist}
  </script>

  <script async src="https://www.googletagmanager.com/gtag/js?id=G-WNVDQKQ516"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){{ dataLayer.push(arguments); }}
    gtag('js', new Date());
    gtag('config', 'G-WNVDQKQ516');
  </script>

  <!-- ============ Google AdSense ============ -->
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9430876049469822"
     crossorigin="anonymous"></script>
</head>
<body>
  <header class="topbar">
    <h1>{heading}</h1>
    <p class="subtitle">Repossessed by Jamaican banks &amp; credit unions — all in one place</p>
    <a class="topbar-link" href="index.html">← Back to search</a>
  </header>

  <section class="intro">
    <p>{esc(desc)}</p>
  </section>

  <nav class="browse-more" aria-label="Browse by category">
    <a href="index.html">🔎 Search everything</a>
    <a href="cars.html">🚗 Cars &amp; Trucks</a>
    <a href="houses.html">🏠 Houses &amp; Land</a>
    <a href="stats.html">📊 Statistics</a>
  </nav>

  <main>
    <p class="result-count" style="max-width:900px;margin:24px auto 0;padding:0 20px;">
      {len(items)} listed
    </p>
    <div class="cards">
{cards}
    </div>
  </main>

  <footer class="foot">
    <p>Updated {esc(generated)}. Always double-check details with the bank before you buy. ❤️</p>
  </footer>
</body>
</html>
"""


# ---------------------------------------------------------------- main
def main():
    vehicles = load("vehicles.json")
    properties = load("properties.json")
    generated = date.today().isoformat()

    # 1 + 2: homepage static cards + ItemList
    index_path = SITE / "index.html"
    index = index_path.read_text(encoding="utf-8")

    home_cards = properties[:HOME_LIMIT] + vehicles[:HOME_LIMIT]
    cards_html = "\n".join(card_html(it) for it in home_cards)
    index = replace_region(
        index, "<!-- BUILD:CARDS", "BUILD:CARDS:END -->",
        cards_html,
    )

    itemlist = item_list_jsonld(
        properties + vehicles,
        "Repossessed houses and cars for sale in Jamaica",
        f"{BASE_URL}/",
    )
    itemlist_block = '  <script type="application/ld+json">\n' + itemlist + "\n  </script>"
    index = replace_region(
        index, "<!-- BUILD:ITEMLIST", "BUILD:ITEMLIST:END -->",
        itemlist_block,
    )
    index_path.write_text(index, encoding="utf-8")

    # 3: category pages
    (SITE / "cars.html").write_text(category_page("cars", vehicles, generated), encoding="utf-8")
    (SITE / "houses.html").write_text(category_page("houses", properties, generated), encoding="utf-8")

    # 4: sitemap
    urls = [
        ("/", "daily", "1.0"),
        ("/cars.html", "daily", "0.9"),
        ("/houses.html", "daily", "0.9"),
        ("/stats.html", "weekly", "0.7"),
    ]
    entries = "\n".join(
        f"  <url>\n"
        f"    <loc>{BASE_URL}{path}</loc>\n"
        f"    <lastmod>{generated}</lastmod>\n"
        f"    <changefreq>{freq}</changefreq>\n"
        f"    <priority>{prio}</priority>\n"
        f"  </url>"
        for path, freq, prio in urls
    )
    sitemap = ('<?xml version="1.0" encoding="UTF-8"?>\n'
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
               f"{entries}\n</urlset>\n")
    (SITE / "sitemap.xml").write_text(sitemap, encoding="utf-8")

    print(f"Pre-rendered {len(properties)} properties + {len(vehicles)} vehicles.")
    print("Wrote: index.html (cards + ItemList), cars.html, houses.html, sitemap.xml")


if __name__ == "__main__":
    main()
