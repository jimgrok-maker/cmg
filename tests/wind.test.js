"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");
const tz = "America/New_York";
const pack = (time, tws, twd) => ({ tz, fetchedAt: Date.now(), hourly: { time, tws, twd, gust: time.map(() => null), code: time.map(() => 0) } });

test("loadCache returns the stored pack (was double-parsed -> always null)", () => {
  const { ctx, store } = load();
  const p = pack(["2026-07-04T12:00"], [8], [200]);
  store["cmg.wind.cache"] = JSON.stringify(p);
  const got = ctx.CMGWind.loadCache();
  assert.ok(got && got.hourly.tws[0] === 8);
});

test("forecast local times convert correctly across DST", () => {
  const { ctx } = load();
  const W = ctx.CMGWind;
  const at = (times, iso) => { const r = W.atTime(pack(times, times.map(() => 5), times.map(() => 0)), Date.parse(iso)); return r && r.time; };
  assert.equal(at(["2026-07-04T11:00", "2026-07-04T12:00", "2026-07-04T13:00"], "2026-07-04T16:00Z"), "2026-07-04T12:00");
  assert.equal(at(["2026-01-15T11:00", "2026-01-15T12:00", "2026-01-15T13:00"], "2026-01-15T17:00Z"), "2026-01-15T12:00");
  assert.equal(at(["2026-03-08T01:00", "2026-03-08T03:00", "2026-03-08T04:00"], "2026-03-08T07:00Z"), "2026-03-08T03:00");
});

test("null hours are skipped; out-of-range departures return no wind", () => {
  const { ctx } = load();
  const W = ctx.CMGWind;
  const p = pack(["2026-07-04T12:00", "2026-07-04T13:00"], [null, 7], [null, 180]);
  const r = W.atTime(p, Date.parse("2026-07-04T16:05Z"));
  assert.equal(r.tws, 7);
  assert.equal(r.time, "2026-07-04T13:00");
  assert.equal(W.atTime(p, Date.parse("2026-07-09T16:00Z")), null, "5 days past the last hour");
  assert.equal(W.outOfRange(p, Date.parse("2026-07-09T16:00Z")), true);
  assert.equal(W.hasData(pack(["2026-07-04T12:00"], [null], [null])), false);
});

test("ECMWF uses the live ecmwf_ifs025 model", () => {
  const { ctx } = load();
  assert.equal(ctx.CMGWind.modelParam("ecmwf"), "ecmwf_ifs025");
});

test("an all-null forecast is a failure and is not cached", async () => {
  const fetch = async () => ({ ok: true, json: async () => ({ latitude: 41.6, longitude: -82.8, hourly: { time: ["2026-07-04T12:00"], wind_speed_10m: [null], wind_direction_10m: [null], wind_gusts_10m: [null], weather_code: [null] } }) });
  const { ctx, store } = load({ fetch });
  await assert.rejects(ctx.CMGWind.fetchForecast(41.6, -82.8, "ecmwf", tz));
  assert.equal(store["cmg.wind.cache"], undefined);
  const field = await ctx.CMGWind.fetchMany([{ lat: 41.5, lon: -82.7 }, { lat: 41.6, lon: -82.8 }], "ecmwf", tz);
  assert.equal(field.length, 0);
});

test("fetchMany back-fills points the batch call missed", async () => {
  const mk = (a, b) => ({ latitude: +a, longitude: +b, hourly: { time: ["2026-07-04T12:00"], wind_speed_10m: [+a], wind_direction_10m: [0], wind_gusts_10m: [0], weather_code: [0] } });
  const fetch = async (url) => {
    const u = new URL(url); const la = u.searchParams.get("latitude").split(","), lo = u.searchParams.get("longitude").split(",");
    const list = la.map((a, i) => mk(a, lo[i]));
    return { ok: true, json: async () => (la.length > 1 ? list.slice(0, 2) : list[0]) };
  };
  const { ctx } = load({ fetch });
  const f = await ctx.CMGWind.fetchMany([{ lat: 41.5, lon: -82.7 }, { lat: 41.6, lon: -82.8 }, { lat: 41.7, lon: -82.9 }], "hrrr", tz);
  assert.equal(f.map((p) => p.lat).join(","), "41.5,41.6,41.7");
});

test("fieldNeedsRefresh: old or unknown-age route fields are rebuilt, fresh ones are not", () => {
  const { ctx } = load();
  const W = ctx.CMGWind, now = Date.now(), H = 3600000;
  const cell = (ageH) => ({ lat: 41.5, lon: -82.7, fetchedAt: now - ageH * H });
  assert.equal(W.fieldNeedsRefresh([cell(0.2), cell(0.3)], 0.9, now), false);
  assert.equal(W.fieldNeedsRefresh([cell(0.2), cell(2)], 0.9, now), true, "oldest cell decides");
  assert.equal(W.fieldNeedsRefresh([{ lat: 1, lon: 2 }], 0.9, now), true, "unknown age");
  assert.equal(W.fieldNeedsRefresh(null, 0.9, now), false, "no field: compute builds one");
  assert.ok(Math.abs(W.fieldAgeHours([cell(3), cell(1)], now) - 3) < 1e-9);
});

