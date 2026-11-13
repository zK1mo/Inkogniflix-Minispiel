// Inkogniflix Spielserver: Räume, Einladungscode, Host-Einstellungen, Kicken, Wiederverbinden, Votekick
const http = require('http');
const { WebSocketServer } = require('ws');
const G = require('./game');
const db = require('./db');
const Q = require('./quiz');
const A = require('./anime');
const ADMINS = new Set((process.env.ADMIN_USERS || 'zk1mo').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)); // Admin-Benutzernamen (bei Render: ADMIN_USERS)
const TEAM_NAMES = ['Blau', 'Orange', 'Grün', 'Rot', 'Lila', 'Gelb'], TEAM_COLORS = [1, 2, 3, 4, 0, 8]; // Teamnamen und Farben (Index in der Farbpalette)
const MOD = (g) => (g && g.kind === 'quiz' ? Q : g && g.kind === 'anime' ? A : G); // Monopoly, Quiz oder Anime-Schmiede

const server = http.createServer((q, r) => { r.writeHead(200); r.end('Inkogniflix-Server läuft'); });
const wss = new WebSocketServer({ server });
const rooms = new Map();
const MAPS = ['klassisch', 'minecraft'];
const COLORS = 12; // Anzahl wählbarer Spielerfarben
const DC_MS = 3 * 60 * 1000; // so lange hat ein getrennter Spieler Zeit, wieder zu verbinden

const send = (ws, m) => ws && ws.readyState === 1 && ws.send(JSON.stringify(m));
const clean = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 20);
const newCode = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
  return rooms.has(s) ? newCode() : s;
};
const freeColor = (room) => { const used = new Set([...room.players.values()].map((p) => p.color)); let c = 0; while (used.has(c)) c++; return c; };
const isOut = (room, id) => { const gp = room.game && room.game.players.find((x) => x.id === id); return !!(gp && gp.out); };
// Votekick: 3/4 der verbundenen, noch aktiven Spieler müssen zustimmen
const needVotes = (room) => Math.max(1, Math.ceil(0.75 * [...room.players.values()].filter((p) => p.ws && !isOut(room, p.id)).length));
const nextHost = (room) => ([...room.players.values()].find((p) => p.ws) || [...room.players.values()][0] || {}).id;

// Spielende: Coins an angemeldete Spieler auszahlen (nur einmal pro Spiel)
function settle(room) {
  const g = room.game; g.paid = true;
  if (g.test) return; // Testspiele geben keine Coins
  for (const p of MOD(g).payouts(g)) {
    const uid = room.uids && room.uids[p.id]; if (!uid) continue;
    const who = room.players.get(p.id) || room.spec.get(p.id);
    db.award(uid, p.coins, p.place === 1).then((r) => {
      if (!r.ok) console.log('Coins-Gutschrift fehlgeschlagen (' + uid + '): ' + r.error);
      if (who && who.ws) send(who.ws, { type: 'award', coins: p.coins, ok: r.ok, error: r.ok ? undefined : r.error }); // der Spieler sieht, ob es geklappt hat
    }).catch((e) => console.log('Coins-Gutschrift fehlgeschlagen:', e.message));
  }
}
function broadcast(room) {
  if (room.game && room.game.phase === 'over' && !room.game.paid) settle(room);
  const base = {
    type: 'room', now: Date.now(), chat: room.chat, specs: [...room.spec.values()].map((x) => x.name), game: room.game ? MOD(room.game).view(room.game) : null, code: room.code, hostId: room.hostId, settings: room.settings, need: needVotes(room),
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, guest: p.guest, color: p.color, trading: !!p.trading, watch: !!p.watch, team: Number.isInteger(p.team) ? p.team : null, avatar: p.avatar || null, dc: p.ws ? null : p.dc, votes: [...p.votes] })),
  };
  const g = room.game, modView = g && g.kind === 'quiz' && g.hostMode ? Q.view(g, true) : null; // der Moderator sieht Antwort und alle Hinweise
  const teamLive = g && g.kind === 'quiz' && g.teams && !g.hostMode && g.phase === 'question'; // jeder sieht nur den Tipp des eigenen Teams
  const gv = (id) => (g && g.kind === 'anime' ? A.view(g, id) : modView && id === room.hostId ? modView : teamLive ? Q.view(g, false, id) : base.game); // Anime: jeder sieht nur, was er sehen darf
  room.players.forEach((p) => send(p.ws, { ...base, game: gv(p.id), you: p.id, admin: !!p.admin }));
  room.spec.forEach((x) => send(x.ws, { ...base, game: gv(x.id), you: x.id, spec: true, admin: !!x.admin })); // Zuschauer sehen alles, können aber nichts tun
}

