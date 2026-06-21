/* Dart Shark engine — dartboard primitives + checkout logic. Pure, no DOM. */
(function (root) {
  'use strict';

  // Clockwise from top (12 o'clock = 20)
  var BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  // A dart = { mult: 0|1|2|3, value: 1..20 | 25 }. mult 0 => miss (value ignored).
  // Bull: value 25, mult 1 => 25 (outer), mult 2 => 50 (inner bull). Triple bull is illegal.
  function dart(mult, value) { return { mult: mult, value: value }; }
  function miss() { return { mult: 0, value: 0 }; }

  function points(d) {
    if (!d || d.mult === 0) return 0;
    return d.mult * d.value;
  }
  function isDouble(d) { return !!d && d.mult === 2; }      // includes 50 (D-bull)
  function isTriple(d) { return !!d && d.mult === 3; }
  function isBull(d) { return !!d && d.value === 25; }

  function dartLabel(d) {
    if (!d || d.mult === 0) return 'Miss';
    if (d.value === 25) return d.mult === 2 ? 'Bull' : '25';
    return (d.mult === 1 ? 'S' : d.mult === 2 ? 'D' : 'T') + d.value;
  }

  // ---- X01 checkout ----------------------------------------------------------
  // Impossible 3-dart double-out finishes (the "bogey" numbers).
  var BOGEY = { 159: 1, 162: 1, 163: 1, 165: 1, 166: 1, 168: 1, 169: 1 };

  // Single-dart reachable point values (for setup darts)
  var SINGLE_VALUES = (function () {
    var s = [];
    for (var n = 1; n <= 20; n++) { s.push({ p: n, d: dart(1, n) }); s.push({ p: 2 * n, d: dart(2, n) }); s.push({ p: 3 * n, d: dart(3, n) }); }
    s.push({ p: 25, d: dart(1, 25) });
    s.push({ p: 50, d: dart(2, 25) });
    return s;
  })();

  // Doubles available to finish (incl. bull 50), preference order (favour standard outs).
  function finishingDoubles(prefDouble) {
    var ds = [];
    for (var n = 1; n <= 20; n++) ds.push({ p: 2 * n, d: dart(2, n) });
    ds.push({ p: 50, d: dart(2, 25) });
    // Rank: preferred double first, then classic D16/D20/D8 path, then bull, then the rest descending.
    var rank = {};
    var order = [prefDouble, 40, 32, 16, 8, 4, 36, 24, 12, 20, 50, 10, 6, 2];
    order.forEach(function (p, i) { if (p && rank[p] === undefined) rank[p] = i; });
    ds.sort(function (a, b) {
      var ra = rank[a.p] === undefined ? 100 + (40 - a.p) : rank[a.p];
      var rb = rank[b.p] === undefined ? 100 + (40 - b.p) : rank[b.p];
      return ra - rb;
    });
    return ds;
  }

  // Return a recommended finishing route (array of darts ending on a double) or null.
  // masterOut allows a triple as the finisher too; straightOut allows any final dart.
  function checkoutRoute(score, dartsLeft, opts) {
    opts = opts || {};
    dartsLeft = dartsLeft || 3;
    var pref = opts.preferredDouble || 32;
    if (opts.straightOut) return straightRoute(score, dartsLeft);
    if (score < 2 || score > 170) return null;
    if (score <= 170 && BOGEY[score] && dartsLeft >= 3) return null; // truly impossible only w/ 3 darts
    var doubles = finishingDoubles(pref);

    // 1-dart finish
    for (var i = 0; i < doubles.length; i++) if (doubles[i].p === score) return [doubles[i].d];

    // 2-dart finish
    if (dartsLeft >= 2) {
      var r2 = twoDart(score, doubles);
      if (r2) return r2;
    }
    // 3-dart finish
    if (dartsLeft >= 3) {
      var r3 = threeDart(score, doubles);
      if (r3) return r3;
    }
    return null;
  }

  function twoDart(score, doubles) {
    // prefer a big setup (T20/T19...) then a good double
    for (var i = 0; i < doubles.length; i++) {
      var fin = doubles[i];
      var need = score - fin.p;
      if (need <= 0) continue;
      var setup = bestSetup(need);
      if (setup) return [setup, fin.d];
    }
    return null;
  }

  function threeDart(score, doubles) {
    for (var i = 0; i < doubles.length; i++) {
      var fin = doubles[i];
      var rem = score - fin.p;
      if (rem <= 0) continue;
      // two setup darts summing to rem; try a high first dart (T20 down) then match the rest
      for (var f = 60; f >= 1; f--) {
        var a = bestSetupExact(f);
        if (!a) continue;
        var b = bestSetupExact(rem - f);
        if (b) return [a, b, fin.d];
      }
    }
    return null;
  }

  // best single-dart value to hit exactly p (prefer triples for big numbers, then singles)
  function bestSetup(p) {
    if (p <= 0) return null;
    return bestSetupExact(p);
  }
  function bestSetupExact(p) {
    // exact match, preferring T20>T19...>S>bull
    var best = null, bestRank = 1e9;
    for (var i = 0; i < SINGLE_VALUES.length; i++) {
      if (SINGLE_VALUES[i].p !== p) continue;
      var d = SINGLE_VALUES[i].d;
      var rank = d.mult === 3 ? (60 - d.value) : d.mult === 1 ? (100 - d.value) : (200 - d.value);
      if (d.value === 25) rank = 150 - d.value;
      if (rank < bestRank) { bestRank = rank; best = d; }
    }
    return best;
  }

  function straightRoute(score, dartsLeft) {
    if (score <= 0 || score > 180) return null;
    // greedy: knock big chunks then finish on anything
    var route = [], rem = score, guard = 0;
    while (rem > 0 && route.length < dartsLeft && guard++ < 10) {
      var d = bestSetupExact(rem) || bestSetupExact(Math.min(rem, 60)) || dart(1, Math.min(rem, 20));
      if (rem <= 60 && bestSetupExact(rem)) { route.push(bestSetupExact(rem)); rem = 0; break; }
      var chunk = Math.min(60, rem - 1);
      var hd = bestSetupExact(chunk) || dart(1, 20);
      route.push(hd); rem -= points(hd);
    }
    return rem === 0 ? route : null;
  }

  function routeLabel(route) {
    if (!route) return null;
    return route.map(dartLabel).join('  ');
  }

  function isBogey(score) { return !!BOGEY[score]; }

  root.Engine = {
    BOARD_ORDER: BOARD_ORDER,
    dart: dart, miss: miss, points: points,
    isDouble: isDouble, isTriple: isTriple, isBull: isBull,
    dartLabel: dartLabel,
    checkoutRoute: checkoutRoute, routeLabel: routeLabel, isBogey: isBogey
  };
})(typeof window !== 'undefined' ? window : this);
