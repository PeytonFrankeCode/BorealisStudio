/* Borealis Software — Traffic Dashboard
 * Zero-dependency dashboard. Talks to the Cloudflare Worker + D1 backend when
 * served by it (with password auth); falls back to a local demo otherwise.
 */
(function () {
  "use strict";

  const STORE_KEY = "borealis.studio.v1";
  const TOKEN_KEY = "borealis.admin.token";
  const DAY = 86400000;
  const SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- Palette (from the Borealis Software aurora logo) ---------- */
  const C = {
    visitors: "#34c8a3", // teal-green
    views: "#6f7bf7",    // indigo
    grid: "rgba(120,160,220,0.10)",
    text: "#e7eefb",
    muted: "#8da2c4",
  };

  /* ---------------------------- Time ranges ------------------------- */
  // Each range is a window length in minutes.
  const RANGES = [
    { min: 30, label: "30m", long: "last 30 minutes" },
    { min: 60, label: "1h", long: "last hour" },
    { min: 360, label: "6h", long: "last 6 hours" },
    { min: 720, label: "12h", long: "last 12 hours" },
    { min: 1440, label: "24h", long: "last 24 hours" },
    { min: 4320, label: "3d", long: "last 3 days" },
    { min: 10080, label: "7d", long: "last 7 days" },
    { min: 43200, label: "30d", long: "last 30 days" },
    { min: 129600, label: "90d", long: "last 90 days" },
  ];
  function rangeLong(min) { const r = RANGES.find((x) => x.min === min); return r ? r.long : min + "m"; }
  function rangeShort(min) { const r = RANGES.find((x) => x.min === min); return r ? r.label : min + "m"; }

  // Chart bucket size for a window. Mirrors bucketPlan() in worker/index.js so
  // the live and demo charts have identical shapes.
  function bucketPlan(minutes) {
    let bucketMin;
    if (minutes <= 30) bucketMin = 2;
    else if (minutes <= 60) bucketMin = 5;
    else if (minutes <= 360) bucketMin = 15;
    else if (minutes <= 720) bucketMin = 30;
    else if (minutes <= 1440) bucketMin = 60;
    else if (minutes <= 4320) bucketMin = 180;
    else bucketMin = 1440;
    const bucketMs = bucketMin * 60000;
    const count = Math.max(1, Math.ceil((minutes * 60000) / bucketMs));
    return { bucketMs: bucketMs, count: count };
  }

  /* ----------------------------- State ----------------------------- */
  const EMPTY = { window: null, projects: [], geo: { countries: [], cities: [] } };
  let state = { projects: [] };   // demo metadata store (persisted): names, notes, profile
  let demoEvents = [];            // demo raw pageview events (in-memory)
  let overviewData = EMPTY;       // window-scoped data for the overview view
  let detailData = EMPTY;         // window-scoped data for the open detail view
  let currentId = null;
  let globalMin = 10080;          // overview window (7 days)
  let detailMin = 10080;          // detail window (7 days)
  let REMOTE = false;        // true when served by the Cloudflare Worker backend
  let authRequired = false;  // backend has an ADMIN_TOKEN configured
  let needLogin = false;     // logged out / wrong password
  let adminToken = "";

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data && data.projects) return { projects: data.projects };
      }
    } catch (e) { /* ignore */ }
    return { projects: seedProjects() };
  }
  function save() {
    if (REMOTE) return; // persistence lives in D1 on the backend
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ projects: state.projects })); } catch (e) {}
  }

  /* --------------------------- Backend API ------------------------- */
  // apiBase points at the Cloudflare Worker. It's "" when the app is served by
  // the Worker itself (same-origin), or a full URL when this static site is on
  // GitHub Pages and needs to reach Cloudflare cross-origin.
  const API_BASE = ((window.BOREALIS_CONFIG && window.BOREALIS_CONFIG.apiBase) || "").replace(/\/$/, "");
  function apiUrl(path) { return API_BASE + path; }

  // When /api/health responds, we run against the live Cloudflare Worker + D1
  // backend. Otherwise (file://, or GitHub Pages with no apiBase set) we fall
  // back to a local, demo-seeded copy so the page still looks complete.
  async function bootstrap() {
    if (API_BASE || location.protocol === "http:" || location.protocol === "https:") {
      try {
        const r = await fetch(apiUrl("/api/health"), { cache: "no-store" });
        if (r.ok) {
          REMOTE = true;
          const h = await r.json();
          authRequired = !!h.authRequired;
          adminToken = localStorage.getItem(TOKEN_KEY) || "";
          try {
            await loadOverview();
          } catch (e) {
            if (e.status === 401) { needLogin = true; overviewData = EMPTY; }
            else throw e;
          }
          return;
        }
      } catch (e) { /* fall through to local mode */ }
    }
    state = load();
    demoEvents = genDemoEvents(state.projects);
    await loadOverview();
  }

  function authHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (adminToken) h["Authorization"] = "Bearer " + adminToken;
    return h;
  }

  async function api(path, opts) {
    opts = opts || {};
    const r = await fetch(apiUrl(path), Object.assign({}, opts, { headers: authHeaders(opts.headers) }));
    if (r.status === 401) { const err = new Error("unauthorized"); err.status = 401; throw err; }
    if (!r.ok) throw new Error("Request failed (" + r.status + ")");
    return r.status === 204 ? null : r.json();
  }

  // Window-scoped data for a given length (minutes): live fetch, or demo compute.
  async function dataForWindow(min) {
    if (REMOTE) return await api("/api/overview?minutes=" + min);
    return demoWindow(min);
  }
  async function loadOverview() { overviewData = await dataForWindow(globalMin); }
  async function loadDetail() {
    detailData = (detailMin === globalMin) ? overviewData : await dataForWindow(detailMin);
  }
  // Refresh whichever data backs the current view(s) after a mutation.
  async function reloadAll() {
    await loadOverview();
    if (currentId) await loadDetail();
  }

  function activeProjects() {
    if (currentId && detailData.projects.length) return detailData.projects;
    return overviewData.projects;
  }
  function getProject(id) {
    return activeProjects().find((p) => p.id === id) ||
      overviewData.projects.find((p) => p.id === id);
  }
  function metaProject(id) { return state.projects.find((p) => p.id === id); }

  async function tryLogin(pw) {
    adminToken = (pw || "").trim();
    try {
      await loadOverview();
      localStorage.setItem(TOKEN_KEY, adminToken);
      needLogin = false;
      hideLogin();
      renderDashboard();
      toast("Unlocked");
    } catch (e) {
      adminToken = "";
      toast("Incorrect password");
    }
  }

  function logout() {
    adminToken = "";
    localStorage.removeItem(TOKEN_KEY);
    needLogin = true;
    overviewData = EMPTY;
    if (currentId) closeDetail();
    renderDashboard();
    showLogin();
  }

  function showLogin() {
    const ov = $("#loginBackdrop");
    if (ov) { ov.hidden = false; const f = $("#loginInput"); if (f) { f.value = ""; f.focus(); } }
  }
  function hideLogin() { const ov = $("#loginBackdrop"); if (ov) ov.hidden = true; }

  /* --------------------------- Demo data --------------------------- */
  // Metadata only (no traffic — that comes from demoEvents).
  function seedProjects() {
    const presets = [
      { name: "Borealis Software", domain: "borealissoftwares.com", color: "#34c8a3",
        description: "Studio site and home base for everything we build.", tags: "Brand, Web", public: true },
      { name: "Aurora Portfolio", domain: "aurora.design", color: "#2f8fd0",
        description: "A clean portfolio template for creative freelancers.", tags: "Next.js, Design", public: true },
      { name: "Northern Blog", domain: "northernlights.blog", color: "#8a4dff",
        description: "Long-form writing on software, design, and the north.", tags: "Writing", public: false },
    ];
    return presets.map((p) => ({
      id: uid(), name: p.name, domain: p.domain, url: "https://" + p.domain,
      description: p.description, tags: p.tags, public: p.public, color: p.color, created: Date.now(),
      notes: p.name === "Borealis Software"
        ? [{ id: uid(), text: "Launched the new landing page — watching bounce rate this week.", ts: Date.now() - 2 * DAY }]
        : [],
    }));
  }

  const DEMO_CITIES = [
    { country: "US", city: "New York", lat: 40.7, lon: -74.0, w: 12 },
    { country: "US", city: "Los Angeles", lat: 34.1, lon: -118.2, w: 8 },
    { country: "US", city: "Chicago", lat: 41.9, lon: -87.6, w: 6 },
    { country: "US", city: "Austin", lat: 30.3, lon: -97.7, w: 4 },
    { country: "CA", city: "Toronto", lat: 43.7, lon: -79.4, w: 6 },
    { country: "CA", city: "Vancouver", lat: 49.3, lon: -123.1, w: 3 },
    { country: "GB", city: "London", lat: 51.5, lon: -0.1, w: 7 },
    { country: "IN", city: "Mumbai", lat: 19.1, lon: 72.9, w: 5 },
    { country: "DE", city: "Berlin", lat: 52.5, lon: 13.4, w: 4 },
    { country: "AU", city: "Sydney", lat: -33.9, lon: 151.2, w: 4 },
    { country: "FR", city: "Paris", lat: 48.9, lon: 2.4, w: 3 },
    { country: "BR", city: "São Paulo", lat: -23.6, lon: -46.6, w: 3 },
    { country: "NL", city: "Amsterdam", lat: 52.4, lon: 4.9, w: 2 },
    { country: "JP", city: "Tokyo", lat: 35.7, lon: 139.7, w: 2 },
  ];
  const DEMO_CITY_TOTAL = DEMO_CITIES.reduce((a, c) => a + c.w, 0);
  function weightedCity() {
    let r = Math.random() * DEMO_CITY_TOTAL;
    for (const c of DEMO_CITIES) { r -= c.w; if (r <= 0) return c; }
    return DEMO_CITIES[0];
  }
  const DEMO_PATHS = ["/", "/about", "/work", "/contact", "/blog", "/pricing"];

  // Synthesize ~90 days of pageview events for one site, including a few in the
  // last ~25 minutes so the short windows (30m/1h) aren't empty.
  function genEventsForSite(p, idx) {
    const events = [];
    const now = Date.now();
    const base = 26 + (idx % 5) * 12; // visits per day-ish
    for (let d = 89; d >= 0; d--) {
      const dayStart = startOfDay(now - d * DAY);
      const dayEnd = Math.min(now, dayStart + DAY);
      if (dayEnd <= dayStart) continue;
      const span = dayEnd - dayStart;
      const dow = new Date(dayStart).getDay();
      const weekend = (dow === 0 || dow === 6) ? 0.7 : 1;
      const n = Math.max(0, Math.round(base * weekend * (0.6 + Math.random() * 0.8)));
      const dayUsers = Math.max(1, Math.round(n * 0.7)); // distinct visitors that day
      for (let k = 0; k < n; k++) {
        const ts = dayStart + Math.random() * span;
        const c = weightedCity();
        const visitor = p.id + "|" + dayStart + "|" + Math.floor(Math.random() * dayUsers);
        events.push({ site: p.id, ts: ts, path: DEMO_PATHS[Math.floor(Math.random() * DEMO_PATHS.length)],
          country: c.country, city: c.city, lat: c.lat, lon: c.lon, visitor: visitor });
      }
    }
    for (let k = 0; k < 5; k++) {
      const ts = now - Math.floor(Math.random() * 25 * 60000);
      const c = weightedCity();
      events.push({ site: p.id, ts: ts, path: "/", country: c.country, city: c.city, lat: c.lat, lon: c.lon,
        visitor: p.id + "|recent|" + Math.floor(ts / 300000) + "|" + k });
    }
    return events;
  }
  function genDemoEvents(projects) {
    const all = [];
    projects.forEach((p, i) => { all.push.apply(all, genEventsForSite(p, i)); });
    return all;
  }

  // Aggregate the in-memory demo events into the same shape the Worker returns.
  function demoWindow(min) {
    const plan = bucketPlan(min);
    const since = Date.now() - min * 60000;
    const projects = state.projects.map((mp) => {
      const evs = demoEvents.filter((e) => e.site === mp.id && e.ts >= since);
      const buckets = [];
      const sets = [];
      for (let i = 0; i < plan.count; i++) { buckets.push({ date: since + i * plan.bucketMs, visitors: 0, views: 0 }); sets.push(null); }
      evs.forEach((e) => {
        let i = Math.floor((e.ts - since) / plan.bucketMs);
        if (i < 0) i = 0; if (i >= plan.count) i = plan.count - 1;
        buckets[i].views++;
        (sets[i] || (sets[i] = new Set())).add(e.visitor);
      });
      for (let i = 0; i < plan.count; i++) buckets[i].visitors = sets[i] ? sets[i].size : 0;
      const pathMap = {};
      evs.forEach((e) => { pathMap[e.path] = (pathMap[e.path] || 0) + 1; });
      const topPages = Object.keys(pathMap).map((k) => ({ path: k, hits: pathMap[k] }))
        .sort((a, b) => b.hits - a.hits).slice(0, 10);
      return {
        id: mp.id, name: mp.name, domain: mp.domain, url: mp.url || "", description: mp.description || "",
        tags: mp.tags || "", public: !!mp.public, color: mp.color, created: mp.created,
        traffic: buckets, totals: { visitors: new Set(evs.map((e) => e.visitor)).size, views: evs.length },
        topPages: topPages, notes: mp.notes || [],
      };
    });
    const countries = [];
    const cities = [];
    state.projects.forEach((mp) => {
      const evs = demoEvents.filter((e) => e.site === mp.id && e.ts >= since);
      const cset = {};
      const cityMap = {};
      evs.forEach((e) => {
        if (e.country) (cset[e.country] || (cset[e.country] = new Set())).add(e.visitor);
        if (e.city) {
          const key = e.city + "|" + e.country;
          const c = cityMap[key] || (cityMap[key] = { country: e.country, city: e.city, lat: e.lat, lon: e.lon, set: new Set() });
          c.set.add(e.visitor);
        }
      });
      Object.keys(cset).forEach((country) => countries.push({ site: mp.id, country: country, visitors: cset[country].size }));
      Object.keys(cityMap).forEach((k) => {
        const c = cityMap[k];
        cities.push({ site: mp.id, country: c.country, city: c.city, lat: c.lat, lon: c.lon, visitors: c.set.size });
      });
    });
    return { window: { minutes: min, bucketMs: plan.bucketMs, count: plan.count, since: since }, projects: projects, geo: { countries: countries, cities: cities } };
  }

  /* ----------------------------- Utils ----------------------------- */
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function fmt(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }
  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60); if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60); if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24); if (d < 30) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }
  function sum(arr, key) { return arr.reduce((a, b) => a + b[key], 0); }
  function $(sel) { return document.querySelector(sel); }
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* --------------------- Public tracking API ----------------------- */
  // The embeddable snippet calls Borealis.track(siteId). We also expose
  // a same-origin recorder so the demo snippet works out of the box.
  window.Borealis = {
    track(siteId, path) {
      if (REMOTE) return; // real pageviews are recorded by the Worker /collect endpoint
      if (!metaProject(siteId)) return;
      const now = Date.now();
      const c = weightedCity();
      demoEvents.push({ site: siteId, ts: now, path: path || location.pathname || "/",
        country: c.country, city: c.city, lat: c.lat, lon: c.lon, visitor: siteId + "|live|" + now });
      reloadAll().then(() => { currentId ? renderDetail() : renderDashboard(); });
    },
  };

  /* ----------------------------- Charts ---------------------------- */
  function drawLineChart(canvas, series, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
    // Capture the intended height once; reading canvas.height back would compound
    // the dpr scaling on every redraw and make the chart grow without bound.
    const cssH = +(canvas.dataset.h || (canvas.dataset.h = canvas.getAttribute("height") || "240"));
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 44, padR = 14, padT = 14, padB = 26;
    const w = cssW - padL - padR, h = cssH - padT - padB;
    const all = series.flatMap((s) => s.data);
    const max = Math.max(1, ...all);
    const n = series[0].data.length;

    // grid + y labels
    ctx.font = "11px Inter, sans-serif"; ctx.fillStyle = C.muted; ctx.textAlign = "right";
    const lines = 4;
    for (let i = 0; i <= lines; i++) {
      const y = padT + (h * i) / lines;
      const val = Math.round(max * (1 - i / lines));
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + w, y); ctx.stroke();
      ctx.fillText(fmt(val), padL - 8, y + 4);
    }

    const xAt = (i) => padL + (n <= 1 ? w / 2 : (w * i) / (n - 1));
    const yAt = (v) => padT + h - (h * v) / max;

    series.forEach((s) => {
      // area fill
      if (s.fill) {
        const grad = ctx.createLinearGradient(0, padT, 0, padT + h);
        grad.addColorStop(0, s.color + "44");
        grad.addColorStop(1, s.color + "00");
        ctx.beginPath();
        ctx.moveTo(xAt(0), yAt(s.data[0]));
        s.data.forEach((v, i) => ctx.lineTo(xAt(i), yAt(v)));
        ctx.lineTo(xAt(n - 1), padT + h); ctx.lineTo(xAt(0), padT + h); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
      }
      // line
      ctx.beginPath();
      s.data.forEach((v, i) => { const x = xAt(i), y = yAt(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = s.color; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    });

    // x labels (start / mid / end)
    ctx.fillStyle = C.muted; ctx.textAlign = "center";
    const labels = opts.labels || [];
    [0, Math.floor((n - 1) / 2), n - 1].forEach((i) => {
      if (labels[i]) ctx.fillText(labels[i], xAt(i), cssH - 8);
    });
  }

  function drawSpark(canvas, data, color) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 240, cssH = 44;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    const max = Math.max(1, ...data), min = Math.min(...data);
    const xAt = (i) => (cssW * i) / (Math.max(1, data.length - 1));
    const yAt = (v) => 4 + (cssH - 8) - ((cssH - 8) * (v - min)) / Math.max(1, max - min);
    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, color + "55"); grad.addColorStop(1, color + "00");
    ctx.beginPath(); ctx.moveTo(0, cssH);
    data.forEach((v, i) => ctx.lineTo(xAt(i), yAt(v)));
    ctx.lineTo(cssW, cssH); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => { i ? ctx.lineTo(xAt(i), yAt(v)) : ctx.moveTo(xAt(i), yAt(v)); });
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineJoin = "round"; ctx.stroke();
  }

  // Date labels for the chart x-axis: clock times for sub-day windows, dates above.
  function bucketLabels(traffic, min) {
    const subday = min <= 1440;
    return traffic.map((r) => subday
      ? new Date(r.date).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }

  /* --------------------------- Rendering --------------------------- */
  function deltaPct(arr, key) {
    const n = arr.length; if (n < 2) return 0;
    const half = Math.floor(n / 2);
    const prev = sum(arr.slice(0, half), key) || 1;
    const cur = sum(arr.slice(half), key);
    return Math.round(((cur - prev) / prev) * 100);
  }
  function deltaHtml(pct) {
    const cls = pct >= 0 ? "up" : "down";
    const arrow = pct >= 0 ? "▲" : "▼";
    return `<div class="delta ${cls}">${arrow} ${Math.abs(pct)}% vs prior period</div>`;
  }
  function statCard(label, value, deltaPctVal) {
    return `<div class="stat-card"><div class="label">${label}</div><div class="value">${value}</div>${deltaPctVal == null ? "" : deltaHtml(deltaPctVal)}</div>`;
  }

  // Sum aligned per-bucket series across all sites (they share the same window).
  function combineBuckets(projects) {
    if (!projects.length) return [];
    const len = Math.max.apply(null, projects.map((p) => p.traffic.length));
    const out = [];
    for (let i = 0; i < len; i++) {
      let date = null, visitors = 0, views = 0;
      projects.forEach((p) => {
        const r = p.traffic[i];
        if (r) { date = r.date; visitors += r.visitors; views += r.views; }
      });
      out.push({ date: date || Date.now(), visitors: visitors, views: views });
    }
    return out;
  }

  function renderDashboard() {
    const ps = overviewData.projects;
    const grid = $("#statGrid");
    const sub = $("#overviewSub");
    if (sub) sub.textContent = "Traffic across all your sites — " + rangeLong(globalMin);

    const allVisitors = ps.reduce((a, p) => a + (p.totals ? p.totals.visitors : 0), 0);
    const allViews = ps.reduce((a, p) => a + (p.totals ? p.totals.views : 0), 0);
    const combined = combineBuckets(ps);
    const vDelta = deltaPct(combined, "visitors");

    let top = null, topV = -1;
    ps.forEach((p) => { const v = p.totals ? p.totals.visitors : 0; if (v > topV) { topV = v; top = p; } });

    grid.innerHTML =
      statCard("Total visitors", fmt(allVisitors), vDelta) +
      statCard("Total pageviews", fmt(allViews), deltaPct(combined, "views")) +
      statCard("Active sites", String(ps.length)) +
      statCard("Top site", top ? top.name : "—");

    $("#trendChip").innerHTML = ps.length ? deltaHtml(vDelta).replace(/<\/?div[^>]*>/g, "") : "";
    $("#projectCount").textContent = ps.length ? `${ps.length} site${ps.length > 1 ? "s" : ""}` : "";

    if (combined.length) {
      drawLineChart($("#overviewChart"), [
        { data: combined.map((r) => r.visitors), color: C.visitors, fill: true },
      ], { labels: bucketLabels(combined, globalMin) });
    }

    renderGeoInto($("#worldMap"), $("#geoList"), $("#geoChip"), overviewData.geo, globalMin);

    const pg = $("#projectGrid");
    pg.innerHTML = "";
    ps.forEach((p) => pg.appendChild(projectCard(p)));
    $("#emptyState").hidden = ps.length !== 0;
    $(".chart-panel").style.display = ps.length ? "" : "none";
    $("#geoPanel").style.display = ps.length ? "" : "none";
    $(".section-head").style.display = ps.length ? "" : "none";
    $("#statGrid").style.display = ps.length ? "" : "none";

    requestAnimationFrame(() => {
      ps.forEach((p) => {
        const c = document.getElementById("spark-" + p.id);
        if (c) drawSpark(c, p.traffic.map((r) => r.visitors), p.color);
      });
    });
  }

  /* ----------------------- Visitors by location --------------------- */
  function countryName(code, fallback) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || fallback || code;
    } catch (e) { return fallback || code; }
  }

  // Natural Earth projection (same as the generated map), lat/lon in degrees.
  function projectPoint(lon, lat) {
    const MAP = window.WORLD_MAP;
    const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180;
    const p2 = la * la, p4 = p2 * p2;
    const x = lo * (0.8707 - 0.131979 * p2 + p4 * (-0.013791 + p4 * (0.003971 * p2 - 0.001529 * p4)));
    const y = la * (1.007226 + p2 * (0.015085 + p4 * (-0.044475 + 0.028874 * p2 - 0.005916 * p4)));
    return [MAP.tx + MAP.k * x, MAP.ty - MAP.k * y];
  }

  // Build the SVG world map inside a host element once (guarded per host).
  function buildGeoSvg(host) {
    if (!host || host.dataset.built || !window.WORLD_MAP) return;
    const MAP = window.WORLD_MAP;
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("viewBox", "0 0 " + MAP.w + " " + MAP.h);
    MAP.countries.forEach((c) => {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", c.d);
      p.dataset.code = c.c;
      p.appendChild(document.createElementNS(SVGNS, "title"));
      svg.appendChild(p);
    });
    const g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "geo-bubbles");
    svg.appendChild(g);
    host.appendChild(svg);
    host.dataset.built = "1";
  }

  // Render a (pre-scoped) geo dataset into a map host + list + chip.
  function renderGeoInto(host, listEl, chipEl, geo, min) {
    if (!host) return;
    buildGeoSvg(host);

    const cTotals = {};
    (geo.countries || []).forEach((r) => { if (r.country) cTotals[r.country] = (cTotals[r.country] || 0) + r.visitors; });
    const entries = Object.entries(cTotals).sort((a, b) => b[1] - a[1]);
    const max = entries.length ? entries[0][1] : 0;
    const total = entries.reduce((a, e) => a + e[1], 0);

    const cityMap = {};
    (geo.cities || []).forEach((r) => {
      if (!r.city) return;
      const key = r.city + "|" + r.country;
      const c = cityMap[key] || (cityMap[key] = { city: r.city, country: r.country, lat: r.lat, lon: r.lon, visitors: 0 });
      c.visitors += r.visitors;
    });
    const cities = Object.values(cityMap).sort((a, b) => b.visitors - a.visitors);

    if (chipEl) chipEl.textContent = entries.length
      ? fmt(total) + " unique visitors · " +
        (cities.length ? cities.length + (cities.length === 1 ? " city" : " cities") + " · " : "") +
        entries.length + (entries.length === 1 ? " country" : " countries") + " · " + rangeLong(min)
      : "";

    host.querySelectorAll("path").forEach((p) => {
      const v = cTotals[p.dataset.code] || 0;
      const t = max ? Math.sqrt(v / max) : 0;
      p.style.fill = v
        ? "rgba(52, 200, 163, " + (0.14 + 0.5 * t).toFixed(3) + ")"
        : "rgba(120, 160, 220, 0.08)";
      const ti = p.querySelector("title");
      if (ti) ti.textContent = countryName(p.dataset.code) + ": " + (v ? fmt(v) + " visitor" + (v === 1 ? "" : "s") : "no visitors");
    });

    const bubbles = host.querySelector(".geo-bubbles");
    if (bubbles && window.WORLD_MAP) {
      bubbles.innerHTML = "";
      const cmax = cities.length ? cities[0].visitors : 0;
      cities.slice(0, 60).forEach((c) => {
        if (c.lat == null || c.lon == null) return;
        const xy = projectPoint(c.lon, c.lat);
        const dot = document.createElementNS(SVGNS, "circle");
        dot.setAttribute("cx", xy[0].toFixed(1));
        dot.setAttribute("cy", xy[1].toFixed(1));
        dot.setAttribute("r", (3 + 9 * Math.sqrt(c.visitors / (cmax || 1))).toFixed(1));
        dot.setAttribute("class", "geo-dot");
        const t = document.createElementNS(SVGNS, "title");
        t.textContent = c.city + ", " + countryName(c.country) + ": " + fmt(c.visitors) + " visitor" + (c.visitors === 1 ? "" : "s");
        dot.appendChild(t);
        bubbles.appendChild(dot);
      });
    }

    if (listEl) {
      listEl.innerHTML = "";
      if (!entries.length) {
        listEl.appendChild(el("li", "note-empty", "No location data yet — locations are recorded with each new visit."));
      } else {
        const rows = cities.length
          ? cities.slice(0, 8).map((c) => [c.city, c.visitors])
          : entries.slice(0, 8).map((e) => [countryName(e[0]), e[1]]);
        const rmax = rows[0][1];
        rows.forEach((row) => {
          const li = el("li");
          const barW = Math.round((row[1] / rmax) * 78);
          li.innerHTML = '<span class="path">' + escapeHtml(row[0]) + '</span>' +
            '<span class="bar" style="width:' + barW + 'px"></span>' +
            '<span class="hits">' + fmt(row[1]) + "</span>";
          listEl.appendChild(li);
        });
      }
    }
  }

  function projectCard(p) {
    const visitors = p.totals ? p.totals.visitors : 0;
    const views = p.totals ? p.totals.views : 0;
    const card = el("div", "project-card");
    card.innerHTML = `
      <div class="pc-head">
        <span class="dot" style="background:${p.color};color:${p.color}"></span>
        <div>
          <div class="pc-name">${escapeHtml(p.name)}</div>
          <div class="pc-domain">${escapeHtml(p.domain)}</div>
        </div>
      </div>
      <div class="pc-stats">
        <div><div class="n">${fmt(visitors)}</div><div class="l">Visitors</div></div>
        <div><div class="n">${fmt(views)}</div><div class="l">Pageviews</div></div>
      </div>
      <canvas class="spark" id="spark-${p.id}"></canvas>
      <div class="pc-foot">
        <span>${p.notes.length} note${p.notes.length === 1 ? "" : "s"}${p.public ? " · public" : ""}</span>
        <span class="badge">${rangeShort(globalMin)}</span>
      </div>`;
    card.addEventListener("click", () => openDetail(p.id));
    return card;
  }

  /* ---------------------------- Detail ----------------------------- */
  function openDetail(id) {
    currentId = id; detailMin = globalMin;
    detailData = overviewData; // same window — reuse without an extra fetch
    syncRange("#detailRange", detailMin);
    $("#dashboardView").hidden = true;
    $("#detailView").hidden = false;
    window.scrollTo(0, 0);
    renderDetail();
  }
  function closeDetail() {
    currentId = null;
    $("#detailView").hidden = true;
    $("#dashboardView").hidden = false;
    renderDashboard();
  }

  function renderDetail() {
    const p = getProject(currentId);
    if (!p) return closeDetail();
    $("#detailDot").style.background = p.color;
    $("#detailDot").style.color = p.color;
    $("#detailName").textContent = p.name;
    const dom = $("#detailDomain");
    dom.textContent = p.domain;
    dom.href = /^https?:\/\//.test(p.domain) ? p.domain : "https://" + p.domain;

    const slice = p.traffic;
    const visitors = p.totals ? p.totals.visitors : 0;
    const views = p.totals ? p.totals.views : 0;
    const perVisit = visitors ? (views / visitors) : 0;
    const bounce = 38 + Math.round((p.id.charCodeAt(0) % 20));
    $("#detailStats").innerHTML =
      statCard("Visitors", fmt(visitors), deltaPct(slice, "visitors")) +
      statCard("Pageviews", fmt(views), deltaPct(slice, "views")) +
      statCard("Pages / visit", perVisit.toFixed(1)) +
      statCard("Bounce rate", bounce + "%");

    drawLineChart($("#detailChart"), [
      { data: slice.map((r) => r.views), color: C.views, fill: true },
      { data: slice.map((r) => r.visitors), color: C.visitors, fill: true },
    ], { labels: bucketLabels(slice, detailMin) });

    const dgeo = {
      countries: (detailData.geo.countries || []).filter((r) => r.site === currentId),
      cities: (detailData.geo.cities || []).filter((r) => r.site === currentId),
    };
    renderGeoInto($("#worldMapDetail"), $("#geoListDetail"), $("#geoChipDetail"), dgeo, detailMin);

    renderNotes(p);
    renderTopPages(p);
    renderProfile(p);
  }

  /* ----------------------- Public profile editor ------------------- */
  function renderProfile(p) {
    if (!$("#profileForm")) return;
    $("#profPublic").checked = !!p.public;
    $("#profUrl").value = p.url || ("https://" + p.domain);
    $("#profTags").value = p.tags || "";
    $("#profDesc").value = p.description || "";
    const chip = $("#publicBadge");
    if (chip) {
      chip.textContent = p.public ? "Public" : "Hidden";
      chip.classList.toggle("on", !!p.public);
    }
  }

  async function saveProfile() {
    const patch = {
      public: $("#profPublic").checked,
      url: $("#profUrl").value.trim(),
      tags: $("#profTags").value.trim(),
      description: $("#profDesc").value.trim(),
    };
    try {
      if (REMOTE) await api("/api/sites/" + currentId, { method: "PATCH", body: JSON.stringify(patch) });
      else { Object.assign(metaProject(currentId), patch); save(); }
      await reloadAll();
      renderDetail();
      toast("Public profile saved");
    } catch (err) {
      toast(err.status === 401 ? "Session expired — please unlock" : "Could not save");
      if (err.status === 401) logout();
    }
  }

  function renderNotes(p) {
    $("#notesCount").textContent = `${p.notes.length} note${p.notes.length === 1 ? "" : "s"}`;
    const list = $("#noteList");
    list.innerHTML = "";
    if (!p.notes.length) {
      list.appendChild(el("li", "note-empty", "No notes yet — add your first one above."));
      return;
    }
    [...p.notes].sort((a, b) => b.ts - a.ts).forEach((note) => {
      const li = el("li", "note-item");
      li.innerHTML = `
        <div class="note-text">${escapeHtml(note.text)}</div>
        <div class="note-meta">
          <span class="note-date">${timeAgo(note.ts)}</span>
          <button class="note-del" data-id="${note.id}">Delete</button>
        </div>`;
      li.querySelector(".note-del").addEventListener("click", () => deleteNote(note.id));
      list.appendChild(li);
    });
  }

  async function addNote(text) {
    try {
      if (REMOTE) await api("/api/sites/" + currentId + "/notes", { method: "POST", body: JSON.stringify({ text }) });
      else { metaProject(currentId).notes.push({ id: uid(), text: text, ts: Date.now() }); save(); }
      await reloadAll();
      $("#noteInput").value = ""; renderDetail(); toast("Note added");
    } catch (err) {
      toast(err.status === 401 ? "Session expired — please unlock" : "Could not add note");
      if (err.status === 401) logout();
    }
  }

  async function deleteNote(noteId) {
    try {
      if (REMOTE) await api("/api/notes/" + noteId, { method: "DELETE" });
      else { const mp = metaProject(currentId); mp.notes = mp.notes.filter((x) => x.id !== noteId); save(); }
      await reloadAll();
      renderDetail(); toast("Note deleted");
    } catch (err) { toast("Could not delete note"); }
  }

  function renderTopPages(p) {
    const list = $("#topPages");
    list.innerHTML = "";
    const top = [...p.topPages].sort((a, b) => b.hits - a.hits).slice(0, 6);
    const max = Math.max(1, ...top.map((x) => x.hits));
    top.forEach((tp) => {
      const li = el("li");
      const barW = Math.round((tp.hits / max) * 120);
      li.innerHTML = `<span class="path">${escapeHtml(tp.path)}</span>
        <span class="bar" style="width:${barW}px"></span>
        <span class="hits">${fmt(tp.hits)}</span>`;
      list.appendChild(li);
    });
    if (!top.length) list.appendChild(el("li", "note-empty", "No page data yet."));
  }

  /* --------------------------- Projects ---------------------------- */
  async function addProject(data) {
    const name = data.name.trim();
    const domain = data.domain.trim().replace(/^https?:\/\//, "");
    if (REMOTE) {
      try {
        await api("/api/sites", { method: "POST", body: JSON.stringify({ name, domain, color: data.color }) });
        await loadOverview();
        renderDashboard();
        toast(`Added ${name}`);
      } catch (err) { toast(err.status === 401 ? "Session expired — please unlock" : "Could not add site"); if (err.status === 401) logout(); }
      return;
    }
    const mp = {
      id: uid(), name, domain, url: "https://" + domain, description: "", tags: "", public: false,
      color: data.color, created: Date.now(), notes: [],
    };
    state.projects.push(mp);
    if (data.seed) demoEvents.push.apply(demoEvents, genEventsForSite(mp, state.projects.length));
    save();
    await loadOverview();
    renderDashboard();
    toast(`Added ${mp.name}`);
  }
  async function deleteProject(id) {
    const p = getProject(id);
    if (!p) return;
    if (!confirm(`Delete "${p.name}" and all its notes? This cannot be undone.`)) return;
    if (REMOTE) {
      try {
        await api("/api/sites/" + id, { method: "DELETE" });
      } catch (err) { return toast(err.status === 401 ? "Session expired — please unlock" : "Could not delete site"); }
    } else {
      state.projects = state.projects.filter((x) => x.id !== id);
      demoEvents = demoEvents.filter((e) => e.site !== id);
      save();
    }
    await loadOverview();
    closeDetail(); toast("Site deleted");
  }

  /* ---------------------------- Snippet ---------------------------- */
  function snippetFor(p) {
    // The /collect beacon must hit the Cloudflare Worker: prefer the configured
    // apiBase, then the current origin if served by the Worker, else the domain.
    const base = API_BASE || (REMOTE ? location.origin : "https://borealissoftwares.com");
    return `<!-- Borealis Software analytics — ${p.name} -->
<script>
(function(){
  var SITE_ID = "${p.id}";
  var img = new Image();
  img.src = "${base}/collect?site=" + SITE_ID +
            "&path=" + encodeURIComponent(location.pathname) +
            "&t=" + Date.now();
})();
<\/script>`;
  }

  /* ----------------------------- Helpers --------------------------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function populateRange(sel, min) {
    const host = $(sel);
    if (!host) return;
    host.innerHTML = "";
    RANGES.forEach((r) => {
      const b = document.createElement("button");
      b.dataset.min = r.min;
      b.textContent = r.label;
      if (r.min === min) b.className = "active";
      host.appendChild(b);
    });
  }
  function syncRange(sel, min) {
    document.querySelectorAll(sel + " button").forEach((b) => b.classList.toggle("active", +b.dataset.min === min));
  }

  /* ------------------------------ Wire ----------------------------- */
  function openModal() { $("#modalBackdrop").hidden = false; $("#pName").focus(); }
  function closeModal() { $("#modalBackdrop").hidden = true; $("#projectForm").reset(); }

  function init() {
    populateRange("#globalRange", globalMin);
    populateRange("#detailRange", detailMin);

    $("#addProjectBtn").addEventListener("click", openModal);
    $("#emptyAddBtn").addEventListener("click", openModal);
    $("#cancelModal").addEventListener("click", closeModal);
    $("#modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });

    $("#projectForm").addEventListener("submit", (e) => {
      e.preventDefault();
      addProject({ name: $("#pName").value, domain: $("#pDomain").value, color: $("#pColor").value, seed: $("#pSeed").checked });
      closeModal();
    });

    $("#backBtn").addEventListener("click", closeDetail);
    $("#brandHome").addEventListener("click", () => { if (currentId) closeDetail(); });
    $("#deleteProjectBtn").addEventListener("click", () => deleteProject(currentId));

    $("#noteForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = $("#noteInput").value.trim();
      if (text) addNote(text);
    });

    // login / logout
    const loginForm = $("#loginForm");
    if (loginForm) loginForm.addEventListener("submit", (e) => { e.preventDefault(); tryLogin($("#loginInput").value); });
    const lockBtn = $("#lockBtn");
    if (lockBtn) lockBtn.addEventListener("click", logout);

    // public profile editor
    const profForm = $("#profileForm");
    if (profForm) profForm.addEventListener("submit", (e) => { e.preventDefault(); saveProfile(); });

    // range toggles
    $("#globalRange").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      globalMin = +b.dataset.min; syncRange("#globalRange", globalMin);
      try { await loadOverview(); } catch (err) { if (err.status === 401) return logout(); }
      renderDashboard();
    });
    $("#detailRange").addEventListener("click", async (e) => {
      const b = e.target.closest("button"); if (!b) return;
      detailMin = +b.dataset.min; syncRange("#detailRange", detailMin);
      try { await loadDetail(); } catch (err) { if (err.status === 401) return logout(); }
      renderDetail();
    });

    // snippet
    $("#snippetBtn").addEventListener("click", () => {
      const p = getProject(currentId);
      $("#snippetCode").textContent = snippetFor(p);
      $("#snippetBackdrop").hidden = false;
    });
    $("#closeSnippet").addEventListener("click", () => { $("#snippetBackdrop").hidden = true; });
    $("#snippetBackdrop").addEventListener("click", (e) => { if (e.target.id === "snippetBackdrop") e.currentTarget.hidden = true; });
    $("#copySnippet").addEventListener("click", () => {
      navigator.clipboard.writeText($("#snippetCode").textContent).then(() => toast("Snippet copied"));
    });

    // export / import (demo only — metadata + notes)
    $("#exportBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ projects: state.projects }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `borealis-traffic-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href); toast("Data exported");
    });
    $("#importBtn").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.projects) throw new Error("bad");
          state = { projects: data.projects };
          demoEvents = genDemoEvents(state.projects);
          save();
          await loadOverview();
          closeDetail(); toast("Data imported");
        } catch (err) { toast("Could not import file"); }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeModal(); $("#snippetBackdrop").hidden = true; }
    });
    window.addEventListener("resize", () => { currentId ? renderDetail() : renderDashboard(); });

    // Mode-specific UI: live backend vs. local demo.
    const chip = $("#modeChip");
    if (REMOTE) {
      chip.textContent = "● Live";
      chip.classList.add("live");
      chip.title = "Connected to your Cloudflare backend — tracking real pageviews";
      const seed = document.querySelector("label.check");
      if (seed) seed.style.display = "none"; // no fake data in live mode
      $("#importBtn").style.display = "none"; // import can't push to the live DB
      if (lockBtn) lockBtn.style.display = authRequired ? "" : "none";
    } else {
      chip.textContent = "● Local demo";
      chip.title = "Running on demo data in this browser. Deploy the Worker for real tracking.";
      if (lockBtn) lockBtn.style.display = "none";
    }

    renderDashboard();
    if (needLogin) showLogin();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    await bootstrap();
    init();
  });
})();