function leave(ws) {
  const room = rooms.get(ws.room);
  if (!room) return;
  if (ws.spec) { room.spec.delete(ws.pid); ws.room = null; if (room.hostId === ws.pid) room.hostId = nextHost(room); return broadcast(room); }
  room.players.delete(ws.pid);
  if (room.game) MOD(room.game).drop(room.game, ws.pid);
  ws.room = null;
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === ws.pid) room.hostId = nextHost(room);
  broadcast(room);
}

// Verbindung weg: Im laufenden Spiel bleibt der Platz 3 Minuten frei (Wiederverbinden oder Votekick)
function disconnect(ws) {
  const room = rooms.get(ws.room), p = room && room.players.get(ws.pid);
  if (room && ws.spec) { room.spec.delete(ws.pid); if (room.hostId === ws.pid) room.hostId = nextHost(room); return broadcast(room); }
  if (!p) return;
  if (p.ws !== ws) return; // alte Verbindung wurde schon ersetzt
  if (room.game && room.game.phase !== 'over' && !isOut(room, p.id)) {
    p.ws = null; p.dc = Date.now() + DC_MS; p.votes.clear(); p.trading = false;
    MOD(room.game).note(room.game, `${p.name} hat die Verbindung verloren`);
    broadcast(room);
  } else leave(ws);
}

// Spieler endgültig entfernen (Zeit abgelaufen oder Votekick): Besitz geht an die Bank, kein Wiederbeitritt
function removePlayer(room, p, why) {
  if (room.game) { MOD(room.game).drop(room.game, p.id); MOD(room.game).note(room.game, `${p.name} wurde entfernt (${why})`); }
  room.banned.add(p.cid); if (p.uid) room.banned.add(p.uid);
  room.players.delete(p.id);
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === p.id) room.hostId = nextHost(room);
  broadcast(room);
}

function enter(ws, room, msg, id) {
  const name = id.name;
  if (!name) return send(ws, { type: 'error', text: 'Bitte gib einen Namen ein.' });
  ws.pid = Math.random().toString(36).slice(2, 10);
  ws.room = room.code;
  const color = freeColor(room);
  room.players.set(ws.pid, { id: ws.pid, name, color, guest: id.guest, uid: id.uid, avatar: id.avatar || null, admin: !!id.admin, cid: String(msg.cid || ''), ws, dc: null, votes: new Set(), watch: false });
  if (!room.hostId) room.hostId = ws.pid;
  broadcast(room);
}

// Wer ist das wirklich? Konto: Token wird bei Supabase geprüft, Name kommt aus der Datenbank. Gast: Name darf kein registrierter sein.
async function identify(m) {
  if (m.token) {
    const u = await db.verifyUser(String(m.token));
    if (!u) return { error: 'Anmeldung ungültig oder abgelaufen. Bitte melde dich neu an.' };
    if (await db.isBanned(m.token, u.id)) return { error: 'Dein Konto ist gesperrt.' };
    const name = clean(await db.username(m.token, u.id));
    if (!name) return { error: 'Zu deinem Konto gibt es noch keinen Benutzernamen.' };
    return { name, guest: false, uid: u.id, avatar: await db.avatarOf(m.token, u.id), admin: ADMINS.has(name.toLowerCase()) };
  }
  const name = clean(m.name);
  if (name && await db.nameTaken(name)) return { error: 'Dieser Name gehört einem registrierten Spieler. Wähle einen anderen oder melde dich an.' };
  return { name, guest: true, uid: null };
}

