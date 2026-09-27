(function (w) {
  const KEY = "cmg.wind.cache";
  function modelParam(source) {
    if (source === "hrrr") return "gfs_hrrr";
    if (source === "gfs") return "gfs_seamless";
    if (source === "ecmwf") return "ecmwf_ifs04";
    return "gfs_hrrr";
  }
  function packFrom(data, source, tz, lat, lon) {
    const hourly = data.hourly || {};
    return {
      fetchedAt: Date.now(), source: source,
      lat: data.latitude != null ? data.latitude : lat,
      lon: data.longitude != null ? data.longitude : lon,
      tz: tz || "America/New_York",
      hourly: {
        time: hourly.time || [],
        tws: hourly.wind_speed_10m || [],
        twd: hourly.wind_direction_10m || [],
        gust: hourly.wind_gusts_10m || [],
        code: hourly.weather_code || []
      }
    };
  }
  function buildUrl(lats, lons, source, tz) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lats);
    url.searchParams.set("longitude", lons);
    url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code");
    url.searchParams.set("wind_speed_unit", "kn");
    url.searchParams.set("timezone", tz || "America/New_York");
    url.searchParams.set("forecast_hours", "48");
    if (source === "hrrr" || source === "gfs") url.searchParams.set("models", modelParam(source));
    return url.toString();
  }
  async function fetchForecast(lat, lon, source, tz) {
    const res = await fetch(buildUrl(lat.toFixed(4), lon.toFixed(4), source, tz));
    if (!res.ok) throw new Error("Wind fetch failed " + res.status);
    const data = await res.json();
    const pack = packFrom(Array.isArray(data) ? data[0] : data, source, tz, lat, lon);
    try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) {}
    return pack;
  }
  async function fetchMany(points, source, tz) {
    const pts = (points || []).slice(0, 12);
    if (!pts.length) return [];
    const lats = pts.map(function (p) { return p.lat.toFixed(4); }).join(",");
    const lons = pts.map(function (p) { return p.lon.toFixed(4); }).join(",");
    const res = await fetch(buildUrl(lats, lons, source, tz));
    if (!res.ok) throw new Error("Wind field fetch failed " + res.status);
    const data = await res.json();
    const list = Array.isArray(data) ? data : [data];
    return list.map(function (d, i) {
      return packFrom(d, source, tz, pts[Math.min(i, pts.length - 1)].lat, pts[Math.min(i, pts.length - 1)].lon);
    });
  }
  function loadCache() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function atTime(pack, whenMs) {
    if (!pack || !pack.hourly || !pack.hourly.time || !pack.hourly.time.length) return null;
    const times = pack.hourly.time;
    let best = 0, bestD = 1e18;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(Date.parse(times[i]) - whenMs);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { tws: pack.hourly.tws[best], twd: pack.hourly.twd[best], gust: pack.hourly.gust[best], time: times[best], ageH: bestD / 3600000 };
  }
  function nearestPack(field, lat, lon) {
    if (!field || !field.length) return null;
    let best = field[0], bestD = 1e18;
    field.forEach(function (p) {
      const d = CMGGeo.haversineNm({ lat: lat, lon: lon }, { lat: p.lat, lon: p.lon });
      if (d < bestD) { bestD = d; best = p; }
    });
    return best;
  }
  function atPlace(field, lat, lon, whenMs) {
    const pack = nearestPack(field, lat, lon);
    return pack ? atTime(pack, whenMs) : null;
  }
  w.CMGWind = { fetchForecast, fetchMany, loadCache, atTime, atPlace, nearestPack };
})(window);
