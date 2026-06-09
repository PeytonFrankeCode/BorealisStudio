/* Borealis Softwares — front-end config
 * ---------------------------------------------------------------------------
 * This is the ONE place you connect the GitHub Pages site to your real data.
 *
 * apiBase:  the URL of your deployed Cloudflare Worker (NO trailing slash).
 *   - Leave it "" when the whole app is served from Cloudflare itself
 *     (same-origin — the default for borealissoftwares.com).
 *   - Set it to your Worker URL when the site is hosted on GitHub Pages so the
 *     dashboard and public project feed read your live D1 data, e.g.:
 *
 *       window.BOREALIS_CONFIG = {
 *         apiBase: "https://borealis-softwares.YOURNAME.workers.dev"
 *       };
 *
 * The dashboard passcode is NOT stored here — it lives as the ADMIN_TOKEN
 * secret on Cloudflare and is typed at the login screen.
 */
window.BOREALIS_CONFIG = {
  apiBase: ""
};
