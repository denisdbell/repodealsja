# 🇯🇲 Repossessed Jamaica

A super-simple website that shows **all the repossessed houses and cars** the
Jamaican banks and credit unions are selling — gathered from **12 sources** into
one friendly page.

- 🏠 **Houses & Land** and 🚗 **Cars & Trucks** in two big buttons
- 🔎 Type-to-search
- 🌐 A **"Visit site"** button that opens the original bank page
- ⬇️ A **"Download list"** button that saves the original file (Excel / PDF)
- Built so **anyone** can use it — big buttons, big text, pictures.

---

## 📁 What is in here

```
repossedjamaica/
├── data.txt                 <- the list of banks + links (the input)
├── scraper/                 <- the program that collects the data
│   ├── extract.py           <- run this
│   ├── sources.py           <- the 12 banks/links (edit if a link changes)
│   └── requirements.txt     <- helpers the program needs
└── site/                    <- the website
    ├── index.html           <- open this in your browser
    ├── style.css
    ├── app.js
    ├── data/                <- the JSON the program makes
    │   ├── vehicles.json    <- ★ all the cars   (you asked for this)
    │   ├── properties.json  <- ★ all the houses (you asked for this)
    │   └── data.js          <- same data, so the page opens by double-click
    └── files/               <- a saved copy of every bank's Excel/PDF
```

---

## ▶️ How to use it (two easy steps)

### Step 1 — Collect the data (run once, on your machine)

Open a terminal in this folder and copy/paste these lines:

```bash
cd scraper
python3 -m venv venv
source venv/bin/activate          # Windows:  venv\Scripts\activate
pip install -r requirements.txt
python extract.py
```

When it finishes it prints a summary like:

```
  Cars / vehicles saved :   42   -> site/data/vehicles.json
  Houses / property saved:   37   -> site/data/properties.json
  Original files kept    :    7   -> site/files/
```

### Step 2 — Open the website

**Easiest:** double-click `site/index.html`.

**Best (recommended):** serve it so the Download buttons and JSON work perfectly:

```bash
cd site
python3 -m http.server 8000
```

Then open **http://localhost:8000** in your browser. Done! 🎉

> The website already works *before* you run Step 1 — it just shows a few
> **example** cards with a yellow "example data" note until you load the real lists.

---

## 🔁 Keeping it fresh

The banks update their lists every month. To refresh, just run
`python extract.py` again — it re-downloads everything and rewrites the JSON.

If a bank changes a web address, open `scraper/sources.py` and fix that one line.

---

## ❓ Notes & honesty

- Every bank publishes in a **different shape** (Excel, PDF, web page), so the
  program does its **best effort** to pull out titles, prices and locations.
  A few odd rows may look plain — that is why every card also has the
  **"Visit site"** and **"Download list"** buttons to see the real thing.
- The program only **reads public listings**. It downloads no logins and
  changes nothing on the banks' sites.
- Always confirm details with the bank before buying anything.
# repodealsja
# repodealsja
# repodealsja
