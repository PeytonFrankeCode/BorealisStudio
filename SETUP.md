# Setup Guide — no computer needed (works from an iPad)

You do **not** need to install anything or use a terminal. Everything below is
done in a web browser (Safari/Chrome on your iPad). The actual building and
hosting happens on Cloudflare's servers, not your device.

The whole site — your public front page, the password-protected dashboard, and
your data — runs on **Cloudflare**. Your domain points at Cloudflare. That's it.

---

## Before you start

You need two free accounts (sign up in the browser):

1. **GitHub** — you already have this; your code is at
   `github.com/PeytonFrankeCode/BorealisStudio`.
2. **Cloudflare** — sign up at https://dash.cloudflare.com/sign-up

You also need your domain **borealissoftwares.com** (you have this).

---

## Step 1 — Merge the pull request

1. Open https://github.com/PeytonFrankeCode/BorealisStudio/pull/1
2. Tap **Merge pull request**, then **Confirm merge**.

This puts all the finished code on your `main` branch.

---

## Step 2 — Create the project on Cloudflare

1. Go to https://dash.cloudflare.com and sign in.
2. In the left menu tap **Workers & Pages**.
3. Tap **Create** → choose the **Workers** tab → **Import a repository**
   (you may be asked to connect your GitHub account — approve it, and give it
   access to the **BorealisStudio** repo).
4. Pick the **BorealisStudio** repository.
5. When asked for build settings, leave them as the defaults and tap
   **Create and deploy**.

Cloudflare reads the `wrangler.toml` in your repo, builds the Worker, and puts
it online. The first deploy gives you a temporary address like
`https://borealis-softwares.<something>.workers.dev` — tap it to see your site.

> From now on, every time code changes on `main`, Cloudflare re-deploys
> automatically. No tokens, no terminal.

---

## Step 3 — Create the database (D1) and connect it

The site needs a database to store traffic and notes.

1. In Cloudflare, left menu → **Workers & Pages** → **D1 SQL Database**.
2. Tap **Create database**. Name it exactly:

   ```
   borealis_traffic
   ```

3. Open the new database, tap the **Console** tab, paste the contents of the
   `schema.sql` file from your repo, and tap **Execute**. (Open `schema.sql` on
   GitHub, tap the **Copy raw file** button, then paste it here.)
   *(If you skip this, the app also creates the tables automatically on first
   use — but doing it now is cleaner.)*
4. Now link the database to your Worker: go to **Workers & Pages** → your
   **borealis-softwares** worker → **Settings** → **Bindings** →
   **Add** → **D1 database**:
   - **Variable name:** `DB`
   - **D1 database:** `borealis_traffic`
   - Save. (Cloudflare will re-deploy.)

---

## Step 4 — Set your dashboard passcode

This is the password you'll type to open the dashboard.

1. Go to your **borealis-softwares** worker → **Settings** →
   **Variables and Secrets**.
2. Under **Secrets**, tap **Add**:
   - **Name:** `ADMIN_TOKEN`
   - **Value:** choose a strong password (write it down somewhere safe)
   - Tap **Save**.

That's your dashboard passcode. Without it set, the dashboard would be open to
anyone — so don't skip this before going public.

---

## Step 5 — Put it on your domain

1. In Cloudflare, add your site: top of dashboard → **Add a site** →
   enter `borealissoftwares.com` → follow the prompts. Cloudflare will give you
   two **nameservers**.
2. Go to wherever you bought `borealissoftwares.com` (your domain registrar) and
   set its **nameservers** to the two Cloudflare gave you. *(This is the one
   step that happens outside Cloudflare. It can take a few hours to take effect.)*
3. Back in Cloudflare → **Workers & Pages** → your **borealis-softwares**
   worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain** →
   enter `borealissoftwares.com` (and optionally `www.borealissoftwares.com`).

Done — your site is live at **https://borealissoftwares.com**.

---

## Step 6 — Start tracking your sites

1. Visit **https://borealissoftwares.com/dashboard.html**
2. Enter your passcode (from Step 4).
3. Tap **+ Add Site**, enter a site's name and domain.
4. Open that site in the dashboard, tap **Tracking snippet**, and **Copy** it.
5. Paste that snippet into the `<head>` or before `</body>` of the website you
   want to track. Visits start showing up in your dashboard.

You can also fill in each project's **Public profile** (description, link, tags)
and flip **Show on public site** to feature it on your front page.

---

## What you end up with

- **https://borealissoftwares.com** → your professional studio front page.
- **https://borealissoftwares.com/dashboard.html** → passcode → your real
  traffic and private notes.
- Everything hosted on Cloudflare, auto-updating whenever the code changes.

---

## If something looks off

- **Front page shows example projects (Aurora Portfolio, etc.):** those are
  samples shown until the database is connected and you've added your own sites.
  Recheck Step 3 (the `DB` binding) and Step 6.
- **Dashboard never asks for a passcode:** the `ADMIN_TOKEN` secret isn't set —
  redo Step 4.
- **"Incorrect password":** the passcode must match the `ADMIN_TOKEN` value
  exactly.
- **Domain not loading yet:** nameserver changes (Step 5) can take a few hours.
  In the meantime use the `*.workers.dev` address from Step 2.
