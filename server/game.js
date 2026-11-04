// Monopoly-Logik (läuft nur auf dem Server, Spieler können nicht schummeln)
// Feldtypen: go, p=Straße[Preis,Miete,Farbgruppe], r=Bahnhof, u=Werk, tax, c/ch=Karte, jail, free, gojail
const B = [['go'],['p',60,2,0],['c'],['p',60,4,0],['tax',200],['r',200],['p',100,6,1],['ch'],['p',100,6,1],['p',120,8,1],
['jail'],['p',140,10,2],['u',150],['p',140,10,2],['p',160,12,2],['r',200],['p',180,14,3],['c'],['p',180,14,3],['p',200,16,3],
['free'],['p',220,18,4],['ch'],['p',220,18,4],['p',240,20,4],['r',200],['p',260,22,5],['p',260,22,5],['u',150],['p',280,24,5],
['gojail'],['p',300,26,6],['p',300,26,6],['c'],['p',320,28,6],['r',200],['ch'],['p',350,35,7],['tax',100],['p',400,50,7]];
const NAMES = {
  klassisch: ['Start','Moosgasse','Gemeinschaft','Rosenweg','Einkommensteuer','Nordbahnhof','Lindenallee','Ereignis','Birkenstraße','Ahornplatz','Gefängnis','Uferstraße','Stadtwerke','Hafenweg','Dockstraße','Ostbahnhof','Marktplatz','Gemeinschaft','Kirchgasse','Rathausplatz','Frei Parken','Theaterstraße','Ereignis','Opernplatz','Museumsallee','Südbahnhof','Wiesenstraße','Gartenweg','Wasserwerk','Schlossgasse','Gehe ins Gefängnis','Bankenviertel','Börsenstraße','Gemeinschaft','Goldallee','Westbahnhof','Ereignis','Kaiserstraße','Luxussteuer','Königsallee'],
  minecraft: ['Spawn','Erdhütte','Truhe','Sandgrube','Hungersteuer','Minenbahn Nord','Kiesstrand','Ereignis','Wiesenhügel','Birkenwald','Verlies','Dschungel','Redstone-Werk','Lehmteich','Sumpfhütte','Minenbahn Ost','Taiga','Truhe','Schneeberg','Eisfjord','Pilzinsel','Savanne','Ereignis','Mesa','Wüstentempel','Minenbahn Süd','Ozeanmonument','Korallenriff','Wasserwerk','Unterwasserhöhle','Zum Verlies','Nether-Brücke','Lavasee','Truhe','Netherfestung','Minenbahn West','Ereignis','End-Stadt','Beacon-Steuer','Thron des Drachen'],
};
const CARDS = [['Bankirrtum zu deinen Gunsten: +150',{m:150}],['Strafzettel: -50',{m:-50}],['Geburtstag: +100',{m:100}],
['Gehe direkt zum Start',{go:0}],['Gehe ins Gefängnis',{jail:1}],['Reise zum letzten Feld',{go:39}],['Arztrechnung: -100',{m:-100}],['Lotteriegewinn: +200',{m:200}]];

const rnd = () => 1 + Math.floor(Math.random() * 6);
const cur = (g) => g.players[g.turn];
const say = (g, t) => { g.log.push(t); if (g.log.length > 8) g.log.shift(); };

function newGame(players, settings) {
  return { map: settings.map, owners: {}, houses: {}, mort: {}, debt: null, resume: null, trades: [], tid: 0, turn: 0, phase: 'roll', dice: [0, 0], dbl: 0, again: false, winner: null, log: ['Das Spiel beginnt!'],
    players: players.map((p) => ({ id: p.id, name: p.name, money: settings.budget, pos: 0, jail: 0, out: false })) };
}
function view(g) {
  return { ...g, board: B.map((f, i) => ({ n: NAMES[g.map][i], t: f[0], g: f[0] === 'p' ? f[3] : null, p: f[1] || 0, r: f[2] || 0 })) };
}
function bankrupt(g, p, to) {
  if (to) to.money += Math.max(p.money, 0);
  p.money = 0; p.out = true;
  g.trades = g.trades.filter((t) => t.from !== p.id && t.to !== p.id);
  if (cur(g) === p) g.debt = null;
  for (const k in g.owners) if (g.owners[k] === p.id) { delete g.houses[k]; if (to) g.owners[k] = to.id; else { delete g.owners[k]; delete g.mort[k]; } }
  say(g, p.name + ' ist bankrott!');
  const alive = g.players.filter((x) => !x.out);
  if (alive.length === 1) { g.phase = 'over'; g.winner = alive[0].id; }
}
const cost = (i) => [50, 50, 100, 100, 150, 150, 200, 200][B[i][3]];
const grp = (i) => B.map((f, k) => k).filter((k) => B[k][0] === 'p' && B[k][3] === B[i][3]);
const worth = (g, p) => Object.keys(g.owners).filter((k) => g.owners[k] === p.id)
  .reduce((s, k) => s + (g.mort[k] ? 0 : B[k][1] / 2) + (g.houses[k] ? g.houses[k] * cost(k) / 2 : 0), 0);
