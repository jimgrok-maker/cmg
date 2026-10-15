// Loads the app's browser scripts into a sandbox with a fake window and
// localStorage, so the pure modules (geo, polars, wind, route, data) can be
// tested headless with `node --test`. No dependencies.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WWW = path.join(__dirname, "..", "app", "src", "main", "assets", "www");
const FILES = ["data/lakes.js", "data/islands.js", "js/pois.js", "js/geo.js", "js/polars.js", "js/wind.js", "js/route.js"];

function load(opts) {
  opts = opts || {};
  // Scripts run in this realm (vm.runInThisContext) rather than a separate
  // vm context: global lookups inside a contextified sandbox are ~15x slower.
  const store = {};
  const ctx = globalThis;
  ctx.window = ctx;
  ctx.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  ctx.fetch = opts.fetch || (async () => { throw new Error("no network in tests"); });
  for (const f of FILES) vm.runInThisContext(fs.readFileSync(path.join(WWW, f), "utf8"), { filename: f });
  const erie = ctx.CMGLakeById("erie");
  ctx.CMGGeo.setDocks(ctx.CMG_POIS.filter((p) => p.lake === "erie"));
  const poi = Object.fromEntries(ctx.CMG_POIS.map((p) => [p.id, p]));
  function route(wps, tws, twd, o) {
    o = o || {};
    return ctx.CMGRoute.buildRoute(wps, ctx.CMGPolars.CLASSES[o.boat || "cat22"], tws, twd,
      o.ring || erie.ring, o.islands || ctx.CMG_ISLANDS, !!o.hybrid, o.windAt || null, o.motor || 4, o.plan || "sail");
  }
  // Independent dense check: nm of a segment that is outside the lake or on an island.
  function dryNm(s, ring, islands) {
    const G = ctx.CMGGeo, d = s.dist, n = Math.max(20, Math.ceil(d * 200));
    let m = 0;
    for (let i = 0; i < n; i++) {
      const p = G.destPoint(s.from, s.course, d * (i + 0.5) / n);
      if (!G.pointInRing(p.lon, p.lat, ring || erie.ring) || G.islandAt(p, islands || ctx.CMG_ISLANDS)) m += d / n;
    }
    return m;
  }
  return { ctx, store, erie, poi, route, dryNm, WWW };
}
module.exports = { load, WWW };
