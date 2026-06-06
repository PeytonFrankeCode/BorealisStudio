/* Borealis Softwares — Traffic Dashboard
 * Zero-dependency dashboard. Talks to the Cloudflare Worker + D1 backend when
 * served by it (with password auth); falls back to a local demo otherwise.
 */
(function () {
  "use strict";

  const STORE_KEY = "borealis.studio.v1";
  const TOKEN_KEY = "borealis.admin.token";
  const DAY = 86400000;

  /* ---------- Palette (from the Borealis Softwares aurora logo) ---------- */
  const C = {
    visitors: "#34c8a3", // teal-green
    views: "#6f7bf7",    // indigo
    grid: "rgba(120,160,220,0.10)",
    text: "#e7eefb",
    muted: "#8da2c4",
  };

  /* ----------------------------- State ----------------------------- */
  let state = { projects: [] };
  let currentId = null;
  let globalDays = 30;
  let detailDays = 30;
  let REMOTE = false;        // true when served by the Cloudflare Worker backend
  let authRequired = false;  // backend has an ADMIN_TOKEN configured
  let needLogin = false;     // logged out / wrong password
  let adminToken = "";

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore */ }
    return { projects: seedProjects() };
  }
  function save() {
    if (REMOTE) return; // persistence lives in D1 on the backend
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* --------------------------- Backend API ------------------------- */
  // When served over http(s) and /api/health responds, we run against the live
  // Cloudflare Worker + D1 backend. Otherwise (file://, or a plain static
  // server) we fall back to a local, demo-seeded localStorage copy.
  async function bootstrap() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (r.ok) {
          REMOTE = true;
          const h = await r.json();
          authRequired = !!h.authRequired;
          adminToken = localStorage.getItem(TOKEN_KEY) || "";
          try {
            await reloadOverview();
          } catch (e) {
            if (e.status === 401) { needLogin = true; state = { projects: [] }; }
            else throw e;
          }
          return;
        }
      } catch (e) { /* fall through to local mode */ }
    }
    state = load();
  }

  function authHeaders(extra) {
    const h = Object.assign({ "Content-Type": "application/json" }, extra || {});
    if (adminToken) h["Authorization"] = "Bearer " + adminToken;
    return h;
  }

  async function api(path, opts) {
    opts = opts || {};
    const r = await fetch(path, Object.assign({}, opts, { headers: authHeaders(opts.headers) }));
    if (r.status === 401) { const err = new Error("unauthorized"); err.status = 401; throw err; }
    if (!r.ok) throw new Error("Request failed (" + r.status + ")");
    return r.status === 204 ? null : r.json();
  }

  async function reloadOverview() {
    const data = await api("/api/overview?days=90");
    state.projects = data.projects || [];
  }

  async function tryLogin(pw) {
    adminToken = (pw || "").trim();
    try {
      await reloadOverview();
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
    state = { projects: [] };
    if (currentId) closeDetail();
    renderDashboard();
    showLogin();
  }

  function showLogin() {
    const ov = $("#loginBackdrop");
    if (ov) { ov.hidden = false; const f = $("#loginInput"); if (f) { f.value = ""; f.focus(); } }
  }
  function hideLogin() { const ov = $("#loginBackdrop"); if (ov) ov.hidden = true; }

  /* --------------------------- Seed data --------------------------- */
  function seedProjects() {
    const presets = [
      { name: "Borealis Softwares", domain: "borealissoftwares.com", color: "#34c8a3", base: 320, growth: 1.2,
        description: "Studio site and home base for everything we build.", tags: "Brand, Web", public: true },
      { name: "Aurora Portfolio", domain: "aurora.design", color: "#2f8fd0", base: 140, growth: 0.6,
        description: "A clean portfolio template for creative freelancers.", tags: "Next.js, Design", public: true },
      { name: "Northern Blog", domain: "northernlights.blog", color: "#8a4dff", base: 210, growth: -0.3,
        description: "Long-form writing on software, design, and the north.", tags: "Writing", public: false },
    ];
    return presets.map((p) => ({
      id: uid(),
      name: p.name,
      domain: p.domain,
      url: "https://" + p.domain,
      description: p.description,
      tags: p.tags,
      public: p.public,
      color: p.color,
      created: Date.now(),
      notes: p.name === "Borealis Softwares"
        ? [{ id: uid(), text: "Launched the new landing page — watching bounce rate this week.", ts: Date.now() - 2 * DAY }]
        : [],
      traffic: genTraffic(120, p.base, p.growth),
      topPages: genTopPages(p.base),
    }));
  }

  function genTraffic(days, base, growth) {
    const out = [];
    const now = startOfDay(Date.now());
    for (let i = days - 1; i >= 0; i--) {
      const date = now - i * DAY;
      const dow = new Date(date).getDay();
      const weekend = dow === 0 || dow === 6 ? 0.7 : 1;
      const trend = 1 + (growth * (days - i)) / days;
      const noise = 0.75 + Math.random() * 0.5;
      const visitors = Math.max(3, Math.round(base * weekend * trend * noise));
      const views = Math.round(visitors * (1.8 + Math.random() * 1.4));
      out.push({ date, visitors, views });
    }
    return out;
  }

  function genTopPages(base) {
    const paths = ["/", "/about", "/work", "/contact", "/blog", "/pricing"];
    return paths.map((p, i) => ({ path: p, hits: Math.round(base * (1.5 - i * 0.2) * (0.8 + Math.random() * 0.6)) }))
      .sort((a, b) => b.hits - a.hits);
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
  function lastN(traffic, n) { return traffic.slice(-n); }
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
      const p = state.projects.find((x) => x.id === siteId);
      if (!p) return;
      const today = startOfDay(Date.now());
      let row = p.traffic[p.traffic.length - 1];
      if (!row || row.date !== today) { row = { date: today, visitors: 0, views: 0 }; p.traffic.push(row); }
      row.views += 1;
      row.visitors += 1; // simple model: treat each call as a unique-ish visit
      const path0 = path || location.pathname || "/";
      const tp = p.topPages.find((x) => x.path === path0);
      if (tp) tp.hits += 1; else p.topPages.push({ path: path0, hits: 1 });
      p.topPages.sort((a, b) => b.hits - a.hits);
      save();
      if (currentId === p.id) renderDetail();
    },
  };

  /* ----------------------------- Charts ---------------------------- */
  function drawLineChart(canvas, series, opts) {
    opts = opts || {};
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.parentElement.clientWidth;
    const cssH = canvas.getAttribute("height") * 1 || 240;
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
    const xAt = (i) => (cssW * i) / (data.length - 1);
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

  function dayLabels(traffic) {
    return traffic.map((r) => new Date(r.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
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

  function renderDashboard() {
    const ps = state.projects;
    const grid = $("#statGrid");
    const totals = ps.map((p) => lastN(p.traffic, globalDays));

    const allVisitors = totals.reduce((a, t) => a + sum(t, "visitors"), 0);
    const allViews = totals.reduce((a, t) => a + sum(t, "views"), 0);
    // combined daily visitors for delta + chart
    const combined = combineDaily(ps, globalDays);
    const vDelta = deltaPct(combined, "visitors");

    let top = null, topV = -1;
    ps.forEach((p) => { const v = sum(lastN(p.traffic, globalDays), "visitors"); if (v > topV) { topV = v; top = p; } });

    grid.innerHTML =
      statCard("Total visitors", fmt(allVisitors), vDelta) +
      statCard("Total pageviews", fmt(allViews), deltaPct(combined, "views")) +
      statCard("Active sites", String(ps.length)) +
      statCard("Top site", top ? top.name : "—");

    $("#trendChip").innerHTML = ps.length ? deltaHtml(vDelta).replace(/<\/?div[^>]*>/g, "") : "";
    $("#projectCount").textContent = ps.length ? `${ps.length} site${ps.length > 1 ? "s" : ""}` : "";

    // chart
    if (combined.length) {
      drawLineChart($("#overviewChart"), [
        { data: combined.map((r) => r.visitors), color: C.visitors, fill: true },
      ], { labels: dayLabels(combined) });
    }

    // project cards
    const pg = $("#projectGrid");
    pg.innerHTML = "";
    ps.forEach((p) => pg.appendChild(projectCard(p)));
    $("#emptyState").hidden = ps.length !== 0;
    $(".chart-panel").style.display = ps.length ? "" : "none";
    $(".section-head").style.display = ps.length ? "" : "none";
    $("#statGrid").style.display = ps.length ? "" : "none";

    // render sparks after attach (need layout width)
    requestAnimationFrame(() => {
      ps.forEach((p) => {
        const c = document.getElementById("spark-" + p.id);
        if (c) drawSpark(c, lastN(p.traffic, globalDays).map((r) => r.visitors), p.color);
      });
    });
  }

  function combineDaily(projects, days) {
    if (!projects.length) return [];
    const len = Math.min(days, Math.max(...projects.map((p) => p.traffic.length)));
    const out = [];
    for (let i = 0; i < len; i++) {
      let date = null, visitors = 0, views = 0;
      projects.forEach((p) => {
        const slice = lastN(p.traffic, len);
        const row = slice[i];
        if (row) { date = row.date; visitors += row.visitors; views += row.views; }
      });
      out.push({ date: date || Date.now(), visitors, views });
    }
    return out;
  }

  function projectCard(p) {
    const slice = lastN(p.traffic, globalDays);
    const visitors = sum(slice, "visitors");
    const views = sum(slice, "views");
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
        <span class="badge">${globalDays}d</span>
      </div>`;
    card.addEventListener("click", () => openDetail(p.id));
    return card;
  }

  /* ---------------------------- Detail ----------------------------- */
  function openDetail(id) {
    currentId = id; detailDays = globalDays;
    syncRange("#detailRange", detailDays);
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
    const p = state.projects.find((x) => x.id === currentId);
    if (!p) return closeDetail();
    $("#detailDot").style.background = p.color;
    $("#detailDot").style.color = p.color;
    $("#detailName").textContent = p.name;
    const dom = $("#detailDomain");
    dom.textContent = p.domain;
    dom.href = /^https?:\/\//.test(p.domain) ? p.domain : "https://" + p.domain;

    const slice = lastN(p.traffic, detailDays);
    const visitors = sum(slice, "visitors");
    const views = sum(slice, "views");
    const perDay = Math.round(visitors / Math.max(1, slice.length));
    const bounce = 38 + Math.round((p.id.charCodeAt(0) % 20));
    $("#detailStats").innerHTML =
      statCard("Visitors", fmt(visitors), deltaPct(slice, "visitors")) +
      statCard("Pageviews", fmt(views), deltaPct(slice, "views")) +
      statCard("Avg / day", fmt(perDay)) +
      statCard("Bounce rate", bounce + "%");

    drawLineChart($("#detailChart"), [
      { data: slice.map((r) => r.views), color: C.views, fill: true },
      { data: slice.map((r) => r.visitors), color: C.visitors, fill: true },
    ], { labels: dayLabels(slice) });

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
    const p = state.projects.find((x) => x.id === currentId);
    if (!p) return;
    const patch = {
      public: $("#profPublic").checked,
      url: $("#profUrl").value.trim(),
      tags: $("#profTags").value.trim(),
      description: $("#profDesc").value.trim(),
    };
    try {
      if (REMOTE) await api("/api/sites/" + p.id, { method: "PATCH", body: JSON.stringify(patch) });
      Object.assign(p, patch);
      save(); renderProfile(p); toast("Public profile saved");
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
      li.querySelector(".note-del").addEventListener("click", async () => {
        try {
          if (REMOTE) await api("/api/notes/" + note.id, { method: "DELETE" });
          p.notes = p.notes.filter((x) => x.id !== note.id);
          save(); renderNotes(p); toast("Note deleted");
        } catch (err) { toast("Could not delete note"); }
      });
      list.appendChild(li);
    });
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
        await reloadOverview();
        renderDashboard();
        toast(`Added ${name}`);
      } catch (err) { toast(err.status === 401 ? "Session expired — please unlock" : "Could not add site"); if (err.status === 401) logout(); }
      return;
    }
    const p = {
      id: uid(), name, domain, url: "https://" + domain, description: "", tags: "", public: false,
      color: data.color, created: Date.now(), notes: [],
      traffic: data.seed ? genTraffic(120, 80 + Math.floor(Math.random() * 200), Math.random() - 0.4) : [{ date: startOfDay(Date.now()), visitors: 0, views: 0 }],
      topPages: data.seed ? genTopPages(120) : [],
    };
    state.projects.push(p); save(); renderDashboard();
    toast(`Added ${p.name}`);
  }
  async function deleteProject(id) {
    const p = state.projects.find((x) => x.id === id);
    if (!p) return;
    if (!confirm(`Delete "${p.name}" and all its notes? This cannot be undone.`)) return;
    if (REMOTE) {
      try {
        await api("/api/sites/" + id, { method: "DELETE" });
        await reloadOverview();
      } catch (err) { return toast(err.status === 401 ? "Session expired — please unlock" : "Could not delete site"); }
    } else {
      state.projects = state.projects.filter((x) => x.id !== id);
      save();
    }
    closeDetail(); toast("Site deleted");
  }

  /* ---------------------------- Snippet ---------------------------- */
  function snippetFor(p) {
    // In live (Worker) mode this is your real dashboard origin; in local demo
    // mode it shows the production domain you'll deploy to.
    const base = REMOTE ? location.origin : "https://borealissoftwares.com";
    return `<!-- Borealis Softwares analytics — ${p.name} -->
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
  function syncRange(sel, days) {
    document.querySelectorAll(sel + " button").forEach((b) => b.classList.toggle("active", +b.dataset.days === days));
  }

  /* ------------------------------ Wire ----------------------------- */
  function openModal() { $("#modalBackdrop").hidden = false; $("#pName").focus(); }
  function closeModal() { $("#modalBackdrop").hidden = true; $("#projectForm").reset(); }

  function init() {
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

    $("#noteForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#noteInput").value.trim();
      if (!text) return;
      const p = state.projects.find((x) => x.id === currentId);
      try {
        let note;
        if (REMOTE) {
          const res = await api("/api/sites/" + p.id + "/notes", { method: "POST", body: JSON.stringify({ text }) });
          note = res.note;
        } else {
          note = { id: uid(), text, ts: Date.now() };
        }
        p.notes.push(note);
        save(); $("#noteInput").value = ""; renderNotes(p); toast("Note added");
      } catch (err) { toast(err.status === 401 ? "Session expired — please unlock" : "Could not add note"); if (err.status === 401) logout(); }
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
    $("#globalRange").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      globalDays = +b.dataset.days; syncRange("#globalRange", globalDays); renderDashboard();
    });
    $("#detailRange").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      detailDays = +b.dataset.days; syncRange("#detailRange", detailDays); renderDetail();
    });

    // snippet
    $("#snippetBtn").addEventListener("click", () => {
      const p = state.projects.find((x) => x.id === currentId);
      $("#snippetCode").textContent = snippetFor(p);
      $("#snippetBackdrop").hidden = false;
    });
    $("#closeSnippet").addEventListener("click", () => { $("#snippetBackdrop").hidden = true; });
    $("#snippetBackdrop").addEventListener("click", (e) => { if (e.target.id === "snippetBackdrop") e.currentTarget.hidden = true; });
    $("#copySnippet").addEventListener("click", () => {
      navigator.clipboard.writeText($("#snippetCode").textContent).then(() => toast("Snippet copied"));
    });

    // export / import
    $("#exportBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `borealis-traffic-${new Date().toISOString().slice(0, 10)}.json`;
      a.click(); URL.revokeObjectURL(a.href); toast("Data exported");
    });
    $("#importBtn").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data.projects) throw new Error("bad");
          state = data; save(); closeDetail(); renderDashboard(); toast("Data imported");
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
