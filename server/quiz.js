// Quiz-Spiel. Zwei Arten:
//  (1) Klassisch: alle antworten gleichzeitig am Bildschirm. Punkte nur nach Schwierigkeit der Frage (100/200/300), kein Zeit- oder Serienbonus.
//  (2) Moderator-Modus (mündlich): Reihum bekommt ein Spieler ein ZUFÄLLIGES THEMA und wählt die SCHWIERIGKEIT. Erst danach wird die Frage
//      allen gezeigt. Der Host sieht Antwort und 3 Hinweise, moderiert und wählt den Gewinner. Auf Knopfdruck des Hosts dürfen auch alle anderen raten.
// Die richtige Antwort verlässt den Server nur Richtung Host (im Moderator-Modus) bzw. erst bei der Auflösung.
const BANK = require('./questions');
const CATS = Object.keys(BANK);
const REVEAL_MS = Number(process.env.QUIZ_REVEAL_MS) || 6000, INTRO_MS = Number(process.env.QUIZ_INTRO_MS) || 4500; // (Umgebungsvariablen nur für Tests)

const PTS = { leicht: 100, mittel: 200, schwer: 300 }, TIER = { leicht: 1, mittel: 2, schwer: 3 }, TIERS = { 1: 'leicht', 2: 'mittel', 3: 'schwer' };
const ptsOf = (d) => PTS[TIERS[d]] || PTS.mittel;
const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const firstHint = (ans) => `Die Antwort beginnt mit „${ans.trim()[0]}“ und hat ${ans.length} Zeichen.`;
function autoHints(a, c) { // Hinweise für eigene Quizze, die selbst keine haben
  const ans = a[c], words = ans.trim().split(/\s+/).length, wrong = shuffle(a.filter((_, i) => i !== c)).slice(0, 2);
  return [`Die Antwort besteht aus ${words} ${words === 1 ? 'Wort' : 'Wörtern'}.`, a.length >= 3 ? `Falsch sind: „${wrong.join('“ und „')}“.` : `Die Antwort hat ${ans.length} Zeichen.`, firstHint(ans)];
}
function mkQ(q, answers, correct, hints, d) { const idx = shuffle(answers.map((_, i) => i)), a = idx.map((i) => answers[i]), c = idx.indexOf(correct); return { q, a, c, d: d || 2, hints: hints || autoHints(a, c) }; }
const fromRow = ([q, c, w1, w2, w3, d, h1, h2]) => mkQ(q, [c, w1, w2, w3], 0, [h1, h2, firstHint(c)], d);
function pickBuiltin(cat, count) { // klassisch: Kategorie oder alles gemischt
  const pool = cat && BANK[cat] ? BANK[cat] : Object.values(BANK).flat();
  return shuffle(pool).slice(0, count).map(fromRow);
}
// Moderator-Modus: Frage zum Thema passend zur gewählten Schwierigkeit (bereits gestellte Fragen kommen nicht noch einmal)
function drawQuestion(g, topic, dk) {
  const tier = TIER[dk]; let pool = (BANK[topic] || []).filter((r) => !g.used[r[0]]);
  if (!pool.length) pool = Object.values(BANK).flat().filter((r) => !g.used[r[0]]);
  if (!pool.length) { g.used = {}; pool = BANK[topic] || Object.values(BANK).flat(); }
  const best = Math.min(...pool.map((r) => Math.abs(r[5] - tier))), cand = pool.filter((r) => Math.abs(r[5] - tier) === best), r = cand[Math.floor(Math.random() * cand.length)];
  g.used[r[0]] = 1; return fromRow(r);
}
// Eigene Quizze: alles prüfen und kürzen, bevor es im Spiel landet
function cleanQuestions(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list.slice(0, 50)) {
    if (!x || typeof x.q !== 'string' || !Array.isArray(x.a)) continue;
    const q = x.q.trim().slice(0, 200), a = x.a.map((t) => (typeof t === 'string' ? t.trim().slice(0, 100) : '')), c = Number(x.c);
    const filled = a.map((t, i) => [t, i]).filter(([t]) => t), ci = filled.findIndex(([, i]) => i === c);
    if (q && filled.length >= 2 && filled.length <= 4 && ci >= 0) out.push({ q, a: filled.map(([t]) => t), c: ci });
  }
  return out;
}
function fromCustom(list, count) { return shuffle(cleanQuestions(list)).slice(0, count).map((x) => mkQ(x.q, x.a, x.c)); }

