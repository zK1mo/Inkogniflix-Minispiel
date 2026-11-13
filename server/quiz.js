// Quiz-Spiel. Zwei Arten: (1) alle antworten gleichzeitig am Bildschirm, (2) Moderator-Modus: der Host sieht Frage, Antwort und Hinweise,
// die Runde antwortet mündlich und der Host wählt den Gewinner jeder Frage. Punkte hängen nur von der gewählten Schwierigkeit ab.
// Die richtige Antwort verlässt den Server erst bei der Auflösung (Mogeln über die Browser-Entwicklertools ist nicht möglich).
const BANK = require('./questions');
const CATS = Object.keys(BANK);
const REVEAL_MS = Number(process.env.QUIZ_REVEAL_MS) || 6000, INTRO_MS = Number(process.env.QUIZ_INTRO_MS) || 4500; // (Umgebungsvariablen nur für Tests)

const shuffle = (a) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
const POINTS = { leicht: 100, mittel: 200, schwer: 300 }, TIER = { leicht: 1, mittel: 2, schwer: 3 }; // Punkte pro richtige Antwort, nur nach Schwierigkeit
const diffKey = (v) => (POINTS[v] ? v : 'mittel');
const firstHint = (ans) => `Die Antwort beginnt mit „${ans.trim()[0]}“ und hat ${ans.length} Zeichen.`;
function autoHints(a, c) { // Hinweise für eigene Quizze, die selbst keine haben
  const ans = a[c], words = ans.trim().split(/\s+/).length, wrong = shuffle(a.filter((_, i) => i !== c)).slice(0, 2);
  return [`Die Antwort besteht aus ${words} ${words === 1 ? 'Wort' : 'Wörtern'}.`, a.length >= 3 ? `Falsch sind: „${wrong.join('“ und „')}“.` : `Die Antwort hat ${ans.length} Zeichen.`, firstHint(ans)];
}
function mkQ(q, answers, correct, hints) { const idx = shuffle(answers.map((_, i) => i)), a = idx.map((i) => answers[i]), c = idx.indexOf(correct); return { q, a, c, hints: hints || autoHints(a, c) }; }
// Eingebaute Fragen: passende Schwierigkeit zuerst, reichen sie nicht, kommen die benachbarten Stufen dazu
function pickBuiltin(cat, count, diff) {
  const pool = cat && BANK[cat] ? BANK[cat] : Object.values(BANK).flat(), tier = TIER[diffKey(diff)];
  const sorted = shuffle(pool).sort((x, y) => Math.abs(x[5] - tier) - Math.abs(y[5] - tier));
  return shuffle(sorted.slice(0, count)).map(([q, c, w1, w2, w3, , h1, h2]) => mkQ(q, [c, w1, w2, w3], 0, [h1, h2, firstHint(c)]));
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

function newGame(players, { questions, time, title, coins, diff, hostMode }) {
  const dk = diffKey(diff);
  return { kind: 'quiz', title, coins: !!coins && !hostMode, time: hostMode ? 0 : time, diff: dk, pts: POINTS[dk], hostMode: !!hostMode, hs: [false, false, false], last: null, total: questions.length, questions, qi: -1, phase: 'intro', until: Date.now() + INTRO_MS, qStart: 0,
    answers: {}, res: null, rn: 0, winner: null, log: ['Quiz startet!'], outOrder: [],
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, score: 0, streak: 0, correct: 0, ms: 0, out: false })) };
}
const active = (g) => g.players.filter((p) => !p.out);
function nextQuestion(g) { g.qi++; g.phase = 'question'; g.answers = {}; g.res = null; g.hs = [false, false, false]; g.last = null; g.qStart = Date.now(); g.until = g.hostMode ? 0 : g.qStart + g.time * 1000; g.rn++; }
function reveal(g) {
  const q = g.questions[g.qi], picks = {}, counts = q.a.map(() => 0);
  for (const p of active(g)) {
    const a = g.answers[p.id], ok = !!a && a.choice === q.c; let pts = 0;
    if (ok) { p.streak++; p.correct++; p.ms += a.ms; pts = g.pts; } else p.streak = 0; // Punkte nur nach Schwierigkeit, keine Zeit- oder Serienboni
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
// Moderator-Modus: nur der Host darf Hinweise zeigen, den Gewinner wählen, korrigieren und weiterschalten
function hostAct(g, a, ctx) {
  if (!ctx || !ctx.host || g.phase === 'over') return;
  const q = g.questions[g.qi];
  if (a.type === 'qhint' && g.phase === 'question') { const n = Math.round(Number(a.n)); if (n >= 1 && n <= 3 && !g.hs[n - 1]) { g.hs[n - 1] = true; g.rn++; } }
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
  if (g.hostMode && /^q(pick|hint|next|undo|end)$/.test(a.type)) return hostAct(g, a, ctx);
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
// Coins nur für die eingebauten Fragen (eigene Quizze könnte man mit Zweitkonten erfarmen), mindestens 5 Fragen
function payouts(g) {
  const n = g.players.length, win = 80 + 30 * (n - 2), ok = g.coins && g.total >= 5;
  return rank(g).map((p, i) => ({ id: p.id, place: i + 1, coins: ok && i + 1 < n ? Math.round((win * Math.pow(0.5, i)) / 5) * 5 : 0 }));
}
function view(g, forMod) {
  const q = g.questions[g.qi], show = g.phase === 'reveal', hm = g.hostMode;
  let vq = null;
  if (q && g.phase !== 'intro') {
    if (!hm) vq = { q: q.q, a: q.a, ...(show ? { c: q.c } : {}) };
    else vq = { q: q.q, a: forMod ? q.a : [], hints: q.hints.map((h, i) => (forMod || g.hs[i] ? h : null)), ...(forMod || show ? { c: q.c, ans: q.a[q.c] } : {}) }; // Antwort nur für den Host, bei der Auflösung für alle
  }
  return { kind: 'quiz', title: g.title, phase: g.phase, qi: g.qi, total: g.total, time: g.time, until: g.until, rn: g.rn, winner: g.winner, log: g.log, hostMode: hm, diff: g.diff, pts: g.pts, hs: g.hs, canUndo: !!hm && show,
    q: vq,
    res: show ? (hm ? { c: q.c, win: g.res.win, pts: g.res.pts } : g.res) : null,
    players: g.players.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score, streak: p.streak, out: p.out, correct: p.correct, answered: !hm && g.phase === 'question' && !!g.answers[p.id] })),
    rank: g.phase === 'over' ? rank(g).map((p) => p.id) : null,
    payout: g.phase === 'over' ? Object.fromEntries(payouts(g).map((x) => [x.id, { place: x.place, coins: x.coins }])) : null };
}
const note = (g, t) => { g.log.push(t); if (g.log.length > 20) g.log.shift(); };
module.exports = { newGame, act, drop, tick, view, payouts, note, pickBuiltin, fromCustom, cleanQuestions, CATS, POINTS };
