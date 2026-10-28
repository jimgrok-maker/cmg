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
  const { ctx, store } = load();
  const saved = { savedAt: Date.now() - 5 * 3600000, field: [{ lat: 41.5, lon: -82.7, fetchedAt: Date.now() - 5 * 3600000, hourly: { time: [], tws: [], twd: [], gust: [], code: [] } }] };
  store["cmg.wind.field"] = JSON.stringify(saved);
  const out = await ctx.CMGWind.fetchMany([{ lat: 41.5, lon: -82.7 }, { lat: 41.6, lon: -82.8 }], "hrrr", tz);
  assert.equal(out.length, 0);
  assert.equal(JSON.parse(store["cmg.wind.field"]).savedAt, saved.savedAt);
  assert.equal(ctx.CMGWind.loadField().field.length, 1);
});
