/* Dart Shark storage — versioned localStorage for in-progress game, history, settings. */
(function (root) {
  'use strict';
  var K_GAME = 'oche.game.v1';
  var K_HIST = 'oche.history.v1';
  var K_SET = 'oche.settings.v1';
  var K_PLAYERS = 'oche.players.v1';
  var K_TOURN = 'oche.tournament.v1';

  function read(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
  }

  var saveTimer = null;
  function saveGame(match) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { write(K_GAME, match); }, 350);
  }
  function saveGameNow(match) { clearTimeout(saveTimer); write(K_GAME, match); }
  function loadGame() { return read(K_GAME, null); }
  function clearGame() { try { localStorage.removeItem(K_GAME); } catch (e) {} }

  function pushHistory(entry) {
    var h = read(K_HIST, []);
    h.unshift(entry);
    if (h.length > 60) h = h.slice(0, 60);
    write(K_HIST, h);
  }
  function loadHistory() { return read(K_HIST, []); }
  function clearHistory() { write(K_HIST, []); }

  function saveTournament(t) { write(K_TOURN, t); }
  function loadTournament() { return read(K_TOURN, null); }
  function clearTournament() { try { localStorage.removeItem(K_TOURN); } catch (e) {} }

  function loadSettings() {
    var s = read(K_SET, null) || {};
    return {
      sound: s.sound !== undefined ? s.sound : true,
      voice: s.voice !== undefined ? s.voice : false,
      theme: s.theme || 'dark',
      wake: s.wake !== undefined ? s.wake : true,
      tracer: s.tracer !== undefined ? s.tracer : true
    };
  }
  function saveSettings(s) { write(K_SET, s); }

  function loadPlayers() { return read(K_PLAYERS, ['Player 1', 'Player 2']); }
  function savePlayers(names) { write(K_PLAYERS, names); }

  function exportAll() {
    return JSON.stringify({ v: 1, game: loadGame(), history: loadHistory(), settings: loadSettings(),
      players: loadPlayers(), tournament: loadTournament() }, null, 2);
  }
  function importAll(text) {
    var data = JSON.parse(text);
    if (data.game !== undefined) write(K_GAME, data.game);
    if (data.history) write(K_HIST, data.history);
    if (data.settings) write(K_SET, data.settings);
    if (data.players) write(K_PLAYERS, data.players);
    if (data.tournament !== undefined) write(K_TOURN, data.tournament);
    return true;
  }

  root.Store = {
    saveGame: saveGame, saveGameNow: saveGameNow, loadGame: loadGame, clearGame: clearGame,
    pushHistory: pushHistory, loadHistory: loadHistory, clearHistory: clearHistory,
    loadSettings: loadSettings, saveSettings: saveSettings,
    loadPlayers: loadPlayers, savePlayers: savePlayers,
    saveTournament: saveTournament, loadTournament: loadTournament, clearTournament: clearTournament,
    exportAll: exportAll, importAll: importAll
  };
})(typeof window !== 'undefined' ? window : this);
