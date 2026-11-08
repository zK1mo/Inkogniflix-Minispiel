// Monopoly-Logik (läuft nur auf dem Server, Spieler können nicht schummeln)
// Feldtypen: go, p=Straße[Preis,Miete,Farbgruppe], r=Bahnhof, u=Werk, tax, c/ch=Karte, jail, free, gojail
const B = [['go'],['p',60,2,0],['c'],['p',60,4,0],['tax',200],['r',200],['p',100,6,1],['ch'],['p',100,6,1],['p',120,8,1],
['jail'],['p',140,10,2],['u',150],['p',140,10,2],['p',160,12,2],['r',200],['p',180,14,3],['c'],['p',180,14,3],['p',200,16,3],
['free'],['p',220,18,4],['ch'],['p',220,18,4],['p',240,20,4],['r',200],['p',260,22,5],['p',260,22,5],['u',150],['p',280,24,5],
['gojail'],['p',300,26,6],['p',300,26,6],['c'],['p',320,28,6],['r',200],['ch'],['p',350,35,7],['tax',100],['p',400,50,7]];
const NAMES = {
  klassisch: ['Start','Warschau','Schatztruhe','Krakau','Einkommensteuer','Flughafen Nord','Budapest','Überraschung','Debrecen','Szeged','Gefängnis','Dublin','Stromwerk','Cork','Galway','Flughafen Ost','Amsterdam','Schatztruhe','Rotterdam','Den Haag','Urlaub','Paris','Überraschung','Lyon','Marseille','Flughafen Süd','Madrid','Barcelona','Wasserwerk','Sevilla','Ins Gefängnis','Rom','Mailand','Schatztruhe','Venedig','Flughafen West','Überraschung','München','Luxussteuer','Berlin'],
  minecraft: ['Spawn','Erdhütte','Truhe','Sandgrube','Hungersteuer','Minenbahn Nord','Kiesstrand','Ereignis','Wiesenhügel','Birkenwald','Verlies','Dschungel','Redstone-Werk','Lehmteich','Sumpfhütte','Minenbahn Ost','Taiga','Truhe','Schneeberg','Eisfjord','Pilzinsel','Savanne','Ereignis','Mesa','Wüstentempel','Minenbahn Süd','Ozeanmonument','Korallenriff','Wasserwerk','Unterwasserhöhle','Zum Verlies','Nether-Brücke','Lavasee','Truhe','Netherfestung','Minenbahn West','Ereignis','End-Stadt','Beacon-Steuer','Thron des Drachen'],
};
const GN = {
  klassisch: ['Polen', 'Ungarn', 'Irland', 'Niederlande', 'Frankreich', 'Spanien', 'Italien', 'Deutschland'],
  minecraft: ['Dorf', 'Ebene', 'Wald', 'Gebirge', 'Wüste', 'Ozean', 'Nether', 'Ende'],
};
const CARDS = [['Bankirrtum zu deinen Gunsten: +150',{m:150}],['Strafzettel: -50',{m:-50}],['Geburtstag: +100',{m:100}],
['Gehe direkt zum Start',{go:0}],['Gehe ins Gefängnis',{jail:1}],['Reise zum letzten Feld',{go:39}],['Arztrechnung: -100',{m:-100}],['Lotteriegewinn: +200',{m:200}],['Du kommst aus dem Gefängnis frei (Pardon-Karte, wird aufbewahrt)',{pardon:1}]];

const rnd = () => 1 + Math.floor(Math.random() * 6);
const cur = (g) => g.players[g.turn];
const say = (g, t) => { g.log.push(t); if (g.log.length > 120) g.log.shift(); };