test("a failed fetchMany returns nothing and leaves the saved field untouched", async () => {
  let calls = 0;
  const fetch = async () => { calls++; throw new Error("offline"); };
  const { ctx, store } = load({ fetch });
  const saved = { savedAt: Date.now() - 5 * 3600000, field: [{ lat: 41.5, lon: -82.7, fetchedAt: Date.now() - 5 * 3600000, hourly: { time: [], tws: [], twd: [], gust: [], code: [] } }] };
  store["cmg.wind.field"] = JSON.stringify(saved);
  const pts = Array.from({ length: 12 }, (_, i) => ({ lat: 41.5 + i * 0.02, lon: -82.7 }));
  const out = await ctx.CMGWind.fetchMany(pts, "hrrr", tz, "erie");
  assert.equal(out.length, 0);
  assert.equal(calls, 1, "batch failure skips the 12 sequential retries");
  assert.equal(JSON.parse(store["cmg.wind.field"]).savedAt, saved.savedAt);
  assert.equal(ctx.CMGWind.loadField().field.length, 1);
});

test("fetchMany back-fill does not overwrite cmg.wind.cache and tags source + lakeId", async () => {
  const mk = (a, b) => ({ latitude: +a, longitude: +b, hourly: { time: ["2026-07-04T12:00"], wind_speed_10m: [11], wind_direction_10m: [220], wind_gusts_10m: [14], weather_code: [0] } });
  let sawSignal = false;
  const fetch = async (url, init) => {
    if (init && init.signal) sawSignal = true;
    const u = new URL(url); const la = u.searchParams.get("latitude").split(","), lo = u.searchParams.get("longitude").split(",");
    const list = la.map((a, i) => mk(a, lo[i]));
    return { ok: true, json: async () => (la.length > 1 ? list.slice(0, 1) : list[0]) };
  };
  const { ctx, store } = load({ fetch });
  const origCenter = { fetchedAt: Date.now(), source: "hrrr", lakeId: "erie", lat: 41.66, lon: -82.82, tz, hourly: { time: ["2026-07-04T12:00"], tws: [7], twd: [180], gust: [null], code: [0] } };
  store["cmg.wind.cache"] = JSON.stringify(origCenter);
  const field = await ctx.CMGWind.fetchMany([{ lat: 41.5, lon: -82.7 }, { lat: 41.6, lon: -82.8 }], "gfs", tz, "erie");
  assert.equal(field.length, 2);
  assert.equal(sawSignal, true, "AbortController signal passed to fetch");
  assert.equal(JSON.parse(store["cmg.wind.cache"]).hourly.tws[0], 7, "center cache untouched by back-fill");
  const saved = ctx.CMGWind.loadField();
  assert.equal(saved.source, "gfs");
  assert.equal(saved.lakeId, "erie");
  assert.equal(saved.field[0].lakeId, "erie");
  assert.equal(saved.field[1].lakeId, "erie");
});

test("packMatches and nearestPack enforce source, lakeId, and max distance", () => {
  const { ctx } = load();
  const W = ctx.CMGWind;
  const erieCell = { source: "hrrr", lakeId: "erie", lat: 41.66, lon: -82.82, tz, hourly: { time: ["2026-07-04T12:00"], tws: [10], twd: [270], gust: [null], code: [0] } };
  assert.equal(W.packMatches(erieCell, { source: "hrrr", lakeId: "erie", lat: 41.6, lon: -82.8 }), true);
  assert.equal(W.packMatches(erieCell, { source: "gfs", lakeId: "erie", lat: 41.6, lon: -82.8 }), false, "wrong source");
  assert.equal(W.packMatches(erieCell, { source: "hrrr", lakeId: "huron", lat: 41.6, lon: -82.8 }), false, "wrong lakeId");
  // Lake Superior is > 300 nm away from Lake Erie
  assert.equal(W.packMatches(erieCell, { source: "hrrr", lat: 47.7, lon: -87.5 }), false, "too far");
  assert.equal(W.nearestPack([erieCell], 47.7, -87.5), null, "nearestPack rejects packs beyond max distance");
  assert.equal(W.nearestPack([erieCell], 41.6, -82.8, { source: "gfs", lakeId: "erie" }), null, "nearestPack rejects wrong source");
  assert.equal(W.nearestPack([erieCell], 41.6, -82.8, { source: "hrrr", lakeId: "huron" }), null, "nearestPack rejects wrong lakeId");
  assert.ok(W.nearestPack([erieCell], 41.6, -82.8, { source: "hrrr", lakeId: "erie" }), "matching pack accepted");
});

test("atTime caches Intl.DateTimeFormat and parsed timestamps", () => {
  const { ctx } = load();
  const W = ctx.CMGWind;
  const OrigDTF = Intl.DateTimeFormat;
  let constructed = 0;
  Intl.DateTimeFormat = function (...args) { constructed++; return new OrigDTF(...args); };
  try {
    const times = Array.from({ length: 48 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 4 + Math.floor(i / 24), i % 24));
      return d.toISOString().slice(0, 16);
    });
    const p = { tz: "America/Chicago", fetchedAt: Date.now(), hourly: { time: times, tws: times.map(() => 10), twd: times.map(() => 180), gust: times.map(() => null), code: times.map(() => 0) } };
    const t0 = Date.parse("2026-07-04T17:00Z");
    const r1 = W.atTime(p, t0);
    const r2 = W.atTime(p, t0 + 3600000);
    const r3 = W.atTime(p, t0 + 7200000);
    assert.ok(r1 && r2 && r3);
    assert.ok(constructed <= 1, "Intl.DateTimeFormat cached per tz, got " + constructed);
  } finally {
    Intl.DateTimeFormat = OrigDTF;
  }
});
