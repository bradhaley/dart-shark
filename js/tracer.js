/* Dart Shark shot tracer — broadcast-style neon comet that flies to the exact
   segment hit, drives into the board and embeds (spark burst + ring + stuck pip).
   Pure Canvas 2D, additive 'lighter' glow (no shadowBlur/filter on iOS), cached
   head sprites, sub-step motion blur, preallocated particle pool. Toggleable.

   Technique basis: layered additive strokes for bloom, history-buffer redraw on a
   transparent overlay, easeOutQuint flight, DPR capped at 2, loop stops when idle. */
(function (root) {
  'use strict';
  var E = root.Engine;
  var ORDER = E ? E.BOARD_ORDER : [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  var enabled = true;
  var canvas, ctx, dpr = 1, W = 0, H = 0;
  var boardImg, boardReady = false, boardFade = 0;
  var shots = [];
  var raf = 0, lastNow = 0;
  var sprites = {};            // cached radial head sprites by color key

  // ---- tier color + premium flag --------------------------------------------
  var GOLD = [245, 196, 81], GREEN = [74, 208, 138], ICE = [128, 202, 255];
  function tier(d) {
    var p = E ? E.points(d) : d.mult * d.value;
    if (d.mult === 3 || (d.value === 25 && d.mult === 2) || p >= 50) return { c: GOLD, premium: true };
    if (d.mult === 2) return { c: GREEN, premium: false };
    return { c: ICE, premium: false };
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  // ---- board geometry (same invisible board the dart "lands" on) -------------
  function boardGeom() { var R = Math.min(W, H) * 0.28; return { cx: W / 2, cy: H * 0.40, R: R }; }
  function ringRadius(d) {
    if (d.value === 25) return d.mult === 2 ? 0.028 : 0.085;
    if (d.mult === 3) return 0.622;
    if (d.mult === 2) return 0.912;
    return 0.74;
  }
  function jitter(seed, span) { var x = Math.sin(seed * 999.13) * 43758.5453; x -= Math.floor(x); return (x - 0.5) * span; }
  function landingPoint(d, g, seed) {
    if (d.mult === 0) return null;
    var r = ringRadius(d) * g.R, theta;
    if (d.value === 25) { theta = jitter(seed, Math.PI * 2); r *= (0.4 + Math.abs(jitter(seed + 7, 1))); }
    else {
      var idx = ORDER.indexOf(d.value);
      theta = idx * 18 * Math.PI / 180 + jitter(seed, 0.18);
      r += jitter(seed + 3, 0.04) * g.R;
    }
    return { x: g.cx + r * Math.sin(theta), y: g.cy - r * Math.cos(theta) };
  }

  // ---- canvas setup ----------------------------------------------------------
  function ensure() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'tracer-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:40';
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    resize();
    root.addEventListener('resize', resize);
    boardImg = new Image();
    boardImg.onload = function () { boardReady = true; };
    boardImg.src = './icons/board-fill.png';
  }
  function resize() {
    if (!canvas) return;
    dpr = Math.min(root.devicePixelRatio || 1, 2);  // cap at 2 — biggest iPad win
    W = root.innerWidth; H = root.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sprites = {};                                   // rebuild sprites at new dpr
  }

  // cached white-hot -> accent -> transparent radial sprite, drawn additively
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

  // ---- particle pool ---------------------------------------------------------
  var MAXP = 90, P = new Array(MAXP);
  for (var k = 0; k < MAXP; k++) P[k] = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, c: ICE };
  function burst(x, y, n, c, power) {
    for (var k = 0; k < MAXP && n > 0; k++) {
      var p = P[k]; if (p.life > 0) continue;
      var ang = Math.random() * 6.2832, spd = (50 + Math.random() * 200) * power;
      p.x = x; p.y = y; p.vx = Math.cos(ang) * spd; p.vy = Math.sin(ang) * spd - 30 * power;
      p.max = p.life = 0.35 + Math.random() * 0.45; p.c = c; n--;
    }
  }

  // ---- shoot -----------------------------------------------------------------
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function shoot(d) {
    if (!enabled || !d || d.mult === 0) return;
    ensure();
    var g = boardGeom();
    var seed = (shots.length + 1) * 13.37 + d.value + d.mult * 7;
    var land = landingPoint(d, g, seed * 0.013 + d.value + d.mult);
    if (!land) return;
    var t = tier(d);
    var launch = { x: g.cx + jitter(seed, 1) * W * 0.16, y: H * 1.04 };
    // flat-ish fast dart arc: modest lift, control biased toward the board
    var dist = Math.hypot(land.x - launch.x, land.y - launch.y);
    var ctrl = { x: launch.x + (land.x - launch.x) * 0.62, y: Math.min(land.y, launch.y) - dist * 0.18 - 40 };
    // pre-sample the path once (no per-frame allocation)
    var N = 56, pts = new Array(N + 1);
    for (var i = 0; i <= N; i++) {
      var u = i / N, v = 1 - u, a = v * v, b = 2 * v * u, e = u * u;
      pts[i] = { x: a * launch.x + b * ctrl.x + e * land.x, y: a * launch.y + b * ctrl.y + e * land.y };
    }
    shots.push({
      t0: now(), flight: 400, ringDur: 360, pipDur: 520, total: 1000,
      pts: pts, N: N, land: land, c: t.c, premium: t.premium,
      label: E ? E.dartLabel(d) : '', pts_v: E ? E.points(d) : 0,
      prevHead: 0, impacted: false, impactT: 0, sp: sprite(t.c)
    });
    boardFade = 1;
    if (!raf) { lastNow = now(); raf = requestAnimationFrame(frame); }
  }

  function now() { return root.performance ? performance.now() : Date.now(); }

  // ---- per-frame -------------------------------------------------------------
  function frame() {
    raf = 0;
    var t = now(), dt = Math.min((t - lastNow) / 1000, 0.033); lastNow = t;
    ctx.clearRect(0, 0, W, H);

    // faint board backdrop while anything is active
    var target = shots.length ? 1 : 0;
    boardFade += (target - boardFade) * 0.12;
    if (boardReady && boardFade > 0.02) {
      var g = boardGeom(), bs = g.R * 2.05;
      ctx.save(); ctx.globalAlpha = 0.1 * boardFade;
      ctx.drawImage(boardImg, g.cx - bs / 2, g.cy - bs / 2, bs, bs);
      ctx.restore();
    }

    for (var i = shots.length - 1; i >= 0; i--) {
      var sh = shots[i], age = t - sh.t0;
      drawShot(sh, age, t);
      if (age > sh.total) shots.splice(i, 1);
    }
    updateParticles(dt);

    var anyP = false; for (var k = 0; k < MAXP; k++) if (P[k].life > 0) { anyP = true; break; }
    if (shots.length || anyP || boardFade > 0.02) raf = requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, W, H);   // clean exit + stop the loop
  }

  function drawShot(sh, age, t) {
    var fp = Math.min(age / sh.flight, 1), pe = easeOutQuint(fp);
    // tiny overshoot/settle at the embed point
    var over = fp >= 1 ? 0 : 0;
    var headF = pe * sh.N;
    var fade = 1;

    // ---- comet trail (history-buffer redraw, additive layered strokes) ----
    var TRAIL = 26, i1 = Math.min(Math.floor(headF), sh.N), i0;
    if (age <= sh.flight) i0 = i1 - TRAIL;
    else { var dd = Math.min((age - sh.flight) / 200, 1); i0 = i1 - Math.round(TRAIL * (1 - dd)); fade = 1 - dd; }
    if (i0 < 1) i0 = 1;
    if (i1 > i0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      var pts = sh.pts;
      for (var i = i0; i <= i1; i++) {
        var s = (i - i0) / (i1 - i0), ez = s * s;
        var w = 0.6 + 12.0 * ez, a = (0.05 + 0.92 * ez) * fade;
        var x0 = pts[i - 1].x, y0 = pts[i - 1].y, x1 = pts[i].x, y1 = pts[i].y;
        // wide soft outer bloom
        ctx.globalAlpha = a * 0.16; ctx.strokeStyle = rgba(sh.c, 1); ctx.lineWidth = w * 4.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // mid colored body
        ctx.globalAlpha = a * 0.42; ctx.strokeStyle = rgba(sh.c, 1); ctx.lineWidth = w * 2.4;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // hot near-white core
        ctx.globalAlpha = a; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1.2, w * 0.62);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
      ctx.restore();
    }

    // ---- glowing head with sub-step motion blur (anti-strobe) ----
    if (age < sh.flight + 60 && headF >= 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var sp = sh.sp, sub = 3;
      for (var ss = 1; ss <= sub; ss++) {
        var hf = sh.prevHead + (headF - sh.prevHead) * (ss / sub);
        var idx = Math.max(0, Math.min(sh.N, Math.floor(hf)));
        var hp = sh.pts[idx];
        var scale = 0.62 + 0.2 * ss, rad = sp.r * scale;
        ctx.globalAlpha = 0.4 * (ss / sub) + (ss === sub ? 0.55 : 0);
        ctx.drawImage(sp.canvas, hp.x - rad, hp.y - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }
    sh.prevHead = headF;

    // ---- impact: spark burst + ring + stuck pip + label ----
    if (!sh.impacted && age >= sh.flight) {
      sh.impacted = true; sh.impactT = t;
      burst(sh.land.x, sh.land.y, sh.premium ? 22 : 10, sh.c, sh.premium ? 1.3 : 0.9);
    }
    if (sh.impacted) {
      var ip = t - sh.impactT;
      // expanding ring
      var rp = Math.min(ip / sh.ringDur, 1);
      if (rp < 1) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - rp) * 0.75; ctx.strokeStyle = rgba(sh.c, 1);
        ctx.lineWidth = 3.0 * (1 - rp) + 0.7;
        ctx.beginPath(); ctx.arc(sh.land.x, sh.land.y, 6 + rp * 48, 0, 6.2832); ctx.stroke();
        if (sh.premium) { // a second, faster inner ring for big hits
          ctx.globalAlpha = (1 - rp) * 0.5;
          ctx.beginPath(); ctx.arc(sh.land.x, sh.land.y, 3 + rp * 22, 0, 6.2832); ctx.stroke();
        }
        ctx.restore();
      }
      // premium edge flash
      if (sh.premium && ip < 260) {
        var ef = 1 - ip / 260;
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        var fg = ctx.createRadialGradient(W / 2, H * 0.4, Math.min(W, H) * 0.2, W / 2, H * 0.4, Math.max(W, H) * 0.7);
        fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, rgba(sh.c, 0.16 * ef));
        ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      // stuck pip + contact shadow (holds, then fades)
      var pf = ip < sh.pipDur ? 1 : Math.max(0, 1 - (ip - sh.pipDur) / 200);
      if (pf > 0) {
        ctx.save();
        ctx.globalAlpha = pf * 0.5; ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.beginPath(); ctx.arc(sh.land.x + 1.5, sh.land.y + 1.5, 3.4, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = pf; ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(sh.land.x, sh.land.y, 3.2, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = pf; ctx.fillStyle = rgba(sh.c, 1);
        ctx.beginPath(); ctx.arc(sh.land.x, sh.land.y, 1.6, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
      // floating label (rise + fade)
      var lf = ip < 120 ? ip / 120 : Math.max(0, 1 - (ip - 120) / 700);
      if (lf > 0 && sh.label) {
        ctx.save();
        ctx.globalAlpha = lf;
        ctx.font = '800 17px ui-rounded, system-ui, sans-serif';
        ctx.textAlign = 'center';
        var ly = sh.land.y - 16 - (1 - lf) * 14;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(sh.label + (sh.pts_v ? '  ·  ' + sh.pts_v : ''), sh.land.x + 1, ly + 1);
        ctx.fillStyle = '#fff'; ctx.fillText(sh.label + (sh.pts_v ? '  ·  ' + sh.pts_v : ''), sh.land.x, ly);
        ctx.restore();
      }
    }
  }

  var GRAV = 540;
  function updateParticles(dt) {
    var any = false;
    for (var k = 0; k < MAXP; k++) { if (P[k].life > 0) { any = true; break; } }
    if (!any) return;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < MAXP; i++) {
      var p = P[i]; if (p.life <= 0) continue;
      p.life -= dt; if (p.life <= 0) continue;
      p.vy += GRAV * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      var a = p.life / p.max, r = 0.8 + 2.4 * a;
      ctx.globalAlpha = a;
      ctx.fillStyle = a > 0.55 ? 'rgba(255,255,255,1)' : rgba(p.c, 1);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function setEnabled(b) { enabled = !!b; if (!b && ctx) ctx.clearRect(0, 0, W, H); }

  root.Tracer = { shoot: shoot, setEnabled: setEnabled, isEnabled: function () { return enabled; } };
})(typeof window !== 'undefined' ? window : this);
