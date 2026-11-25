"use strict";
// Full-page tests (index.html + Leaflet + all scripts) in jsdom. jsdom is not a
// dependency of the repo: run `npm i jsdom` somewhere on NODE_PATH to enable;
// the file skips itself otherwise.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { WWW } = require("./load");

let jsdom = null;
try { jsdom = require("jsdom"); } catch (e) { /* optional */ }
const skip = jsdom ? false : "jsdom not installed";

function forecastHours(n, tws, twd) {
  const t = [], now = new Date(), p = (v) => String(v).padStart(2, "0");
  for (let i = -2; i < n; i++) {
    const x = new Date(now.getTime() + i * 3600e3);
    const l = new Date(x.toLocaleString("en-US", { timeZone: "America/New_York" }));
    t.push(`${l.getFullYear()}-${p(l.getMonth() + 1)}-${p(l.getDate())}T${p(l.getHours())}:00`);
  }
  return { time: t, wind_speed_10m: t.map(() => tws), wind_direction_10m: t.map(() => twd), wind_gusts_10m: t.map(() => tws), weather_code: t.map(() => 0) };
}
function cell(lat, lon, ageH, source, lakeId) {
  const h = forecastHours(30, 10, 200);
  const c = { fetchedAt: Date.now() - ageH * 3600e3, source: source || "hrrr", lat, lon, tz: "America/New_York", hourly: { time: h.time, tws: h.wind_speed_10m, twd: h.wind_direction_10m, gust: h.wind_gusts_10m, code: h.weather_code } };
  if (lakeId) c.lakeId = lakeId;
  return c;
}
async function boot(prefs, fetchImpl, beforeExtra) {
  const errs = [];
  const vc = new jsdom.VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(e.message));
  let html = fs.readFileSync(path.join(WWW, "index.html"), "utf8");
  const opts = {
    runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    url: "https://appassets.androidplatform.net/assets/www/index.html",
    beforeParse(w) {
      w.SVGSVGElement.prototype.createSVGRect = () => ({});
      w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
      for (const [k, v] of Object.entries(prefs || {})) w.localStorage.setItem(k, v);
      w.fetch = fetchImpl;
      if (beforeExtra) beforeExtra(w);
    }
  };
  if (typeof jsdom.ResourceLoader === "function") {
    class RL extends jsdom.ResourceLoader {
      fetch(url) {
        const m = url.match(/assets\/www\/(.*)$/);
        return Promise.resolve(m ? fs.readFileSync(path.join(WWW, m[1])) : Buffer.from(""));
      }
    }
    opts.resources = new RL();
  } else {
    html = html.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, "");
    html = html.replace(/<script\s+src="([^"]+)"><\/script>/g, (_, src) => {
      const code = fs.readFileSync(path.join(WWW, src), "utf8").replace(/<\/script>/gi, "<\\/script>");
      return `<script>${code}</script>`;
    });
  }
  const dom = new jsdom.JSDOM(html, opts);
  if (dom.window.document.readyState !== "complete") {
    await new Promise((r) => dom.window.addEventListener("load", r));
  }
  return { dom, errs, doc: dom.window.document };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const WPS = [{ lat: 41.4980, lon: -82.6782, name: "Sandusky" }, { lat: 41.5920, lon: -82.7087, name: "Kelleys" }];
function prefs(fieldAgeH, withCache) {
  const p = { "cmg.v1": JSON.stringify({ windSource: "hrrr", waypoints: WPS }),
    "cmg.wind.field": JSON.stringify({ savedAt: Date.now() - fieldAgeH * 3600e3, field: [cell(41.5, -82.68, fieldAgeH), cell(41.59, -82.71, fieldAgeH)] }) };
  if (withCache) p["cmg.wind.cache"] = JSON.stringify(cell(41.66, -82.82, 6));
  return p;
}
function counting() {
  const st = { single: 0, multi: 0 };
  const fn = async (url) => {
    const u = new URL(url), la = u.searchParams.get("latitude").split(","), lo = u.searchParams.get("longitude").split(",");
    const one = (i) => ({ latitude: +la[i], longitude: +lo[i], hourly: forecastHours(30, 12, 0) });
    if (la.length > 1) st.multi++; else st.single++;
    return { ok: true, json: async () => (la.length > 1 ? la.map((_, i) => one(i)) : one(0)) };
  };
  return { st, fn };
}

