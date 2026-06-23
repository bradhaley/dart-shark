/* Dart Shark app controller — routing, match engine glue, events, iPad lifecycle. */
(function (root) {
  'use strict';
  var Modes = root.Modes, E = root.Engine, UI = root.UI, Sound = root.Sound, Store = root.Store;
  var appEl, fxReady = false;

  var App = {
    screen: 'home', settings: null, match: null, undoStack: [],
    setupCtx: null, lastSetup: null, curMult: 1, locked: false, hasGame: false, wakeLock: null,
    tournament: null, tMatch: null, tSetupCtx: null, tEdit: false,
    animating: false, _anim: null, _skipAt: 0
  };

  function clone(o) { try { return root.structuredClone ? structuredClone(o) : JSON.parse(JSON.stringify(o)); } catch (e) { return JSON.parse(JSON.stringify(o)); } }
  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function dateStr() { try { return new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch (e) { return ''; } }

  // ---------------- boot ----------------
  function boot() {
    appEl = document.getElementById('app');
    App.settings = Store.loadSettings();
    applySettings();
    registerSW();
    Store.migrateOldGame();
    var tr = Store.loadTournament();
    App.tournament = (tr && tr.v === 2) ? tr : null;     // keep a finished tournament too (champion screen survives a relaunch)
    App.match = null; App.tMatch = null;                 // home lists every in-progress match; one opens on demand
    App.screen = 'home';
    render();
    attachHandlers();
    setupWake();
  }

  function applySettings() {
    var s = App.settings;
    document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    Sound.setEnabled(!!s.sound);
    Sound.setVoice(!!s.voice);
    if (root.Tracer) root.Tracer.setEnabled(!!s.tracer);
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    try { navigator.serviceWorker.register('./sw.js').catch(function () {}); } catch (e) {}
  }

  function setupWake() {
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') requestWake();
    });
  }
  function requestWake() {
    if (!App.settings.wake || !navigator.wakeLock || App.screen !== 'game') return;
    try { navigator.wakeLock.request('screen').then(function (w) { App.wakeLock = w; }).catch(function () {}); } catch (e) {}
  }

  // ---------------- render router ----------------
  function render() {
    if (App.match) App.match.canUndo = App.undoStack.length > 0;
    var html;
    switch (App.screen) {
      case 'setup': html = UI.setup(App.setupCtx); break;
      case 'game': html = UI.game(App.match); break;
      case 'over': html = UI.over(App.match); break;
      case 'history': html = UI.history(Store.loadHistory()); break;
      case 'settings': html = UI.settings(App.settings, isStandalone()); break;
      case 'tsetup': html = UI.tournamentSetup(App.tSetupCtx); break;
      case 'tournament': html = UI.tournament(App.tournament, tNextMatch(App.tournament), {
        edit: App.tEdit,
        live: liveTournamentRef(),
        standings: (App.tournament && App.tournament.format === 'rr') ? tStandings(App.tournament) : null
      }); break;
      default:
        var games = Store.loadGames().filter(function (g) { return g && !g.finished && !g._tMatch; });
        html = UI.home({ games: games, hasTournament: !!App.tournament,
          tournamentDone: !!(App.tournament && App.tournament.champion != null),
          canReset: games.length > 0 || !!App.tournament });
    }
    appEl.innerHTML = html;
    if (App.screen === 'game') { syncMult(); requestWake(); }
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function syncMult() {
    var m = App.match, M = m ? Modes[m.modeId] : null;
    var forced = M && M.forcedMult ? M.forcedMult(m) : null;
    var eff = forced || App.curMult;
    var btns = document.querySelectorAll('.mult');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', (+btns[i].dataset.mult === eff) + '');
  }

  // ---------------- setup ----------------
  function openSetup(modeId) {
    var M = Modes[modeId];
    var cfg = clone(M.defaults || {});
    if (cfg.setsToWin === undefined && M.supportsLegs) cfg.setsToWin = 1;
    var names = Store.loadPlayers();
    if (!names || !names.length) names = ['Player 1', 'Player 2'];
    if (modeId === 'killer' && names.length < 2) names = ['Player 1', 'Player 2'];
    App.setupCtx = { modeId: modeId, config: cfg, names: names.slice() };
    App.screen = 'setup'; render();
  }
  function syncNames() {
    var ins = document.querySelectorAll('input[data-pi]');
    for (var i = 0; i < ins.length; i++) { var k = +ins[i].dataset.pi; if (App.setupCtx.names[k] !== undefined) App.setupCtx.names[k] = ins[i].value; }
  }
  function setConfig(key, raw) {
    var M = Modes[App.setupCtx.modeId];
    var def = (M.defaults || {})[key];
    var val = typeof def === 'number' ? Number(raw) : raw;
    App.setupCtx.config[key] = val;
  }

  // ---------------- match engine ----------------
  function startMatch(modeId, config, names) {
    App.tMatch = null;                          // a plain game is never a tournament match
    var M = Modes[modeId];
    var players = names.map(function (nm, i) { return { name: (String(nm || '').trim()) || ('Player ' + (i + 1)) }; });
    var n = players.length;
    var m = {
      id: newGameId(), modeId: modeId, config: clone(config), players: players,
      ps: [], ms: {}, current: 0, startingPlayer: 0,
      turn: { darts: [], scored: 0, marks: 0 },
      leg: 1, round: 1, roundLimit: 0,
      legWins: zeros(n), setWins: zeros(n),
      stats: players.map(function () { return { darts: 0, points: 0, marks: 0, rounds: 0, high: 0, c180: 0, cTon: 0, bestCheckout: 0 }; }),
      finished: false, winner: null, rank: [], canUndo: false,
      _win: null, _shanghai: false, startedAt: Date.now()
    };
    M.init(m);
    if (M.beginTurn) M.beginTurn(m);
    App.match = m; App.undoStack = []; App.curMult = 1;
    App.lastSetup = { modeId: modeId, config: clone(config), names: players.map(function (p) { return p.name; }) };
    App.screen = 'game'; persistNow(); render();
  }

  function snapshot() { App.undoStack.push(clone(App.match)); if (App.undoStack.length > 60) App.undoStack.shift(); }

  function inputDart(mult, value) {
    var m = App.match; if (!m || m.finished || App.animating) return;
    if (m.turn.darts.length >= 3) return;
    var d = value === 0 ? E.miss() : E.dart(mult, value);
    snapshot();
    m.turn.darts.push(d);
    var res = Modes[m.modeId].applyDart(m, d) || {};
    m.turn.scored = (m.turn.scored || 0) + (res.scored || 0);
    m.turn.marks = (m.turn.marks || 0) + (res.marks || 0);
    App.curMult = 1;
    // tracers no longer fire per dart — they replay together when the visit ends
    if (value === 0) Sound.play('dart');
    else if (res.event === 'advance') Sound.play('advance');
    else Sound.play('tick');
    if (res.turnEnd) endVisit(res);
    else { persist(); render(); }
  }

  function handleNext() {
    var m = App.match; if (!m || m.finished || App.animating) return;
    snapshot();
    endVisit({ skipped: true });
  }

  // replay timing (ms): each dart launches REPLAY_GAP apart, the total pops after the last lands and holds TOTAL_HOLD
  var REPLAY_GAP = 480, REPLAY_LAND = 380, TOTAL_HOLD = 950;

  function endVisit(res) {
    var m = App.match, M = Modes[m.modeId], i = m.current;
    var endRes = M.endTurn ? (M.endTurn(m) || {}) : {};
    // stats
    var s = m.stats[i], vp = m.turn.scored || 0;
    s.darts += m.turn.darts.length;
    s.points += vp;
    s.marks += (m.turn.marks || 0);
    s.rounds += 1;
    if (vp > s.high) s.high = vp;
    // checkout record (x01 finishing visit)
    if (M.id === 'x01' && res.win && m.turn.snap) { var co = m.turn.snap.score; if (co > s.bestCheckout) s.bestCheckout = co; }

    var ctx = {
      M: M, i: i, vp: vp, res: res, endRes: endRes, name: m.players[i].name,
      win: !!(res.win || endRes.win || m._win != null),
      winner: m._win != null ? m._win : i,
      isShanghai: !!m._shanghai,
      darts: m.turn.darts.slice()
    };

    if (App.settings.tracer && root.Tracer && root.Tracer.shoot && ctx.darts.some(isScoringDart)) {
      App.animating = true;
      render();                       // show all three darts in the strip; input is locked while the replay runs
      playReplay(ctx);                // fire the tracers one by one, then pop the visit total, then advance
    } else {
      finishVisitImmediate(ctx);      // tracer off / nothing to trace — original instant behavior
    }
  }

  function isScoringDart(d) { return !!d && d.mult !== 0; }

  // tracer ON: send each dart one at a time, then the total popup, then advance
  function playReplay(ctx) {
    var scoring = ctx.darts.filter(isScoringDart), idx = 0;
    App._anim = { ctx: ctx, timers: [], phase: 'replay', done: false };
    (function step() {
      if (!App._anim || App._anim.done) return;
      if (idx < scoring.length) {
        root.Tracer.shoot(scoring[idx]); idx++;
        App._anim.timers.push(setTimeout(step, REPLAY_GAP));
      } else {
        App._anim.timers.push(setTimeout(function () { showTotalThenAdvance(ctx); }, REPLAY_LAND));
      }
    })();
  }

  function showTotalThenAdvance(ctx) {
    if (!App._anim || App._anim.done) return;
    App._anim.phase = 'total'; App._anim.timers = [];
    if (ctx.win) { endReplay(); handleWin(ctx.winner, ctx.isShanghai); return; }
    if (ctx.endRes.event === 'halve') { Sound.play('halve'); UI.celebrate('halve', 'HALVED', ctx.name + ' missed'); }
    else if (ctx.endRes.event === 'eliminated') { Sound.play('eliminated'); UI.celebrate('eliminated', 'OUT', ctx.name); }
    else {
      var kind = ctx.res.event === 'bust' ? 'bust' : ctx.vp === 180 ? '180' : ctx.vp >= 100 ? 'ton' : 'score';
      UI.turnTotal(kind === 'bust' ? 0 : ctx.vp, kind);
      playScoreSound(ctx, kind);
    }
    App._anim.timers.push(setTimeout(function () { endReplay(); rotate(); persist(); render(); }, TOTAL_HOLD));
  }

  function playScoreSound(ctx, kind) {
    var s = App.match.stats[ctx.i];
    if (kind === 'bust') Sound.play('bust');
    else if (kind === '180') { s.c180++; Sound.play('big180'); if (App.settings.voice) Sound.callScore(180); }
    else if (kind === 'ton') { s.cTon++; Sound.play('ton'); if (App.settings.voice) Sound.callScore(ctx.vp); }
    else if (App.settings.voice && (ctx.M.id === 'x01' || ctx.M.id === 'countup') && ctx.vp > 0) Sound.callScore(ctx.vp);
  }

  function endReplay() { App.animating = false; if (App._anim) { App._anim.done = true; App._anim.timers.forEach(clearTimeout); } App._anim = null; }

  // a tap during the replay fast-forwards it
  function skipReplay() {
    if (!App._anim || App._anim.done) return;
    var ctx = App._anim.ctx, phase = App._anim.phase;
    App._anim.timers.forEach(clearTimeout); App._anim.timers = [];
    App._skipAt = nowMs();
    if (root.Tracer && root.Tracer.clear) root.Tracer.clear();
    if (phase === 'replay') showTotalThenAdvance(ctx);
    else { endReplay(); rotate(); persist(); render(); }
  }
  function nowMs() { return root.performance && performance.now ? performance.now() : Date.now(); }

  // tracer OFF: original synchronous celebration + advance
  function finishVisitImmediate(ctx) {
    var m = App.match, M = ctx.M, i = ctx.i, vp = ctx.vp, res = ctx.res, endRes = ctx.endRes, s = m.stats[i];
    if (ctx.win) { handleWin(ctx.winner, ctx.isShanghai); return; }
    if (res.event === 'bust') { Sound.play('bust'); UI.celebrate('bust', 'BUST', 'no score'); }
    else if (endRes.event === 'halve') { Sound.play('halve'); UI.celebrate('halve', 'HALVED', m.players[i].name + ' missed'); }
    else if (endRes.event === 'eliminated') { Sound.play('eliminated'); UI.celebrate('eliminated', 'OUT', m.players[i].name); }
    else if (vp === 180) { s.c180++; Sound.play('big180'); UI.celebrate('180', '180', 'maximum!'); if (App.settings.voice) Sound.callScore(180); }
    else if (vp >= 140 && (M.id === 'x01')) { Sound.play('ton'); UI.toast(vp + '!  Big score'); if (App.settings.voice) Sound.callScore(vp); }
    else if (vp >= 100 && (M.id === 'x01' || M.id === 'countup')) { s.cTon++; Sound.play('ton'); UI.toast(vp + '!  Ton+'); if (App.settings.voice) Sound.callScore(vp); }
    else if (App.settings.voice && (M.id === 'x01' || M.id === 'countup') && vp > 0) Sound.callScore(vp);
    rotate();
    persist(); render();
  }

  function rotate() {
    var m = App.match, M = Modes[m.modeId], n = m.ps.length, steps = 0;
    while (steps < n + 1) {
      m.current = (m.current + 1) % n;
      if (m.current === m.startingPlayer) {
        m.round++;
        if (M.roundBased && m.round > m.roundLimit) { finishByRank(); return; }
      }
      steps++;
      if (!m.ps[m.current].out) break;
    }
    if (m.ps.every(function (p) { return p.out; })) { finishByRank(); return; }
    m.turn = { darts: [], scored: 0, marks: 0 };
    if (M.beginTurn) M.beginTurn(m);
  }

  function handleWin(i, isShanghai) {
    var m = App.match, M = Modes[m.modeId];
    m._win = null; m._shanghai = false;
    if (!M.supportsLegs) { finishMatch(i, isShanghai ? 'shanghai' : 'win'); return; }

    m.legWins[i]++;
    if (m.legWins[i] >= (m.config.legsToWin || 1)) {
      m.setWins[i]++;
      if (m.setWins[i] >= (m.config.setsToWin || 1)) { finishMatch(i, 'win'); return; }
      m.legWins = zeros(m.players.length);
      Sound.play('leg'); UI.celebrate('leg', 'SET', m.players[i].name + ' takes the set');
    } else {
      Sound.play('leg'); UI.celebrate('leg', 'LEG ' + m.leg, m.players[i].name);
    }
    startNewLeg();
    persist(); render();
  }

  function startNewLeg() {
    var m = App.match, M = Modes[m.modeId], n = m.players.length;
    m.leg++;
    m.startingPlayer = (m.startingPlayer + 1) % n;
    m.current = m.startingPlayer;
    m.round = 1;
    M.newLeg(m);
    m.turn = { darts: [], scored: 0, marks: 0 };
    if (M.beginTurn) M.beginTurn(m);
  }

  function finishByRank() {
    var m = App.match, M = Modes[m.modeId];
    var rank = M.rank ? M.rank(m) : m.players.map(function (_, i) { return i; });
    finishMatch(rank[0], 'win');
  }

  function finishMatch(i, kind) {
    var m = App.match, M = Modes[m.modeId];
    m.finished = true; m.winner = i;
    m.rank = computeRank(m, i);
    Sound.play('match');
    UI.celebrate('win', kind === 'shanghai' ? 'SHANGHAI!' : 'GAME SHOT!', m.players[i].name + ' wins', true);
    if (App.settings.voice) Sound.say('Game shot, and the match, ' + m.players[i].name);
    Store.pushHistory({ mode: M.name, players: m.players.map(function (p) { return p.name; }), winner: m.players[i].name, date: dateStr() });
    removeGameFromStore(m.id);                                              // this match is done — drop it from the list
    if (App.tMatch && App.tournament) { tournamentMatchDone(i); return; }   // back to the bracket
    App.screen = 'over'; render();
  }

  function computeRank(m, winner) {
    var M = Modes[m.modeId], idx;
    if (M.rank) idx = M.rank(m).slice();
    else if (M.supportsLegs) {
      idx = m.players.map(function (_, i) { return i; });
      idx.sort(function (a, b) {
        return (m.setWins[b] - m.setWins[a]) || (m.legWins[b] - m.legWins[a]) ||
          (avg3num(m.stats[b]) - avg3num(m.stats[a]));
      });
    } else {
      idx = m.players.map(function (_, i) { return i; });
      idx.sort(function (a, b) { return (m.ps[b].lives || 0) - (m.ps[a].lives || 0); });
    }
    // ensure declared winner is first
    idx = [winner].concat(idx.filter(function (x) { return x !== winner; }));
    return idx;
  }
  function avg3num(s) { return s.darts ? (s.points / s.darts) * 3 : 0; }

  // ---------------- tournament (knockout + round-robin) ----------------
  // Entrants carry a stable numeric id; matches store ids (NOT names) so duplicate names never corrupt a draw.
  var ROUND_NAMES = { 1: 'Final', 2: 'Semi-finals', 4: 'Quarter-finals', 8: 'Round of 16', 16: 'Round of 32' };
  function roundLabelByCount(inRound) { return ROUND_NAMES[inRound] || ('Round of ' + inRound * 2); }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function dedupeNames(names) {
    var seen = {};
    return names.map(function (nm) { if (seen[nm] === undefined) { seen[nm] = 1; return nm; } seen[nm] += 1; return nm + ' (' + seen[nm] + ')'; });
  }

  function tName(t, id) { if (id == null) return null; for (var i = 0; i < t.entrants.length; i++) if (t.entrants[i].id === id) return t.entrants[i].name; return null; }
  function tGetMatch(t, ref) {
    if (!t || !ref) return null;
    if (ref.kind === 'rr') return t.fixtures[ref.i];
    if (ref.kind === 'third') return t.third;
    return t.rounds[ref.round][ref.match];
  }
  function sameRef(a, b) { return !!a && !!b && a.kind === b.kind && a.round === b.round && a.match === b.match && a.i === b.i; }
  function parseRef(s) {
    var p = s.split(':');
    if (p[0] === 'rr') return { ref: { kind: 'rr', i: +p[1] }, slot: p[2] };
    if (p[0] === 'third') return { ref: { kind: 'third' }, slot: p[1] };
    return { ref: { kind: 'se', round: +p[1], match: +p[2] }, slot: p[3] };
  }

  // standard seed-slot order for a bracket of `size` (power of 2): byes land on the top seeds and spread out
  function seedSlots(size) {
    var rounds = Math.round(Math.log(size) / Math.log(2)), seeds = [1, 2];
    for (var r = 1; r < rounds; r++) {
      var out = [], sum = Math.pow(2, r + 1) + 1;
      for (var i = 0; i < seeds.length; i++) { out.push(seeds[i]); out.push(sum - seeds[i]); }
      seeds = out;
    }
    return seeds;
  }

  function buildTournament(names, modeId, config, opts) {
    opts = opts || {};
    names = names.map(function (n, i) { return (String(n || '').trim()) || ('Player ' + (i + 1)); });
    names = dedupeNames(names);
    var entrants = names.map(function (nm, i) { return { id: i, name: nm, seed: i + 1 }; });
    if (opts.seed === 'random') { var ids = shuffle(entrants.map(function (e) { return e.id; })); ids.forEach(function (id, s) { entrants[id].seed = s + 1; }); }
    var t = { v: 2, format: opts.format || 'se', modeId: modeId, config: clone(config),
      modeName: Modes[modeId].name, entrants: entrants, champion: null, createdAt: Date.now() };
    if (t.format === 'rr') buildRR(t); else buildSE(t, opts);
    return t;
  }

  function buildSE(t, opts) {
    var n = t.entrants.length, size = 2; while (size < n) size *= 2;
    var order = seedSlots(size), bySeed = {};
    t.entrants.forEach(function (e) { bySeed[e.seed] = e.id; });
    var slots = order.map(function (s) { return bySeed[s] !== undefined ? bySeed[s] : null; });
    var rounds = [], r0 = [];
    for (var i = 0; i < size; i += 2) r0.push({ a: slots[i], b: slots[i + 1], winner: null });
    rounds.push(r0);
    var count = r0.length;
    while (count > 1) { var rr = []; for (var j = 0; j < count / 2; j++) rr.push({ a: null, b: null, winner: null }); rounds.push(rr); count = count / 2; }
    t.rounds = rounds;
    t.third = (opts.thirdPlace && t.entrants.length >= 4) ? { a: null, b: null, winner: null } : null;
    tResolveSE(t);
  }

  function buildRR(t) {
    var ids = t.entrants.slice().sort(function (a, b) { return a.seed - b.seed; }).map(function (e) { return e.id; });
    var arr = ids.slice(); if (arr.length % 2 === 1) arr.push(null);
    var nn = arr.length, roundsCount = nn - 1, half = nn / 2, rot = arr.slice(), fixtures = [];
    for (var r = 0; r < roundsCount; r++) {
      for (var i = 0; i < half; i++) { var a = rot[i], b = rot[nn - 1 - i]; if (a != null && b != null) fixtures.push({ a: a, b: b, winner: null, round: r }); }
      var fixed = rot[0], rest = rot.slice(1); rest.unshift(rest.pop()); rot = [fixed].concat(rest);
    }
    t.fixtures = fixtures; t.champion = null;
  }

  function loserOf(mt) { if (!mt || mt.winner == null || mt.a == null || mt.b == null) return null; return mt.winner === mt.a ? mt.b : mt.a; }

  function tResolveSE(t) {
    var rounds = t.rounds, r, k;
    for (r = 1; r < rounds.length; r++) for (k = 0; k < rounds[r].length; k++) { rounds[r][k].a = null; rounds[r][k].b = null; }
    for (r = 0; r < rounds.length; r++) {
      for (k = 0; k < rounds[r].length; k++) {
        var mt = rounds[r][k];
        if (mt.winner == null) { if (mt.a != null && mt.b == null) mt.winner = mt.a; else if (mt.b != null && mt.a == null) mt.winner = mt.b; }
        if (mt.winner != null && mt.winner !== mt.a && mt.winner !== mt.b) mt.winner = null;     // drop a winner invalidated by an edit
        if (mt.winner != null && r + 1 < rounds.length) {
          var nm = rounds[r + 1][Math.floor(k / 2)];
          if (k % 2 === 0) nm.a = mt.winner; else nm.b = mt.winner;
        }
      }
    }
    if (t.third && rounds.length >= 2) {
      var semis = rounds[rounds.length - 2];
      if (semis.length === 2) {
        t.third.a = loserOf(semis[0]); t.third.b = loserOf(semis[1]);
        if (t.third.winner != null && t.third.winner !== t.third.a && t.third.winner !== t.third.b) t.third.winner = null;
      }
    }
    t.champion = rounds[rounds.length - 1][0].winner;
    if (t.champion === undefined) t.champion = null;
  }

  function tResolveRR(t) {
    var done = t.fixtures.length > 0 && t.fixtures.every(function (f) { return f.winner != null; });
    var top = done ? tStandings(t)[0] : null;
    t.champion = top ? top.id : null;
  }
  function tResolve(t) { if (t.format === 'rr') tResolveRR(t); else tResolveSE(t); }

  function tStandings(t) {
    var rec = {};
    t.entrants.forEach(function (e) { rec[e.id] = { id: e.id, name: e.name, seed: e.seed, played: 0, wins: 0, losses: 0, h2h: {} }; });
    (t.fixtures || []).forEach(function (f) {
      if (f.winner == null) return;
      var loser = f.winner === f.a ? f.b : f.a;
      rec[f.winner].wins++; rec[f.winner].played++; rec[f.winner].h2h[loser] = (rec[f.winner].h2h[loser] || 0) + 1;
      rec[loser].losses++; rec[loser].played++;
    });
    var arr = Object.keys(rec).map(function (key) { return rec[key]; });
    arr.sort(function (a, b) {
      if (b.wins !== a.wins) return b.wins - a.wins;
      var ah = a.h2h[b.id] || 0, bh = b.h2h[a.id] || 0; if (ah !== bh) return bh - ah;
      if (a.losses !== b.losses) return a.losses - b.losses;
      return a.seed - b.seed;
    });
    arr.forEach(function (row, i) { row.rank = i + 1; });
    return arr;
  }

  function tNextMatch(t) {
    if (!t) return null;
    if (t.format === 'rr') { for (var i = 0; i < t.fixtures.length; i++) if (t.fixtures[i].winner == null) return { kind: 'rr', i: i }; return null; }
    for (var r = 0; r < t.rounds.length; r++) for (var k = 0; k < t.rounds[r].length; k++) {
      var mt = t.rounds[r][k];
      if (mt.a != null && mt.b != null && mt.winner == null) return { kind: 'se', round: r, match: k };
    }
    if (t.third && t.third.a != null && t.third.b != null && t.third.winner == null) return { kind: 'third' };
    return null;
  }

  function tRefLabel(t, ref) {
    if (!ref) return 'Tournament';
    if (ref.kind === 'third') return 'Third-place playoff';
    if (ref.kind === 'rr') return 'Round-robin';
    return roundLabelByCount(t.rounds[ref.round].length);
  }

  function openTournamentSetup() {
    var names = Store.loadPlayers();
    if (!names || names.length < 2) names = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    App.tSetupCtx = { names: names.slice(0, 16), modeId: 'x01', start: 501, legsToWin: 1, seed: 'random', format: 'se', thirdPlace: true };
    App.tEdit = false; App.screen = 'tsetup'; render();
  }

  function startTournament() {
    syncNamesT();
    var ctx = App.tSetupCtx;
    var names = ctx.names.map(function (n) { return String(n || '').trim(); }).filter(function (n) { return n !== ''; });
    if (names.length < 2) { UI.toast('Add at least 2 players'); return; }
    Store.savePlayers(names);
    var cfg = clone(Modes[ctx.modeId].defaults || {});
    cfg.setsToWin = 1; cfg.legsToWin = Modes[ctx.modeId].supportsLegs ? (ctx.legsToWin || 1) : 1;
    if (ctx.modeId === 'x01') cfg.start = ctx.start;
    App.tournament = buildTournament(names, ctx.modeId, cfg, { format: ctx.format, seed: ctx.seed, thirdPlace: ctx.thirdPlace });
    App.tMatch = null; App.tEdit = false;
    Store.saveTournament(App.tournament);
    App.screen = 'tournament'; render();
  }

  function syncNamesT() {
    var ins = document.querySelectorAll('input[data-tpi]');
    for (var i = 0; i < ins.length; i++) { var k = +ins[i].dataset.tpi; if (App.tSetupCtx.names[k] !== undefined) App.tSetupCtx.names[k] = ins[i].value; }
  }

  function findTournamentGame(ref) {
    var list = Store.loadGames();
    for (var i = 0; i < list.length; i++) if (!list[i].finished && list[i]._tMatch && sameRef(list[i]._tMatch, ref)) return list[i];
    return null;
  }
  function liveTournamentRef() {                          // the next match has a saved (in-progress) game → show "Resume"
    if (App.match && App.match._tMatch && !App.match.finished) return App.match._tMatch;
    if (!App.tournament) return null;
    var ref = tNextMatch(App.tournament);
    return (ref && findTournamentGame(ref)) ? ref : null;
  }
  function tPlayNext() {
    var t = App.tournament, ref = tNextMatch(t);
    if (!ref) return;
    var existing = (App.match && App.match._tMatch && sameRef(App.match._tMatch, ref) && !App.match.finished) ? App.match : findTournamentGame(ref);
    if (existing) {                                        // resume a saved in-progress match (open or from a prior session)
      App.match = existing; App.tMatch = ref; App.undoStack = []; App.tEdit = false;
      App.animating = false; App._anim = null; App.screen = 'game'; render(); return;
    }
    var mt = tGetMatch(t, ref);
    startMatch(t.modeId, t.config, [tName(t, mt.a), tName(t, mt.b)]);
    App.tMatch = ref;
    App.match._tMatch = ref;                              // startMatch already rendered without these — re-render
    App.match._tInfo = { label: tRefLabel(t, ref) };
    persistNow(); render();
  }

  function tBackToBracket() { persistNow(); App.tEdit = false; App.screen = 'tournament'; render(); }

  function tournamentMatchDone(i) {
    var t = App.tournament, ref = App.tMatch, mt = tGetMatch(t, ref);
    if (mt) mt.winner = (i === 0) ? mt.a : mt.b;     // winner by SEAT (0/1) — never by name
    tResolve(t);
    App.tMatch = null; App.match = null;                 // finishMatch already removed this game from the list
    Store.saveTournament(t);
    App.screen = 'tournament';
    render();
    if (t.champion != null && tNextMatch(t) == null) {
      Sound.play('match');
      UI.celebrate('win', 'CHAMPION', tName(t, t.champion) + ' wins the tournament', true);
      if (App.settings.voice) Sound.say('Champion, ' + tName(t, t.champion));
    }
  }

  function tEditResult(ref, slot) {
    var t = App.tournament, mt = tGetMatch(t, ref);
    if (!mt || mt.a == null || mt.b == null) return;
    var id = slot === 'a' ? mt.a : mt.b;
    if (mt.winner === id) return;
    var msg = t.format === 'se'
      ? 'Set ' + tName(t, id) + ' as the winner? Later matches that follow from this will be reset.'
      : 'Set ' + tName(t, id) + ' as the winner of this match?';
    if (root.confirm && !root.confirm(msg)) return;
    mt.winner = id; tResolve(t); Store.saveTournament(t); render(); UI.toast('Result updated');
  }

  function tNewTournament() {
    if (App.tournament && App.tournament.champion == null && root.confirm && !root.confirm('Discard the current tournament and start a new one?')) return;
    Store.clearTournament(); App.tournament = null; App.tMatch = null; App.tEdit = false;
    openTournamentSetup();
  }

  function undo() {
    if (!App.undoStack.length) return;
    App.match = App.undoStack.pop();
    App.curMult = 1;
    if (App.screen !== 'game') App.screen = 'game';
    persist(); render();
    Sound.play('tick');
  }

  // ---------------- multiple concurrent matches ----------------
  function newGameId() { return 'g' + Date.now() + '-' + Math.floor(Math.random() * 1000); }
  function gameById(id) { var list = Store.loadGames(); for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function upsertGame(m, immediate) {
    if (!m || !m.id) return;
    var list = Store.loadGames(), found = false;
    for (var i = 0; i < list.length; i++) if (list[i].id === m.id) { list[i] = m; found = true; break; }
    if (!found) list.push(m);
    if (immediate) Store.saveGamesNow(list); else Store.saveGames(list);
  }
  function removeGameFromStore(id) { Store.saveGamesNow(Store.loadGames().filter(function (g) { return g.id !== id; })); }

  function persist() { if (App.match && !App.match.finished) upsertGame(App.match, false); }
  function persistNow() { if (App.match && !App.match.finished) upsertGame(App.match, true); }

  function resumeGame(id) {
    var g = gameById(id);
    if (!g) { render(); return; }
    App.match = g; App.tMatch = g._tMatch || null;
    App.undoStack = []; App.curMult = 1; App.animating = false; App._anim = null;
    App.screen = 'game'; render();
  }
  function removeGame(id) {
    if (root.confirm && !root.confirm('Remove this match?')) return;
    removeGameFromStore(id);
    if (App.match && App.match.id === id) { App.match = null; App.tMatch = null; }
    render();
  }
  function doReset() {
    if (root.confirm && !root.confirm('Clear every match in progress, the tournament, and saved names for a fresh start?')) return;
    Store.clearGames(); Store.clearTournament(); Store.savePlayers(['Player 1', 'Player 2']);
    App.match = null; App.tournament = null; App.tMatch = null; App.tEdit = false;
    App.undoStack = []; App.animating = false; App._anim = null;
    App.screen = 'home'; render();
    UI.toast('Fresh start — ready for the next match');
  }

  // ---------------- event handlers ----------------
  function attachHandlers() {
    // low-latency scoring via pointerdown + lockout (kills iOS double-count)
    document.addEventListener('pointerdown', function (e) {
      if (App.animating) {                                  // a tap during the dart replay fast-forwards it
        Sound.unlock();
        if (App.screen === 'game') { if (e.cancelable) e.preventDefault(); skipReplay(); }
        return;
      }
      var k = e.target.closest && e.target.closest('.key, .mult');
      if (!k) { Sound.unlock(); return; }
      e.preventDefault();
      Sound.unlock(); requestWake();
      if (k.classList.contains('mult')) {
        if (k.disabled) return;
        App.curMult = +k.dataset.mult; syncMult(); Sound.play('tick'); return;
      }
      if (k.disabled || App.locked) return;
      App.locked = true; k.classList.add('is-pressed');
      setTimeout(function () { App.locked = false; }, 90);
      setTimeout(function () { k.classList.remove('is-pressed'); }, 120);
      if (k.dataset.act === 'next') { handleNext(); return; }
      var num = +k.dataset.num;
      var mult = k.dataset.mult ? +k.dataset.mult : App.curMult;
      if (num === 0) mult = 0;
      else if (!k.dataset.mult && App.match) {           // modes that demand a fixed multiplier (around: doubles/trebles)
        var Mk = Modes[App.match.modeId]; var fm = Mk.forcedMult ? Mk.forcedMult(App.match) : null; if (fm) mult = fm;
      }
      inputDart(mult, num);
    }, { passive: false });

    appEl.addEventListener('click', function (e) {
      if (App.animating || (nowMs() - (App._skipAt || 0) < 400)) return;   // ignore the click that follows a skip tap
      var t = e.target.closest('[data-act],[data-mode],[data-cfg],[data-toggle],[data-step],[data-rm],[data-set],[data-theme-set],[data-tmode],[data-tlegs],[data-tstart],[data-trm],[data-tformat],[data-tseedmode],[data-tpick],[data-resume-game],[data-rm-game],.modecard');
      if (!t) return;
      if (t.classList.contains('key') || t.classList.contains('mult')) return;
      handleClick(t);
    });

    appEl.addEventListener('input', function (e) {
      if (e.target && e.target.matches('input[data-pi]')) {
        var k = +e.target.dataset.pi;
        if (App.setupCtx && App.setupCtx.names[k] !== undefined) App.setupCtx.names[k] = e.target.value;
      } else if (e.target && e.target.matches('input[data-tpi]')) {
        var j = +e.target.dataset.tpi;
        if (App.tSetupCtx && App.tSetupCtx.names[j] !== undefined) App.tSetupCtx.names[j] = e.target.value;
      }
    });
  }

  function handleClick(t) {
    var ds = t.dataset;
    if (ds.rmGame) { removeGame(ds.rmGame); return; }       // × on a match row (check before resume)
    if (ds.resumeGame) { resumeGame(ds.resumeGame); return; }
    if (ds.mode) { openSetup(ds.mode); return; }
    if (ds.tmode) { syncNamesT(); App.tSetupCtx.modeId = ds.tmode; render(); return; }
    if (ds.tlegs) { syncNamesT(); App.tSetupCtx.legsToWin = +ds.tlegs; render(); return; }
    if (ds.tstart) { syncNamesT(); App.tSetupCtx.start = +ds.tstart; render(); return; }
    if (ds.tformat) { syncNamesT(); App.tSetupCtx.format = ds.tformat; render(); return; }
    if (ds.tseedmode) { syncNamesT(); App.tSetupCtx.seed = ds.tseedmode; render(); return; }
    if (ds.trm !== undefined) { App.tSetupCtx.names.splice(+ds.trm, 1); render(); return; }
    if (ds.tpick !== undefined) { var pk = parseRef(ds.tpick); tEditResult(pk.ref, pk.slot); return; }
    if (ds.cfg) { setConfig(ds.cfg, ds.val); syncNames(); render(); return; }
    if (ds.toggle) { var key = ds.toggle; App.setupCtx.config[key] = !App.setupCtx.config[key]; syncNames(); render(); return; }
    if (ds.step) { stepConfig(ds.step, +ds.d); syncNames(); render(); return; }
    if (ds.rm !== undefined) { App.setupCtx.names.splice(+ds.rm, 1); syncNames2remove(); render(); return; }
    if (ds.set) { toggleSetting(ds.set); return; }
    if (ds.themeSet) { App.settings.theme = ds.themeSet; applySettings(); Store.saveSettings(App.settings); render(); return; }

    var act = ds.act;
    if (!act) return;
    switch (act) {
      case 'home': goHome(); break;
      case 'menu': persistNow(); App.match = null; App.tMatch = null; App.screen = 'home'; render(); break;   // background this match
      case 'reset': doReset(); break;
      case 'history': App.screen = 'history'; render(); break;
      case 'settings': App.screen = 'settings'; render(); break;
      case 'tournament': openTournamentSetup(); break;
      case 'resumetourney': App.tEdit = false; App.screen = 'tournament'; render(); break;
      case 'tstart': startTournament(); break;
      case 'tplay': tPlayNext(); break;
      case 'taddp': syncNamesT(); if (App.tSetupCtx.names.length < 16) { App.tSetupCtx.names.push('Player ' + (App.tSetupCtx.names.length + 1)); render(); } break;
      case 'tthird': syncNamesT(); App.tSetupCtx.thirdPlace = !App.tSetupCtx.thirdPlace; render(); break;
      case 'tedit': App.tEdit = !App.tEdit; render(); break;
      case 'tbracket': tBackToBracket(); break;
      case 'tnew': tNewTournament(); break;
      case 'texit': App.tEdit = false; App.match = null; App.tMatch = null; App.screen = 'home'; render(); break;
      case 'install': installHint(); break;
      case 'addp': addPlayer(); break;
      case 'start': doStart(); break;
      case 'undo': undo(); break;
      case 'rematch': if (App.lastSetup) startMatch(App.lastSetup.modeId, App.lastSetup.config, App.lastSetup.names); break;
      case 'export': doExport(); break;
      case 'import': doImport(); break;
      case 'clearhist': Store.clearHistory(); render(); break;
    }
  }

  function syncNames2remove() { /* names already spliced; nothing else */ }

  function stepConfig(key, d) {
    var M = Modes[App.setupCtx.modeId];
    var field = (M.configFields || []).filter(function (f) { return f.key === key; })[0] || {};
    var cur = Number(App.setupCtx.config[key]) || 0;
    var nv = cur + d;
    if (field.min !== undefined) nv = Math.max(field.min, nv);
    if (field.max !== undefined) nv = Math.min(field.max, nv);
    App.setupCtx.config[key] = nv;
  }

  function addPlayer() {
    syncNames();
    if (App.setupCtx.names.length >= 8) return;
    App.setupCtx.names.push('Player ' + (App.setupCtx.names.length + 1));
    render();
  }

  function doStart() {
    syncNames();
    var names = App.setupCtx.names.filter(function (n) { return true; });
    if (names.length < 1) return;
    if (App.setupCtx.modeId === 'killer' && names.length < 2) { UI.toast('Killer needs 2+ players'); return; }
    Store.savePlayers(names);
    startMatch(App.setupCtx.modeId, App.setupCtx.config, names);
  }

  function goHome() {
    if (App.match && !App.match.finished) persistNow();
    App.match = null; App.tMatch = null;
    App.screen = 'home'; render();
  }

  function toggleSetting(key) {
    App.settings[key] = !App.settings[key];
    applySettings();
    Store.saveSettings(App.settings);
    if (key === 'sound' && App.settings.sound) Sound.play('leg');
    if (key === 'voice' && App.settings.voice) Sound.say('One hundred and eighty');
    render();
    if (key === 'tracer' && App.settings.tracer && root.Tracer) { setTimeout(function () { root.Tracer.shoot(E.dart(3, 20)); }, 120); UI.toast('Treble 20!'); }
  }

  function installHint() {
    if (isStandalone()) { UI.toast('Dart Shark is already installed ✓'); return; }
    UI.toast('Safari: Share  →  Add to Home Screen');
  }

  function doExport() {
    try {
      var data = Store.exportAll();
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'dart-shark-backup.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      UI.toast('Backup downloaded');
    } catch (e) {
      try { navigator.clipboard.writeText(Store.exportAll()); UI.toast('Backup copied to clipboard'); } catch (e2) { UI.toast('Export not available'); }
    }
  }
  function doImport() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () { try { Store.importAll(r.result); App.settings = Store.loadSettings(); applySettings(); UI.toast('Backup restored'); boot(); } catch (e) { UI.toast('Could not read backup'); } };
      r.readAsText(f);
    };
    inp.click();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // pure tournament helpers exposed for tests/scripting (no side effects)
  App._t = { build: buildTournament, resolve: tResolve, standings: tStandings, next: tNextMatch, name: tName, get: tGetMatch, seedSlots: seedSlots };

  root.DartShark = root.OCHE = App;
})(typeof window !== 'undefined' ? window : this);
