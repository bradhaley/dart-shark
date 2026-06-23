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
    if (ctx.hasTournament) resumes += '<button class="btn btn-accent btn-lg" data-act="resumetourney">' + (ctx.tournamentDone ? '🏆 View tournament ▸' : 'Resume tournament ▸') + '</button>';
    var cards = MODE_LIST.map(function (id) {
      var M = Modes[id];
      return '<button class="modecard" data-mode="' + id + '">' +
        '<span class="badge tnum" aria-hidden="true">' + h(M.badge) + '</span>' +
        '<h3>' + h(M.name) + '</h3><p>' + h(M.tagline) + '</p>' +
        '<span class="goal">' + h(M.goal) + '</span></button>';
    }).join('');
    return '<div class="screen home scroll">' +
      '<div class="home-head">' +
      '<img class="brand-mark" src="./icons/icon-192.png" alt="">' +
      '<div class="brand">DART SHARK</div><div class="tag">Dart scoreboard · pick a game</div></div>' +
      (resumes ? '<div class="home-actions">' + resumes + '</div>' : '') +
      '<div class="pad-x"><button class="btn tcta btn-block btn-lg" data-act="tournament">🏆 Run a Tournament</button></div>' +
      '<div class="section-label pad-x">Game modes</div>' +
      '<div class="modegrid">' + cards + '</div></div>';
  }

  // ---------------- TOURNAMENT helpers ----------------
  function entrantName(t, id) { if (id == null) return null; for (var i = 0; i < t.entrants.length; i++) if (t.entrants[i].id === id) return t.entrants[i].name; return null; }
  function tGetMatchUI(t, ref) { if (!ref) return null; if (ref.kind === 'rr') return t.fixtures[ref.i]; if (ref.kind === 'third') return t.third; return t.rounds[ref.round][ref.match]; }
  function refEq(a, b) { return !!a && !!b && a.kind === b.kind && a.round === b.round && a.match === b.match && a.i === b.i; }
  function refStr(ref) { if (ref.kind === 'rr') return 'rr:' + ref.i; if (ref.kind === 'third') return 'third'; return 'se:' + ref.round + ':' + ref.match; }
  function refLabel(t, ref) { if (!ref) return ''; if (ref.kind === 'third') return 'Third-place playoff'; if (ref.kind === 'rr') return 'Round-robin'; return roundLabel(t, ref.round); }
  function roundLabel(t, r) {
    var inRound = t.rounds[r].length;
    var names = { 1: 'Final', 2: 'Semi-finals', 4: 'Quarter-finals', 8: 'Round of 16', 16: 'Round of 32' };
    return names[inRound] || ('Round ' + (r + 1));
  }

  // ---------------- TOURNAMENT SETUP ----------------
  function tournamentSetup(ctx) {
    var names = ctx.names, M = Modes[ctx.modeId];
    var isSE = ctx.format !== 'rr';
    var nNamed = names.filter(function (n) { return String(n || '').trim() !== ''; }).length;
    var intro = isSE
      ? 'Single-elimination bracket — win to advance, last shark standing takes the crown. Any byes go to the top seeds.'
      : 'Round-robin — everyone plays everyone once; best record wins. Great for a small group where nobody wants to be knocked out early.';

    var html = '<div class="screen setup">' +
      '<div class="setup-head"><button class="icon-btn" data-act="home">‹ Back</button><h2>🏆 Tournament</h2></div>' +
      '<div class="setup-body scroll">';

    html += tseg('Format', 'tformat', [['se', 'Knockout'], ['rr', 'Round-robin']], ctx.format);
    html += '<p class="muted" style="margin:-8px 0 12px">' + h(intro) + '</p>';

    html += '<div class="field"><label>Players (2–16)</label><div class="players-list">';
    names.forEach(function (nm, i) {
      html += '<div class="player-row"><span class="player-dot" style="background:' + pc(i) + '"></span>' +
        '<input data-tpi="' + i + '" value="' + h(nm) + '" maxlength="16" placeholder="Player ' + (i + 1) + '">' +
        (names.length > 2 ? '<button class="rm" data-trm="' + i + '" aria-label="remove">×</button>' : '') + '</div>';
    });
    html += '</div>';
    if (names.length < 16) html += '<button class="btn btn-ghost add-player" data-act="taddp">+ Add player</button>';
    html += '</div>';

    var modeOpts = MODE_LIST.filter(function (id) { return id !== 'killer'; }).map(function (id) { return [id, Modes[id].name]; });
    html += tseg('Match game', 'tmode', modeOpts, ctx.modeId);
    if (ctx.modeId === 'x01') html += tseg('Start score', 'tstart', [[301, '301'], [501, '501'], [701, '701']], ctx.start);
    if (M.supportsLegs) html += tseg('Match length', 'tlegs', [[1, '1 leg'], [2, 'best of 3'], [3, 'best of 5']], ctx.legsToWin);
    if (isSE) html += tseg('Seeding', 'tseedmode', [['random', 'Random draw'], ['seeded', 'By entry (seeded)']], ctx.seed === 'random' ? 'random' : 'seeded');
    if (isSE && nNamed >= 4) html += '<div class="switch-row"><div><div class="lbl">Third-place playoff</div>' +
      '<div class="sub">losing semi-finalists play for bronze</div></div>' +
      '<button class="toggle" data-act="tthird" role="switch" aria-label="Third-place playoff" aria-pressed="' + (!!ctx.thirdPlace) + '"></button></div>';

    html += '</div>' +
      '<div class="bottombar"><button class="btn btn-accent btn-block btn-lg" data-act="tstart">Start ' + (isSE ? 'tournament' : 'round-robin') + ' ▸</button></div></div>';
    return html;
  }
  function tseg(label, attr, options, val) {
    var btns = options.map(function (o) {
      return '<button data-' + attr + '="' + o[0] + '" aria-pressed="' + (String(o[0]) === String(val)) + '">' + h(o[1]) + '</button>';
    }).join('');
    return '<div class="field"><label>' + h(label) + '</label><div class="seg seg-wrap">' + btns + '</div></div>';
  }

  // ---------------- TOURNAMENT BRACKET / TABLE ----------------
  function tournament(t, next, opts) {
    if (!t) return '<div class="screen"><div class="empty">No tournament.</div></div>';
    opts = opts || {};
    var edit = !!opts.edit, live = opts.live || null;
    var legsTxt = (t.config && t.config.legsToWin > 1) ? ' · best of ' + (t.config.legsToWin * 2 - 1) : '';
    var sub = (t.format === 'rr' ? 'Round-robin' : 'Knockout') + ' · ' + t.modeName + legsTxt + ' · ' + t.entrants.length + ' players';

    var hasResults = (t.format === 'rr')
      ? t.fixtures.some(function (f) { return f.winner != null; })
      : t.rounds.some(function (rd) { return rd.some(function (mt) { return mt.winner != null && mt.a != null && mt.b != null; }); });
    var editBtn = hasResults ? '<button class="icon-btn' + (edit ? ' edit-on' : '') + '" data-act="tedit">' + (edit ? 'Done' : 'Edit') + '</button>' : '';
    var head = '<div class="setup-head"><button class="icon-btn" data-act="texit">‹ Home</button>' +
      '<h2 style="flex:1">🏆 Tournament</h2>' + editBtn +
      '<button class="icon-btn" data-act="tnew">New</button></div>';

    var champ = champBanner(t);
    var cta = next ? ctaBlock(t, next, live) : '';
    var body = t.format === 'rr' ? rrBody(t, opts.standings, next, edit) : seBody(t, next, edit);

    return '<div class="screen tourney">' + head +
      '<div class="t-sub pad-x">' + h(sub) + '</div>' + champ + cta + body + '</div>';
  }

  function champBanner(t) {
    if (t.champion == null) return '';
    var third = (t.format === 'se' && t.third && t.third.winner != null)
      ? '<div class="champ-third">🥉 ' + h(entrantName(t, t.third.winner)) + ' — third place</div>' : '';
    return '<div class="champ-banner"><div class="champ-trophy">🏆</div>' +
      '<div class="champ-name">' + h(entrantName(t, t.champion)) + '</div><div class="champ-sub">Tournament champion</div>' +
      third + '<button class="btn btn-accent btn-lg" data-act="tnew" style="margin-top:10px">New tournament ▸</button></div>';
  }

  function ctaBlock(t, next, live) {
    var mt = tGetMatchUI(t, next), resuming = live && refEq(live, next);
    return '<div class="t-cta"><div class="t-cta-label">' + (resuming ? 'In progress' : 'Up next') + ' · ' + h(refLabel(t, next)) + '</div>' +
      '<div class="t-cta-match"><span>' + h(entrantName(t, mt.a)) + '</span><span class="vs">vs</span><span>' + h(entrantName(t, mt.b)) + '</span></div>' +
      '<button class="btn btn-accent btn-block btn-lg" data-act="tplay">' + (resuming ? 'Resume match ▸' : 'Play match ▸') + '</button></div>';
  }

  function matchCard(t, mt, ref, isLive, edit) {
    var aw = mt.winner != null && mt.winner === mt.a, bw = mt.winner != null && mt.winner === mt.b;
    var editable = edit && mt.a != null && mt.b != null;
    return '<div class="t-match' + (isLive ? ' live' : '') + (editable ? ' editable' : '') + '">' +
      tslot(t, mt, 'a', aw, ref, editable) + tslot(t, mt, 'b', bw, ref, editable) + '</div>';
  }
  function tslot(t, mt, which, won, ref, editable) {
    var id = which === 'a' ? mt.a : mt.b, empty = id == null;
    var byeOk = ref.kind === 'se' && ref.round === 0;   // only first-round empties are real byes; later empties are TBD
    var name = empty ? (byeOk ? '— bye' : 'TBD') : entrantName(t, id);
    var canPick = editable && !empty;
    var cls = 't-slot' + (won ? ' won' : '') + (empty ? (byeOk ? ' bye' : ' tbd') : '') + (canPick ? ' pickable' : '');
    var attr = canPick ? ' data-tpick="' + refStr(ref) + ':' + which + '" role="button"' : '';
    return '<div class="' + cls + '"' + attr + '><span class="t-slot-name">' + h(name) + '</span>' + (won ? '<span class="t-check">✓</span>' : '') + '</div>';
  }

  function seBody(t, next, edit) {
    var hint = edit ? '<div class="t-edithint pad-x">Tap a player in a finished match to make them the winner — later rounds reset.</div>' : '';
    var cols = t.rounds.map(function (round, r) {
      var rows = round.map(function (mt, k) {
        var ref = { kind: 'se', round: r, match: k };
        var isLive = next && next.kind === 'se' && next.round === r && next.match === k;
        return matchCard(t, mt, ref, isLive, edit);
      }).join('');
      return '<div class="t-col"><div class="t-col-h">' + h(roundLabel(t, r)) + '</div><div class="t-col-body">' + rows + '</div></div>';
    }).join('');
    var thirdCol = '';
    if (t.third) {
      thirdCol = '<div class="t-col t-col-third"><div class="t-col-h">Third place</div><div class="t-col-body">' +
        matchCard(t, t.third, { kind: 'third' }, next && next.kind === 'third', edit) + '</div></div>';
    }
    return hint + '<div class="t-bracket scroll">' + cols + thirdCol + '</div>';
  }

  function rrBody(t, standings, next, edit) {
    standings = standings || [];
    var rows = standings.map(function (s) {
      var lead = s.rank === 1 && s.played > 0 && t.champion != null;
      return '<tr' + (lead ? ' class="lead"' : '') + '><td class="t-rank tnum">' + s.rank + '</td>' +
        '<td class="t-pname">' + h(s.name) + '</td>' +
        '<td class="tnum">' + s.played + '</td><td class="tnum">' + s.wins + '</td><td class="tnum">' + s.losses + '</td>' +
        '<td class="tnum t-pts">' + (s.wins * 2) + '</td></tr>';
    }).join('');
    var table = '<div class="t-standings"><table class="t-table"><thead><tr>' +
      '<th></th><th class="t-th-name">Player</th><th>P</th><th>W</th><th>L</th><th>Pts</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';

    var byRound = {};
    t.fixtures.forEach(function (f, i) { (byRound[f.round] = byRound[f.round] || []).push({ f: f, i: i }); });
    var hint = edit ? '<div class="t-edithint">Tap a player in a finished match to change who won.</div>' : '';
    var groups = Object.keys(byRound).map(function (rk) {
      var items = byRound[rk].map(function (o) {
        var ref = { kind: 'rr', i: o.i }, isLive = next && next.kind === 'rr' && next.i === o.i;
        return matchCard(t, o.f, ref, isLive, edit);
      }).join('');
      return '<div class="t-rr-round"><div class="t-col-h">Round ' + (+rk + 1) + '</div><div class="t-rr-matches">' + items + '</div></div>';
    }).join('');

    return '<div class="t-scroll scroll pad-x">' + table + hint + '<div class="t-fixtures">' + groups + '</div></div>';
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
      html += seg('Legs' + (cfg.setsToWin > 1 ? ' per set' : ''), 'legsToWin', [[1, '1'], [2, 'first to 2'], [3, 'first to 3'], [5, 'first to 5']], cfg.legsToWin);
      html += seg('Sets', 'setsToWin', [[1, '1'], [2, 'first to 2'], [3, 'first to 3']], cfg.setsToWin || 1);
    }
    if (M.id === 'cricket') {
      html += switchRow('Cut Throat', 'points go to opponents — lowest wins', 'cutThroat', cfg.cutThroat);
      html += seg('Legs' + (cfg.setsToWin > 1 ? ' per set' : ''), 'legsToWin', [[1, '1'], [2, 'first to 2'], [3, 'first to 3']], cfg.legsToWin);
      html += seg('Sets', 'setsToWin', [[1, '1'], [2, 'first to 2'], [3, 'first to 3']], cfg.setsToWin || 1);
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
      '<button class="toggle" data-toggle="' + key + '" role="switch" aria-label="' + h(label) + '" aria-pressed="' + (!!val) + '"></button></div>';
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
    var inT = !!m._tMatch;
    var meta = [];
    if (inT && m._tInfo && m._tInfo.label) meta.push('🏆 ' + m._tInfo.label);
    meta.push(M.name);
    if (M.supportsLegs) { meta.push('Leg ' + m.leg); if (m.config.setsToWin > 1) meta.push('Set ' + (sum(m.setWins) + 1)); }
    if (M.roundBased) meta.push('Round ' + Math.min(m.round, m.roundLimit) + '/' + m.roundLimit);

    var backBtn = inT ? '<button class="icon-btn" data-act="tbracket">‹ Bracket</button>' : '<button class="icon-btn" data-act="menu">‹ Menu</button>';
    var html = '<div class="screen game">' +
      '<div class="topbar">' +
      backBtn +
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
    var forced = M.forcedMult ? M.forcedMult(m) : null;     // around: doubles/trebles lock the multiplier
    var keys = '';
    for (var n = 1; n <= 20; n++) {
      var off = keyNums && keyNums.indexOf(n) === -1;
      keys += '<button class="key tnum" data-num="' + n + '"' + (off ? ' disabled' : '') + '>' + n + '</button>';
    }
    var bullOff = (keyNums && keyNums.indexOf(25) === -1) || M.noBull;   // modes where the bull never scores
    var total = m.turn.scored ? '+' + m.turn.scored : '';

    function mult(val, lbl, ok) {
      var pressed = forced ? (forced === val) : (val === 1);
      var dis = forced ? (forced !== val) : !ok;
      return '<button class="mult" data-mult="' + val + '"' + (dis ? ' disabled' : '') + ' aria-pressed="' + pressed + '">' + lbl + '</button>';
    }

    return '<div class="entry">' +
      '<div class="turnstrip">' +
      '<div class="darts">' + pips + '</div>' +
      '<div class="turn-total tnum">' + h(total) + '</div></div>' +
      '<div class="mults' + (forced ? ' locked' : '') + '">' +
      mult(1, 'Single', true) + mult(2, 'Double', allowD) + mult(3, 'Treble', allowT) + '</div>' +
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
    var sub = M.goal;
    if (M.supportsLegs && m.config.legsToWin > 1) {
      var sw = m.setWins[m.winner], lw = m.legWins[m.winner];
      sub = sw ? ('won ' + sw + (sw === 1 ? ' set' : ' sets')) : ('won ' + lw + (lw === 1 ? ' leg' : ' legs'));
    }
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
      '<button class="toggle" data-set="' + key + '" role="switch" aria-label="' + h(label) + '" aria-pressed="' + (!!val) + '"></button></div>';
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
  // turn-total popup shown after the three darts replay (the requested "pop up total score")
  function turnTotal(n, kind) {
    fxEl = fxEl || document.getElementById('fx');
    if (!fxEl) return;
    var big = kind === 'bust' ? 'BUST' : String(n);
    var sub = kind === '180' ? 'maximum!' : kind === 'ton' ? 'ton+!' : kind === 'bust' ? 'no score' : 'scored';
    fxEl.innerHTML = (kind === '180' ? confetti() : '') +
      '<div class="fx-card"><div class="fx-big fx-total' + (kind === 'bust' ? ' danger' : '') + '">' + h(big) + '</div>' +
      '<div class="fx-sub">' + h(sub) + '</div></div>';
    clearTimeout(celebrate._t);
    celebrate._t = setTimeout(function () { if (fxEl) fxEl.innerHTML = ''; }, 1500);
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

  root.UI = { home: home, setup: setup, game: game, over: over, history: history, settings: settings, tournamentSetup: tournamentSetup, tournament: tournament, celebrate: celebrate, toast: toast, turnTotal: turnTotal };
})(typeof window !== 'undefined' ? window : this);