// Raum erstellen oder betreten (nachdem die Identität geklärt ist)
function entry(ws, m, id) {
  const cid = String(m.cid || '');
  if (m.type === 'create') {
    const r = { code: newCode(), hostId: null, players: new Map(), spec: new Map(), banned: new Set(), settings: { budget: 1500, map: 'klassisch', max: 8, test: false, mode: 'monopoly', anime: { rs: 'mix', time: 45 }, quiz: { category: 'gemischt', count: 10, time: 20, host: false, team: false, teamSize: 2, id: null, title: null, max: null }, rules: { doubleRent: true, vacation: true, noRentPrison: true, evenBuild: true, randomOrder: true, auction: false, vacationSkip: false } }, chat: [] };
    rooms.set(r.code, r);
    return enter(ws, r, m, id);
  }
  const r = rooms.get(String(m.code || '').toUpperCase());
  if (!r) return send(ws, { type: 'error', text: 'Diesen Raum gibt es nicht (mehr).' });
  if (r.banned.has(cid) || (id.uid && r.banned.has(id.uid))) return send(ws, { type: 'error', text: 'Du wurdest aus diesem Raum entfernt.' });
  // gleiches Gerät oder gleiches Konto = derselbe Spieler (Wiederverbinden, auch von einem anderen Gerät)
  const same = [...r.players.values()].find((x) => (x.cid && x.cid === cid) || (id.uid && x.uid === id.uid));
  if (r.game && !same) { // Spiel läuft schon: als Zuschauer dazukommen
    if (!id.name) return send(ws, { type: 'error', text: 'Bitte gib einen Namen ein.' });
    ws.pid = 's' + Math.random().toString(36).slice(2, 9); ws.room = r.code; ws.spec = true;
    r.spec.set(ws.pid, { id: ws.pid, name: id.name, guest: id.guest, uid: id.uid, admin: !!id.admin, cid, ws });
    return broadcast(r);
  }
  if (same) {
    if (same.ws && same.ws !== ws) { same.ws.room = null; try { same.ws.close(); } catch {} }
    same.ws = ws; same.dc = null; same.votes.clear(); same.trading = false; if (id.uid) { same.avatar = id.avatar || null; same.admin = !!id.admin; } ws.pid = same.id; ws.room = r.code;
    if (r.game) MOD(r.game).note(r.game, `${same.name} ist zurück`);
    return broadcast(r);
  }
  if (r.players.size >= r.settings.max) return send(ws, { type: 'error', text: 'Der Raum ist voll.' });
  enter(ws, r, m, id);
}

// Eigenes Quiz auswählen: nur eigene oder öffentliche Quizze des Hosts
async function setQuizSource(room, id) {
  const cfg = room.settings.quiz;
  if (!id) { cfg.id = null; cfg.title = null; cfg.max = null; return broadcast(room); }
  const meta = await db.quizMeta(String(id)), host = room.players.get(room.hostId) || room.spec.get(room.hostId);
  if (!meta || !host || !(meta.is_public || (host.uid && meta.owner === host.uid))) { if (host) send(host.ws, { type: 'error', text: 'Dieses Quiz kann nicht ausgewählt werden.' }); return; }
  cfg.id = String(id); cfg.title = String(meta.title).slice(0, 60); cfg.max = meta.question_count; cfg.count = Math.min(cfg.count, meta.question_count);
  if (!room.game) broadcast(room);
}

