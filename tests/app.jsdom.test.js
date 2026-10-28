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
function cell(lat, lon, ageH) {
  const h = forecastHours(30, 10, 200);
  return { fetchedAt: Date.now() - ageH * 3600e3, source: "hrrr", lat, lon, tz: "America/New_York", hourly: { time: h.time, tws: h.wind_speed_10m, twd: h.wind_direction_10m, gust: h.wind_gusts_10m, code: h.weather_code } };
}
async function boot(prefs, fetchImpl) {
  const errs = [];
  const vc = new jsdom.VirtualConsole();
  vc.on("jsdomError", (e) => errs.push(e.message));
  class RL extends jsdom.ResourceLoader {
    fetch(url) {
      const m = url.match(/assets\/www\/(.*)$/);
      return Promise.resolve(m ? fs.readFileSync(path.join(WWW, m[1])) : Buffer.from(""));
    }
  }
  const dom = new jsdom.JSDOM(fs.readFileSync(path.join(WWW, "index.html"), "utf8"), {
    runScripts: "dangerously", resources: new RL(), pretendToBeVisual: true, virtualConsole: vc,
    url: "https://appassets.androidplatform.net/assets/www/index.html",
    beforeParse(w) {
      w.SVGSVGElement.prototype.createSVGRect = () => ({});
      w.SVGElement.prototype.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
      for (const [k, v] of Object.entries(prefs || {})) w.localStorage.setItem(k, v);
      w.fetch = fetchImpl;
    }
  });
  await new Promise((r) => dom.window.addEventListener("load", r));
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