test("on open, a route field older than the refresh interval is rebuilt", { skip }, async () => {
  const { st, fn } = counting();
  const { dom, errs, doc } = await boot(prefs(3, true), fn);
  doc.getElementById("openChart").click();
  await wait(900);
  assert.ok(st.multi >= 1, "route field was re-requested");
  const f = JSON.parse(dom.window.localStorage.getItem("cmg.wind.field"));
  assert.ok(Date.now() - f.savedAt < 60000, "new field saved");
  assert.ok(Date.now() - f.field[0].fetchedAt < 60000, "cells are fresh");
  assert.equal(f.source, "hrrr");
  assert.equal(f.lakeId, "erie");
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("a fresh route field is reused (no rebuild)", { skip }, async () => {
  const { st, fn } = counting();
  const { dom, doc } = await boot(prefs(0.1, true), fn);
  doc.getElementById("openChart").click();
  await wait(900);
  assert.equal(st.multi, 0);
  assert.ok(st.single >= 1, "centre forecast still refreshed");
  dom.window.close();
});

test("offline: the saved field is kept and its age / STALE shown", { skip }, async () => {
  const { dom, errs, doc } = await boot(prefs(3, true), async () => { throw new Error("offline"); });
  const before = dom.window.localStorage.getItem("cmg.wind.field");
  doc.getElementById("openChart").click();
  await wait(900);
  assert.equal(dom.window.localStorage.getItem("cmg.wind.field"), before, "saved field untouched");
  const label = doc.getElementById("windLabel").textContent;
  assert.match(label, /Offline/);
  assert.match(label, /STALE/);
  assert.match(label, /3\.\dh stale/);
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("manual mode ignores cached HRRR packs and updates windLabel on TWS/TWD edits", { skip }, async () => {
  const p = {
    "cmg.v1": JSON.stringify({ windSource: "manual", waypoints: WPS }),
    "cmg.wind.cache": JSON.stringify(cell(41.66, -82.82, 0.2, "hrrr", "erie")),
    "cmg.wind.field": JSON.stringify({ savedAt: Date.now(), source: "hrrr", lakeId: "erie", field: [cell(41.5, -82.68, 0.2, "hrrr", "erie")] })
  };
  let fetches = 0;
  const { dom, errs, doc } = await boot(p, async () => { fetches++; throw new Error("no fetch in manual"); });
  doc.getElementById("openChart").click();
  await wait(300);
  assert.equal(fetches, 0, "manual mode does not fetch");
  assert.match(doc.getElementById("windLabel").textContent, /^Manual 10 kn FROM 270°/);
  assert.equal(doc.getElementById("tws").value, "10");
  assert.equal(doc.getElementById("twd").value, "270");
  doc.getElementById("tws").value = "15";
  doc.getElementById("tws").dispatchEvent(new dom.window.Event("input"));
  doc.getElementById("twd").value = "90";
  doc.getElementById("twd").dispatchEvent(new dom.window.Event("input"));
  assert.match(doc.getElementById("windLabel").textContent, /^Manual 15 kn FROM 090°/);
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("cached wind does not leak across lakes or wind models when offline", { skip }, async () => {
  const erieCache = {
    "cmg.wind.cache": JSON.stringify(cell(41.66, -82.82, 0.2, "hrrr", "erie")),
    "cmg.wind.field": JSON.stringify({ savedAt: Date.now(), source: "hrrr", lakeId: "erie", field: [cell(41.5, -82.68, 0.2, "hrrr", "erie")] })
  };
  // Different wind model (gfs) on same lake -> must reject hrrr cache
  const { dom: d1, doc: doc1, errs: e1 } = await boot(Object.assign({ "cmg.v1": JSON.stringify({ lakeId: "erie", windSource: "gfs", waypoints: WPS }) }, erieCache), async () => { throw new Error("offline"); });
  doc1.getElementById("openChart").click();
  await wait(300);
  assert.match(doc1.getElementById("windLabel").textContent, /Wind fetch failed/);
  assert.deepEqual(e1, []);
  d1.window.close();

  // Different lake (huron) with same model (hrrr) -> must reject erie cache
  const { dom: d2, doc: doc2, errs: e2 } = await boot(Object.assign({ "cmg.v1": JSON.stringify({ lakeId: "huron", windSource: "hrrr", waypoints: [] }) }, erieCache), async () => { throw new Error("offline"); });
  doc2.getElementById("openChart").click();
  await wait(300);
  assert.match(doc2.getElementById("windLabel").textContent, /Wind fetch failed/);
  assert.deepEqual(e2, []);
  d2.window.close();
});

test("Setup changes before map init do not crash and save prefs; zoom/pan preserved on return", { skip }, async () => {
  const { fn } = counting();
  const { dom, errs, doc } = await boot({}, fn);
  // Change windSource, boat, genericLwl, and mag on Setup screen before map exists
  const ws = doc.getElementById("windSource");
  ws.value = "gfs"; ws.dispatchEvent(new dom.window.Event("change"));
  const boat = doc.getElementById("boat");
  boat.value = "generic"; boat.dispatchEvent(new dom.window.Event("change"));
  const lwl = doc.getElementById("genericLwl");
  lwl.value = "30"; lwl.dispatchEvent(new dom.window.Event("change"));
  const mag = doc.getElementById("mag");
  mag.checked = true; mag.dispatchEvent(new dom.window.Event("change"));
  const saved = JSON.parse(dom.window.localStorage.getItem("cmg.v1"));
  assert.equal(saved.windSource, "gfs");
  assert.equal(saved.boatId, "generic");
  assert.equal(saved.genericLwl, 30);
  assert.equal(saved.magnetic, true);

  // Open chart, pan/zoom, return to Setup, re-open chart -> view preserved
  doc.getElementById("openChart").click();
  await wait(300);
  assert.ok(dom.window.CMGMap, "window.CMGMap exposed without fence.js");
  dom.window.CMGMap.setView([41.75, -82.55], 11);
  doc.getElementById("editSetup").click();
  doc.getElementById("openChart").click();
  await wait(300);
  const c = dom.window.CMGMap.getCenter();
  assert.equal(dom.window.CMGMap.getZoom(), 11);
  assert.ok(Math.abs(c.lat - 41.75) < 0.01 && Math.abs(c.lng - (-82.55)) < 0.01);
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("depart change refreshes windLabel & TWS/TWD; clearWp and changeLake clear offset/warn/polarDelta", { skip }, async () => {
  const now = Date.now();
  const p2 = (v) => String(v).padStart(2, "0");
  const fmtNy = (ms) => {
    const l = new Date(new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York" }));
    return `${l.getFullYear()}-${p2(l.getMonth() + 1)}-${p2(l.getDate())}T${p2(l.getHours())}:00`;
  };
  const times = [];
  const twsArr = [];
  const twdArr = [];
  for (let i = -1; i <= 10; i++) {
    times.push(fmtNy(now + i * 3600e3));
    twsArr.push(i < 4 ? 10 : 18);
    twdArr.push(i < 4 ? 180 : 90);
  }
  const fetchImpl = async (url) => {
    const u = new URL(url), la = u.searchParams.get("latitude").split(","), lo = u.searchParams.get("longitude").split(",");
    const one = (i) => ({ latitude: +la[i], longitude: +lo[i], hourly: { time: times, wind_speed_10m: twsArr, wind_direction_10m: twdArr, wind_gusts_10m: twsArr, weather_code: times.map(() => 0) } });
    return { ok: true, json: async () => (la.length > 1 ? la.map((_, i) => one(i)) : one(0)) };
  };
  const { dom, errs, doc } = await boot({ "cmg.v1": JSON.stringify({ windSource: "hrrr", plan: "fast", motorKn: 6, waypoints: WPS }) }, fetchImpl);
  doc.getElementById("openChart").click();
  await wait(400);

  // Check updated stat labels and Fastest-mode motor warning (not hybrid!)
  const statsTxt = doc.getElementById("stats").textContent;
  assert.match(statsTxt, /nm total/);
  assert.match(statsTxt, /speed ≥ 2 kn/);
  assert.match(statsTxt, /speed ≥ 4 kn/);
  assert.match(statsTxt, /motor used/);
  assert.doesNotMatch(statsTxt, /VMG/);
  const warnTxt = doc.getElementById("routeWarn").textContent;
  assert.match(warnTxt, /Fastest plan/);
  assert.doesNotMatch(warnTxt, /hybrid compare/);

  // Turn on offset so offsetLine is populated
  const off = doc.getElementById("offset");
  off.checked = true; off.dispatchEvent(new dom.window.Event("change"));
  assert.match(doc.getElementById("offsetLine").textContent, /Rhumb/);

  // Shift departure +6h -> should sync to 18 kn FROM 090°
  const later = new Date(now + 6 * 3600e3);
  const dep = doc.getElementById("depart");
  dep.value = `${later.getFullYear()}-${p2(later.getMonth() + 1)}-${p2(later.getDate())}T${p2(later.getHours())}:${p2(later.getMinutes())}`;
  dep.dispatchEvent(new dom.window.Event("change"));
  assert.match(doc.getElementById("windLabel").textContent, /18 kn FROM 090° at leave/);
  assert.equal(doc.getElementById("tws").value, "18");

  // Click Use now -> reverts to ~10 kn FROM 180° now
  doc.getElementById("departNow").click();
  assert.match(doc.getElementById("windLabel").textContent, /10 kn FROM 180° now/);
  assert.equal(doc.getElementById("tws").value, "10");

  // Clear marks -> clears offsetLine, routeWarn, polarDelta, stats
  doc.getElementById("clearWp").click();
  assert.equal(doc.getElementById("offsetLine").textContent, "");
  assert.equal(doc.getElementById("routeWarn").textContent, "");
  assert.equal(doc.getElementById("routeWarn").classList.contains("hidden"), true);
  assert.equal(doc.getElementById("polarDelta").textContent, "");
  assert.equal(doc.getElementById("stats").textContent, "");
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("GPS track validates loaded points, saves past 4000-point cap, flushes on pagehide, and clears watch on permission denied", { skip }, async () => {
  // Seed 3999 valid points plus invalid entries (which must be filtered out)
  const seed = Array.from({ length: 3999 }, (_, i) => [41.5 + i * 0.0001, -82.7]);
  seed.push([null, -82.7], ["bad", -82.7], [95, -82.7], [41.6]);
  let onFixCb = null, onErrCb = null, clearedId = null, watchCalls = 0;
  const { dom, errs, doc } = await boot(
    { "cmg.track.v1": JSON.stringify(seed), "cmg.v1": JSON.stringify({ windSource: "manual", waypoints: WPS }) },
    async () => { throw new Error("offline"); },
    (w) => {
      Object.defineProperty(w.navigator, "geolocation", {
        configurable: true,
        value: {
          watchPosition(ok, err) { watchCalls++; onFixCb = ok; onErrCb = err; return 77; },
          clearWatch(id) { clearedId = id; }
        }
      });
    }
  );
  doc.getElementById("openChart").click();
  await wait(300);
  assert.equal(watchCalls, 1);

  // Send 9 moving fixes past the 4000 cap (spaced > 0.008 nm apart): should save at 8 unsaved, leaving 1 unsaved
  const t0 = Date.now();
  for (let i = 0; i < 9; i++) {
    onFixCb({ coords: { latitude: 42.0 + i * 0.01, longitude: -82.5, speed: 3 }, timestamp: t0 + i * 5000 });
  }
  const after8 = JSON.parse(dom.window.localStorage.getItem("cmg.track.v1"));
  assert.equal(after8.length, 4000, "capped at 4000");
  assert.ok(Math.abs(after8[after8.length - 1][0] - 42.07) < 1e-6, "saved after 8 new points at cap");

  // pagehide flushes the 9th point
  dom.window.dispatchEvent(new dom.window.Event("pagehide"));
  const afterFlush = JSON.parse(dom.window.localStorage.getItem("cmg.track.v1"));
  assert.ok(Math.abs(afterFlush[afterFlush.length - 1][0] - 42.08) < 1e-6, "pagehide flushed remaining point");

  // polarDelta was active while moving, clearTrack resets movingSince and clears polarDelta
  assert.match(doc.getElementById("polarDelta").textContent, /SOG vs polar/);
  doc.getElementById("clearTrack").click();
  assert.equal(doc.getElementById("polarDelta").textContent, "");

  // Permission denied (code 1) clears gpsWatch so a later openChart can retry
  onErrCb({ code: 1 });
  assert.equal(clearedId, 77);
  assert.equal(doc.getElementById("hudSog").textContent, "off");
  assert.deepEqual(errs, []);
  dom.window.close();
});

test("FAQ renders with the corrected sections and Setup text", { skip }, async () => {
  const { dom, doc } = await boot({}, async () => { throw new Error("offline"); });
  doc.getElementById("tabFaq").click();
  const faq = doc.getElementById("faqPane");
  assert.equal(faq.classList.contains("hidden"), false);
  const heads = [...faq.querySelectorAll("h3")].map((h) => h.textContent);
  for (const h of ["P50 / P90", "Tacking", "Calm wind", "Plans and motor", "Offset 8 nm", "Boats", "Magnetic courses", "Typing your own wind", "Marks and GPS track", "Data sources"]) assert.ok(heads.includes(h), h);
  for (const h of heads) assert.ok(faq.querySelector("h3 + p"), h);
  assert.equal(faq.querySelectorAll("h3").length, faq.querySelectorAll("p").length, "every heading has a paragraph");
  const text = faq.textContent;
  assert.match(text, /P50 × 1\.22/);
  assert.match(text, /© OpenStreetMap contributors/);
  assert.doesNotMatch(text, /Same yellow/);
  assert.doesNotMatch(text, /left out of the clock/);
  const setup = doc.getElementById("setupPane").textContent;
  assert.match(setup, /Sailing never motors/);
  assert.doesNotMatch(setup, /coarse shoreline/);
  dom.window.close();
});
