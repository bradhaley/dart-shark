/* Dart Shark shot tracer — "broadcast 360".
   Each dart of a visit flies a real 3D parabola to its segment as a glowing
   Toptracer-style comet; once all darts have landed the camera orbits a full
   360° around the board (bullet-time), then settles to the front and fades.
   Pure Canvas 2D: additive 'lighter' glow, cached head sprites, a tiny 3D
   projection (rotate-about-Y + tilt + perspective), preallocated particle pool. */
(function (root) {
  'use strict';
  var E = root.Engine;
  var ORDER = E ? E.BOARD_ORDER : [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  var enabled = true;
  var canvas, ctx, dpr = 1, W = 0, H = 0;
  var raf = 0, lastNow = 0;
  var sprites = {};
  var visit = null;                              // the active visit animation

  // ---- timing (ms) ----
  var FLY_GAP = 320, FLY_DUR = 520, ORBIT_DELAY = 150, ORBIT_DUR = 1050, FADE = 320;
  // ---- camera / scene ----
  var CAM_Z = 4.3, PHI = 0.18, APEX = 0.52, NSAMP = 46;
  var TWO_PI = Math.PI * 2;

  var GOLD = [224, 182, 110], GREEN = [74, 208, 138], ICE = [150, 200, 255];
  function tier(d) {
    var p = E ? E.points(d) : d.mult * d.value;
    if (d.mult === 3 || (d.value === 25 && d.mult === 2) || p >= 50) return { c: GOLD, premium: true };
    if (d.mult === 2) return { c: GREEN, premium: false };
    return { c: ICE, premium: false };
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function rnd(s) { var x = Math.sin(s * 991.317) * 43758.545; return x - Math.floor(x); }
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function now() { return root.performance && performance.now ? performance.now() : Date.now(); }

  // ---- canvas ----
  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'tracer-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:40';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) { canvas = null; return; }       // no 2D context — disable gracefully
    resize();
    root.addEventListener('resize', resize);
  }
  function resize() {
    if (!canvas || !ctx) return;
    dpr = Math.min(root.devicePixelRatio || 1, 2);
    W = root.innerWidth; H = root.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sprites = {};
  }
  function clearCanvas() { if (ctx) ctx.clearRect(0, 0, W, H); }

  function sprite(c) {
    var key = c[0] + '_' + c[1] + '_' + c[2];
    if (sprites[key]) return sprites[key];
    var R = 46, s = document.createElement('canvas'); s.width = s.height = R * 2;
    var sc = s.getContext('2d');
    var g = sc.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0.0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, rgba(c, 0.6));
    g.addColorStop(1.0, rgba(c, 0));
    sc.fillStyle = g; sc.fillRect(0, 0, R * 2, R * 2);
    sprites[key] = { canvas: s, r: R };
    return sprites[key];
  }

  // ---- particle pool ----
  var MAXP = 90, P = new Array(MAXP);
  for (var k = 0; k < MAXP; k++) P[k] = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: ICE };
  function burst(x, y, n, c, power) {
    for (var k = 0; k < MAXP && n > 0; k++) {
      var p = P[k]; if (p.life > 0) continue;
      var ang = Math.random() * TWO_PI, spd = (50 + Math.random() * 190) * power;
      p.x = x; p.y = y; p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd - 30 * power;
      p.max = p.life = 0.34 + Math.random() * 0.44; p.c = c; n--;
    }
  }
  var GRAV = 540;
  function updateParticles(dt) {
    var any = false;
    for (var i = 0; i < MAXP; i++) {
      var p = P[i]; if (p.life <= 0) continue;
      p.life -= dt; if (p.life <= 0) continue; any = true;
      p.vy += GRAV * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      var a = p.life / p.max, r = 0.8 + 2.4 * a;
      ctx.globalAlpha = a; ctx.fillStyle = a > 0.55 ? 'rgba(255,255,255,1)' : rgba(p.c, 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TWO_PI); ctx.fill();
    }
    return any;
  }
  function anyParticles() { for (var i = 0; i < MAXP; i++) if (P[i].life > 0) return true; return false; }

  // ---- 3D scene ----
  function scene() { var m = Math.min(W, H); return { cx: W / 2, cy: H * 0.42, focal: 0.30 * m * CAM_Z }; }
  function ringFrac(d) {
    if (d.value === 25) return d.mult === 2 ? 0.05 : 0.10;
    if (d.mult === 3) return 0.55;
    if (d.mult === 2) return 0.90;
    return 0.72;
  }
  function targetXY(d, seed) {
    var rf = ringFrac(d), theta;
    if (d.value === 25) { theta = rnd(seed) * TWO_PI; rf *= 0.3 + Math.abs(rnd(seed + 1)) * 0.6; }
    else { var i = ORDER.indexOf(d.value); theta = i * 18 * Math.PI / 180 + (rnd(seed) - 0.5) * 0.16; rf += (rnd(seed + 2) - 0.5) * 0.05; }
    return { x: rf * Math.sin(theta), y: rf * Math.cos(theta) };   // board plane: +Y up, 20 at top
  }
  function buildShot(d, idx) {
    var seed = (idx + 1) * 13.37 + d.value + d.mult * 7;
    var tgt = targetXY(d, seed);
    var lx = (rnd(seed + 5) - 0.5) * 0.5, ly = -1.4, lz = 2.7;
    var pts = new Array(NSAMP + 1);
    for (var k = 0; k <= NSAMP; k++) {
      var t = k / NSAMP;
      pts[k] = {
        x: lx + (tgt.x - lx) * t,
        y: ly + (tgt.y - ly) * t + APEX * 4 * t * (1 - t),
        z: lz * (1 - t)
      };
    }
    var tr = tier(d);
    return { pts: pts, c: tr.c, premium: tr.premium, sp: sprite(tr.c), N: NSAMP };
  }

  function cam(theta) {
    var s = scene();
    return { cx: s.cx, cy: s.cy, focal: s.focal, cosT: Math.cos(theta), sinT: Math.sin(theta), cosP: Math.cos(PHI), sinP: Math.sin(PHI) };
  }
  function project(p, c) {
    var xr = p.x * c.cosT + p.z * c.sinT;
    var zr = -p.x * c.sinT + p.z * c.cosT;
    var yt = p.y * c.cosP - zr * c.sinP;
    var zt = p.y * c.sinP + zr * c.cosP;
    var depth = CAM_Z - zt; if (depth < 0.06) depth = 0.06;
    var s = c.focal / depth;
    return { x: c.cx + xr * s, y: c.cy - yt * s, s: s };
  }

  // ---- play a whole visit ----
  function playVisit(darts, onDone) {
    ensure();
    var scoring = (darts || []).filter(function (d) { return d && d.mult !== 0; });
    if (!enabled || !scoring.length || !ctx) { if (onDone) onDone(); return; }
    visit = { shots: scoring.map(function (d, i) { return buildShot(d, i); }), onDone: onDone, t0: now(), done: false, bursts: {} };
    if (!raf) { lastNow = now(); raf = requestAnimationFrame(frame); }
  }
  function shoot(d) { playVisit([d]); }                 // single-dart preview (kept for compatibility)
  function finishVisit() {
    if (!visit || visit.done) return;
    visit.done = true; var cb = visit.onDone; visit = null; clearCanvas();
    if (cb) cb();
  }
  function skip() { if (visit && !visit.done) finishVisit(); }
  function clear() {
    visit = null;
    for (var i = 0; i < MAXP; i++) P[i].life = 0;
    if (raf && root.cancelAnimationFrame) { root.cancelAnimationFrame(raf); raf = 0; }
    clearCanvas();
  }

  // ---- frame ----
  function frame() {
    raf = 0;
    var t = now(), dt = Math.min((t - lastNow) / 1000, 0.033); lastNow = t;
    ctx.clearRect(0, 0, W, H);
    if (visit) drawVisit(t);
    var pAlive = false;
    if (anyParticles()) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; pAlive = updateParticles(dt); ctx.restore(); }
    if (visit || pAlive) raf = requestAnimationFrame(frame);
    else clearCanvas();
  }

  function drawVisit(t) {
    var el = t - visit.t0, shots = visit.shots, n = shots.length;
    var flightEnd = (n - 1) * FLY_GAP + FLY_DUR;
    var orbitStart = flightEnd + ORBIT_DELAY, orbitEnd = orbitStart + ORBIT_DUR, fadeEnd = orbitEnd + FADE;
    if (el >= fadeEnd) { finishVisit(); return; }

    var theta = 0;
    if (el > orbitStart && el < orbitEnd) theta = easeInOut((el - orbitStart) / ORBIT_DUR) * TWO_PI;
    var alpha = el < orbitEnd ? 1 : Math.max(0, 1 - (el - orbitEnd) / FADE);
    var c = cam(theta);

    drawBoard(c, alpha);
    for (var i = 0; i < n; i++) drawShot(shots[i], i, el, c, alpha);
  }

  function drawBoard(c, alpha) {
    function ring(rf, steps) { var a = []; for (var i = 0; i <= steps; i++) { var ang = i / steps * TWO_PI; a.push(project({ x: rf * Math.cos(ang), y: rf * Math.sin(ang), z: 0 }, c)); } return a; }
    function poly(pts) { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); }
    var outer = ring(1.0, 40);
    ctx.save();
    // board face (dark disc) so the orbit reads as a solid board
    poly(outer); ctx.closePath(); ctx.fillStyle = 'rgba(10,12,16,' + (0.55 * alpha) + ')'; ctx.fill();
    ctx.lineJoin = 'round';
    // rings
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.12 * alpha) + ')'; ctx.lineWidth = 1.2;
    poly(outer); ctx.closePath(); ctx.stroke();
    var triple = ring(0.55, 40), dbl = ring(0.90, 40), bull = ring(0.09, 24);
    poly(triple); ctx.closePath(); ctx.stroke();
    poly(bull); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = rgba(GOLD, 0.20 * alpha); ctx.lineWidth = 1.4;
    poly(dbl); ctx.closePath(); ctx.stroke();
    // spokes
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.07 * alpha) + ')'; ctx.lineWidth = 1;
    for (var k = 0; k < 20; k++) {
      var ang = (k * 18 + 9) * Math.PI / 180;
      var a = project({ x: 0.09 * Math.cos(ang), y: 0.09 * Math.sin(ang), z: 0 }, c);
      var b = project({ x: Math.cos(ang), y: Math.sin(ang), z: 0 }, c);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  function drawShot(sh, idx, el, c, alpha) {
    var se = el - idx * FLY_GAP;
    if (se <= 0) return;
    var fp = Math.min(se / FLY_DUR, 1), fe = easeOutQuint(fp);
    var headK = fe * sh.N, lastK = Math.min(Math.floor(headK), sh.N);
    // project the flown trail
    var proj = [];
    for (var k = 0; k <= lastK; k++) proj.push(project(sh.pts[k], c));
    if (fp < 1) { var f = headK - lastK, a = sh.pts[lastK], b = sh.pts[Math.min(lastK + 1, sh.N)]; proj.push(project({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }, c)); }
    drawTrail(proj, sh.c, alpha, fp);
    var head = proj[proj.length - 1];
    if (fp < 1) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      var rad = sh.sp.r * 0.5 * Math.min(2, head.s / 120 + 0.5);
      ctx.globalAlpha = alpha; ctx.drawImage(sh.sp.canvas, head.x - rad, head.y - rad, rad * 2, rad * 2);
      ctx.restore();
    } else {
      var lp = project(sh.pts[sh.N], c);
      if (!visit.bursts[idx]) { visit.bursts[idx] = true; burst(lp.x, lp.y, sh.premium ? 20 : 10, sh.c, sh.premium ? 1.25 : 0.9); }
      ctx.save();
      ctx.globalAlpha = alpha; ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(lp.x, lp.y, 3.0, 0, TWO_PI); ctx.fill();
      ctx.fillStyle = rgba(sh.c, 1); ctx.beginPath(); ctx.arc(lp.x, lp.y, 1.5, 0, TWO_PI); ctx.fill();
      ctx.restore();
    }
  }

  function drawTrail(pts, col, alpha, fp) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    var n = pts.length;
    for (var i = 1; i < n; i++) {
      var s = i / (n - 1), ez = s * s;                       // brighter toward the head
      var sc = (pts[i].s + pts[i - 1].s) / 240;
      var w = (0.7 + 7.5 * ez) * Math.max(0.5, Math.min(1.8, sc)), a = (0.06 + 0.9 * ez) * alpha;
      var x0 = pts[i - 1].x, y0 = pts[i - 1].y, x1 = pts[i].x, y1 = pts[i].y;
      ctx.globalAlpha = a * 0.16; ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = w * 4.0;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = a * 0.42; ctx.strokeStyle = rgba(col, 1); ctx.lineWidth = w * 2.2;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1.1, w * 0.6);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.restore();
  }

  function setEnabled(b) { enabled = !!b; if (!b) clear(); }

  root.Tracer = {
    playVisit: playVisit, shoot: shoot, skip: skip, clear: clear,
    setEnabled: setEnabled, isEnabled: function () { return enabled; }
  };
})(typeof window !== 'undefined' ? window : this);