// Spiel starten (Monopoly oder Quiz). Zuschauer spielen nicht mit.
async function startGame(room) {
  if (room.starting || room.game) return;
  room.starting = true;
  try {
    let quizSetup = null;
    const animeSetup = room.settings.mode === 'anime' ? { rs: room.settings.anime.rs, time: room.settings.anime.time } : null;
    if (room.settings.mode === 'quiz') {
      const cfg = room.settings.quiz; let questions = [], title = 'Allgemeinwissen' + (cfg.category !== 'gemischt' ? ': ' + cfg.category : ''), coins = true;
      if (cfg.id) {
        const d = await db.quizData(cfg.id); questions = d ? Q.fromCustom(d.questions, cfg.count) : []; title = d ? d.title : ''; coins = false;
        if (questions.length < 3) { const h = room.players.get(room.hostId) || room.spec.get(room.hostId); return h && send(h.ws, { type: 'error', text: 'Dieses Quiz konnte nicht geladen werden (mindestens 3 gültige Fragen nötig).' }); }
      } else if (cfg.host) { title = 'Wissensquiz: Zufallsthemen'; coins = false; } // Moderator-Modus: Fragen werden erst nach der Schwierigkeitswahl gezogen
      else questions = Q.pickBuiltin(cfg.category === 'gemischt' ? null : cfg.category, cfg.count);
      quizSetup = { questions, time: cfg.time, title, coins, hostMode: !!cfg.host, builtin: !!cfg.host && !cfg.id, count: cfg.count };
    }
    if (room.game) return;
    const all = [...room.players.values()], host = room.players.get(room.hostId), ps = all.filter((p) => !p.watch && !(quizSetup && quizSetup.hostMode && p.id === room.hostId)), test = !quizSetup && room.settings.test && host && host.admin; // Moderator spielt nicht mit
    if (ps.length < (test || (quizSetup && quizSetup.hostMode) ? 1 : 2)) return;
    if (quizSetup && room.settings.quiz.team) { // Teammodus: Teams aus den Wünschen der Spieler bilden, Rest automatisch auffüllen
      const size = room.settings.quiz.teamSize, slots = Math.max(2, Math.ceil(ps.length / size)), buckets = Array.from({ length: slots }, () => []), rest = [];
      ps.forEach((p) => { if (Number.isInteger(p.team) && p.team < slots && buckets[p.team].length < size) buckets[p.team].push(p); else rest.push(p); });
      rest.forEach((p) => { const b = buckets.filter((x) => x.length < size).sort((a, c) => a.length - c.length)[0] || buckets[0]; b.push(p); });
      const teams = buckets.map((b, i) => ({ id: 't' + i, name: 'Team ' + TEAM_NAMES[i], color: TEAM_COLORS[i], members: b.map((p) => p.id) })).filter((x) => x.members.length);
      if (teams.length < 2) { const h = room.players.get(room.hostId); return h && send(h.ws, { type: 'error', text: 'Für den Teammodus braucht es mindestens 2 Teams mit Spielern.' }); }
      quizSetup.teams = teams;
    }
    if (animeSetup) room.game = A.newGame(ps, animeSetup);
    else if (quizSetup) room.game = Q.newGame(ps, quizSetup);
    else {
      if (room.settings.rules.randomOrder) for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
      room.game = G.newGame(ps, room.settings); if (test) room.game.test = true;
    }
    room.uids = {}; ps.forEach((p) => { if (p.uid) room.uids[p.id] = p.uid; }); // wer ein Konto hat (für die Coins)
    all.filter((p) => p.watch).forEach((p) => { room.players.delete(p.id); room.spec.set(p.id, { id: p.id, name: p.name, guest: p.guest, uid: p.uid, cid: p.cid, ws: p.ws, chosen: true }); if (p.ws) p.ws.spec = true; });
    broadcast(room);
  } catch (e) { console.log('Start fehlgeschlagen:', e.message); } finally { room.starting = false; }
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const room = rooms.get(ws.room);

    if ((m.type === 'create' || m.type === 'join') && !room) {
      if (ws.busy) return;
      ws.busy = true;
      identify(m).then((id) => { ws.busy = false; if (ws.room) return; if (id.error) return send(ws, { type: 'error', text: id.error }); entry(ws, m, id); })
        .catch(() => { ws.busy = false; send(ws, { type: 'error', text: 'Anmeldung konnte nicht geprüft werden. Bitte versuche es gleich noch einmal.' }); });
      return;
    } else if (room && room.game && ['roll', 'jailpay', 'buy', 'skip', 'end', 'build', 'sell', 'mortgage', 'giveup', 'jailcard', 'bid', 'pass', 'trade', 'tradeok', 'tradeno', 'answer', 'adm', 'qpick', 'qhint', 'qnext', 'qundo', 'qend', 'qopen', 'qdiff', 'apick'].includes(m.type)) {
      const g = room.game, who = room.players.get(ws.pid) || room.spec.get(ws.pid), adminOk = !!(who && who.admin && g.test); // Admin-Werkzeuge nur im Testspiel
      if (m.type === 'adm') { if (adminOk && g.kind !== 'quiz') G.admin(g, m); }
      else MOD(g).act(g, adminOk && m.as && g.players.some((x) => x.id === m.as) ? m.as : ws.pid, m, { host: ws.pid === room.hostId }); // der Admin darf für Test-Spieler handeln
      broadcast(room);
    } else if (room && ws.pid === room.hostId) {
      if (m.type === 'start' && !room.game) {
        startGame(room);
      } else if (m.type === 'lobby' && room.game && room.game.phase === 'over') {
        room.game = null;
        room.spec.forEach((x) => {
          if (room.players.size < room.settings.max) { room.players.set(x.id, { id: x.id, name: x.name, color: freeColor(room), guest: x.guest, uid: x.uid, cid: x.cid, ws: x.ws, dc: null, votes: new Set(), watch: !!x.chosen }); x.ws.spec = false; }
          else { send(x.ws, { type: 'error', text: 'Der Raum ist voll.' }); x.ws.room = null; }
        });
        room.spec.clear();
        [...room.players.values()].filter((p) => !p.ws).forEach((p) => room.players.delete(p.id)); // Getrennte fliegen nach dem Spiel raus
        broadcast(room);
      } else if (m.type === 'settings' && !room.game) {
        const b = Math.round(Number(m.budget));
        if (b >= 500 && b <= 100000) room.settings.budget = b;
        if (MAPS.includes(m.map)) room.settings.map = m.map;
        const mx = Math.round(Number(m.max)); if (mx >= Math.max(2, room.players.size) && mx <= 8) room.settings.max = mx;
        for (const k of Object.keys(room.settings.rules)) if (m.rules && typeof m.rules[k] === 'boolean') room.settings.rules[k] = m.rules[k];
        if (['monopoly', 'quiz', 'anime'].includes(m.mode)) room.settings.mode = m.mode;
        if (m.anime && typeof m.anime === 'object') { const an = room.settings.anime; if (A.RS[m.anime.rs]) an.rs = m.anime.rs; const at = Math.round(Number(m.anime.time)); if (at >= 15 && at <= 120) an.time = at; } // Anime-Schmiede
        if (typeof m.test === 'boolean') { const h = room.players.get(room.hostId); room.settings.test = !!(m.test && h && h.admin); } // Testmodus nur für Admins
        if (m.quiz && typeof m.quiz === 'object') { // Quiz-Einstellungen
          const qz = m.quiz, cfg = room.settings.quiz;
          if ('id' in qz && !qz.id) { cfg.id = null; cfg.title = null; cfg.max = null; } // zurück auf die eingebauten Fragen
          if (typeof qz.category === 'string' && (qz.category === 'gemischt' || Q.CATS.includes(qz.category))) cfg.category = qz.category;
          const cnt = Math.round(Number(qz.count)); if (cnt >= 3 && cnt <= 30) cfg.count = cfg.max ? Math.min(cnt, cfg.max) : cnt;
          const tm = Math.round(Number(qz.time)); if (tm >= 5 && tm <= 60) cfg.time = tm;
          if (typeof qz.team === 'boolean') cfg.team = qz.team; // Teammodus
          const tsz = Math.round(Number(qz.teamSize)); if (tsz >= 2 && tsz <= 4) cfg.teamSize = tsz;
          if (typeof qz.host === 'boolean') cfg.host = qz.host; // Moderator-Modus: Zufallsthema, Spieler wählt Schwierigkeit, Host moderiert
          if (qz.id) setQuizSource(room, qz.id);
        }
        broadcast(room);
      } else if (m.type === 'kick' && m.id !== ws.pid) {
        const p = room.players.get(m.id);
        if (!p) return;
        removePlayer(room, p, 'vom Host gekickt');
        send(p.ws, { type: 'kicked' });
        if (p.ws) p.ws.room = null;
      }
    }
    if (m.type === 'team' && room && !room.game && room.players.has(ws.pid)) { // Team wählen (oder verlassen)
      const p = room.players.get(ws.pid), cfg = room.settings.quiz, host = room.players.get(room.hostId);
      const cs = [...room.players.values()].filter((x) => !x.watch && !(cfg.host && x.id === room.hostId)), slots = Math.max(2, Math.ceil(cs.length / cfg.teamSize));
      if (m.team === null) p.team = null;
      else if (Number.isInteger(m.team) && m.team >= 0 && m.team < slots && cs.filter((x) => x.team === m.team && x.id !== p.id).length < cfg.teamSize && !(cfg.host && p.id === room.hostId)) p.team = m.team;
      return broadcast(room);
    }
    if (m.type === 'teamshuffle' && room && !room.game && room.hostId === ws.pid) { // Host lost die Teams aus
      const cfg = room.settings.quiz, cs = [...room.players.values()].filter((x) => !x.watch && !(cfg.host && x.id === room.hostId)), slots = Math.max(2, Math.ceil(cs.length / cfg.teamSize));
      const order = cs.map((x) => x).sort(() => Math.random() - 0.5); order.forEach((x, i) => { x.team = i % slots; });
      return broadcast(room);
    }
    if (m.type === 'color' && room && !room.game && room.players.has(ws.pid)) { // Spielerfarbe wählen (jede Farbe nur einmal)
      const c = Math.round(Number(m.color));
      if (c >= 0 && c < COLORS && ![...room.players.values()].some((p) => p.id !== ws.pid && p.color === c)) { room.players.get(ws.pid).color = c; broadcast(room); }
    }
    if (m.type === 'votekick' && room && room.players.has(ws.pid)) {
      const t = room.players.get(String(m.id));
      if (t && !t.ws && t.id !== ws.pid) {
        t.votes.add(ws.pid);
        if (t.votes.size >= needVotes(room)) removePlayer(room, t, 'Votekick'); else broadcast(room);
      }
    }
    if (m.type === 'watch' && room && !room.game && room.players.has(ws.pid)) { room.players.get(ws.pid).watch = !!m.on; broadcast(room); } // in der Lobby nur zuschauen
    if (m.type === 'trading' && room && room.players.has(ws.pid)) { room.players.get(ws.pid).trading = !!m.on; broadcast(room); }
    if (m.type === 'chat' && room && (room.players.has(ws.pid) || room.spec.has(ws.pid))) {
      const t = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 200), who = room.players.get(ws.pid) || room.spec.get(ws.pid);
      if (t) { room.chat.push({ n: who.name + (ws.spec ? ' 👁' : ''), t }); if (room.chat.length > 50) room.chat.shift(); broadcast(room); }
    }
    if (m.type === 'leave') leave(ws);
  });
  ws.on('close', () => disconnect(ws));
});

// Jede Sekunde: Minus-Timer und Verbindungs-Timer prüfen
setInterval(() => rooms.forEach((r) => {
  if (r.game && MOD(r.game).tick(r.game)) broadcast(r);
  [...r.players.values()].forEach((p) => { if (!p.ws && p.dc && Date.now() > p.dc && rooms.has(r.code)) removePlayer(r, p, 'Zeit abgelaufen'); });
}), 500);

server.listen(process.env.PORT || 3000, () => console.log('Server läuft'));
