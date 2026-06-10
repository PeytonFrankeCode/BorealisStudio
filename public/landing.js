/* Borealis Software — public landing logic
 * Fetches the public projects feed from the Worker. When opened as a static
 * file (no backend), it shows a small sample so the page still looks complete.
 */
(function () {
  "use strict";

  // Projects that always appear on the landing page, ahead of the live feed.
  var FEATURED = [
    { name: "The Card Huddle", logo: "cardhuddle.png",
      url: "https://thecardhuddle.com", domain: "thecardhuddle.com",
      description: "Find. Collect. Track. A home for sports card collectors to browse cards and keep tabs on their collection.",
      tags: ["Sports cards", "Web app"], color: "#2e8b57" },
  ];

  var SAMPLE = [
    { name: "Borealis Software", url: "https://borealissoftwares.com", domain: "borealissoftwares.com",
      description: "Our home on the web — the portfolio you're looking at right now.", tags: ["Brand", "Web"], color: "#34c8a3" },
    { name: "Aurora Portfolio", url: "https://aurora.design", domain: "aurora.design",
      description: "A clean, simple portfolio site for creative work.", tags: ["Next.js", "Design"], color: "#2f8fd0" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function card(p) {
    var url = p.url || (p.domain ? "https://" + p.domain : "");
    var label = (p.domain || url).replace(/^https?:\/\//, "").replace(/\/$/, "");
    var tags = (p.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");
    var logo = p.logo ? '<img class="card-logo" src="' + esc(p.logo) + '" alt="' + esc(p.name) + ' logo" />' : "";
    var visit = url ? '<a class="visit" href="' + esc(url) + '" target="_blank" rel="noopener">Visit ' + esc(label) + " ↗</a>" : "";
    return '' +
      '<article class="work-card">' +
        '<span class="accent-line" style="background:' + esc(p.color || "#34c8a3") + '"></span>' +
        logo +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="desc">' + esc(p.description || "") + "</p>" +
        '<div class="tags">' + tags + "</div>" +
        visit +
      "</article>";
  }

  function render(projects) {
    var grid = document.getElementById("workGrid");
    var empty = document.getElementById("workEmpty");
    var loading = document.getElementById("workLoading");
    if (loading) loading.remove();
    var seen = {};
    FEATURED.forEach(function (p) { seen[p.name.toLowerCase()] = true; });
    var list = FEATURED.concat((projects || []).filter(function (p) {
      return !seen[String(p.name || "").toLowerCase()];
    }));
    if (!list.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    grid.innerHTML = list.map(card).join("");
  }

  var API_BASE = ((window.BOREALIS_CONFIG && window.BOREALIS_CONFIG.apiBase) || "").replace(/\/$/, "");

  async function load() {
    if (API_BASE || location.protocol === "http:" || location.protocol === "https:") {
      try {
        var r = await fetch(API_BASE + "/api/projects", { cache: "no-store" });
        if (r.ok) {
          var data = await r.json();
          render(data.projects || []);
          return;
        }
      } catch (e) { /* fall back to sample */ }
    }
    render(SAMPLE);
  }

  document.getElementById("year").textContent = new Date().getFullYear();
  load();
})();
