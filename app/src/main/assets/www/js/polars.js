(function (w) {
  const TWA_SHAPE = [[32,0.36],[38,0.48],[45,0.58],[52,0.66],[60,0.74],[70,0.82],[80,0.88],[90,0.92],[100,0.95],[110,0.96],[120,0.94],[135,0.86],[150,0.74],[165,0.60],[180,0.50]];
  function hullSpeed(lwlFt) { return 1.34 * Math.sqrt(Math.max(8, lwlFt)); }
  function windScale(tws) {
    if (tws <= 3) return 0.22;
    if (tws >= 22) return 1.02;
    const knots = [4,6,8,10,12,14,16,18,20,22];
    const sc = [0.38,0.55,0.70,0.84,0.96,1.04,1.08,1.10,1.08,1.02];
    for (let i = 1; i < knots.length; i++) {
      if (tws <= knots[i]) {
        const t = (tws - knots[i-1]) / (knots[i] - knots[i-1]);
        return sc[i-1] + t * (sc[i] - sc[i-1]);
      }
    }
    return 1;
  }
  function shapeAt(twa) {
    const a = Math.min(180, Math.abs(twa));
    if (a < TWA_SHAPE[0][0]) return TWA_SHAPE[0][1] * (a / TWA_SHAPE[0][0]);
    for (let i = 1; i < TWA_SHAPE.length; i++) {
      if (a <= TWA_SHAPE[i][0]) {
        const t = (a - TWA_SHAPE[i-1][0]) / (TWA_SHAPE[i][0] - TWA_SHAPE[i-1][0]);
        return TWA_SHAPE[i-1][1] + t * (TWA_SHAPE[i][1] - TWA_SHAPE[i-1][1]);
      }
    }
    return TWA_SHAPE[TWA_SHAPE.length-1][1];
  }
  const CLASSES = {
    mac26x: { id:"mac26x", name:"MacGregor 26X", loa:25.82, lwl:23.0, draft:5.5, phrf:219, notes:"Board down. Ballast full. Working sails.", upwind:0.90, reach:1.02, run:0.96 },
    cat22: { id:"cat22", name:"Catalina 22", loa:21.5, lwl:19.33, draft:5.0, phrf:273, notes:"Working sails.", upwind:1.00, reach:0.98, run:0.98 },
    cat30: { id:"cat30", name:"Catalina 30", loa:29.92, lwl:25.0, draft:5.25, phrf:192, notes:"Working sails.", upwind:1.02, reach:1.00, run:1.00 },
    hun34: { id:"hun34", name:"Hunter 34", loa:34.42, lwl:28.21, draft:5.5, phrf:150, notes:"Working sails.", upwind:1.04, reach:1.02, run:1.00 },
    s280: { id:"s280", name:"S2 8.0", loa:26.0, lwl:21.5, draft:4.0, phrf:228, notes:"S2 8.0 / S2 26. Working sails.", upwind:0.98, reach:0.99, run:0.98 }
  };
  function classFactor(cls, twa) {
    const a = Math.abs(twa);
    if (a < 60) return cls.upwind;
    if (a < 130) return cls.reach;
    return cls.run;
  }
  function boatSpeed(cls, tws, twa) {
    const vh = hullSpeed(cls.lwl);
    return Math.min(vh * 1.05, Math.max(0, vh * shapeAt(twa) * windScale(tws) * classFactor(cls, twa)));
  }
  function vmgToWind(cls, tws, twa) { return boatSpeed(cls, tws, twa) * Math.cos(CMGGeo.toRad(twa)); }
  function bestUpwindTwa(cls, tws) {
    let best = 42, bestV = -1e9;
    for (let a = 32; a <= 55; a++) {
      const v = vmgToWind(cls, tws, a);
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }
  function genericClass(lwlFt) {
    const lwl = Number(lwlFt) || 23;
    return { id:"generic", name:"Generic " + lwl.toFixed(1) + " ft LWL", loa:lwl, lwl, draft:null, phrf:null, notes:"Hull speed " + hullSpeed(lwl).toFixed(2) + " kn", upwind:1, reach:1, run:1 };
  }
  w.CMGPolars = { hullSpeed, CLASSES, boatSpeed, vmgToWind, bestUpwindTwa, genericClass, shapeAt, TWA_SHAPE };
})(window);
