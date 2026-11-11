// Quiz-Spiel: alle antworten gleichzeitig, schnelle richtige Antworten geben mehr Punkte, Serien geben Bonus.
// Die richtige Antwort verlässt den Server erst bei der Auflösung (Mogeln über die Browser-Entwicklertools ist nicht möglich).
const BANK = require('./questions');
const CATS = Object.keys(BANK);
const REVEAL_MS = Number(process.env.QUIZ_REVEAL_MS) || 6000, INTRO_MS = Number(process.env.QUIZ_INTRO_MS) || 4500; // (Umgebungsvariablen nur für Tests)

const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
function mkQ(q, answers, correct) { const idx = shuffle(answers.map((_, i) => i)); return { q, a: idx.map((i) => answers[i]), c: idx.indexOf(correct) }; }
function pickBuiltin(cat, count) {
  const pool = cat && BANK[cat] ? BANK[cat] : Object.values(BANK).flat();
  return shuffle(pool).slice(0, count).map(([q, ...a]) => mkQ(q, a, 0));
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

function newGame(players, { questions, time, title, coins }) {
  return { kind: 'quiz', title, coins: !!coins, time, total: questions.length, questions, qi: -1, phase: 'intro', until: Date.now() + INTRO_MS, qStart: 0,
    answers: {}, res: null, rn: 0, winner: null, log: ['Quiz startet!'], outOrder: [],
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, score: 0, streak: 0, correct: 0, ms: 0, out: false })) };
}
const active = (g) => g.players.filter((p) => !p.out);
function nextQuestion(g) { g.qi++; g.phase = 'question'; g.answers = {}; g.res = null; g.qStart = Date.now(); g.until = g.qStart + g.time * 1000; g.rn++; }
function reveal(g) {
  const q = g.questions[g.qi], picks = {}, counts = q.a.map(() => 0);
  for (const p of active(g)) {
    const a = g.answers[p.id], ok = !!a && a.choice === q.c; let pts = 0;
    if (ok) { p.streak++; p.correct++; p.ms += a.ms; pts = Math.round(600 + 400 * Math.max(0, 1 - a.ms / (g.time * 1000))) + Math.min(p.streak - 1, 4) * 40; } else p.streak = 0;
    p.score += pts; if (a) counts[a.choice]++;
    picks[p.id] = { choice: a ? a.choice : -1, pts, ok, streak: p.streak };
  }
  g.res = { c: q.c, picks, counts }; g.phase = 'reveal'; g.until = Date.now() + REVEAL_MS; g.rn++;
}
function rank(g) {
  const act = active(g).sort((a, b) => b.score - a.score || a.ms - b.ms);
  return [...act, ...[...g.outOrder].reverse().map((id) => g.players.find((p) => p.id === id))];
}
function finish(g) { g.phase = 'over'; g.until = 0; g.winner = rank(g)[0].id; g.rn++; }
function act(g, pid, a) {
  const p = g.players.find((x) => x.id === pid); if (!p || p.out || g.phase === 'over') return;
  if (a.type === 'giveup') return drop(g, pid);
  if (a.type !== 'answer' || g.phase !== 'question' || g.answers[pid]) return;
  const choice = Number(a.choice); if (!Number.isInteger(choice) || choice < 0 || choice >= g.questions[g.qi].a.length) return;
  g.answers[pid] = { choice, ms: Math.min(Date.now() - g.qStart, g.time * 1000) };
  if (active(g).every((x) => g.answers[x.id])) reveal(g); // alle haben geantwortet: gleich auflösen
}
function drop(g, pid) {
  const p = g.players.find((x) => x.id === pid); if (!p || p.out || g.phase === 'over') return;
  p.out = true; g.outOrder.push(pid);
  if (active(g).length <= 1) return finish(g);
  if (g.phase === 'question' && active(g).every((x) => g.answers[x.id])) reveal(g);
}
function tick(g) {
  if (g.phase === 'over' || Date.now() < g.until) return false;
  if (g.phase === 'intro') nextQuestion(g);
  else if (g.phase === 'question') reveal(g);
  else if (g.qi + 1 < g.total) nextQuestion(g);
  else finish(g);
  return true;
}
// Coins nur für die eingebauten Fragen (eigene Quizze könnte man mit Zweitkonten erfarmen), mindestens 5 Fragen
function payouts(g) {
  const n = g.players.length, win = 80 + 30 * (n - 2), ok = g.coins && g.total >= 5;
  return rank(g).map((p, i) => ({ id: p.id, place: i + 1, coins: ok && i + 1 < n ? Math.round((win * Math.pow(0.5, i)) / 5) * 5 : 0 }));
}
function view(g) {
  const q = g.questions[g.qi], show = g.phase === 'reveal';
  return { kind: 'quiz', title: g.title, phase: g.phase, qi: g.qi, total: g.total, time: g.time, until: g.until, rn: g.rn, winner: g.winner, log: g.log,
    q: q && g.phase !== 'intro' ? { q: q.q, a: q.a, ...(show ? { c: q.c } : {}) } : null,
    res: show ? g.res : null,
    players: g.players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, streak: p.streak, out: p.out, correct: p.correct, answered: g.phase === 'question' && !!g.answers[p.id] })),
    rank: g.phase === 'over' ? rank(g).map((p) => p.id) : null,
    payout: g.phase === 'over' ? Object.fromEntries(payouts(g).map((x) => [x.id, { place: x.place, coins: x.coins }])) : null };
}
const note = (g, t) => { g.log.push(t); if (g.log.length > 20) g.log.shift(); };
module.exports = { newGame, act, drop, tick, view, payouts, note, pickBuiltin, fromCustom, cleanQuestions, CATS };
