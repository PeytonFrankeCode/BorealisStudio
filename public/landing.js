/* Borealis Softwares — public landing logic
 * Fetches the public projects feed from the Worker. When opened as a static
 * file (no backend), it shows a small sample so the page still looks complete.
 */
(function () {
  "use strict";

  var SAMPLE = [
    { name: "Borealis Softwares", url: "https://borealissoftwares.com", domain: "borealissoftwares.com",
      description: "Studio site and home base for everything we build.", tags: ["Brand", "Web"], color: "#34c8a3" },
    { name: "Aurora Portfolio", url: "https://aurora.design", domain: "aurora.design",
      description: "A clean portfolio template for creative freelancers.", tags: ["Next.js", "Design"], color: "#2f8fd0" },
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function card(p) {
    var url = p.url || ("https://" + p.domain);
    var label = (p.domain || url).replace(/^https?:\/\//, "").replace(/\/$/, "");
    var tags = (p.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");
    return '' +
      '<article class="work-card">' +
        '<span class="accent-line" style="background:' + esc(p.color || "#34c8a3") + '"></span>' +
        "<h3>" + esc(p.name) + "</h3>" +
        '<p class="desc">' + esc(p.description || "") + "</p>" +
        '<div class="tags">' + tags + "</div>" +
        '<a class="visit" href="' + esc(url) + '" target="_blank" rel="noopener">Visit ' + esc(label) + " ↗</a>" +
      "</article>";
  }

  function render(projects) {
    var grid = document.getElementById("workGrid");
    var empty = document.getElementById("workEmpty");
    var loading = document.getElementById("workLoading");
    if (loading) loading.remove();
    if (!projects || !projects.length) {
      grid.innerHTML = "";
      empty.hidden = false;
      return;
    }
    grid.innerHTML = projects.map(card).join("");
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
