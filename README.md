# Borealis Softwares

The public site for **Borealis Softwares** (borealissoftwares.com) plus a
private traffic dashboard, on one Cloudflare Worker + D1 backend.

> **Setting this up?** Follow **[SETUP.md](SETUP.md)** — a step-by-step,
> browser-only guide that needs no computer or terminal (works from an iPad).
> The whole site runs on Cloudflare; your domain points there.

- **Public landing page** (`/`) — a professional, dark "aurora" site that shows
  your projects to visitors. Read-only; it only ever exposes safe project info.
- **Private dashboard** (`/dashboard.html`) — password-protected. Track real
  pageviews per site, keep private notes, and choose which projects appear on
  the public site.

## How it fits together

```
  Visitors ─▶ GitHub Pages (public/)         Cloudflare Worker + D1
             ├─ index.html  (landing)  ──────▶  GET /api/projects   (public feed)
             └─ dashboard.html (passcode) ────▶  /api/overview, ... (Bearer token)
                                          ▲
   Your sites ─▶ /collect beacon ─────────┘  (records pageviews into D1)
```

- **GitHub Pages** hosts the professional front end (landing + dashboard) with
  the aurora palette.
- The **dashboard lives at `/dashboard.html`** and is gated by a passcode.
- All real data flows through **Cloudflare** (Worker + D1). The front end reaches
  it by setting one value — `apiBase` in `public/config.js`.

### Connect GitHub Pages to Cloudflare (the important step)

`public/config.js` is the single place that links the two:

```js
window.BOREALIS_CONFIG = {
  // Your deployed Worker URL (no trailing slash). Leave "" only if the whole
  // app is served from Cloudflare itself.
  apiBase: "https://borealis-softwares.YOURNAME.workers.dev"
};
```

- **apiBase set** → the GitHub Pages landing shows your real public projects, and
  the dashboard passcode unlocks your real Cloudflare data (cross-origin; the
  Worker already sends permissive CORS and the passcode is a Bearer token, never
  a cookie).
- **apiBase empty** → demo/sample mode (no backend), so the page still looks
  complete for previews.

The passcode itself is **not** in this file — it's the `ADMIN_TOKEN` secret on
Cloudflare, typed at the dashboard login screen.

## Two ways to run it

1. **GitHub Pages front + Cloudflare data (recommended)** — push to publish the
   site from `public/` via `.github/workflows/pages.yml`, set `apiBase` in
   `config.js` to your Worker URL, and deploy the Worker (below). The public
   front is on Pages; all real data is served by Cloudflare behind the passcode.
2. **All on Cloudflare** — deploy the Worker, which also serves `public/`. Leave
   `apiBase` as `""`. Single origin, ideal for `borealissoftwares.com`.

## How the two sides connect

Every project you track has a **"Show on public site"** toggle plus a
description, link, and tags you edit in the dashboard. Public ones are served
through `/api/projects`, which returns **only** name, link, description, tags,
and accent color — never traffic numbers or notes. The landing page renders
that feed.

## Project layout

| Path | Purpose |
|------|---------|
| `public/index.html` | Public landing page |
| `public/landing.css`, `public/landing.js` | Landing styles + project feed |
| `public/dashboard.html` | Private traffic dashboard |
| `public/app.js`, `public/styles.css` | Dashboard logic + styles |
| `public/config.js` | Sets `apiBase` — connects the front end to Cloudflare |
| `public/logo.svg` | Borealis aurora logo mark |
| `worker/index.js` | API, `/collect` beacon, auth, talks to D1 |
| `schema.sql` | D1 tables (`sites`, `events`, `notes`) |
| `wrangler.toml` | Cloudflare config |

## Enable GitHub Pages

In the repo: **Settings → Pages → Build and deployment → Source: GitHub
Actions**. Then push to `main` (or run the **Deploy to GitHub Pages** workflow
manually). The published URL appears in the workflow summary.

## Deploy to Cloudflare

You can deploy from your machine (below) or automatically from CI — the
`.github/workflows/deploy.yml` workflow runs `wrangler deploy` on every push to
`main` once you add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as
repository secrets and set the repository variable `ENABLE_CLOUDFLARE_DEPLOY` to
`true`.

```bash
# 1. Install + log in
npm install -g wrangler
wrangler login

# 2. Create the D1 database, then paste the printed database_id into wrangler.toml
wrangler d1 create borealis_traffic

# 3. Create the tables
wrangler d1 execute borealis_traffic --remote --file schema.sql

# 4. Set the dashboard password (REQUIRED to lock the dashboard)
wrangler secret put ADMIN_TOKEN          # type a strong password when prompted

# 5. Ship it
wrangler deploy
```

Wrangler prints your URL (e.g. `https://borealis-softwares.<you>.workers.dev`).
The landing page is at `/`; the dashboard is at `/dashboard.html` and will ask
for the password you set in step 4.

### Point your domain at it

A domain can only point to one host, so pick the layout that matches how you
want to run it:

**A) GitHub Pages front + Cloudflare data (the recommended split)**
- Apex `borealissoftwares.com` → **GitHub Pages**. The `public/CNAME` file
  already requests this domain; in repo **Settings → Pages → Custom domain**
  enter `borealissoftwares.com` and add the DNS records GitHub shows you.
- The Worker keeps its own address — either its `*.workers.dev` URL or a
  subdomain like `api.borealissoftwares.com` (Cloudflare → your Worker →
  **Settings → Domains & Routes → Add custom domain**).
- Put that Worker address in `public/config.js` as `apiBase`.

**B) Everything on Cloudflare (single origin)**
- Delete `public/CNAME` (it's only for GitHub Pages), leave `apiBase` as `""`,
  and in Cloudflare → your Worker → **Settings → Domains & Routes** add the
  custom domain `borealissoftwares.com`.

Wrangler prints your Worker URL on deploy (e.g.
`https://borealis-softwares.<you>.workers.dev`).

## Security model

- The dashboard and all admin APIs (`/api/overview`, create/update/delete sites,
  notes) require `Authorization: Bearer <ADMIN_TOKEN>`. The dashboard stores the
  password locally after you log in and sends it with every request.
- **If `ADMIN_TOKEN` is not set, the admin API is open** — always run
  `wrangler secret put ADMIN_TOKEN` before going public.
- Public endpoints (`/`, `/api/projects`, `/collect`) need no auth and never
  expose private data.
- Visitor counts come from a daily one-way hash of IP + user-agent — no cookies,
  no IPs or personal data stored.

## Add a site and start tracking

1. Open `/dashboard.html`, log in, click **+ Add Site**.
2. Open the site → fill in **Public profile** (description, link, tags) and flip
   **Show this project on the public site** if you want it on the landing page.
3. Click **Tracking snippet**, copy it, and paste it before `</body>` on the
   site you want to track:

```html
<script>
(function(){
  var SITE_ID = "your-site-id";
  var img = new Image();
  img.src = "https://borealissoftwares.com/collect?site=" + SITE_ID +
            "&path=" + encodeURIComponent(location.pathname) +
            "&t=" + Date.now();
})();
</script>
```

## Develop locally

```bash
npm install -g wrangler
echo 'ADMIN_TOKEN = "dev-password"' > .dev.vars   # optional: test the login flow
wrangler dev                                       # http://localhost:8787
```

Or just open `public/index.html` / `public/dashboard.html` directly for a
no-backend preview (the dashboard runs on demo data; the landing shows samples).
