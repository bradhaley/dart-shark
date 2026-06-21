/* Dart Shark app controller — routing, match engine glue, events, iPad lifecycle. */
(function (root) {
  'use strict';
  var Modes = root.Modes, E = root.Engine, UI = root.UI, Sound = root.Sound, Store = root.Store;
  var appEl, fxReady = false;

  var App = {
    screen: 'home', settings: null, match: null, undoStack: [],
    setupCtx: null, lastSetup: null, curMult: 1, locked: false, hasGame: false, wakeLock: null,
    tournament: null, tMatch: null, tSetupCtx: null
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
    var tr = Store.loadTournament();
    App.tournament = (tr && !tr.champion) ? tr : null;
    var g = Store.loadGame();
    App.hasGame = !!(g && !g.finished);
    App.match = (g && !g.finished) ? g : null;
    if (App.match && App.match._tMatch) App.tMatch = App.match._tMatch;   // resume a tourney match
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
      case 'tournament': html = UI.tournament(App.tournament, tNextMatch(App.tournament)); break;
      default:
        App.hasGame = !!(App.match && !App.match.finished);
        html = UI.home({ hasGame: App.hasGame, hasTournament: !!App.tournament });
    }
    appEl.innerHTML = html;
    if (App.screen === 'game') { syncMult(); requestWake(); }
  }
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function syncMult() {
    var btns = document.querySelectorAll('.mult');
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', (+btns[i].dataset.mult === App.curMult) + '');
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
      modeId: modeId, config: clone(config), players: players,
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
    var m = App.match; if (!m || m.finished) return;
    if (m.turn.darts.length >= 3) return;
    var d = value === 0 ? E.miss() : E.dart(mult, value);
    snapshot();
    m.turn.darts.push(d);
    var res = Modes[m.modeId].applyDart(m, d) || {};
    m.turn.scored = (m.turn.scored || 0) + (res.scored || 0);
    m.turn.marks = (m.turn.marks || 0) + (res.marks || 0);
    App.curMult = 1;
    if (value !== 0 && App.settings.tracer && root.Tracer) root.Tracer.shoot(d);
    if (value === 0) Sound.play('dart');
    else if (res.event === 'advance') Sound.play('advance');
    else Sound.play('tick');
    if (res.turnEnd) endVisit(res);
    else { persist(); render(); }
  }

  function handleNext() {
    var m = App.match; if (!m || m.finished) return;
    snapshot();
    endVisit({ skipped: true });
  }

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

    var win = !!(res.win || endRes.win || m._win != null);
    var winner = m._win != null ? m._win : i;
    var isShanghai = !!m._shanghai;

    // checkout record (x01 finishing visit)
    if (M.id === 'x01' && res.win && m.turn.snap) { var co = m.turn.snap.score; if (co > s.bestCheckout) s.bestCheckout = co; }

    // celebration (priority order); skip scoring cheers when busting
    if (win) {
      handleWin(winner, isShanghai);
      return;
    }
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
    Store.clearGame();
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

  // ---------------- tournament (single-elimination bracket) ----------------
  var ROUND_NAMES = { 1: 'Final', 2: 'Semi-finals', 4: 'Quarter-finals', 8: 'Round of 16', 16: 'Round of 32' };
  function roundName(matchesInRound) { return ROUND_NAMES[matchesInRound] || ('Round of ' + matchesInRound * 2); }

  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function buildTournament(names, modeId, config, seedRandom) {
    names = names.map(function (n, i) { return (String(n || '').trim()) || ('Player ' + (i + 1)); });
    if (seedRandom) names = shuffle(names.slice());
    var size = 2; while (size < names.length) size *= 2;
    var slots = names.slice(); while (slots.length < size) slots.push(null);   // pad with byes
    var rounds = [], r0 = [];
    for (var i = 0; i < size; i += 2) r0.push({ a: slots[i], b: slots[i + 1], winner: null });
    rounds.push(r0);
    var count = r0.length;
    while (count > 1) { var rr = []; for (var j = 0; j < count / 2; j++) rr.push({ a: null, b: null, winner: null }); rounds.push(rr); count = count / 2; }
    var t = { modeId: modeId, config: clone(config), modeName: Modes[modeId].name, names: names,
      rounds: rounds, champion: null, createdAt: Date.now() };
    tResolve(t);
    return t;
  }

  function tResolve(t) {
    for (var r = 0; r < t.rounds.length; r++) {
      var round = t.rounds[r];
      for (var k = 0; k < round.length; k++) {
        var mt = round[k];
        if (mt.winner == null) {                                  // bye auto-advance
          if (mt.a && !mt.b) mt.winner = mt.a;
          else if (mt.b && !mt.a) mt.winner = mt.b;
        }
        if (mt.winner != null && r + 1 < t.rounds.length) {
          var nm = t.rounds[r + 1][Math.floor(k / 2)];
          if (k % 2 === 0) nm.a = mt.winner; else nm.b = mt.winner;
        }
      }
    }
    var last = t.rounds[t.rounds.length - 1][0];
    t.champion = last.winner || null;
  }

  function tNextMatch(t) {
    if (!t) return null;
    for (var r = 0; r < t.rounds.length; r++) {
      var round = t.rounds[r];
      for (var k = 0; k < round.length; k++) {
        var mt = round[k];
        if (mt.a && mt.b && mt.winner == null) return { round: r, match: k };
      }
    }
    return null;
  }

  function openTournamentSetup() {
    var names = Store.loadPlayers();
    if (!names || names.length < 2) names = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];
    App.tSetupCtx = { names: names.slice(0, 16), modeId: 'x01', start: 501, legsToWin: 1, seedRandom: true };
    App.screen = 'tsetup'; render();
  }

  function startTournament() {
    syncNamesT();
    var ctx = App.tSetupCtx;
    var names = ctx.names.filter(function (n) { return String(n || '').trim() !== ''; });
    if (names.length < 2) { UI.toast('Add at least 2 players'); return; }
    Store.savePlayers(names);
    var cfg = clone(Modes[ctx.modeId].defaults || {});
    cfg.setsToWin = 1; cfg.legsToWin = ctx.legsToWin || 1;
    if (ctx.modeId === 'x01') cfg.start = ctx.start;
    App.tournament = buildTournament(names, ctx.modeId, cfg, ctx.seedRandom);
    Store.saveTournament(App.tournament);
    App.screen = 'tournament'; render();
  }

  function syncNamesT() {
    var ins = document.querySelectorAll('input[data-tpi]');
    for (var i = 0; i < ins.length; i++) { var k = +ins[i].dataset.tpi; if (App.tSetupCtx.names[k] !== undefined) App.tSetupCtx.names[k] = ins[i].value; }
  }

  function tPlayNext() {
    var t = App.tournament, pos = tNextMatch(t);
    if (!pos) return;
    var mt = t.rounds[pos.round][pos.match];
    startMatch(t.modeId, t.config, [mt.a, mt.b]);
    App.tMatch = pos;                                              // set AFTER startMatch (it clears it)
    App.match._tMatch = pos;                                       // so a mid-match resume re-links
    persistNow();
  }

  function tournamentMatchDone(i) {
    var t = App.tournament, pos = App.tMatch;
    var winnerName = App.match.players[i].name;
    t.rounds[pos.round][pos.match].winner = winnerName;
    tResolve(t);
    App.tMatch = null; App.match = null;
    Store.clearGame();
    Store.saveTournament(t);
    App.screen = 'tournament';
    render();
    if (t.champion) {
      Sound.play('match');
      UI.celebrate('win', 'CHAMPION', t.champion + ' wins the tournament', true);
      if (App.settings.voice) Sound.say('Champion, ' + t.champion);
    }
  }

  function undo() {
    if (!App.undoStack.length) return;
    App.match = App.undoStack.pop();
    App.curMult = 1;
    if (App.screen !== 'game') App.screen = 'game';
    persist(); render();
    Sound.play('tick');
  }

  function persist() { if (App.match && !App.match.finished) Store.saveGame(App.match); }
  function persistNow() { if (App.match && !App.match.finished) Store.saveGameNow(App.match); }

  // ---------------- event handlers ----------------
  function attachHandlers() {
    // low-latency scoring via pointerdown + lockout (kills iOS double-count)
    document.addEventListener('pointerdown', function (e) {
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
      inputDart(mult, num);
    }, { passive: false });

    appEl.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-mode],[data-cfg],[data-toggle],[data-step],[data-rm],[data-set],[data-theme-set],[data-tmode],[data-tlegs],[data-tstart],[data-trm],.modecard');
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
    if (ds.mode) { openSetup(ds.mode); return; }
    if (ds.tmode) { syncNamesT(); App.tSetupCtx.modeId = ds.tmode; render(); return; }
    if (ds.tlegs) { syncNamesT(); App.tSetupCtx.legsToWin = +ds.tlegs; render(); return; }
    if (ds.tstart) { syncNamesT(); App.tSetupCtx.start = +ds.tstart; render(); return; }
    if (ds.trm !== undefined) { App.tSetupCtx.names.splice(+ds.trm, 1); render(); return; }
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
      case 'menu': persistNow(); App.screen = 'home'; render(); break;
      case 'resume': App.screen = 'game'; App.undoStack = []; render(); break;
      case 'history': App.screen = 'history'; render(); break;
      case 'settings': App.screen = 'settings'; render(); break;
      case 'tournament': openTournamentSetup(); break;
      case 'resumetourney': App.screen = 'tournament'; render(); break;
      case 'tstart': startTournament(); break;
      case 'tplay': tPlayNext(); break;
      case 'taddp': syncNamesT(); if (App.tSetupCtx.names.length < 16) { App.tSetupCtx.names.push('Player ' + (App.tSetupCtx.names.length + 1)); render(); } break;
      case 'tseed': syncNamesT(); App.tSetupCtx.seedRandom = !App.tSetupCtx.seedRandom; render(); break;
      case 'tnew': Store.clearTournament(); App.tournament = null; App.tMatch = null; openTournamentSetup(); break;
      case 'texit': App.screen = 'home'; render(); break;
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
    App.hasGame = !!(App.match && !App.match.finished);
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

  root.DartShark = root.OCHE = App;
})(typeof window !== 'undefined' ? window : this);
