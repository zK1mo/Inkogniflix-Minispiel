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
  return { map: settings.map, owners: {}, turn: 0, phase: 'roll', dice: [0, 0], dbl: 0, again: false, winner: null, log: ['Das Spiel beginnt!'],
    players: players.map((p) => ({ id: p.id, name: p.name, money: settings.budget, pos: 0, jail: 0, out: false })) };
}
function view(g) {
  return { ...g, board: B.map((f, i) => ({ n: NAMES[g.map][i], t: f[0], g: f[0] === 'p' ? f[3] : null, p: f[1] || 0 })) };
}
function bankrupt(g, p, to) {
  if (to) to.money += Math.max(p.money, 0);
  p.money = 0; p.out = true;
  for (const k in g.owners) if (g.owners[k] === p.id) { if (to) g.owners[k] = to.id; else delete g.owners[k]; }
  say(g, p.name + ' ist bankrott!');
  const alive = g.players.filter((x) => !x.out);
  if (alive.length === 1) { g.phase = 'over'; g.winner = alive[0].id; }
}
function pay(g, p, amt, to) { if (p.money >= amt) { p.money -= amt; if (to) to.money += amt; } else bankrupt(g, p, to); }
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
    if (o !== p.id) {
      const ow = g.players.find((x) => x.id === o); let rent;
      if (f[0] === 'p') rent = f[2] * (B.every((x, i) => x[0] !== 'p' || x[3] !== f[3] || g.owners[i] === o) ? 2 : 1);
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
  g.phase = 'roll'; g.again = false; g.dbl = 0;
}
function act(g, pid, a) {
  const p = cur(g);
  if (g.phase === 'over' || p.id !== pid) return;
  if (a.type === 'jailpay' && g.phase === 'roll' && p.jail) { pay(g, p, 50, null); p.jail = 0; if (p.out) g.phase = 'end'; }
  else if (a.type === 'roll' && g.phase === 'roll') {
    g.dice = [rnd(), rnd()];
    const dbl = g.dice[0] === g.dice[1];
    say(g, `${p.name} würfelt ${g.dice[0]} + ${g.dice[1]}`);
    if (p.jail) {
      if (dbl) { p.jail = 0; g.again = false; }
      else if (++p.jail > 3) { pay(g, p, 50, null); p.jail = 0; g.again = false; if (p.out) { g.phase = 'end'; return; } }
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
}
function drop(g, pid) {
  const p = g.players.find((x) => x.id === pid);
  if (!p || p.out) return;
  const was = cur(g).id === pid;
  bankrupt(g, p, null);
  if (g.phase !== 'over' && was) next(g);
}
module.exports = { newGame, act, drop, view };
