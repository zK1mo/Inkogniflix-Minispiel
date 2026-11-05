// Inkogniflix Spielserver: Räume, Einladungscode, Host-Einstellungen, Kicken, Wiederverbinden, Votekick
const http = require('http');
const { WebSocketServer } = require('ws');
const G = require('./game');

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
const isOut = (room, id) => { const gp = room.game && room.game.players.find((x) => x.id === id); return !!(gp && gp.out); };
// Votekick: 3/4 der verbundenen, noch aktiven Spieler müssen zustimmen
const needVotes = (room) => Math.max(1, Math.ceil(0.75 * [...room.players.values()].filter((p) => p.ws && !isOut(room, p.id)).length));
const nextHost = (room) => ([...room.players.values()].find((p) => p.ws) || [...room.players.values()][0] || {}).id;

function broadcast(room) {
  const base = {
    type: 'room', now: Date.now(), chat: room.chat, game: room.game ? G.view(room.game) : null, code: room.code, hostId: room.hostId, settings: room.settings, need: needVotes(room),
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, guest: p.guest, color: p.color, dc: p.ws ? null : p.dc, votes: [...p.votes] })),
  };
  room.players.forEach((p) => send(p.ws, { ...base, you: p.id }));
}

function leave(ws) {
  const room = rooms.get(ws.room);
  if (!room) return;
  room.players.delete(ws.pid);
  if (room.game) G.drop(room.game, ws.pid);
  ws.room = null;
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === ws.pid) room.hostId = nextHost(room);
  broadcast(room);
}

// Verbindung weg: Im laufenden Spiel bleibt der Platz 3 Minuten frei (Wiederverbinden oder Votekick)
function disconnect(ws) {
  const room = rooms.get(ws.room), p = room && room.players.get(ws.pid);
  if (!p) return;
  if (p.ws !== ws) return; // alte Verbindung wurde schon ersetzt
  if (room.game && room.game.phase !== 'over' && !isOut(room, p.id)) {
    p.ws = null; p.dc = Date.now() + DC_MS; p.votes.clear();
    G.note(room.game, `${p.name} hat die Verbindung verloren`);
    broadcast(room);
  } else leave(ws);
}

// Spieler endgültig entfernen (Zeit abgelaufen oder Votekick): Besitz geht an die Bank, kein Wiederbeitritt
function removePlayer(room, p, why) {
  if (room.game) { G.drop(room.game, p.id); G.note(room.game, `${p.name} wurde entfernt (${why})`); }
  room.banned.add(p.cid);
  room.players.delete(p.id);
  if (!room.players.size) { rooms.delete(room.code); return; }
  if (room.hostId === p.id) room.hostId = nextHost(room);
  broadcast(room);
}

function enter(ws, room, msg) {
  const name = clean(msg.name);
  if (!name) return send(ws, { type: 'error', text: 'Bitte gib einen Namen ein.' });
  ws.pid = Math.random().toString(36).slice(2, 10);
  ws.room = room.code;
  const used = new Set([...room.players.values()].map((p) => p.color)); let color = 0; while (used.has(color)) color++;
  room.players.set(ws.pid, { id: ws.pid, name, color, guest: msg.guest !== false, cid: String(msg.cid || ''), ws, dc: null, votes: new Set() });
  if (!room.hostId) room.hostId = ws.pid;
  broadcast(room);
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const room = rooms.get(ws.room);

    if (m.type === 'create' && !room) {
      const r = { code: newCode(), hostId: null, players: new Map(), banned: new Set(), settings: { budget: 1500, map: 'klassisch', max: 8, rules: { doubleRent: true, vacation: true, noRentPrison: true, evenBuild: true, randomOrder: false, auction: false } }, chat: [] };
      rooms.set(r.code, r);
      enter(ws, r, m);
    } else if (m.type === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase()), cid = String(m.cid || '');
      if (!r) return send(ws, { type: 'error', text: 'Diesen Raum gibt es nicht (mehr).' });
      if (r.banned.has(cid)) return send(ws, { type: 'error', text: 'Du wurdest aus diesem Raum entfernt.' });
      if (r.game) { // laufendes Spiel: nur Wiederverbinden mit demselben Gerät/Browser
        const p = [...r.players.values()].find((x) => x.cid && x.cid === cid);
        if (!p) return send(ws, { type: 'error', text: 'Das Spiel läuft bereits.' });
        if (p.ws && p.ws !== ws) { p.ws.room = null; try { p.ws.close(); } catch {} }
        p.ws = ws; p.dc = null; p.votes.clear(); ws.pid = p.id; ws.room = r.code;
        G.note(r.game, `${p.name} ist zurück`);
        return broadcast(r);
      }
      if (r.players.size >= r.settings.max) return send(ws, { type: 'error', text: 'Der Raum ist voll.' });
      enter(ws, r, m);
    } else if (room && room.game && ['roll', 'jailpay', 'buy', 'skip', 'end', 'build', 'sell', 'mortgage', 'giveup', 'bid', 'pass', 'trade', 'tradeok', 'tradeno'].includes(m.type)) {
      G.act(room.game, ws.pid, m);
      broadcast(room);
    } else if (room && ws.pid === room.hostId) {
      if (m.type === 'start' && !room.game && room.players.size >= 2) {
        const ps = [...room.players.values()];
        if (room.settings.rules.randomOrder) for (let i = ps.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ps[i], ps[j]] = [ps[j], ps[i]]; }
        room.game = G.newGame(ps, room.settings);
        broadcast(room);
      } else if (m.type === 'lobby' && room.game && room.game.phase === 'over') {
        room.game = null;
        [...room.players.values()].filter((p) => !p.ws).forEach((p) => room.players.delete(p.id)); // Getrennte fliegen nach dem Spiel raus
        broadcast(room);
      } else if (m.type === 'settings' && !room.game) {
        const b = Math.round(Number(m.budget));
        if (b >= 500 && b <= 100000) room.settings.budget = b;
        if (MAPS.includes(m.map)) room.settings.map = m.map;
        const mx = Math.round(Number(m.max)); if (mx >= Math.max(2, room.players.size) && mx <= 8) room.settings.max = mx;
        for (const k of Object.keys(room.settings.rules)) if (m.rules && typeof m.rules[k] === 'boolean') room.settings.rules[k] = m.rules[k];
        broadcast(room);
      } else if (m.type === 'kick' && m.id !== ws.pid) {
        const p = room.players.get(m.id);
        if (!p) return;
        removePlayer(room, p, 'vom Host gekickt');
        send(p.ws, { type: 'kicked' });
        if (p.ws) p.ws.room = null;
      }
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
    if (m.type === 'chat' && room && room.players.has(ws.pid)) {
      const t = String(m.text || '').replace(/[<>]/g, '').trim().slice(0, 200);
      if (t) { room.chat.push({ n: room.players.get(ws.pid).name, t }); if (room.chat.length > 50) room.chat.shift(); broadcast(room); }
    }
    if (m.type === 'leave') leave(ws);
  });
  ws.on('close', () => disconnect(ws));
});

// Jede Sekunde: Minus-Timer und Verbindungs-Timer prüfen
setInterval(() => rooms.forEach((r) => {
  if (r.game && G.tick(r.game)) broadcast(r);
  [...r.players.values()].forEach((p) => { if (!p.ws && p.dc && Date.now() > p.dc && rooms.has(r.code)) removePlayer(r, p, 'Zeit abgelaufen'); });
}), 1000);

server.listen(process.env.PORT || 3000, () => console.log('Server läuft'));
