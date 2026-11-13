// Anime-Schmiede: Jeder zieht pro Runde einen zufälligen Anime-Charakter und setzt ihn in EINE von fünf Kategorien (jede Kategorie nur einmal).
// Pro Kategorie eine Runde (5, in den Nur-Anime-Modi 6). Danach wird verglichen: Wer in einer Kategorie den besten Wert hat, bekommt den Punkt. Die Werte bleiben bis zum Showdown geheim.
// Was die anderen gesetzt haben, sieht man erst, wenn man selbst gesetzt hat. Alle Werte liegen auf einer gemeinsamen Skala (1-100).
const CHARS = require('./anime_chars'); // [Name, Anime, Werte, Spezialwerte, Suchname, Bild-URL, Zusatznamen]
const RS = {
  mix: { name: 'Gemischt (alle Animes)', anime: null, cats: [['Stärke', '💪'], ['Geschwindigkeit', '💨'], ['Fähigkeiten', '⚡'], ['IQ', '🧠'], ['Zähigkeit', '🛡️']] },
  onepiece: { name: 'Nur One Piece', anime: 'One Piece', cats: [['Stärke', '💪'], ['Geschwindigkeit', '💨'], ['Haki', '👁️'], ['Teufelsfrucht', '🍎'], ['Zähigkeit', '🛡️'], ['IQ', '🧠']] },
  dragonball: { name: 'Nur Dragon Ball', anime: 'Dragon Ball', cats: [['Kampfkraft', '💥'], ['Geschwindigkeit', '💨'], ['Ki-Kontrolle', '✨'], ['Kampf-IQ', '🥋'], ['Zähigkeit', '🛡️'], ['IQ', '🧠']] },
  naruto: { name: 'Nur Naruto', anime: 'Naruto', cats: [['Ninjutsu', '🌀'], ['Taijutsu', '👊'], ['Genjutsu', '👁️'], ['Chakra', '🔋'], ['IQ', '🧠'], ['Kampf-IQ', '🥋']] },
};
const SPIN_MS = Number(process.env.ANIME_SPIN_MS) || 5200, BETWEEN_MS = Number(process.env.ANIME_BETWEEN_MS) || 3500, SHOW_MS = Number(process.env.ANIME_SHOW_MS) || 4200; // (Umgebungsvariablen nur für Tests)

const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const ci = (i) => (i === undefined || i === null ? null : { i, n: CHARS[i][0], a: CHARS[i][1], q: CHARS[i][4] || CHARS[i][0], img: CHARS[i][5] || null, alts: CHARS[i][6] || [], r: RAR[i] });
// Nur-Anime-Modi: Spezialwerte, innerhalb des Animes neu skaliert: schwächster Wert der Kategorie ≈ 1, stärkster = 100, dazwischen mit Kurve (so liegen die Abstände im eigenen Universum auseinander)
const RANGE = {}; Object.keys(RS).forEach((k) => { if (!RS[k].anime) return; const pool = CHARS.filter((c) => c[1] === RS[k].anime && c[3]); RANGE[k] = RS[k].cats.map((_, i) => [Math.min(...pool.map((c) => c[3][i])), Math.max(...pool.map((c) => c[3][i]))]); });
const scaleIn = (rs, cat, v) => { const [lo, hi] = RANGE[rs][cat]; return hi === lo ? 50 : Math.max(1, Math.min(100, Math.round(100 * Math.pow((v - lo) / (hi - lo), 1.5)))); };
// Seltenheit nach Kampfstärke: gewöhnlich (schwächste 40 %), selten (30 %), legendär (20 %), mythisch (stärkste 10 % plus ein paar feste Größen)
const power = (s) => ((s[0] + s[1] + s[2] + s[4]) / 4) * 0.9 + s[3] * 0.1, PIN_MYTHIC = ['Zeno', 'Saitama', 'Son Goku', 'Monkey D. Luffy', 'Naruto Uzumaki'];
const RAR = (() => { const order = CHARS.map((c, i) => i).sort((x, y) => power(CHARS[y][2]) - power(CHARS[x][2])), n = order.length, r = {}; order.forEach((i, k) => { r[i] = k < n * 0.1 ? 'm' : k < n * 0.3 ? 'l' : k < n * 0.6 ? 'r' : 'c'; }); CHARS.forEach((c, i) => { if (PIN_MYTHIC.includes(c[0])) r[i] = 'm'; }); return r; })();
const statOf = (g, ch, cat) => ((g.rs !== 'mix' && CHARS[ch][3]) ? scaleIn(g.rs, cat, CHARS[ch][3][cat]) : CHARS[ch][2][cat]);

