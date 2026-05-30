# Borealis Studios — Traffic Tracker

A lightweight dashboard to track traffic across all of your websites and keep
notes on every project. Built to match the Borealis Studios aurora-wave brand.

![Dashboard](preview-dashboard.png)

## Features

- **Multi-site overview** — total visitors, pageviews, active sites, and your
  top-performing site at a glance, with a combined traffic chart.
- **Per-project detail** — visitors vs. pageviews chart, average/day, bounce
  rate, and top pages for each site.
- **Notes** — add, timestamp, and delete notes on any project (ideas, todos,
  campaign results).
- **Date ranges** — toggle between 7 / 30 / 90 days.
- **Tracking snippet** — copy a drop-in `<script>` for each site to record real
  pageviews into the dashboard.
- **Export / Import** — back up or move all your data as JSON.
- **Local-first** — everything is stored in your browser's `localStorage`; no
  account or server required.

## Run it

It's a zero-build static site. Just open `index.html` in a browser, or serve
the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

The dashboard ships with seeded sample data so you can see how it looks. Use
**+ Add Site** to add your own, or delete the samples.

## How tracking works

Each site has a unique ID. The **Tracking snippet** button on a project page
gives you a snippet to paste before `</body>` on that site. It fires a pageview
beacon that the dashboard records. To wire it to a real backend, point the
snippet's `collect` URL at an endpoint that appends to the project's traffic
data.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Markup and views |
| `styles.css` | Aurora-themed styling |
| `app.js` | State, charts, and all interactivity |
| `logo.svg` | Borealis Studios wave logo |

## Data & privacy

All data lives in `localStorage` under the key `borealis.studio.v1`. Clearing
your browser data removes it — export first if you want a backup.
