/* Dart Shark UI — HTML builders + celebration/toast. Pure-ish (returns strings; small DOM fx). */
(function (root) {
  'use strict';
  var Modes = root.Modes, MODE_LIST = root.MODE_LIST, E = root.Engine;

  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function pc(i) { return 'var(--p' + (i % 8) + ')'; }

  // ---------------- HOME ----------------
  function home(ctx) {
    var resumes = '';
    if (ctx.hasGame) resumes += '<button class="btn btn-accent btn-lg" data-act="resume">Resume game ▸</button>';
    if (ctx.hasTournament) resumes += '<button class="btn btn-accent btn-lg" data-act="resumetourney">Resume tournament ▸</button>';
    var cards = MODE_LIST.map(function (id) {
      var M = Modes[id];
      return '<button class="modecard" data-mode="' + id + '">' +
        '<span class="badge tnum">' + h(M.badge) + '</span>' +
        '<h3>' + h(M.name) + '</h3><p>' + h(M.tagline) + '</p>' +
        '<span class="goal">' + h(M.goal) + '</span></button>';
    }).join('');
    return '<div class="screen home scroll">' +
      '<div class="home-head">' +
      '<img class="brand-mark" src="./icons/icon-192.png" alt="">' +
      '<div class="brand">DART SHARK</div><div class="tag">Dart scoreboard · pick a game</div></div>' +
      (resumes ? '<div class="home-actions">' + resumes + '</div>' : '') +
      '<div class="home-actions">' +
      '<button class="icon-btn" data-act="history">History</button>' +
      '<button class="icon-btn" data-act="settings">Settings</button>' +
      '<button class="icon-btn" data-act="install">Add to iPad</button></div>' +
      '<div class="pad-x"><button class="btn tcta btn-block btn-lg" data-act="tournament">🏆 Run a Tournament</button></div>' +
      '<div class="section-label pad-x">Game modes</div>' +
      '<div class="modegrid">' + cards + '</div></div>';
  }

  // ---------------- TOURNAMENT SETUP ----------------
  function tournamentSetup(ctx) {
    var names = ctx.names;
    var html = '<div class="screen setup">' +
      '<div class="setup-head"><button class="icon-btn" data-act="home">‹ Back</button><h2>🏆 Tournament</h2></div>' +
      '<div class="setup-body scroll">' +
      '<p class="muted" style="margin:0 0 6px">Single-elimination bracket — winners advance, last shark standing takes the crown. Odd numbers get a bye.</p>';
    html += '<div class="field"><label>Players (2–16)</label><div class="players-list">';
    names.forEach(function (nm, i) {
      html += '<div class="player-row"><span class="player-dot" style="background:' + pc(i) + '"></span>' +
        '<input data-tpi="' + i + '" value="' + h(nm) + '" maxlength="16" placeholder="Player ' + (i + 1) + '">' +
        (names.length > 2 ? '<button class="rm" data-trm="' + i + '" aria-label="remove">×</button>' : '') + '</div>';
    });
    html += '</div>';
    if (names.length < 16) html += '<button class="btn btn-ghost add-player" data-act="taddp">+ Add player</button>';
    html += '</div>';

    // game mode for each match
    var modeOpts = MODE_LIST.filter(function (id) { return id !== 'killer'; })
      .map(function (id) { return [id, Modes[id].name]; });
    html += tseg('Match game', 'tmode', modeOpts, ctx.modeId);
    if (ctx.modeId === 'x01') html += tseg('Start score', 'tstart', [[301, '301'], [501, '501'], [701, '701']], ctx.start);
    html += tseg('Match length', 'tlegs', [[1, '1 leg'], [2, 'best of 3'], [3, 'best of 5']], ctx.legsToWin);
    html += '<div class="switch-row"><div><div class="lbl">Random draw</div>' +
      '<div class="sub">shuffle the bracket seeding</div></div>' +
      '<button class="toggle" data-act="tseed" aria-pressed="' + (!!ctx.seedRandom) + '"></button></div>';

    html += '</div>' +
      '<div class="bottombar"><button class="btn btn-accent btn-block btn-lg" data-act="tstart">Start tournament ▸</button></div></div>';
    return html;
  }
  function tseg(label, attr, options, val) {
    var btns = options.map(function (o) {
      return '<button data-' + attr + '="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(val)) + '">' + h(o[1]) + '</button>';
    }).join('');
    return '<div class="field"><label>' + h(label) + '</label><div class="seg seg-wrap">' + btns + '</div></div>';
  }

  // ---------------- TOURNAMENT BRACKET ----------------
  function tournament(t, next) {
    if (!t) return '<div class="screen"><div class="empty">No tournament.</div></div>';
    var sub = t.modeName + (t.config && t.config.legsToWin > 1 ? ' · best of ' + (t.config.legsToWin * 2 - 1) : '') + ' · ' + t.names.length + ' players';
    var head = '<div class="setup-head"><button class="icon-btn" data-act="texit">‹ Home</button>' +
      '<h2>🏆 Tournament</h2><button class="icon-btn" data-act="tnew">New</button></div>';

    var champ = '';
    if (t.champion) {
      champ = '<div class="champ-banner"><div class="champ-trophy">🏆</div>' +
        '<div class="champ-name">' + h(t.champion) + '</div><div class="champ-sub">Tournament champion</div>' +
        '<button class="btn btn-accent btn-lg" data-act="tnew" style="margin-top:10px">New tournament ▸</button></div>';
    }

    var cta = '';
    if (next) {
      var mt = t.rounds[next.round][next.match];
      cta = '<div class="t-cta"><div class="t-cta-label">Up next · ' + h(roundLabel(t, next.round)) + '</div>' +
        '<div class="t-cta-match"><span>' + h(mt.a) + '</span><span class="vs">vs</span><span>' + h(mt.b) + '</span></div>' +
        '<button class="btn btn-accent btn-block btn-lg" data-act="tplay">Play match ▸</button></div>';
    }

    var cols = t.rounds.map(function (round, r) {
      var rows = round.map(function (mt) {
        var aw = mt.winner && mt.winner === mt.a, bw = mt.winner && mt.winner === mt.b;
        var live = next && t.rounds[next.round][next.match] === mt;
        return '<div class="t-match' + (live ? ' live' : '') + '">' +
          slot(mt.a, aw) + slot(mt.b, bw) + '</div>';
      }).join('');
      return '<div class="t-col"><div class="t-col-h">' + h(roundLabel(t, r)) + '</div>' + rows + '</div>';
    }).join('');

    return '<div class="screen tourney">' + head +
      '<div class="t-sub pad-x">' + h(sub) + '</div>' +
      champ + cta +
      '<div class="t-bracket scroll">' + cols + '</div></div>';
  }
  function slot(name, won) {
    var cls = 't-slot' + (won ? ' won' : '') + (name ? '' : ' bye');
    return '<div class="' + cls + '">' + (name ? h(name) : '—') + (won ? '<span class="t-check">✓</span>' : '') + '</div>';
  }
  function roundLabel(t, r) {
    var inRound = t.rounds[r].length;
    var names = { 1: 'Final', 2: 'Semi-finals', 4: 'Quarter-finals', 8: 'Round of 16', 16: 'Round of 32' };
    return names[inRound] || ('Round ' + (r + 1));
  }

  // ---------------- SETUP ----------------
  function setup(ctx) {
    var M = Modes[ctx.modeId], cfg = ctx.config, names = ctx.names;
    var html = '<div class="screen setup">' +
      '<div class="setup-head"><button class="icon-btn" data-act="home">‹ Back</button><h2>' + h(M.name) + '</h2></div>' +
      '<div class="setup-body scroll">' +
      '<p class="muted" style="margin:0 0 6px">' + h(M.tagline) + '</p>';

    // players
    html += '<div class="field"><label>Players</label><div class="players-list">';
    names.forEach(function (nm, i) {
      html += '<div class="player-row"><span class="player-dot" style="background:' + pc(i) + '"></span>' +
        '<input data-pi="' + i + '" value="' + h(nm) + '" maxlength="16" placeholder="Player ' + (i + 1) + '">' +
        (names.length > 1 ? '<button class="rm" data-rm="' + i + '" aria-label="remove">×</button>' : '') + '</div>';
    });
    html += '</div>';
    if (names.length < 8) html += '<button class="btn btn-ghost add-player" data-act="addp">+ Add player</button>';
    html += '</div>';

    // x01 options
    if (M.id === 'x01') {
      html += seg('Start score', 'start', [[301, '301'], [501, '501'], [701, '701']], cfg.start);
      html += switchRow('Double out', 'finish on a double (standard)', 'doubleOut', cfg.doubleOut);
      html += switchRow('Double in', 'must hit a double to start scoring', 'doubleIn', cfg.doubleIn);
      html += seg('Best of (legs)', 'legsToWin', [[1, '1'], [2, 'best 3'], [3, 'best 5'], [5, 'best 9']], cfg.legsToWin);
    }
    if (M.id === 'cricket') {
      html += switchRow('Cut Throat', 'points go to opponents — lowest wins', 'cutThroat', cfg.cutThroat);
      html += seg('Best of (legs)', 'legsToWin', [[1, '1'], [2, 'best 3'], [3, 'best 5']], cfg.legsToWin);
    }
    // generic config fields
    (M.configFields || []).forEach(function (f) {
      if (f.type === 'select') html += seg(f.label, f.key, f.options, cfg[f.key]);
      else if (f.type === 'number') html += stepper(f.label, f.key, cfg[f.key], f.min, f.max);
    });

    html += '</div>' +
      '<div class="bottombar"><button class="btn btn-accent btn-block btn-lg" data-act="start">Start game ▸</button></div></div>';
    return html;
  }
  function seg(label, key, options, val) {
    var btns = options.map(function (o) { return '<button data-cfg="' + key + '" data-val="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(val)) + '">' + h(o[1]) + '</button>'; }).join('');
    return '<div class="field"><label>' + h(label) + '</label><div class="seg">' + btns + '</div></div>';
  }
  function switchRow(label, sub, key, val) {
    return '<div class="switch-row"><div><div class="lbl">' + h(label) + '</div><div class="sub">' + h(sub) + '</div></div>' +
      '<button class="toggle" data-toggle="' + key + '" aria-pressed="' + (!!val) + '"></button></div>';
  }
  function stepper(label, key, val, min, max) {
    return '<div class="field"><label>' + h(label) + '</label><div class="seg">' +
      '<button data-step="' + key + '" data-d="-1">−</button>' +
      '<button class="tnum" style="min-width:60px;background:var(--bg-3);color:var(--text)" data-stepval="' + key + '">' + h(val) + '</button>' +
      '<button data-step="' + key + '" data-d="1">+</button></div><input type="hidden" data-cfgmin="' + min + '" data-cfgmax="' + max + '"></div>';
  }

  // ---------------- GAME ----------------
  function game(m) {
    var M = Modes[m.modeId];
    var meta = [M.name];
    if (M.supportsLegs) { meta.push('Leg ' + m.leg); if (m.config.setsToWin > 1) meta.push('Set ' + (sum(m.setWins) + 1)); }
    if (M.roundBased) meta.push('Round ' + Math.min(m.round, m.roundLimit) + '/' + m.roundLimit);

    var html = '<div class="screen game">' +
      '<div class="topbar">' +
      '<button class="icon-btn" data-act="menu">‹ Menu</button>' +
      '<div class="match-meta">' + h(meta.join(' · ')) + '</div>' +
      '<button class="icon-btn" data-act="undo"' + (m.canUndo ? '' : ' disabled') + '>Undo</button></div>' +
      '<div class="game-main">' +
      '<div class="scoreboard" data-n="' + m.ps.length + '">' + m.ps.map(function (_, i) { return pcard(m, M, i); }).join('') + '</div>' +
      entry(m, M) + '</div></div>';
    return html;
  }

  function pcard(m, M, i) {
    var d = M.display(m, i), active = i === m.current && !m.finished;
    var cls = 'pcard' + (active ? ' active' : '') + (m.ps[i].out ? ' out' : '');
    var wins = '';
    if (M.supportsLegs && m.config.legsToWin > 1) { var w = m.legWins[i] || 0; wins = '<span class="pwins">' + dots(w) + '</span>'; }
    var statline = M.statLines(m, i).slice(0, 3).map(function (s) { return '<span>' + h(label(s.label)) + ' <b class="tnum">' + h(s.value) + '</b></span>'; }).join('');

    var extra = '';
    if (d.cricket) extra = cmarks(d.cricket);
    if (d.lives) extra = lives(d.lives);

    return '<article class="' + cls + '" style="--pc:' + pc(i) + '" data-p="' + i + '">' +
      '<div class="pcard-top"><span class="pname">' + h(m.players[i].name) + '</span>' +
      (active ? '<span class="throw-tag">throwing</span>' : wins) + '</div>' +
      '<div class="pbig tnum">' + h(d.primary) + '</div>' +
      '<div class="psub">' + h(d.sub || '') + '</div>' +
      (d.target ? '<div class="ptarget tnum">' + h(d.target) + '</div>' : '<div class="ptarget"></div>') +
      extra +
      '<div class="pstats tnum">' + statline + '</div></article>';
  }
  function cmarks(marks) {
    var order = [20, 19, 18, 17, 16, 15, 25];
    return '<div class="cmarks">' + order.map(function (n) {
      var v = marks[n] || 0, sym = v >= 3 ? '✕' : v === 2 ? '/' : v === 1 ? '\\' : '·';
      if (v >= 3) sym = '⊗';
      return '<div class="cmark m' + v + '"><span class="n">' + (n === 25 ? 'B' : n) + '</span><span class="m">' + sym + '</span></div>';
    }).join('') + '</div>';
  }
  function lives(l) {
    if (l.out) return '<div class="lives"><span class="armed-badge" style="color:var(--red)">ELIMINATED</span></div>';
    var pips = ''; for (var k = 0; k < l.max; k++) pips += '<span class="life' + (k < l.n ? '' : ' lost') + '"></span>';
    return '<div class="lives">' + pips + (l.killer ? '<span class="armed-badge">ARMED</span>' : '') + '</div>';
  }

  function entry(m, M) {
    var dl = 3 - m.turn.darts.length;
    var pips = '';
    for (var i = 0; i < 3; i++) {
      var d = m.turn.darts[i];
      pips += '<div class="dpip' + (d ? ' filled' : '') + '">' + (d ? h(E.dartLabel(d)) : '·') + '</div>';
    }
    var allowT = M.allow(m, 20).T, allowD = M.allow(m, 20).D;
    var keyNums = M.keyNumbers || null;
    var keys = '';
    for (var n = 1; n <= 20; n++) {
      var off = keyNums && keyNums.indexOf(n) === -1;
      keys += '<button class="key tnum" data-num="' + n + '"' + (off ? ' disabled' : '') + '>' + n + '</button>';
    }
    var bullOff = keyNums && keyNums.indexOf(25) === -1;
    var total = m.turn.scored ? '+' + m.turn.scored : '';

    return '<div class="entry">' +
      '<div class="turnstrip">' +
      '<div class="darts">' + pips + '</div>' +
      '<div class="turn-total tnum">' + h(total) + '</div></div>' +
      '<div class="mults">' +
      '<button class="mult" data-mult="1" aria-pressed="true">Single</button>' +
      '<button class="mult" data-mult="2"' + (allowD ? '' : ' disabled') + ' aria-pressed="false">Double</button>' +
      '<button class="mult" data-mult="3"' + (allowT ? '' : ' disabled') + ' aria-pressed="false">Treble</button></div>' +
      '<div class="pad">' + keys + '</div>' +
      '<div class="pad-special">' +
      '<button class="key miss" data-num="0">Miss</button>' +
      '<button class="key outer tnum" data-num="25" data-mult="1"' + (bullOff ? ' disabled' : '') + '>25</button>' +
      '<button class="key bull" data-num="25" data-mult="2"' + (bullOff ? ' disabled' : '') + '>Bull</button>' +
      '<button class="key next" data-act="next">' + (dl === 3 ? 'Skip ▸' : 'Next ▸') + '</button></div></div>';
  }

  // ---------------- GAME OVER ----------------
  function over(m) {
    var M = Modes[m.modeId];
    var rows = m.rank.map(function (i, pos) {
      var s = m.stats[i], detail;
      if (M.id === 'x01') detail = 'avg <b>' + avg3(s) + '</b> · 180s <b>' + s.c180 + '</b>';
      else if (M.id === 'cricket') detail = 'MPR <b>' + (s.rounds ? (s.marks / s.rounds).toFixed(2) : '0.00') + '</b>';
      else detail = M.statLines(m, i)[0].label + ' <b>' + M.statLines(m, i)[0].value + '</b>';
      return '<div class="rank-row' + (pos === 0 ? ' first' : '') + '">' +
        '<span class="rank-pos">' + (pos === 0 ? '🏆' : '#' + (pos + 1)) + '</span>' +
        '<span class="rank-name">' + h(m.players[i].name) + '</span>' +
        '<span class="rank-stat tnum">' + detail + '</span></div>';
    }).join('');
    var champ = m.players[m.winner].name;
    var sub = M.supportsLegs && m.config.legsToWin > 1 ? ('won ' + (m.setWins[m.winner] ? m.setWins[m.winner] + ' set' : m.legWins[m.winner] + ' legs')) : M.goal;
    return '<div class="screen over scroll">' +
      '<div class="over-head"><div class="trophy">🏆</div><h1>' + h(champ) + ' wins!</h1>' +
      '<div class="winsub">' + h(M.name) + ' · ' + h(sub) + '</div></div>' +
      '<div class="rank-list">' + rows + '</div>' +
      '<div class="bottombar"><button class="btn btn-ghost" data-act="home">Home</button>' +
      '<button class="btn btn-accent btn-block btn-lg" data-act="rematch">Rematch ▸</button></div></div>';
  }

  // ---------------- HISTORY ----------------
  function history(list) {
    var body = !list.length ? '<div class="empty">No games yet. Play one!</div>' :
      list.map(function (e) {
        return '<div class="card hist-row"><div><div class="hist-mode">' + h(e.mode) + '</div>' +
          '<div class="hist-sub">' + h(e.players.join(', ')) + ' · ' + h(e.date) + '</div></div>' +
          '<div class="hist-win">🏆 ' + h(e.winner) + '</div></div>';
      }).join('');
    return '<div class="screen scroll">' +
      '<div class="list-head"><button class="icon-btn" data-act="home">‹ Back</button><h2>History</h2>' +
      (list.length ? '<button class="icon-btn" data-act="clearhist">Clear</button>' : '') + '</div>' + body + '</div>';
  }

  // ---------------- SETTINGS ----------------
  function settings(s, standalone) {
    return '<div class="screen scroll">' +
      '<div class="list-head"><button class="icon-btn" data-act="home">‹ Back</button><h2>Settings</h2></div>' +
      '<div class="card">' +
      srow('Shot tracer', 'golf-style glowing arc to the segment you hit', 'tracer', s.tracer) +
      srow('Sound effects', 'synthesized clicks & cheers', 'sound', s.sound) +
      srow('Voice caller', 'announces your score out loud', 'voice', s.voice) +
      srow('Keep screen awake', 'stop the iPad sleeping mid-game', 'wake', s.wake) +
      '<div class="switch-row"><div><div class="lbl">Theme</div><div class="sub">light or dark</div></div>' +
      '<div class="seg"><button data-theme-set="dark" aria-pressed="' + (s.theme !== 'light') + '">Dark</button>' +
      '<button data-theme-set="light" aria-pressed="' + (s.theme === 'light') + '">Light</button></div></div>' +
      '</div>' +
      '<div class="card"><div class="row spread"><div class="lbl">Your data</div></div>' +
      '<p class="tiny muted">Games & history live only on this device. Back them up here.</p>' +
      '<div class="row"><button class="btn btn-ghost" data-act="export">Export backup</button>' +
      '<button class="btn btn-ghost" data-act="import">Import</button></div></div>' +
      '<div class="card"><div class="lbl">Add Dart Shark to your iPad</div>' +
      '<p class="tiny muted">In Safari, tap the <b>Share</b> icon → <b>Add to Home Screen</b>. ' +
      (standalone ? 'You are running the installed app. ✓' : 'It then runs full-screen and offline like a native app.') + '</p></div>' +
      '<div class="center muted tiny" style="padding:20px">Dart Shark · built for the oche · v1</div></div>';
  }
  function srow(label, sub, key, val) {
    return '<div class="switch-row"><div><div class="lbl">' + h(label) + '</div><div class="sub">' + h(sub) + '</div></div>' +
      '<button class="toggle" data-set="' + key + '" aria-pressed="' + (!!val) + '"></button></div>';
  }

  // ---------------- FX ----------------
  var fxEl;
  function celebrate(kind, big, sub, hold) {
    fxEl = fxEl || document.getElementById('fx');
    var danger = kind === 'bust' || kind === 'eliminated' || kind === 'halve';
    var conf = (kind === 'win' || kind === '180' || kind === 'leg' || kind === 'shanghai');
    fxEl.innerHTML = (conf ? confetti() : '') +
      '<div class="fx-card' + (hold ? ' hold' : '') + '"><div class="fx-big' + (danger ? ' danger' : '') + '">' + h(big) + '</div>' +
      (sub ? '<div class="fx-sub">' + h(sub) + '</div>' : '') + '</div>';
    clearTimeout(celebrate._t);
    celebrate._t = setTimeout(function () { if (fxEl) fxEl.innerHTML = ''; }, hold ? 2200 : 1500);
  }
  function confetti() {
    var cols = ['var(--accent)', 'var(--green)', 'var(--red)', 'var(--blue)', 'var(--accent-2)'];
    var s = '<div class="confetti">';
    for (var i = 0; i < 36; i++) {
      var left = Math.round(Math.random() * 100), dur = (1.1 + Math.random() * 1.3).toFixed(2), delay = (Math.random() * 0.5).toFixed(2);
      s += '<i style="left:' + left + '%;background:' + cols[i % cols.length] + ';animation-duration:' + dur + 's;animation-delay:' + delay + 's"></i>';
    }
    return s + '</div>';
  }
  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  // helpers
  function dots(n) { var s = ''; for (var i = 0; i < n; i++) s += '●'; return s || '○'; }
  function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function avg3(s) { return s.darts ? ((s.points / s.darts) * 3).toFixed(1) : '0.0'; }
  function label(l) { return l.replace('3-dart avg', 'avg').replace('Checkout', 'co'); }

  root.UI = { home: home, setup: setup, game: game, over: over, history: history, settings: settings, tournamentSetup: tournamentSetup, tournament: tournament, celebrate: celebrate, toast: toast };
})(typeof window !== 'undefined' ? window : this);