const DEFAULT_RULES = { doubleRent: true, vacation: true, noRentPrison: true, evenBuild: true, randomOrder: true, auction: false };
function newGame(players, settings) {
  return { map: settings.map, rules: { ...DEFAULT_RULES, ...(settings.rules || {}) }, pot: 0, owners: {}, houses: {}, mort: {}, minus: null, outOrder: [], trades: [], tid: 0, rn: 0, turn: 0, phase: 'roll', dice: [0, 0], dbl: 0, again: false, winner: null, log: ['Das Spiel beginnt!'],
    players: players.map((p) => ({ id: p.id, name: p.name, color: p.color || 0, pardon: 0, money: settings.budget, pos: 0, jail: 0, out: false })) };
}
// Coins nach Platz: Sieger bekommt am meisten, jeder weitere Platz die Hälfte des Vorgängers, der Letzte nichts.
// Zu kurze Spiele (unter 12 Würfen) geben keine Coins, damit man sie nicht mit Zweitkonten erfarmen kann.
const MIN_ROLLS = 12;
function payouts(g) {
  const n = g.players.length, win = 100 + 40 * (n - 2), long = g.rn >= MIN_ROLLS;
  return [g.winner, ...[...g.outOrder].reverse()].filter(Boolean).map((id, i) => {
    const place = i + 1, raw = place < n ? win * Math.pow(0.5, place - 1) : 0;
    return { id, place, coins: long ? Math.round(raw / 5) * 5 : 0 };
  });
}
function view(g) {
  return { ...g, payout: g.phase === 'over' ? Object.fromEntries(payouts(g).map((x) => [x.id, { place: x.place, coins: x.coins }])) : null, groups: GN[g.map], board: B.map((f, i) => ({ n: NAMES[g.map][i], t: f[0], g: f[0] === 'p' ? f[3] : null, p: f[1] || 0, r: f[2] || 0 })) };
}
function bankrupt(g, p, to) {
  if (to) to.money += Math.max(p.money, 0);
  p.money = 0; p.out = true; g.outOrder.push(p.id);
  g.trades = g.trades.filter((t) => t.from !== p.id && t.to !== p.id);
  for (const k in g.owners) if (g.owners[k] === p.id) { delete g.houses[k]; if (to) g.owners[k] = to.id; else { delete g.owners[k]; delete g.mort[k]; } }
  say(g, p.name + ' ist bankrott!');
  if (g.auction && g.auction.bidder === p.id) { g.auction.bid = 0; g.auction.bidder = null; }
  const alive = g.players.filter((x) => !x.out);
  if (alive.length === 1) { g.phase = 'over'; g.winner = alive[0].id; }
}
const cost = (i) => [50, 50, 100, 100, 150, 150, 200, 200][B[i][3]];
const grp = (i) => B.map((f, k) => k).filter((k) => B[k][0] === 'p' && B[k][3] === B[i][3]);
const worth = (g, p) => Object.keys(g.owners).filter((k) => g.owners[k] === p.id)
  .reduce((s, k) => s + (g.mort[k] ? 0 : B[k][1] / 2) + (g.houses[k] ? g.houses[k] * cost(k) / 2 : 0), 0);
// ===== Auktion: wer nicht kaufen will, schickt das Feld in die Versteigerung =====
const AUC_START_MS = 15000, AUC_BID_MS = 10000; // Startzeit; nach jedem Gebot laufen 10 s neu
function startAuction(g, p) {
  g.auction = { pos: p.pos, bid: 0, bidder: null, passed: [], until: Date.now() + AUC_START_MS };
  g.phase = 'auction'; say(g, `${NAMES[g.map][p.pos]} wird versteigert`);
}
function endAuction(g) {
  const au = g.auction, w = au.bidder && g.players.find((x) => x.id === au.bidder), nm = NAMES[g.map][au.pos];
  if (w && !w.out && w.money >= au.bid) { w.money -= au.bid; g.owners[au.pos] = w.id; say(g, `${w.name} ersteigert ${nm} für ${au.bid} €`); }
  else say(g, `Niemand ersteigert ${nm}`);
  g.auction = null; g.phase = g.again ? 'roll' : 'end';
}
// Früher fertig, wenn niemand mehr überbieten kann oder will
function auctionCheck(g) {
  const au = g.auction; if (!au) return;
  const live = g.players.filter((x) => !x.out && !au.passed.includes(x.id) && x.money >= 0 && (x.id === au.bidder || x.money > au.bid));
  if (au.bidder ? live.length === 1 : live.length === 0) endAuction(g);
}
function auctionAct(g, pid, a) {
  const au = g.auction, q = g.players.find((x) => x.id === pid);
  if (!au || !q || q.out || au.passed.includes(pid)) return;
  if (a.type === 'bid') {
    const amt = Math.floor(Number(a.amount));
    if (!(amt > au.bid) || amt > q.money || amt > 1e6) return;
    au.bid = amt; au.bidder = pid; au.until = Date.now() + AUC_BID_MS; say(g, `${q.name} bietet ${amt} €`);
  } else if (a.type === 'pass') { if (pid === au.bidder) return; au.passed.push(pid); }
  auctionCheck(g);
}

