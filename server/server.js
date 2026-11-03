// Inkogniflix Spielserver – Schritt 1: Räume, Einladungscode, Host-Einstellungen, Kicken
const http = require('http');
const { WebSocketServer } = require('ws');
const G = require('./game');

const server = http.createServer((q, r) => { r.writeHead(200); r.end('Inkogniflix-Server läuft'); });
const wss = new WebSocketServer({ server });
const rooms = new Map();
const MAPS = ['klassisch', 'minecraft'];
const MAX_PLAYERS = 8;

const send = (ws, m) => ws.readyState === 1 && ws.send(JSON.stringify(m));
const clean = (s) => String(s || '').replace(/[<>]/g, '').trim().slice(0, 20);
const newCode = () => {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
  return rooms.has(s) ? newCode() : s;
};

function broadcast(room) {
  const base = {
    type: 'room', game: room.game ? G.view(room.game) : null, code: room.code, hostId: room.hostId, settings: room.settings,
    players: [...room.players.values()].map((p) => ({ id: p.id, name: p.name, guest: p.guest })),
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
  if (room.hostId === ws.pid) room.hostId = room.players.keys().next().value;
  broadcast(room);
}

function enter(ws, room, msg) {
  const name = clean(msg.name);
  if (!name) return send(ws, { type: 'error', text: 'Bitte gib einen Namen ein.' });
  ws.pid = Math.random().toString(36).slice(2, 10);
  ws.room = room.code;
  room.players.set(ws.pid, { id: ws.pid, name, guest: msg.guest !== false, cid: String(msg.cid || ''), ws });
  if (!room.hostId) room.hostId = ws.pid;
  broadcast(room);
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    const room = rooms.get(ws.room);

    if (m.type === 'create' && !room) {
      const r = { code: newCode(), hostId: null, players: new Map(), banned: new Set(), settings: { budget: 1500, map: 'klassisch' } };
      rooms.set(r.code, r);
      enter(ws, r, m);
    } else if (m.type === 'join' && !room) {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return send(ws, { type: 'error', text: 'Diesen Raum gibt es nicht (mehr).' });
      if (r.game) return send(ws, { type: 'error', text: 'Das Spiel läuft bereits.' });
      if (r.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', text: 'Der Raum ist voll.' });
      if (r.banned.has(String(m.cid || ''))) return send(ws, { type: 'error', text: 'Du wurdest aus diesem Raum gekickt.' });
      enter(ws, r, m);
    } else if (room && room.game && ['roll', 'jailpay', 'buy', 'skip', 'end', 'build', 'sell', 'mortgage', 'paydebt', 'giveup'].includes(m.type)) {
      G.act(room.game, ws.pid, m);
      broadcast(room);
    } else if (room && ws.pid === room.hostId) {
      if (m.type === 'start' && !room.game && room.players.size >= 2) {
        room.game = G.newGame([...room.players.values()], room.settings);
        broadcast(room);
      } else if (m.type === 'lobby' && room.game && room.game.phase === 'over') {
        room.game = null;
        broadcast(room);
      } else if (m.type === 'settings' && !room.game) {
        const b = Math.round(Number(m.budget));
        if (b >= 500 && b <= 100000) room.settings.budget = b;
        if (MAPS.includes(m.map)) room.settings.map = m.map;
        broadcast(room);
      } else if (m.type === 'kick' && m.id !== ws.pid) {
        const p = room.players.get(m.id);
        if (!p) return;
        if (room.game) G.drop(room.game, m.id);
        room.banned.add(p.cid);
        room.players.delete(m.id);
        send(p.ws, { type: 'kicked' });
        p.ws.room = null;
        broadcast(room);
      }
    }
    if (m.type === 'leave') leave(ws);
  });
  ws.on('close', () => leave(ws));
});

server.listen(process.env.PORT || 3000, () => console.log('Server läuft'));
