# 🦈🎯 Dart Shark — Dart Scorer

A fun, offline dart scoreboard built for the iPad. Premium dark/light UI, big
touch targets, a **golf-style shot tracer** on every dart, sound + an optional
voice caller, and 8 game modes. 100% vanilla JS/HTML/CSS — no build step, no
server-side code, no accounts, works offline.

## Put it on your iPad — two ways

**Double-click `Dart Shark.app`** on your Desktop first (it serves the app and
refreshes the downloadable file). Then either:

**A. Home-screen app (Mac stays on, same Wi-Fi)**
1. On the **iPad**, open **Safari** → the address it shows (e.g. `http://192.168.5.80:8099`).
2. Tap **Share → Add to Home Screen** — launches full-screen like a native app.

**B. Download & play anywhere, fully offline** ⬇️
1. **AirDrop `Dart Shark.html`** (sitting on your Desktop) to the iPad.
2. **Save to Files**, then open it (tap it in Files, or open in Safari). It's one
   self-contained file — runs offline with **no Mac and no Wi-Fi**.

Your games, tournaments & history are saved on the iPad either way. To rebuild the
single file by hand: `python3 ~/dart-shark/bundle.py`.

### Want it to work anywhere, fully offline?
Host the `~/dart-shark` folder on any free static host with **HTTPS**
(GitHub Pages, Netlify, Cloudflare Pages…). Over HTTPS the service worker caches
everything, so the home-screen app then works with no Wi-Fi at all. Over plain
LAN http, iOS won't enable the offline service worker — it still runs great while
this Mac is serving it.

## Game modes
- **501 / 301 / 701** — classic countdown, double-in/out, legs & sets, live
  checkout suggestions (`170 → T20 T20 Bull`), bust handling, 180 calls.
- **Cricket** (+ Cut Throat) — close 15–20 + bull, MPR stats.
- **Around the Clock** — race 1→20→Bull (singles / doubles / trebles).
- **Count-Up** — every dart scores, most points wins.
- **Bob's 27** — the doubles gauntlet, D1…D20, start on 27.
- **Shanghai** — round-number scoring, S+D+T = instant win.
- **Killer** — arm on your double, knock everyone else out.
- **Halve It** — hit the target or your score is halved.
- **🏆 Tournament** — single-elimination bracket for 2–16 players. Pick the match
  game + length, optional random draw; winners advance through the bracket (odd
  counts get byes) to a crowned champion. Saves & resumes mid-bracket.

## Scoring
Tap the **multiplier** (Single / Double / Treble), then the **number**; use
**25 / Bull** for the bull and **Miss** for a missed dart. Three dart slots fill
per visit, then it auto-advances. **Undo** rewinds dart-by-dart. The active
player's card glows; checkout routes appear when you're on a finish.

## Settings
Shot tracer · sound effects · voice caller · keep-screen-awake · light/dark ·
export / import backup. Everything is stored locally on the device.

## Run it on the Mac directly
```sh
python3 -m http.server 8099 --directory ~/dart-shark
# then open http://localhost:8099
```

## Files
```
index.html            app shell + iPad PWA meta
styles.css            design system (OKLCH tokens, one accent, tabular nums)
manifest.webmanifest  PWA manifest
sw.js                 service worker (network-first, offline fallback)
js/engine.js          dartboard math + checkout/bust logic
js/modes.js           the 8 game modes
js/tracer.js          golf-style shot tracer (canvas)
js/sound.js           synthesized Web Audio SFX + voice caller
js/storage.js         localStorage persistence + export/import
js/ui.js              screen renderers
js/app.js             controller: turns, legs/sets, undo, stats, lifecycle
icons/                app icon = dartboard clipped inside a CC0 shark
                      silhouette (freesvg.org); board-fill.png = tracer board
                      (see icons/NOTICE.txt for provenance)
```
Built honest-to-the-rules: bull = 50 = a valid double finish; bogey numbers
(159/162/163/165/166/168/169) show "no 3-dart out"; busts revert the whole visit.
