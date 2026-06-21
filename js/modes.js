/* Dart Shark game modes. Each mode plugs into the controller in app.js.
   Interface per mode:
     id, name, tagline, goal, badge
     supportsLegs (x01/cricket), defaults, configFields
     init(m)            set up m.ps[] (per-player) + m.ms (mode state)
     newLeg(m)          reset scoring fields for a new leg (legs modes)
     beginTurn(m)       snapshot anything needed for bust-revert
     applyDart(m,d)     -> { scored, bust, win, turnEnd, event }
     endTurn(m)         -> optional finalize; may set m._win / eliminate
     display(m,i)       -> { primary, sub, target, chips:[...] }
     allow(m, value)    -> { D:bool, T:bool } which multipliers are legal for a value
     statLines(m,i)     -> [{label,value}]
     rank(m)            -> array of player indices best->worst (for round-limited finishes)
*/
(function (root) {
  'use strict';
  var E = root.Engine;
  var P = E.points;

  function opps(m, i) { var a = []; for (var j = 0; j < m.ps.length; j++) if (j !== i) a.push(j); return a; }
  function dartsLeft(m) { return 3 - m.turn.darts.length; }
  function live(m, i) { return !m.ps[i].out; }

  // ---------------------------------------------------------------- X01
  var x01 = {
    id: 'x01', name: '501', tagline: 'The classic countdown. Finish on a double.',
    goal: 'First to zero', badge: '501', supportsLegs: true,
    defaults: { start: 501, doubleOut: true, doubleIn: false, legsToWin: 1, setsToWin: 1, preferredDouble: 32 },
    init: function (m) {
      m.ps = m.players.map(function () { return { score: m.config.start, opened: !m.config.doubleIn }; });
    },
    newLeg: function (m) {
      m.ps.forEach(function (p) { p.score = m.config.start; p.opened = !m.config.doubleIn; });
    },
    beginTurn: function (m) { var p = m.ps[m.current]; m.turn.snap = { score: p.score, opened: p.opened }; },
    applyDart: function (m, d) {
      var p = m.ps[m.current], cfg = m.config, last = dartsLeft(m) === 0;
      // double-in gate
      if (cfg.doubleIn && !p.opened) {
        if (!(E.isDouble(d))) return { scored: 0, turnEnd: last, sub: 'need a double to start' };
        p.opened = true; // and this dart counts below
      }
      var pts = P(d), ns = p.score - pts, bust = false, win = false, ev = null;
      if (ns < 0) bust = true;
      else if (ns === 0) {
        if (!cfg.doubleOut || E.isDouble(d)) { p.score = 0; win = true; ev = 'leg'; }
        else bust = true;
      } else if (ns === 1 && cfg.doubleOut) bust = true;
      else p.score = ns;

      if (bust) { p.score = m.turn.snap.score; p.opened = m.turn.snap.opened; return { scored: 0, bust: true, turnEnd: true, event: 'bust' }; }
      // visit-level ton / 180 detection happens in endTurn via stats; per-dart event for win only
      return { scored: pts, win: win, turnEnd: win || last, event: ev };
    },
    display: function (m, i) {
      var p = m.ps[i], target = null;
      if (i === m.current && p.opened) {
        if (E.isBogey(p.score) || p.score > 170) target = p.score <= 170 ? 'No 3-dart out' : null;
        else if (p.score <= 170 && p.score >= 2) {
          var r = E.checkoutRoute(p.score, dartsLeft(m), { doubleOut: m.config.doubleOut, straightOut: !m.config.doubleOut, preferredDouble: m.config.preferredDouble });
          target = r ? E.routeLabel(r) : (p.score <= 170 ? 'No 3-dart out' : null);
        }
      }
      var sub = !p.opened ? 'double to start' : (p.score <= 50 ? 'on a finish' : '');
      return { primary: p.score, sub: sub, target: target };
    },
    allow: function (m, v) { return { D: true, T: v !== 25 }; },
    statLines: function (m, i) {
      var s = m.stats[i];
      return [
        { label: '3-dart avg', value: avg3(s) },
        { label: 'Darts', value: s.darts },
        { label: '180s', value: s.c180 },
        { label: 'Ton+', value: s.cTon },
        { label: 'High', value: s.high },
        { label: 'Checkout', value: s.bestCheckout || '—' }
      ];
    }
  };

  // ---------------------------------------------------------------- Cricket
  var CR_NUMS = [20, 19, 18, 17, 16, 15, 25];
  var cricket = {
    id: 'cricket', name: 'Cricket', tagline: 'Close 15–20 and the bull. Score on what you own.',
    goal: 'Close all + lead on points', badge: '◎', supportsLegs: true,
    keyNumbers: [15, 16, 17, 18, 19, 20, 25],
    defaults: { cutThroat: false, legsToWin: 1, setsToWin: 1 },
    init: function (m) {
      m.ps = m.players.map(function () { var marks = {}; CR_NUMS.forEach(function (n) { marks[n] = 0; }); return { marks: marks, points: 0 }; });
    },
    newLeg: function (m) { this.init(m); },
    beginTurn: function () {},
    applyDart: function (m, d) {
      var i = m.current, p = m.ps[i], last = dartsLeft(m) === 0, ev = null;
      var n = d.value, add = d.mult;
      if (CR_NUMS.indexOf(n) === -1 || d.mult === 0) return { scored: 0, marks: 0, turnEnd: last };
      var before = p.marks[n], capacity = Math.max(0, 3 - before);
      var closing = Math.min(add, capacity);
      p.marks[n] = before + closing;
      var scoringMarks = add - closing;
      if (before < 3 && p.marks[n] === 3) ev = 'close';
      var gained = 0;
      if (scoringMarks > 0) {
        var face = n; // bull face = 25
        if (m.config.cutThroat) {
          opps(m, i).forEach(function (j) { if (m.ps[j].marks[n] < 3) { m.ps[j].points += scoringMarks * face; } });
        } else {
          var someOpen = opps(m, i).some(function (j) { return m.ps[j].marks[n] < 3; });
          if (someOpen) { gained = scoringMarks * face; p.points += gained; }
        }
      }
      var win = this._winner(m, i);
      return { scored: gained, marks: add, win: win, turnEnd: win || last, event: win ? 'leg' : ev };
    },
    _allClosed: function (m, i) { return CR_NUMS.every(function (n) { return m.ps[i].marks[n] >= 3; }); },
    _winner: function (m, i) {
      if (!this._allClosed(m, i)) return false;
      var pts = m.ps[i].points, os = opps(m, i);
      if (m.config.cutThroat) return os.every(function (j) { return pts <= m.ps[j].points; });
      return os.every(function (j) { return pts >= m.ps[j].points; });
    },
    display: function (m, i) {
      var p = m.ps[i];
      // aim = highest open number this player hasn't closed
      var aim = null;
      for (var k = 0; k < CR_NUMS.length; k++) { if (p.marks[CR_NUMS[k]] < 3) { aim = CR_NUMS[k]; break; } }
      return { primary: p.points, sub: 'points', target: i === m.current && aim ? 'Aim: ' + (aim === 25 ? 'Bull' : aim) : null, cricket: p.marks };
    },
    allow: function (m, v) { return { D: true, T: v !== 25 }; },
    statLines: function (m, i) {
      var s = m.stats[i];
      return [
        { label: 'Points', value: m.ps[i].points },
        { label: 'MPR', value: s.rounds ? (s.marks / s.rounds).toFixed(2) : '0.00' },
        { label: 'Marks', value: s.marks },
        { label: 'Darts', value: s.darts }
      ];
    }
  };

  // ---------------------------------------------------------------- Around the Clock
  var SEQ = (function () { var a = []; for (var n = 1; n <= 20; n++) a.push(n); a.push(25); return a; })();
  var around = {
    id: 'around', name: 'Around the Clock', tagline: 'Hit 1 → 20 → Bull in order. First home wins.',
    goal: 'First to finish the board', badge: '↻', supportsLegs: false,
    defaults: { mode: 'single' }, // single | double | treble
    configFields: [{ key: 'mode', label: 'Must hit', type: 'select', options: [['single', 'Any (singles)'], ['double', 'Doubles only'], ['treble', 'Trebles only']] }],
    init: function (m) { m.ps = m.players.map(function () { return { idx: 0 }; }); },
    beginTurn: function () {},
    applyDart: function (m, d) {
      var p = m.ps[m.current], last = dartsLeft(m) === 0, target = SEQ[p.idx];
      var need = m.config.mode;
      var hit = d.value === target && (need === 'single' || (need === 'double' && d.mult === 2) || (need === 'treble' && d.mult === 3 && target !== 25));
      if (target === 25 && d.value === 25 && need !== 'treble') hit = (need === 'single') || (need === 'double' && d.mult === 2);
      var ev = null, win = false;
      if (hit) { p.idx++; ev = 'advance'; if (p.idx >= SEQ.length) { win = true; ev = 'leg'; } }
      return { scored: hit ? 1 : 0, win: win, turnEnd: win || last, event: ev };
    },
    display: function (m, i) {
      var p = m.ps[i], t = p.idx >= SEQ.length ? '✓' : SEQ[p.idx];
      return { primary: t === 25 ? 'Bull' : t, sub: p.idx >= SEQ.length ? 'finished' : 'on ' + (p.idx + 1) + ' / 21', target: i === m.current && p.idx < SEQ.length ? 'Aim: ' + (SEQ[p.idx] === 25 ? 'Bull' : SEQ[p.idx]) : null };
    },
    allow: function (m, v) { return { D: true, T: v !== 25 }; },
    statLines: function (m, i) { return [{ label: 'Reached', value: m.ps[i].idx >= SEQ.length ? 'Bull ✓' : (SEQ[m.ps[i].idx]) }, { label: 'Darts', value: m.stats[i].darts }]; },
    rank: function (m) { return order(m, function (i) { return m.ps[i].idx; }, true); }
  };

  // ---------------------------------------------------------------- Count-Up
  var countup = {
    id: 'countup', name: 'Count-Up', tagline: 'Every dart scores. Most points after the rounds wins.',
    goal: 'Highest score', badge: '＋', supportsLegs: false, roundBased: true,
    defaults: { rounds: 8 },
    configFields: [{ key: 'rounds', label: 'Rounds', type: 'number', min: 3, max: 20 }],
    init: function (m) { m.ps = m.players.map(function () { return { total: 0 }; }); m.roundLimit = m.config.rounds; },
    beginTurn: function () {},
    applyDart: function (m, d) {
      var p = m.ps[m.current], pts = P(d); p.total += pts;
      return { scored: pts, turnEnd: dartsLeft(m) === 0 };
    },
    display: function (m, i) { return { primary: m.ps[i].total, sub: 'points' }; },
    allow: function () { return { D: true, T: true }; },
    statLines: function (m, i) { return [{ label: 'Score', value: m.ps[i].total }, { label: '3-dart avg', value: avg3(m.stats[i]) }, { label: 'High', value: m.stats[i].high }]; },
    rank: function (m) { return order(m, function (i) { return m.ps[i].total; }, true); }
  };

  // ---------------------------------------------------------------- Bob's 27
  var bobs = {
    id: 'bobs27', name: "Bob's 27", tagline: 'Doubles gauntlet: D1…D20. Start on 27, miss a double and pay.',
    goal: 'Survive & score highest', badge: '27', supportsLegs: false, roundBased: true,
    defaults: {},
    init: function (m) { m.ps = m.players.map(function () { return { total: 27, out: false }; }); m.roundLimit = 20; },
    beginTurn: function (m) { m.turn.hits = 0; },
    applyDart: function (m, d) {
      var p = m.ps[m.current], round = m.round, last = dartsLeft(m) === 0, ev = null;
      if (E.isDouble(d) && d.value === round) { m.turn.hits++; p.total += 2 * round; ev = 'advance'; }
      return { scored: ev ? 2 * round : 0, turnEnd: last, event: ev };
    },
    endTurn: function (m) {
      var p = m.ps[m.current], round = m.round;
      if (m.turn.hits === 0) { p.total -= 2 * round; }
      if (p.total < 0) { p.out = true; return { event: 'eliminated' }; }
    },
    display: function (m, i) { var p = m.ps[i]; return { primary: p.out ? 'OUT' : p.total, sub: p.out ? '' : 'points', target: i === m.current && !p.out ? 'Aim: D' + m.round : null }; },
    allow: function (m, v) { return { D: true, T: false }; },
    statLines: function (m, i) { return [{ label: 'Score', value: m.ps[i].out ? 'OUT' : m.ps[i].total }, { label: 'Darts', value: m.stats[i].darts }]; },
    rank: function (m) { return order(m, function (i) { return m.ps[i].out ? -1 : m.ps[i].total; }, true); }
  };

  // ---------------------------------------------------------------- Shanghai
  var shanghai = {
    id: 'shanghai', name: 'Shanghai', tagline: 'Rounds 1–7. Only the round number scores. S+D+T = instant win!',
    goal: 'Highest score (or a Shanghai!)', badge: '上', supportsLegs: false, roundBased: true,
    defaults: { rounds: 7 },
    configFields: [{ key: 'rounds', label: 'Rounds', type: 'select', options: [[7, '1–7 (classic)'], [20, '1–20 (long)']] }],
    init: function (m) { m.ps = m.players.map(function () { return { total: 0 }; }); m.roundLimit = m.config.rounds; },
    beginTurn: function (m) { m.turn.sh = {}; },
    applyDart: function (m, d) {
      var p = m.ps[m.current], round = m.round, last = dartsLeft(m) === 0, gained = 0, ev = null;
      if (d.value === round && d.mult > 0) { gained = d.mult * round; p.total += gained; m.turn.sh[d.mult] = true; }
      return { scored: gained, turnEnd: last, event: ev };
    },
    endTurn: function (m) {
      var sh = m.turn.sh || {};
      if (sh[1] && sh[2] && sh[3]) { m._win = m.current; m._shanghai = true; return { win: true, event: 'shanghai' }; }
    },
    display: function (m, i) { return { primary: m.ps[i].total, sub: 'points', target: i === m.current ? 'Round ' + m.round + ': hit ' + m.round + 's' : null }; },
    allow: function (m, v) { return { D: true, T: v !== 25 }; },
    statLines: function (m, i) { return [{ label: 'Score', value: m.ps[i].total }, { label: 'Darts', value: m.stats[i].darts }]; },
    rank: function (m) { return order(m, function (i) { return m.ps[i].total; }, true); }
  };

  // ---------------------------------------------------------------- Killer
  var killer = {
    id: 'killer', name: 'Killer', tagline: 'Hit your double to arm up, then knock out everyone else.',
    goal: 'Last player standing', badge: '☠', supportsLegs: false,
    defaults: { lives: 3, selfKill: true },
    configFields: [{ key: 'lives', label: 'Lives', type: 'number', min: 1, max: 9 }],
    init: function (m) {
      var taken = {};
      m.ps = m.players.map(function (pl, idx) {
        var num = pl.killerNumber;
        if (!num) { do { num = 1 + Math.floor(Math.random() * 20); } while (taken[num]); }
        taken[num] = true;
        return { number: num, lives: m.config.lives, killer: false, out: false };
      });
    },
    beginTurn: function () {},
    applyDart: function (m, d) {
      var i = m.current, p = m.ps[i], last = dartsLeft(m) === 0, ev = null;
      if (d.mult === 0 || d.value === 25) return { scored: 0, turnEnd: last };
      if (!p.killer) {
        if (d.value === p.number && E.isDouble(d)) { p.killer = true; ev = 'advance'; }
        return { scored: 0, turnEnd: last, event: ev };
      }
      // armed
      if (d.value === p.number) {
        if (m.config.selfKill) { p.lives -= d.mult; ev = 'self'; if (p.lives <= 0) { p.lives = 0; p.out = true; ev = 'eliminated'; } }
      } else {
        for (var j = 0; j < m.ps.length; j++) {
          if (j !== i && m.ps[j].number === d.value && !m.ps[j].out) {
            m.ps[j].lives -= d.mult; ev = 'hit';
            if (m.ps[j].lives <= 0) { m.ps[j].lives = 0; m.ps[j].out = true; ev = 'eliminated'; }
          }
        }
      }
      var aliveCount = m.ps.filter(function (x) { return !x.out; }).length;
      var win = aliveCount <= 1 && m.ps.length > 1;
      return { scored: 0, win: win, turnEnd: win || last, event: win ? 'leg' : ev };
    },
    display: function (m, i) {
      var p = m.ps[i];
      return { primary: p.out ? '☠' : '#' + p.number, sub: p.out ? 'eliminated' : (p.killer ? 'ARMED' : 'hit D' + p.number + ' to arm'), lives: { n: p.lives, max: m.config.lives, killer: p.killer, out: p.out } };
    },
    allow: function (m, v) { return { D: true, T: v !== 25 }; },
    statLines: function (m, i) { return [{ label: 'Number', value: '#' + m.ps[i].number }, { label: 'Lives', value: m.ps[i].out ? 0 : m.ps[i].lives }, { label: 'Armed', value: m.ps[i].killer ? 'yes' : 'no' }]; }
  };

  // ---------------------------------------------------------------- Halve It
  var HALVE_TARGETS = [{ t: 15 }, { t: 16 }, { t: 'D' }, { t: 17 }, { t: 18 }, { t: 'T' }, { t: 19 }, { t: 20 }, { t: 'B' }];
  function targetLabel(t) { return t === 'D' ? 'Any Double' : t === 'T' ? 'Any Treble' : t === 'B' ? 'Bull' : t; }
  var halveit = {
    id: 'halveit', name: 'Halve It', tagline: 'Hit the round target — miss it and your score is HALVED.',
    goal: 'Highest score', badge: '½', supportsLegs: false, roundBased: true,
    defaults: { startScore: 40 },
    init: function (m) { m.ps = m.players.map(function () { return { total: m.config.startScore }; }); m.roundLimit = HALVE_TARGETS.length; },
    beginTurn: function (m) { m.turn.hits = 0; },
    applyDart: function (m, d) {
      var p = m.ps[m.current], last = dartsLeft(m) === 0, tg = HALVE_TARGETS[m.round - 1].t, gained = 0;
      var hit = false;
      if (tg === 'D') hit = E.isDouble(d);
      else if (tg === 'T') hit = E.isTriple(d);
      else if (tg === 'B') hit = d.value === 25;
      else hit = d.value === tg && d.mult > 0;
      if (hit) { gained = P(d); p.total += gained; m.turn.hits++; }
      return { scored: gained, turnEnd: last, event: hit ? 'advance' : null };
    },
    endTurn: function (m) { var p = m.ps[m.current]; if (m.turn.hits === 0) { p.total = Math.floor(p.total / 2); return { event: 'halve' }; } },
    display: function (m, i) { return { primary: m.ps[i].total, sub: 'points', target: i === m.current ? 'Hit: ' + targetLabel(HALVE_TARGETS[m.round - 1].t) : null }; },
    allow: function (m, v) { var tg = HALVE_TARGETS[m.round - 1] ? HALVE_TARGETS[m.round - 1].t : 0; return { D: true, T: v !== 25 }; },
    statLines: function (m, i) { return [{ label: 'Score', value: m.ps[i].total }, { label: 'Darts', value: m.stats[i].darts }]; },
    rank: function (m) { return order(m, function (i) { return m.ps[i].total; }, true); }
  };

  // ---- helpers ----
  function avg3(s) { return s.darts ? ((s.points / s.darts) * 3).toFixed(1) : '0.0'; }
  function order(m, valFn, desc) {
    var idx = m.ps.map(function (_, i) { return i; });
    idx.sort(function (a, b) { return desc ? valFn(b) - valFn(a) : valFn(a) - valFn(b); });
    return idx;
  }

  root.Modes = { x01: x01, cricket: cricket, around: around, countup: countup, bobs27: bobs, shanghai: shanghai, killer: killer, halveit: halveit };
  root.MODE_LIST = ['x01', 'cricket', 'around', 'countup', 'bobs27', 'shanghai', 'killer', 'halveit'];
})(typeof window !== 'undefined' ? window : this);
