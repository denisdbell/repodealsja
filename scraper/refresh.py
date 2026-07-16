#!/usr/bin/env python3
"""
refresh.py — one command to rebuild everything.

Runs the two steps back to back:
  1. extract.py     — scrape the 12 banks and write site/data/*.json
  2. build_seo.py   — pre-render the static SEO pages from that fresh JSON

Usage:
    python refresh.py            # do both steps
    python refresh.py --seo-only # skip scraping, just rebuild the SEO pages
                                  # (useful when the JSON is already up to date)
"""

import sys

import extract
import build_seo


def main():
    seo_only = "--seo-only" in sys.argv[1:]

    if seo_only:
        print(">> Skipping scrape (--seo-only). Rebuilding SEO pages from existing JSON.\n")
    else:
        print(">> Step 1/2 — scraping the banks (extract.py)\n")
        extract.main()
        print("\n>> Step 1/2 done.\n")

    print(">> Step 2/2 — pre-rendering SEO pages (build_seo.py)\n")
    build_seo.main()
    print("\n>> All done. The site in ./site is ready to publish.")


if __name__ == "__main__":
    main()