const MINUS_MS = 3 * 60 * 1000; // so lange hat man Zeit, wieder ins Plus zu kommen
function pay(g, p, amt, to) {
  p.money -= amt; if (to) to.money += amt; // darf ins Minus gehen, kein automatisches Aufgeben
  if (!to && g.rules.vacation) g.pot += amt; // Zahlungen an die Bank wandern in den Urlaubs-Topf
  if (p.money < 0) { say(g, `${p.name} ist im Minus (${p.money} €)`); g.minus = { id: p.id, until: Date.now() + MINUS_MS }; }
}
// Minus-Timer löschen, sobald der Spieler wieder im Plus ist (oder ausgeschieden)
function chk(g) { if (g.minus) { const q = g.players.find((x) => x.id === g.minus.id); if (!q || q.out || q.money >= 0) g.minus = null; } }
// Wird vom Server jede Sekunde aufgerufen: Zeit abgelaufen -> Bankrott
function tick(g) {
  let ch = false;
  if (g.auction && g.phase !== 'over' && Date.now() >= g.auction.until) { endAuction(g); ch = true; }
  return tickMinus(g) || ch;
}
function tickMinus(g) {
  if (!g.minus || g.phase === 'over' || Date.now() < g.minus.until) return false;
  const q = g.players.find((x) => x.id === g.minus.id); g.minus = null;
  if (!q || q.out || q.money >= 0) return true;
  say(g, `${q.name}: Zeit abgelaufen`);
  const was = cur(g) === q; bankrupt(g, q, null); if (g.phase !== 'over' && was) next(g);
  return true;
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
      if (f[0] === 'p') rent = g.houses[p.pos] ? f[2] * [1, 5, 15, 45, 80, 125][g.houses[p.pos]] : f[2] * (g.rules.doubleRent && B.every((x, i) => x[0] !== 'p' || x[3] !== f[3] || g.owners[i] === o) ? 2 : 1);
      else if (f[0] === 'r') rent = 25 * 2 ** (B.filter((x, i) => x[0] === 'r' && g.owners[i] === o).length - 1);
      else rent = (g.dice[0] + g.dice[1]) * (B.filter((x, i) => x[0] === 'u' && g.owners[i] === o).length > 1 ? 10 : 4);
      if (g.rules.noRentPrison && ow.jail) say(g, `${ow.name} sitzt im Gefängnis: keine Miete für ${nm}`);
      else { say(g, `${p.name} zahlt ${rent} Miete an ${ow.name} (${nm})`); pay(g, p, rent, ow); }
    }
  } else if (f[0] === 'tax') { say(g, `${p.name} zahlt ${f[1]} Steuern`); pay(g, p, f[1], null); }
  else if (f[0] === 'free' && g.rules.vacation && g.pot > 0) { say(g, `${p.name} kassiert ${g.pot} € Urlaubsgeld`); p.money += g.pot; g.pot = 0; }
  else if (f[0] === 'gojail') toJail(g, p);
  else if (f[0] === 'c' || f[0] === 'ch') {
    const c = CARDS[Math.floor(Math.random() * CARDS.length)], e = c[1];
    say(g, `${p.name}: ${c[0]}`);
    if (e.m > 0) p.money += e.m; else if (e.m < 0) pay(g, p, -e.m, null);
    else if (e.pardon) p.pardon = (p.pardon || 0) + 1;
    else if ('go' in e) move(g, p, e.go); else toJail(g, p);
  }
  if (g.phase === 'end' && g.again && !p.out) g.phase = 'roll';
}
function next(g) {
  do { g.turn = (g.turn + 1) % g.players.length; } while (cur(g).out);
  g.phase = 'roll'; g.again = false; g.dbl = 0; g.auction = null;
}
function act0(g, pid, a) {
  const p = cur(g);
  if (g.phase === 'over' || p.id !== pid) return;
  if (a.type === 'jailpay' && g.phase === 'roll' && p.jail && p.money >= 50) {
    pay(g, p, 50, null); p.jail = 0; g.again = false; g.phase = 'end';
    say(g, `${p.name} kauft sich frei und setzt diese Runde aus`);
  } else if (a.type === 'jailcard' && g.phase === 'roll' && p.jail && p.pardon > 0) {
    p.pardon--; p.jail = 0; g.again = false; g.phase = 'end';
    say(g, `${p.name} nutzt eine Pardon-Karte und setzt diese Runde aus`);
  } else if (a.type === 'roll' && g.phase === 'roll' && p.money >= 0) { // im Minus darf man nicht würfeln
    g.dice = [rnd(), rnd()]; g.rn++; // Wurfzähler: nur ein neuer Wurf startet die Würfel-Animation
    const dbl = g.dice[0] === g.dice[1];
    say(g, `${p.name} würfelt ${g.dice[0]} + ${g.dice[1]}`);
    if (p.jail) {
      if (dbl) { p.jail = 0; g.again = false; } // Pasch: frei und sofort ziehen
      else if (++p.jail > 3) { pay(g, p, 50, null); p.jail = 0; g.again = false; if (p.out) { g.phase = 'end'; return; } }
      else { g.phase = 'end'; return; }
    } else if (dbl) {
      g.dbl++; g.again = true;
      if (g.dbl >= 3) { toJail(g, p); g.phase = 'end'; return; }
    } else { g.dbl = 0; g.again = false; }
    move(g, p, (p.pos + g.dice[0] + g.dice[1]) % 40);
  } else if ((a.type === 'buy' || a.type === 'skip') && g.phase === 'buy') {
    const f = B[p.pos];
    if (a.type === 'skip' && g.rules.auction) { startAuction(g, p); return; }
    if (a.type === 'buy' && p.money >= f[1]) { p.money -= f[1]; g.owners[p.pos] = p.id; say(g, `${p.name} kauft ${NAMES[g.map][p.pos]} für ${f[1]}`); }
    g.phase = g.again ? 'roll' : 'end';
  } else if (a.type === 'end' && g.phase === 'end' && p.money >= 0) next(g);
  else manage(g, p, a);
}
// Häuser/Hotels (gleichmäßig bauen), Hypotheken, Schulden begleichen oder aufgeben
function manage(g, p, a) {
  if (a.type === 'giveup') { // Aufgeben: alles geht zurück an die Bank
    bankrupt(g, p, null);
    if (g.phase !== 'over') next(g);
    return;
  }
  const i = Number(a.pos), f = B[i];
  if (!f || g.owners[i] !== p.id) return;
  const hs = g.houses, h = hs[i] || 0, G = grp(i).map((k) => hs[k] || 0);
  if (a.type === 'build' && f[0] === 'p' && grp(i).every((k) => g.owners[k] === p.id && !g.mort[k]) && h < 5 && (!g.rules.evenBuild || h === Math.min(...G)) && p.money >= cost(i)) {
    p.money -= cost(i); hs[i] = h + 1;
    say(g, `${p.name} baut auf ${NAMES[g.map][i]} (${hs[i] === 5 ? 'Hotel' : hs[i] + '. Haus'})`);
  } else if (a.type === 'sell' && h > 0 && (!g.rules.evenBuild || h === Math.max(...G))) {
    hs[i] = h - 1; p.money += cost(i) / 2;
    say(g, `${p.name} verkauft ein Gebäude auf ${NAMES[g.map][i]}`);
  } else if (a.type === 'mortgage') {
    if (g.mort[i]) { const c = Math.ceil(f[1] / 2 * 1.1); if (p.money >= c) { p.money -= c; delete g.mort[i]; say(g, `${p.name} löst die Hypothek auf ${NAMES[g.map][i]} aus`); } }
    else if (f[0] !== 'p' || G.every((x) => x === 0)) { g.mort[i] = true; p.money += f[1] / 2; say(g, `${p.name} nimmt eine Hypothek auf ${NAMES[g.map][i]} auf`); }
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
    if (!tradable(g, pid, gp) || !tradable(g, to.id, tp) || (gm > 0 && gm > me.money) || (tm > 0 && tm > to.money)) return;
    if (a.replace) g.trades = g.trades.filter((x) => !(x.id === Number(a.replace) && x.to === pid)); // Gegenangebot ersetzt das alte Angebot
    if (g.trades.length >= 10) g.trades.shift();
    g.trades.push({ id: ++g.tid, from: pid, to: to.id, gm, gp, tm, tp });
    return;
  }
  const t = g.trades.find((x) => x.id === Number(a.id));
  if (!t || (pid !== t.from && pid !== t.to)) return;
  g.trades = g.trades.filter((x) => x !== t);
  if (a.type !== 'tradeok' || pid !== t.to) return;
  const f = g.players.find((x) => x.id === t.from);
  if (f.out || !tradable(g, t.from, t.gp) || !tradable(g, t.to, t.tp) || (t.gm > 0 && t.gm > f.money) || (t.tm > 0 && t.tm > me.money)) return;
  f.money += t.tm - t.gm; me.money += t.gm - t.tm;
  t.gp.forEach((k) => { g.owners[k] = t.to; }); t.tp.forEach((k) => { g.owners[k] = t.from; });
  say(g, `Handel: ${f.name} und ${me.name} tauschen`);
}
function act(g, pid, a) {
  if (String(a.type).startsWith('trade')) { tradeAct(g, pid, a); chk(g); return; }
  if (a.type === 'giveup') { // Aufgeben geht jederzeit, auch wenn man nicht am Zug ist
    const q = g.players.find((x) => x.id === pid);
    if (q && !q.out && g.phase !== 'over') { say(g, `${q.name} gibt auf`); drop(g, pid); }
    return;
  }
  if (a.type === 'bid' || a.type === 'pass') { auctionAct(g, pid, a); return; }
  if (['build', 'sell', 'mortgage'].includes(a.type)) { // Bauen und Hypotheken gehen jederzeit, nicht nur im eigenen Zug
    const q = g.players.find((x) => x.id === pid);
    const myTurn = cur(g).id === pid, mortInAuction = a.type === 'mortgage' && g.phase === 'auction' && !g.mort[Number(a.pos)];
    if (q && !q.out && g.phase !== 'over' && (myTurn || mortInAuction)) manage(g, q, a);
    chk(g); return;
  }
  act0(g, pid, a); chk(g);
}
function drop(g, pid) {
  const p = g.players.find((x) => x.id === pid);
  if (!p || p.out) return;
  const was = cur(g).id === pid;
  bankrupt(g, p, null);
  if (g.phase !== 'over' && was) next(g);
  chk(g);
}
module.exports = { newGame, act, drop, view, tick, payouts, note: say };