function newGame(players, { rs, time, win }) {
  const key = RS[rs] ? rs : 'mix', pool = CHARS.map((_, i) => i).filter((i) => !RS[key].anime || CHARS[i][1] === RS[key].anime);
  const g = { kind: 'anime', rs: key, win: win === 'avg' ? 'avg' : 'cats', nc: RS[key].cats.length, time: Math.max(15, Math.min(120, Math.round(Number(time)) || 45)), pool, used: {}, round: -1, phase: 'spin', until: 0, rn: 0, draw: {}, decoys: [], step: 0, winners: [], forfeit: false, log: [],
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, out: false })), board: {} };
  g.players.forEach((p) => { g.board[p.id] = Array(g.nc).fill(null); });
  startRound(g); return g;
}
const active = (g) => g.players.filter((p) => !p.out);
function startRound(g) {
  g.round++; g.rn++; g.phase = 'spin'; g.until = Date.now() + SPIN_MS; g.draw = {};
  const taken = new Set();
  for (const p of active(g)) { // jeder bekommt einen anderen Charakter, im ganzen Spiel möglichst keinen doppelt
    let c = g.pool.filter((i) => !g.used[i] && !taken.has(i));
    if (!c.length) { g.used = {}; c = g.pool.filter((i) => !taken.has(i)); }
    if (!c.length) c = g.pool.slice();
    const pick = c[Math.floor(Math.random() * c.length)]; g.used[pick] = 1; taken.add(pick); g.draw[p.id] = pick;
  }
  g.decoys = shuffle(g.pool.filter((i) => !taken.has(i))).slice(0, 26); // Füllfiguren für die Slotmaschine (nie die gezogenen)
}
const placedNow = (g, id) => g.board[id].some((e) => e && e.round === g.round);
function allPlaced(g) { return active(g).every((p) => placedNow(g, p.id)); }
function place(g, id, cat) { g.board[id][cat] = { ch: g.draw[id], round: g.round }; }
function afterPlace(g) { if (g.phase === 'pick' && allPlaced(g)) { g.phase = 'between'; g.until = Date.now() + BETWEEN_MS; g.rn++; } }
function act(g, pid, a) {
  const p = g.players.find((x) => x.id === pid); if (!p || p.out || g.phase === 'over') return;
  if (a.type === 'giveup') return drop(g, pid);
  if (a.type !== 'apick' || g.phase !== 'pick' || placedNow(g, pid)) return;
  const cat = Number(a.cat); if (!Number.isInteger(cat) || cat < 0 || cat >= g.nc || g.board[pid][cat]) return;
  place(g, pid, cat); g.rn++; afterPlace(g);
}
function drop(g, pid) {
  const p = g.players.find((x) => x.id === pid); if (!p || p.out || g.phase === 'over') return;
  p.out = true; g.rn++;
  if (active(g).length <= 1) { g.phase = 'over'; g.forfeit = true; g.winners = active(g).map((x) => x.id); g.until = 0; g.backAt = Date.now() + 3000; g.rn++; return; } // alle anderen weg: nach 3 s zurück in die Lobby
  afterPlace(g);
}
function tick(g) {
  if (g.phase === 'over' || Date.now() < g.until) return false;
  if (g.phase === 'spin') { g.phase = 'pick'; g.until = Date.now() + g.time * 1000; }
  else if (g.phase === 'pick') { // Zeit abgelaufen: wer nicht gesetzt hat, bekommt eine zufällige freie Kategorie
    for (const p of active(g)) if (!placedNow(g, p.id)) { const free = g.board[p.id].map((_, c) => c).filter((c) => !g.board[p.id][c]); place(g, p.id, free[Math.floor(Math.random() * free.length)]); }
    g.phase = 'between'; g.until = Date.now() + BETWEEN_MS;
  } else if (g.phase === 'between') { if (g.round < g.nc - 1) startRound(g); else { g.phase = 'showdown'; g.step = 0; g.until = Date.now() + 2800; } }
  else if (g.phase === 'showdown') { if (g.step < g.nc) { g.step++; g.until = Date.now() + SHOW_MS; } else { g.phase = 'over'; g.until = 0; g.winners = results(g).winners; } }
  g.rn++; return true;
}
// Ergebnis: pro Kategorie gewinnt der beste Wert (bei Gleichstand alle), insgesamt zählen die gewonnenen Kategorien, dann der Durchschnitt
function results(g, upto = g.nc) {
  const act = active(g), vals = {}, catWin = [], wins = {}, avg = {};
  act.forEach((p) => { vals[p.id] = g.board[p.id].map((e, c) => (e ? statOf(g, e.ch, c) : null)); wins[p.id] = 0; });
  for (let c = 0; c < g.nc; c++) { const best = Math.max(...act.map((p) => vals[p.id][c] ?? -1)); catWin[c] = act.filter((p) => vals[p.id][c] === best).map((p) => p.id); if (c < upto) catWin[c].forEach((id) => { wins[id]++; }); }
  act.forEach((p) => { avg[p.id] = Math.round(vals[p.id].reduce((s, v) => s + (v || 0), 0) / g.nc * 10) / 10; });
  const top = Math.max(...act.map((p) => wins[p.id])), tied = act.filter((p) => wins[p.id] === top), bestAvg = Math.max(...tied.map((p) => avg[p.id]));
  let winners = tied.filter((p) => avg[p.id] === bestAvg).map((p) => p.id);
  if (g.win === 'avg') { const best = Math.max(...act.map((p) => avg[p.id])); winners = act.filter((p) => avg[p.id] === best).map((p) => p.id); } // Schalter: nur der höchste Ø-Score zählt
  return { vals, catWin, wins, avg, winners };
}
function view(g, pid) { // pid = Betrachter (null = Zuschauer): geheime Infos werden hier herausgefiltert
  const me = pid && g.players.find((x) => x.id === pid && !x.out), mine = !!me && placedNow(g, pid);
  const open = g.phase === 'showdown' || g.phase === 'over' || g.phase === 'between';
  const board = {};
  for (const p of g.players) board[p.id] = g.board[p.id].map((e) => (e && (open || e.round < g.round || p.id === pid || mine) ? { ch: ci(e.ch), round: e.round } : null)); // fremde Platzierungen erst nach dem eigenen Setzen
  const showing = g.phase === 'showdown' || g.phase === 'over', step = g.phase === 'over' ? g.nc : g.step;
  let show = null;
  if (showing && !g.forfeit) { const r = results(g, step), vals = {}; Object.keys(r.vals).forEach((id) => { vals[id] = r.vals[id].map((v, c) => (c < step ? v : null)); }); show = { step, vals, catWin: r.catWin.map((w, c) => (c < step ? w : [])), wins: r.wins, avg: g.phase === 'over' ? r.avg : null }; }
  return { kind: 'anime', rs: g.rs, win: g.win, rsName: RS[g.rs].name, cats: RS[g.rs].cats.map(([n, e]) => ({ n, e })), phase: g.phase, round: g.round, rounds: g.nc, until: g.until, time: g.time, rn: g.rn, step, forfeit: g.forfeit,
    players: g.players.map((p) => ({ id: p.id, name: p.name, color: p.color, out: p.out, placed: (g.phase === 'pick' || g.phase === 'between' || g.phase === 'spin') && !p.out && placedNow(g, p.id) })),
    me: me && g.phase !== 'showdown' && g.phase !== 'over' ? { draw: ci(g.draw[pid]), placed: mine } : null,
    board, decoys: g.phase === 'spin' ? g.decoys.map(ci) : [], show, winners: g.phase === 'over' ? g.winners : null, backAt: g.backAt || null, log: [] };
}
const payouts = () => []; // keine Coins (Spielwert kann nicht mit Zweitkonten erfarmt werden)
module.exports = { newGame, act, drop, tick, view, payouts, results, RS, CHARS, statOf };
