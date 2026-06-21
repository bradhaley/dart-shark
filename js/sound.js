/* Dart Shark sound — synthesized Web Audio (no files) + optional voice caller.
   iPad Safari has no working navigator.vibrate, so tactile feedback = crisp
   audio ticks + visual press. Audio context is unlocked on first user gesture. */
(function (root) {
  'use strict';
  var ctx = null, master = null;
  var enabled = true, voiceOn = false;

  function ensure() {
    if (ctx) return ctx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    return ctx;
  }
  function unlock() { var c = ensure(); if (c && c.state === 'suspended') c.resume(); }

  function tone(freq, t0, dur, type, gain, slideTo) {
    var c = ensure(); if (!c || !enabled) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.25, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(t0, dur, gain) {
    var c = ensure(); if (!c || !enabled) return;
    var n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var g = c.createGain(); g.gain.value = gain || 0.2;
    var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    src.connect(f); f.connect(g); g.connect(master); src.start(t0);
  }

  var SFX = {
    tick: function () { var c = ensure(); if (!c) return; tone(880, c.currentTime, 0.03, 'square', 0.12); },
    dart: function () { var c = ensure(); if (!c) return; noise(c.currentTime, 0.05, 0.18); tone(420, c.currentTime, 0.05, 'triangle', 0.1); },
    advance: function () { var c = ensure(); if (!c) return; tone(660, c.currentTime, 0.08, 'sine', 0.18, 990); },
    ton: function () { var c = ensure(); if (!c) return; var t = c.currentTime;[523, 659, 784].forEach(function (f, i) { tone(f, t + i * 0.06, 0.18, 'triangle', 0.18); }); },
    big180: function () { var c = ensure(); if (!c) return; var t = c.currentTime;[523, 659, 784, 1046].forEach(function (f, i) { tone(f, t + i * 0.09, 0.4, 'sawtooth', 0.16); }); noise(t, 0.3, 0.1); },
    bust: function () { var c = ensure(); if (!c) return; tone(220, c.currentTime, 0.3, 'sawtooth', 0.22, 90); },
    halve: function () { var c = ensure(); if (!c) return; tone(330, c.currentTime, 0.35, 'square', 0.18, 110); },
    eliminated: function () { var c = ensure(); if (!c) return; tone(300, c.currentTime, 0.5, 'sawtooth', 0.2, 70); },
    leg: function () { var c = ensure(); if (!c) return; var t = c.currentTime;[659, 784, 1046, 1318].forEach(function (f, i) { tone(f, t + i * 0.1, 0.3, 'triangle', 0.18); }); },
    match: function () { var c = ensure(); if (!c) return; var t = c.currentTime;[523, 659, 784, 1046, 1318, 1568].forEach(function (f, i) { tone(f, t + i * 0.11, 0.45, 'sawtooth', 0.16); }); noise(t + 0.2, 0.5, 0.08); }
  };

  function play(name) { if (!enabled) return; var fn = SFX[name]; if (fn) try { fn(); } catch (e) {} }

  // ---- voice caller (SpeechSynthesis) ----
  function say(text) {
    if (!voiceOn || !root.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
      root.speechSynthesis.cancel();
      root.speechSynthesis.speak(u);
    } catch (e) {}
  }
  var NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  function words(n) {
    if (n <= 20) return NUM_WORDS[n];
    if (n < 100) { var t = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']; var r = n % 10; return t[Math.floor(n / 10)] + (r ? '-' + NUM_WORDS[r] : ''); }
    var h = Math.floor(n / 100), rem = n % 100; return NUM_WORDS[h] + ' hundred' + (rem ? ' and ' + words(rem) : '');
  }
  function callScore(total) {
    if (!voiceOn) return;
    if (total === 180) say('One hundred and eighty!');
    else say(words(total));
  }

  root.Sound = {
    unlock: unlock, play: play,
    setEnabled: function (b) { enabled = b; if (b) unlock(); },
    setVoice: function (b) { voiceOn = b; if (b) unlock(); },
    isEnabled: function () { return enabled; }, isVoice: function () { return voiceOn; },
    callScore: callScore, say: say
  };
})(typeof window !== 'undefined' ? window : this);