function pay(g, p, amt, to) {
  if (p.money >= amt) { p.money -= amt; if (to) to.money += amt; }
  else if (p.money + worth(g, p) >= amt) g.debt = { amt, to: to ? to.id : null }; // Spieler kann Geld beschaffen
  else bankrupt(g, p, to);
}
function toJail(g, p) { p.pos = 10; p.jail = 1; g.again = false; say(g, p.name + ' geht ins Gefängnis.'); }
function move(g, p, to) {
  if (to < p.pos) { p.money += 200; say(g, p.name + ' passiert den Start: +200'); }
  p.pos = to; land(g, p);
}
function land(g, p) {
  const f = B[p.pos], nm = NAMES[g.map][p.pos];
  g.phase = 'end';
  if (['p', 'r', 'u'].includes(f[0])) {
    const o = g.owners[p.pos];
    if (!o) { g.phase = 'buy'; return; }
    if (o !== p.id && !g.mort[p.pos]) {
      const ow = g.players.find((x) => x.id === o); let rent;
      if (f[0] === 'p') rent = g.houses[p.pos] ? f[2] * [1, 5, 15, 45, 80, 125][g.houses[p.pos]] : f[2] * (B.every((x, i) => x[0] !== 'p' || x[3] !== f[3] || g.owners[i] === o) ? 2 : 1);
      else if (f[0] === 'r') rent = 25 * 2 ** (B.filter((x, i) => x[0] === 'r' && g.owners[i] === o).length - 1);
      else rent = (g.dice[0] + g.dice[1]) * (B.filter((x, i) => x[0] === 'u' && g.owners[i] === o).length > 1 ? 10 : 4);
      say(g, `${p.name} zahlt ${rent} Miete an ${ow.name} (${nm})`);
      pay(g, p, rent, ow);
    }
  } else if (f[0] === 'tax') { say(g, `${p.name} zahlt ${f[1]} Steuern`); pay(g, p, f[1], null); }
  else if (f[0] === 'gojail') toJail(g, p);
  else if (f[0] === 'c' || f[0] === 'ch') {
    const c = CARDS[Math.floor(Math.random() * CARDS.length)], e = c[1];
    say(g, `${p.name}: ${c[0]}`);
    if (e.m > 0) p.money += e.m; else if (e.m < 0) pay(g, p, -e.m, null);
    else if ('go' in e) move(g, p, e.go); else toJail(g, p);
  }
  if (g.phase === 'end' && g.again && !p.out) g.phase = 'roll';
}
function next(g) {
  do { g.turn = (g.turn + 1) % g.players.length; } while (cur(g).out);
  g.phase = 'roll'; g.again = false; g.dbl = 0; g.debt = null;
}
function act0(g, pid, a) {
  const p = cur(g);
  if (g.phase === 'over' || p.id !== pid) return;
  if (a.type === 'jailpay' && g.phase === 'roll' && p.jail) { pay(g, p, 50, null); p.jail = 0; if (p.out) g.phase = 'end'; }
  else if (a.type === 'roll' && g.phase === 'roll') {
    g.dice = [rnd(), rnd()];
    const dbl = g.dice[0] === g.dice[1];
    say(g, `${p.name} würfelt ${g.dice[0]} + ${g.dice[1]}`);
    if (p.jail) {
      if (dbl) { p.jail = 0; g.again = false; }
      else if (++p.jail > 3) { pay(g, p, 50, null); p.jail = 0; g.again = false; if (p.out) { g.phase = 'end'; return; } if (g.debt) return; }
      else { g.phase = 'end'; return; }
    } else if (dbl) {
      g.dbl++; g.again = true;
      if (g.dbl >= 3) { toJail(g, p); g.phase = 'end'; return; }
    } else { g.dbl = 0; g.again = false; }
    move(g, p, (p.pos + g.dice[0] + g.dice[1]) % 40);
  } else if ((a.type === 'buy' || a.type === 'skip') && g.phase === 'buy') {
    const f = B[p.pos];
    if (a.type === 'buy' && p.money >= f[1]) { p.money -= f[1]; g.owners[p.pos] = p.id; say(g, `${p.name} kauft ${NAMES[g.map][p.pos]} für ${f[1]}`); }
    g.phase = g.again ? 'roll' : 'end';
  } else if (a.type === 'end' && g.phase === 'end') next(g);
  else manage(g, p, a);
}
// Häuser/Hotels (gleichmäßig bauen), Hypotheken, Schulden begleichen oder aufgeben
function manage(g, p, a) {
  if (a.type === 'paydebt' && g.debt && p.money >= g.debt.amt) {
    const to = g.players.find((x) => x.id === g.debt.to);
    p.money -= g.debt.amt; if (to) to.money += g.debt.amt;
    g.debt = null; g.phase = g.resume; return;
  }
  if (a.type === 'giveup') {
    bankrupt(g, p, g.debt && g.players.find((x) => x.id === g.debt.to));
    if (g.phase !== 'over') next(g);
    return;
  }
  const i = Number(a.pos), f = B[i];
  if (!f || g.owners[i] !== p.id) return;
  const hs = g.houses, h = hs[i] || 0, G = grp(i).map((k) => hs[k] || 0);
  if (a.type === 'build' && f[0] === 'p' && grp(i).every((k) => g.owners[k] === p.id && !g.mort[k]) && h < 5 && h === Math.min(...G) && p.money >= cost(i)) {
    p.money -= cost(i); hs[i] = h + 1;
  } else if (a.type === 'sell' && h > 0 && h === Math.max(...G)) {
    hs[i] = h - 1; p.money += cost(i) / 2;
  } else if (a.type === 'mortgage') {
    if (g.mort[i]) { const c = Math.ceil(f[1] / 2 * 1.1); if (p.money >= c) { p.money -= c; delete g.mort[i]; } }
    else if (f[0] !== 'p' || G.every((x) => x === 0)) { g.mort[i] = true; p.money += f[1] / 2; }
  }
}
// Handel: jeder Spieler kann jederzeit Angebote machen; der Server prüft alles beim Erstellen und beim Annehmen
const tradable = (g, pid, ps) => ps.every((k) => g.owners[k] === pid && B[k][0] && !grp(k).some((x) => g.houses[x]));
function tradeAct(g, pid, a) {
  const me = g.players.find((x) => x.id === pid);
  if (!me || me.out || g.phase === 'over') return;
  if (a.type === 'trade') {
    const to = g.players.find((x) => x.id === a.to);
    const gp = [].concat(a.gp || []).map(Number), tp = [].concat(a.tp || []).map(Number);
    const gm = Math.max(0, Math.floor(Number(a.gm) || 0)), tm = Math.max(0, Math.floor(Number(a.tm) || 0));
    if (!to || to.out || to === me || !(gm || tm || gp.length || tp.length)) return;
    if (!tradable(g, pid, gp) || !tradable(g, to.id, tp) || gm > me.money || tm > to.money) return;
    if (g.trades.length >= 10) g.trades.shift();
    g.trades.push({ id: ++g.tid, from: pid, to: to.id, gm, gp, tm, tp });
    return;
  }
  const t = g.trades.find((x) => x.id === Number(a.id));
  if (!t || (pid !== t.from && pid !== t.to)) return;
  g.trades = g.trades.filter((x) => x !== t);
  if (a.type !== 'tradeok' || pid !== t.to) return;
  const f = g.players.find((x) => x.id === t.from);
  if (f.out || !tradable(g, t.from, t.gp) || !tradable(g, t.to, t.tp) || t.gm > f.money || t.tm > me.money) return;
  f.money += t.tm - t.gm; me.money += t.gm - t.tm;
  t.gp.forEach((k) => { g.owners[k] = t.to; }); t.tp.forEach((k) => { g.owners[k] = t.from; });
  say(g, `Handel: ${f.name} und ${me.name} tauschen`);
}
function act(g, pid, a) {
  if (String(a.type).startsWith('trade')) return tradeAct(g, pid, a);
  act0(g, pid, a);
  if (g.debt && g.phase !== 'debt' && g.phase !== 'over') { g.resume = g.phase; g.phase = 'debt'; }
}
function drop(g, pid) {
  const p = g.players.find((x) => x.id === pid);
  if (!p || p.out) return;
  const was = cur(g).id === pid;
  bankrupt(g, p, null);
  if (g.phase !== 'over' && was) next(g);
}
module.exports = { newGame, act, drop, view };