function newGame(players, { questions, time, title, coins, hostMode, builtin, count }) {
  const auto = !!(hostMode && builtin); // Zufallsthema + Schwierigkeit wählen
  return { kind: 'quiz', title, coins: !!coins && !hostMode, time: hostMode ? 0 : time, hostMode: !!hostMode, auto, hs: [false, false, false], last: null, open: false, topic: null, diff: null, pts: 0, used: {}, queue: [],
    total: auto ? count : questions.length, questions: auto ? [] : questions, qi: -1, phase: 'intro', until: Date.now() + INTRO_MS, qStart: 0,
    answers: {}, res: null, rn: 0, winner: null, log: ['Quiz startet!'], outOrder: [],
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, score: 0, streak: 0, correct: 0, ms: 0, out: false })) };
}
const active = (g) => g.players.filter((p) => !p.out);
const activeOf = (g) => { const l = active(g); return l.length && g.qi >= 0 ? l[g.qi % l.length].id : null; }; // wer ist in dieser Runde dran (reihum)
function nextQuestion(g) {
  g.qi++; g.answers = {}; g.res = null; g.hs = [false, false, false]; g.last = null; g.open = false; g.rn++;
  if (g.auto) { if (!g.queue.length) g.queue = shuffle(CATS); g.topic = g.queue.pop(); g.diff = null; g.pts = 0; g.phase = 'pick'; g.until = 0; return; }
  const q = g.questions[g.qi]; g.diff = TIERS[q.d]; g.pts = ptsOf(q.d); g.phase = 'question'; g.qStart = Date.now(); g.until = g.hostMode ? 0 : g.qStart + g.time * 1000;
}
function reveal(g) {
  const q = g.questions[g.qi], picks = {}, counts = q.a.map(() => 0);
  for (const p of active(g)) {
    const a = g.answers[p.id], ok = !!a && a.choice === q.c; let pts = 0;
    if (ok) { p.streak++; p.correct++; p.ms += a.ms; pts = g.pts; } else p.streak = 0; // Punkte nur nach Schwierigkeit
    p.score += pts; if (a) counts[a.choice]++;
    picks[p.id] = { choice: a ? a.choice : -1, pts, ok, streak: p.streak };
  }
  g.res = { c: q.c, picks, counts }; g.phase = 'reveal'; g.until = Date.now() + REVEAL_MS; g.rn++;
}
function rank(g) {
  const act = active(g).sort((a, b) => b.score - a.score || b.correct - a.correct || a.ms - b.ms);
  return [...act, ...[...g.outOrder].reverse().map((id) => g.players.find((p) => p.id === id))];
}
function finish(g) { g.phase = 'over'; g.until = 0; g.winner = rank(g)[0].id; g.rn++; }
// Moderator-Modus: Schwierigkeit wählen darf der Spieler, der dran ist (oder der Host für ihn)
function pickDiff(g, pid, a, ctx) {
  if (!g.auto || g.phase !== 'pick' || !PTS[a.d]) return;
  if (!(ctx && ctx.host) && pid !== activeOf(g)) return;
  g.questions[g.qi] = drawQuestion(g, g.topic, a.d); g.diff = a.d; g.pts = PTS[a.d]; g.phase = 'question'; g.rn++;
}
// Nur der Host: Hinweise zeigen, für alle freigeben, Gewinner wählen, korrigieren, weiter, beenden
function hostAct(g, a, ctx) {
  if (!ctx || !ctx.host || g.phase === 'over') return;
  const q = g.questions[g.qi];
  if (a.type === 'qhint' && g.phase === 'question') { const n = Math.round(Number(a.n)); if (n >= 1 && n <= 3 && !g.hs[n - 1]) { g.hs[n - 1] = true; g.rn++; } }
  else if (a.type === 'qopen' && g.phase === 'question' && !g.open) { g.open = true; g.rn++; } // jetzt dürfen alle raten
  else if (a.type === 'qpick' && g.phase === 'question') {
    const w = a.id ? active(g).find((x) => x.id === a.id) : null; if (a.id && !w) return;
    if (w) { w.score += g.pts; w.correct++; }
    g.last = w ? { id: w.id, pts: g.pts } : null; g.res = { c: q.c, win: w ? w.id : null, pts: w ? g.pts : 0 }; g.phase = 'reveal'; g.rn++;
  } else if (a.type === 'qundo' && g.phase === 'reveal') { // falsche Wahl zurücknehmen
    const w = g.last && g.players.find((x) => x.id === g.last.id); if (w) { w.score -= g.last.pts; w.correct--; }
    g.last = null; g.res = null; g.phase = 'question'; g.rn++;
  } else if (a.type === 'qend') finish(g); // Host beendet das Quiz früher
  else if (a.type === 'qnext' && g.phase === 'reveal') { if (g.qi + 1 < g.total) nextQuestion(g); else finish(g); }
}
function act(g, pid, a, ctx) {
  if (g.hostMode && a.type === 'qdiff') return pickDiff(g, pid, a, ctx);
  if (g.hostMode && /^q(pick|hint|next|undo|end|open)$/.test(a.type)) return hostAct(g, a, ctx);
  const p = g.players.find((x) => x.id === pid); if (!p || p.out || g.phase === 'over') return;
  if (a.type === 'giveup') return drop(g, pid);
  if (g.hostMode || a.type !== 'answer' || g.phase !== 'question' || g.answers[pid]) return; // im Moderator-Modus wird mündlich geantwortet
  const choice = Number(a.choice); if (!Number.isInteger(choice) || choice < 0 || choice >= g.questions[g.qi].a.length) return;
  g.answers[pid] = { choice, ms: Math.min(Date.now() - g.qStart, g.time * 1000) };
  if (active(g).every((x) => g.answers[x.id])) reveal(g); // alle haben geantwortet: gleich auflösen
}
function drop(g, pid) {
  const p = g.players.find((x) => x.id === pid); if (!p || p.out || g.phase === 'over') return;
  p.out = true; g.outOrder.push(pid);
  if (active(g).length <= 1) return finish(g);
  if (!g.hostMode && g.phase === 'question' && active(g).every((x) => g.answers[x.id])) reveal(g);
}
function tick(g) {
  if (g.phase === 'over' || Date.now() < g.until) return false;
  if (g.hostMode && g.phase !== 'intro') return false; // der Host bestimmt das Tempo
  if (g.phase === 'intro') nextQuestion(g);
  else if (g.phase === 'question') reveal(g);
  else if (g.qi + 1 < g.total) nextQuestion(g);
  else finish(g);
  return true;
}
// Coins nur für die eingebauten Fragen im klassischen Quiz (eigene Quizze und Moderator-Spiele könnte man mit Zweitkonten erfarmen), mindestens 5 Fragen
function payouts(g) {
  const n = g.players.length, win = 80 + 30 * (n - 2), ok = g.coins && g.total >= 5;
  return rank(g).map((p, i) => ({ id: p.id, place: i + 1, coins: ok && i + 1 < n ? Math.round((win * Math.pow(0.5, i)) / 5) * 5 : 0 }));
}
function view(g, forMod) {
  const q = g.questions[g.qi], show = g.phase === 'reveal', hm = g.hostMode;
  let vq = null;
  if (q && g.phase !== 'intro' && g.phase !== 'pick') {
    if (!hm) vq = { q: q.q, a: q.a, ...(show ? { c: q.c } : {}) };
    else vq = { q: q.q, a: forMod ? q.a : [], hints: q.hints.map((h, i) => (forMod || g.hs[i] ? h : null)), ...(forMod || show ? { c: q.c, ans: q.a[q.c] } : {}) }; // Antwort nur für den Host, bei der Auflösung für alle
  }
  return { kind: 'quiz', title: g.title, phase: g.phase, qi: g.qi, total: g.total, time: g.time, until: g.until, rn: g.rn, winner: g.winner, log: g.log, hostMode: hm, auto: g.auto, topic: g.topic, diff: g.diff, pts: g.pts, ptsMap: PTS,
    active: hm ? activeOf(g) : null, open: g.open, hs: g.hs, canUndo: !!hm && show,
    q: vq,
    res: show ? (hm ? { c: q.c, win: g.res.win, pts: g.res.pts } : g.res) : null,
    players: g.players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, streak: p.streak, out: p.out, correct: p.correct, answered: !hm && g.phase === 'question' && !!g.answers[p.id] })),
    rank: g.phase === 'over' ? rank(g).map((p) => p.id) : null,
    payout: g.phase === 'over' ? Object.fromEntries(payouts(g).map((x) => [x.id, { place: x.place, coins: x.coins }])) : null };
}
const note = (g, t) => { g.log.push(t); if (g.log.length > 20) g.log.shift(); };
module.exports = { newGame, act, drop, tick, view, payouts, note, pickBuiltin, fromCustom, cleanQuestions, drawQuestion, CATS, POINTS: PTS };
