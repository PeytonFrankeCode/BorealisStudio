/* Borealis Studios — traffic tracker Worker (Cloudflare Workers + D1)
 *
 * Routes:
 *   GET    /collect?site=ID&path=/page   -> records a pageview, returns 1x1 gif
 *   GET    /api/overview?days=90         -> all sites with traffic, top pages, notes
 *   POST   /api/sites                    -> create a site
 *   DELETE /api/sites/:id                -> delete a site (and its data)
 *   POST   /api/sites/:id/notes          -> add a note
 *   DELETE /api/notes/:id                -> delete a note
 *   GET    /api/health                   -> { ok: true }
 * Everything else falls through to the static assets in /public.
 */

const DAY_MS = 86400000;

// 1x1 transparent GIF
const PIXEL = Uint8Array.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0, 0, 0,
  0x21, 0xf9, 4, 1, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0, 0x3b,
]);

let schemaReady = false;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // Only handle API + collect here; other paths are served as static assets.
    if (pathname !== "/collect" && !pathname.startsWith("/api/")) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("Not found", { status: 404 });
    }

    try {
      await ensureSchema(env);

      if (pathname === "/collect") return collect(request, env, url, cors);
      if (pathname === "/api/health") return json({ ok: true }, cors);
      if (pathname === "/api/overview") return overview(env, url, cors);

      if (pathname === "/api/sites" && request.method === "POST") return createSite(request, env, cors);

      let m;
      if ((m = pathname.match(/^\/api\/sites\/([^/]+)\/notes$/)) && request.method === "POST")
        return createNote(m[1], request, env, cors);
      if ((m = pathname.match(/^\/api\/sites\/([^/]+)$/)) && request.method === "DELETE")
        return deleteSite(m[1], env, cors);
      if ((m = pathname.match(/^\/api\/notes\/([^/]+)$/)) && request.method === "DELETE")
        return deleteNote(m[1], env, cors);

      return json({ error: "not found" }, cors, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, cors, 500);
    }
  },
};

/* ----------------------------- Handlers ----------------------------- */

async function collect(request, env, url, cors) {
  const site = url.searchParams.get("site");
  if (site) {
    const exists = await env.DB.prepare("SELECT 1 FROM sites WHERE id = ?").bind(site).first();
    if (exists) {
      const path = clip(url.searchParams.get("path") || "/", 512);
      const ip = request.headers.get("cf-connecting-ip") || "0";
      const ua = request.headers.get("user-agent") || "";
      const day = new Date().toISOString().slice(0, 10);
      const visitor = await sha256(`${site}|${day}|${ip}|${ua}`);
      await env.DB.prepare(
        "INSERT INTO events (site_id, day, path, visitor, ts) VALUES (?,?,?,?,?)"
      ).bind(site, day, path, visitor, Date.now()).run();
    }
  }
  return new Response(PIXEL, {
    headers: {
      ...cors,
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      "Pragma": "no-cache",
    },
  });
}

async function overview(env, url, cors) {
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get("days") || "90", 10)));
  const since = new Date(Date.now() - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  const sites = (await env.DB.prepare(
    "SELECT id, name, domain, color, created FROM sites ORDER BY created"
  ).all()).results || [];

  const projects = [];
  for (const s of sites) {
    const ev = (await env.DB.prepare(
      "SELECT day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors " +
      "FROM events WHERE site_id = ? AND day >= ? GROUP BY day"
    ).bind(s.id, since).all()).results || [];
    const byDay = {};
    ev.forEach((r) => { byDay[r.day] = r; });

    const tp = (await env.DB.prepare(
      "SELECT path, COUNT(*) AS hits FROM events WHERE site_id = ? AND day >= ? " +
      "GROUP BY path ORDER BY hits DESC LIMIT 10"
    ).bind(s.id, since).all()).results || [];

    const notes = (await env.DB.prepare(
      "SELECT id, text, ts FROM notes WHERE site_id = ? ORDER BY ts DESC"
    ).bind(s.id).all()).results || [];

    projects.push({
      id: s.id, name: s.name, domain: s.domain, color: s.color, created: s.created,
      traffic: fillDays(days, byDay),
      topPages: tp.map((r) => ({ path: r.path, hits: r.hits })),
      notes: notes.map((n) => ({ id: n.id, text: n.text, ts: n.ts })),
    });
  }
  return json({ projects }, cors);
}

async function createSite(request, env, cors) {
  const body = await readJson(request);
  const name = clip((body.name || "").trim(), 120);
  const domain = clip((body.domain || "").trim().replace(/^https?:\/\//, ""), 200);
  if (!name || !domain) return json({ error: "name and domain are required" }, cors, 400);
  const color = /^#[0-9a-fA-F]{6}$/.test(body.color || "") ? body.color : "#2bd4a8";
  const id = crypto.randomUUID().slice(0, 8);
  const created = Date.now();
  await env.DB.prepare(
    "INSERT INTO sites (id, name, domain, color, created) VALUES (?,?,?,?,?)"
  ).bind(id, name, domain, color, created).run();
  return json({ project: { id, name, domain, color, created } }, cors, 201);
}

async function deleteSite(id, env, cors) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM events WHERE site_id = ?").bind(id),
    env.DB.prepare("DELETE FROM notes WHERE site_id = ?").bind(id),
    env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id),
  ]);
  return json({ ok: true }, cors);
}

async function createNote(siteId, request, env, cors) {
  const body = await readJson(request);
  const text = clip((body.text || "").trim(), 4000);
  if (!text) return json({ error: "text is required" }, cors, 400);
  const id = crypto.randomUUID().slice(0, 8);
  const ts = Date.now();
  await env.DB.prepare(
    "INSERT INTO notes (id, site_id, text, ts) VALUES (?,?,?,?)"
  ).bind(id, siteId, text, ts).run();
  return json({ note: { id, text, ts } }, cors, 201);
}

async function deleteNote(id, env, cors) {
  await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
  return json({ ok: true }, cors);
}

/* ------------------------------ Helpers ----------------------------- */

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, " +
      "domain TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#2bd4a8', created INTEGER NOT NULL)"
    ),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, " +
      "site_id TEXT NOT NULL, day TEXT NOT NULL, path TEXT NOT NULL DEFAULT '/', " +
      "visitor TEXT NOT NULL, ts INTEGER NOT NULL)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_events_site_day ON events (site_id, day)"),
    env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, site_id TEXT NOT NULL, " +
      "text TEXT NOT NULL, ts INTEGER NOT NULL)"
    ),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_notes_site ON notes (site_id)"),
  ]);
  schemaReady = true;
}

function fillDays(days, byDay) {
  const out = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY_MS);
    const r = byDay[d.toISOString().slice(0, 10)];
    out.push({ date: d.getTime(), visitors: r ? r.visitors : 0, views: r ? r.views : 0 });
  }
  return out;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

async function readJson(request) {
  try { return await request.json(); } catch (e) { return {}; }
}

function clip(s, n) { return String(s).slice(0, n); }

function json(obj, cors, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
