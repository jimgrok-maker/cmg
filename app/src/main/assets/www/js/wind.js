(function (w) {
  // Build stamp: shown in the wind label so a sideloaded APK can be told
  // apart from older ones without opening DevTools.
  const BUILD = "0.3.23"; // keep in sync with versionName in app/build.gradle.kts (checked by tests)
  const KEY = "cmg.wind.cache";
  const FIELD_KEY = "cmg.wind.field";
  const FETCH_TIMEOUT_MS = 12000;
  const MAX_PACK_DIST_NM = 200;
  function modelParam(source) {
    if (source === "hrrr") return "gfs_hrrr";
    if (source === "gfs") return "gfs_seamless";
    if (source === "ecmwf") return "ecmwf_ifs025";
    return "gfs_hrrr";
  }
  function packFrom(data, source, tz, lat, lon, lakeId) {
    const hourly = data.hourly || {};
    const lat0 = Array.isArray(data.latitude) ? data.latitude[0] : data.latitude;
    const lon0 = Array.isArray(data.longitude) ? data.longitude[0] : data.longitude;
    const pack = {
      fetchedAt: Date.now(), source: source,
      lat: lat0 != null ? lat0 : lat,
      lon: lon0 != null ? lon0 : lon,
      tz: tz || "America/New_York",
      hourly: {
        time: hourly.time || [],
        tws: hourly.wind_speed_10m || [],
        twd: hourly.wind_direction_10m || [],
        gust: hourly.wind_gusts_10m || [],
        code: hourly.weather_code || []
      }
    };
    if (lakeId) pack.lakeId = lakeId;
    return pack;
  }
  function buildUrl(lats, lons, source, tz) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lats);
    url.searchParams.set("longitude", lons);
    url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code");
    url.searchParams.set("wind_speed_unit", "kn");
    url.searchParams.set("timezone", tz || "America/New_York");
    url.searchParams.set("models", modelParam(source));
    return url.toString();
  }
  async function fetchWithTimeout(url, timeoutMs) {
    const ms = timeoutMs || FETCH_TIMEOUT_MS;
    if (typeof AbortController !== "function") return fetch(url);
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, ms);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }
  async function fetchSingle(lat, lon, source, tz, lakeId) {
    const res = await fetchWithTimeout(buildUrl(lat.toFixed(4), lon.toFixed(4), source, tz));
    if (!res.ok) throw new Error("Wind fetch failed " + res.status);
    const data = await res.json();
    const pack = packFrom(Array.isArray(data) ? data[0] : data, source, tz, lat, lon, lakeId);
    // A model that returns only nulls (e.g. a retired model id) is a failure,
    // not a forecast: don't overwrite a good cache with it.
    if (!hasData(pack)) throw new Error("Forecast has no wind data for " + source);
    return pack;
  }
  async function fetchForecast(lat, lon, source, tz, lakeId) {
    const pack = await fetchSingle(lat, lon, source, tz, lakeId);
    try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) {}
    return pack;
  }
  async function fetchMany(points, source, tz, lakeId) {
    const pts = (points || []).slice(0, 12);
    if (!pts.length) return [];
    // Index each returned pack by its requested position in a sparse slots
    // array, so the back-fill below can tell which waypoints the batch
    // actually covered even when the API returns fewer points than asked.
    const slots = new Array(pts.length).fill(null);
    let batchOk = false;
    try {
      const lats = pts.map(function (p) { return p.lat.toFixed(4); }).join(",");
      const lons = pts.map(function (p) { return p.lon.toFixed(4); }).join(",");
      const res = await fetchWithTimeout(buildUrl(lats, lons, source, tz));
      if (res.ok) {
        batchOk = true;
        const data = await res.json();
        const list = Array.isArray(data) ? data : [data];
        list.forEach(function (d, i) {
          if (i >= pts.length || d == null) return;
          // Open-Meteo echoes the requested coordinate on multi-point calls;
          // trust it over position when it is present and finite.
          let lat0 = d.latitude, lon0 = d.longitude;
          if (lat0 == null) lat0 = pts[i].lat;
          if (lon0 == null) lon0 = pts[i].lon;
          if (!isFinite(lat0) || !isFinite(lon0)) return;
          const pk = packFrom(d, source, tz, lat0, lon0, lakeId);
          if (!isFinite(pk.lat) || !isFinite(pk.lon) || !hasData(pk)) return;
          slots[i] = pk;
        });
      }
    } catch (e) {}
    // If the batch fetch itself failed (offline / timeout / HTTP error),
    // skip the up-to-12 sequential retries.
    if (!batchOk) return [];
    const have = slots.filter(Boolean);
    if (have.length >= pts.length) {
      saveField(have, { source: source, lakeId: lakeId });
      return have;
    }
    const out = have.slice();
    for (let i = 0; i < pts.length; i++) {
      if (slots[i]) continue; // this waypoint already has its cell
      try { out.push(await fetchSingle(pts[i].lat, pts[i].lon, source, tz, lakeId)); } catch (e) {}
    }
    if (out.length) saveField(out, { source: source, lakeId: lakeId });
    return out;
  }
  function saveField(field, meta) {
    try {
      const clean = (field || []).filter(function (p) {
        return p && isFinite(p.lat) && isFinite(p.lon);
      });
      const first = clean[0] || {};
      const src = (meta && meta.source) || first.source || null;
      const lid = (meta && meta.lakeId) || first.lakeId || null;
      const payload = { savedAt: Date.now(), field: clean };
      if (src) payload.source = src;
      if (lid) payload.lakeId = lid;
      localStorage.setItem(FIELD_KEY, JSON.stringify(payload));
    } catch (e) {}
  }
  function loadField() {
    try {
      const raw = JSON.parse(localStorage.getItem(FIELD_KEY) || "null");
      if (raw && Array.isArray(raw.field) && raw.field.length) return raw;
    } catch (e) {}
    return null;
  }
  // Age in hours of the oldest cell in a saved route field (null if unknown).
  function fieldAgeHours(field, now) {
    if (!field || !field.length) return null;
    let oldest = null;
    for (let i = 0; i < field.length; i++) {
      const t = field[i] && field[i].fetchedAt;
      if (!t) return null;
      if (oldest == null || t < oldest) oldest = t;
    }
    return ((now || Date.now()) - oldest) / 3600000;
  }
  // True when a route field exists but is at least maxAgeH old (or of unknown
  // age) and should be rebuilt from the current route.
  function fieldNeedsRefresh(field, maxAgeH, now) {
    if (!field || !field.length) return false;
    const age = fieldAgeHours(field, now);
    return age == null || age >= maxAgeH;
  }
  function loadCache() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function ageHours(packOrField) {
    const t = packOrField && (packOrField.fetchedAt || packOrField.savedAt);
    if (!t) return null;
    return (Date.now() - t) / 3600000;
  }
  const tzFormatters = {};
  function getFormatter(tz) {
    const key = tz || "America/New_York";
    if (!tzFormatters[key]) {
      tzFormatters[key] = new Intl.DateTimeFormat("en-US", {
        timeZone: key, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
      });
    }
    return tzFormatters[key];
  }
  function tzOffsetMs(utcMs, tz) {
    try {
      const parts = getFormatter(tz).formatToParts(new Date(utcMs));
      let yr = 0, mo = 0, dy = 0, hr = 0, mi = 0, sc = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.type === "year") yr = +p.value;
        else if (p.type === "month") mo = +p.value;
        else if (p.type === "day") dy = +p.value;
        else if (p.type === "hour") hr = +p.value;
        else if (p.type === "minute") mi = +p.value;
        else if (p.type === "second") sc = +p.value;
      }
      const asUtc = Date.UTC(yr, mo - 1, dy, hr, mi, sc);
      return asUtc - utcMs;
    } catch (e) { return 0; }
  }
  function parsePackTime(iso, tz) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return NaN;
    const utcGuess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    let utc = utcGuess - tzOffsetMs(utcGuess, tz);
    utc = utcGuess - tzOffsetMs(utc, tz);
    return utc;
  }
  const parsedTimesCache = typeof WeakMap === "function" ? new WeakMap() : null;
  function parsedTimesFor(pack) {
    const times = pack.hourly.time;
    const tz = pack.tz || "America/New_York";
    if (parsedTimesCache) {
      const cached = parsedTimesCache.get(pack);
      if (cached && cached.tz === tz && cached.times === times && cached.len === times.length) {
        return cached.ms;
      }
    }
    const ms = new Array(times.length);
    for (let i = 0; i < times.length; i++) ms[i] = parsePackTime(times[i], tz);
    if (parsedTimesCache) parsedTimesCache.set(pack, { tz: tz, times: times, len: times.length, ms: ms });
    return ms;
  }
  // A forecast hour further than this from the requested time is treated as
  // "no forecast" (departure beyond the model horizon, or only null hours).
  const MAX_GAP_H = 1.5;
  function num(v) { return typeof v === "number" && isFinite(v); }
  // Nearest forecast hour that actually has wind. Null hours (models return
  // null past their horizon) are skipped. Returns null when nothing usable is
  // within MAX_GAP_H, and { outOfRange: true } callers can report via lastGap.
  function atTime(pack, whenMs) {
    if (!pack || !pack.hourly || !pack.hourly.time || !pack.hourly.time.length) return null;
    const times = pack.hourly.time;
    const parsed = parsedTimesFor(pack);
    const tws = pack.hourly.tws || [], twd = pack.hourly.twd || [], gust = pack.hourly.gust || [], code = pack.hourly.code || [];
    let best = -1, bestD = 1e18;
    for (let i = 0; i < times.length; i++) {
      if (!num(tws[i]) || !num(twd[i])) continue;
      const t = parsed[i];
      if (!isFinite(t)) continue;
      const d = Math.abs(t - whenMs);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0 || bestD / 3600000 > MAX_GAP_H) return null;
    return {
      tws: tws[best], twd: twd[best],
      gust: num(gust[best]) ? gust[best] : null,
      code: code[best],
      time: times[best], ageH: bestD / 3600000
    };
  }
  // True when the pack has usable wind somewhere but not near whenMs.
  function outOfRange(pack, whenMs) {
    if (!pack || !pack.hourly || !pack.hourly.time || !pack.hourly.time.length) return false;
    return atTime(pack, whenMs) == null;
  }
  function hasData(pack) {
    if (!pack || !pack.hourly) return false;
    const tws = pack.hourly.tws || [], twd = pack.hourly.twd || [];
    for (let i = 0; i < tws.length; i++) if (num(tws[i]) && num(twd[i])) return true;
    return false;
  }
  function packMatches(pack, opts) {
    if (!pack || !isFinite(pack.lat) || !isFinite(pack.lon)) return false;
    opts = opts || {};
    if (opts.source && pack.source !== opts.source) return false;
    if (opts.lakeId && pack.lakeId && pack.lakeId !== opts.lakeId) return false;
    if (opts.lat != null && opts.lon != null && isFinite(opts.lat) && isFinite(opts.lon)) {
      const maxDist = isFinite(opts.maxDistNm) ? opts.maxDistNm : MAX_PACK_DIST_NM;
      if (CMGGeo.haversineNm({ lat: opts.lat, lon: opts.lon }, { lat: pack.lat, lon: pack.lon }) > maxDist) return false;
    }
    return true;
  }
  function nearestPack(field, lat, lon, opts) {
    if (!field || !field.length || !isFinite(lat) || !isFinite(lon)) return null;
    const maxDist = (typeof opts === "number" && isFinite(opts)) ? opts
      : (opts && isFinite(opts.maxDistNm) ? opts.maxDistNm : MAX_PACK_DIST_NM);
    const src = opts && typeof opts === "object" ? opts.source : null;
    const lakeId = opts && typeof opts === "object" ? opts.lakeId : null;
    let best = null, bestD = 1e18;
    field.forEach(function (p) {
      if (!p || !isFinite(p.lat) || !isFinite(p.lon)) return;
      if (src && p.source !== src) return;
      if (lakeId && p.lakeId && p.lakeId !== lakeId) return;
      const d = CMGGeo.haversineNm({ lat: lat, lon: lon }, { lat: p.lat, lon: p.lon });
      if (d <= maxDist && d < bestD) { bestD = d; best = p; }
    });
    return best;
  }
  function atPlace(field, lat, lon, whenMs, opts) {
    const pack = nearestPack(field, lat, lon, opts);
    return pack ? atTime(pack, whenMs) : null;
  }
  w.CMGWind = { BUILD: BUILD, MAX_GAP_H, MAX_PACK_DIST_NM, FETCH_TIMEOUT_MS, modelParam, parsePackTime, fetchForecast, fetchMany, loadCache, loadField, saveField, ageHours, fieldAgeHours, fieldNeedsRefresh, atTime, outOfRange, hasData, packMatches, atPlace, nearestPack };
})(window);
