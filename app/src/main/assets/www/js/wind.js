(function (w) {
  const KEY = "cmg.wind.cache";
  function modelParam(source) {
    if (source === "hrrr") return "gfs_hrrr";
    if (source === "gfs") return "gfs_seamless";
    if (source === "ecmwf") return "ecmwf_ifs04";
    return "gfs_hrrr";
  }
  async function fetchForecast(lat, lon, source) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", lat.toFixed(4));
    url.searchParams.set("longitude", lon.toFixed(4));
    url.searchParams.set("hourly", "wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code");
    url.searchParams.set("wind_speed_unit", "kn");
    url.searchParams.set("timezone", "America/New_York");
    url.searchParams.set("forecast_hours", "48");
    if (source === "hrrr" || source === "gfs") url.searchParams.set("models", modelParam(source));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error("Wind fetch failed " + res.status);
    const data = await res.json();
    const pack = {
      fetchedAt: Date.now(), source, lat, lon,
      hourly: { time: data.hourly.time, tws: data.hourly.wind_speed_10m, twd: data.hourly.wind_direction_10m, gust: data.hourly.wind_gusts_10m || [], code: data.hourly.weather_code || [] }
    };
    try { localStorage.setItem(KEY, JSON.stringify(pack)); } catch (e) {}
    return pack;
  }
  function loadCache() {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function atTime(pack, whenMs) {
    if (!pack || !pack.hourly) return null;
    const times = pack.hourly.time;
    let best = 0, bestD = 1e18;
    for (let i = 0; i < times.length; i++) {
      const d = Math.abs(Date.parse(times[i]) - whenMs);
      if (d < bestD) { bestD = d; best = i; }
    }
    return { tws: pack.hourly.tws[best], twd: pack.hourly.twd[best], gust: pack.hourly.gust[best], time: times[best], ageH: bestD / 3600000 };
  }
  w.CMGWind = { fetchForecast, loadCache, atTime };
})(window);
