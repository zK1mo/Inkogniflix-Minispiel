// Supabase-Anbindung des Spielservers. Der Server vertraut NIEMALS dem, was der Browser über seine Identität behauptet:
// Er prüft das Login-Token direkt bei Supabase und liest den Benutzernamen selbst aus der Datenbank.
const URL_ = (process.env.SUPABASE_URL || 'https://hzvnbtksanoonvkblded.supabase.co').replace(/\/$/, '');
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_BXqu2VmFxndAXpF4FAqlAg_3Dpr4Lsf'; // öffentlicher Schlüssel (darf im Code stehen)

const SERVICE = process.env.SUPABASE_SERVICE_KEY || ''; // GEHEIM: nur als Umgebungsvariable auf Render, niemals in Dateien
async function sb(path, { method = 'GET', token, body, key } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 6000);
  try {
    const h = { apikey: key || KEY, 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    else if (key && key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
    const r = await fetch(URL_ + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, data: txt ? JSON.parse(txt) : null };
  } finally { clearTimeout(t); }
}

// Gehört dieses Token zu einem echten, eingeloggten Konto? -> { id } oder null
async function verifyUser(token) {
  if (!token || typeof token !== 'string' || token.length > 4000) return null;
  const r = await sb('/auth/v1/user', { token });
  return r.ok && r.data && r.data.id ? { id: r.data.id } : null;
}
// Benutzername aus der Tabelle profiles (darf nur das eigene Profil lesen)
async function username(token, uid) {
  const r = await sb(`/rest/v1/profiles?select=username&user_id=eq.${encodeURIComponent(uid)}`, { token });
  return r.ok && Array.isArray(r.data) && r.data[0] ? String(r.data[0].username || '') : '';
}
// Gesperrt über die vorhandene Tabelle banned_users deiner Website
async function isBanned(token, uid) {
  try { const r = await sb(`/rest/v1/banned_users?select=user_id&user_id=eq.${encodeURIComponent(uid)}`, { token }); return r.ok && Array.isArray(r.data) && r.data.length > 0; }
  catch { return false; }
}
// Gast-Name schon an ein Konto vergeben? (verhindert, dass sich jemand als registrierter Spieler ausgibt)
async function nameTaken(name) {
  try { const r = await sb('/rest/v1/rpc/username_available', { method: 'POST', body: { p_name: name } }); return r.ok && r.data === false; }
  catch { return false; }
}
// Avatar aus dem Spiel-Konto (nur eigene Zeile lesbar); wird bereinigt, damit nichts Unerwartetes durchkommt
const SLOTS = ['skin', 'eyes', 'mouth', 'hat', 'glasses'];
function cleanAvatar(a) {
  const out = {}; if (!a || typeof a !== 'object') return out;
  for (const k of SLOTS) if (typeof a[k] === 'string' && /^[a-z0-9_]{1,24}$/.test(a[k])) out[k] = a[k];
  return out;
}
async function avatarOf(token, uid) {
  try { const r = await sb(`/rest/v1/game_profiles?select=avatar&user_id=eq.${encodeURIComponent(uid)}`, { token }); return r.ok && Array.isArray(r.data) && r.data[0] ? cleanAvatar(r.data[0].avatar) : {}; }
  catch { return {}; }
}
// Coins und Sieg gutschreiben: nur der Server darf das (Service-Schlüssel)
let warned = false;
async function award(uid, coins, win) {
  if (!SERVICE) { if (!warned) { warned = true; console.log('Hinweis: SUPABASE_SERVICE_KEY fehlt, Coins werden nicht vergeben.'); } return false; }
  const r = await sb('/rest/v1/rpc/game_award', { method: 'POST', key: SERVICE, body: { p_user: uid, p_coins: Math.max(0, Math.floor(coins)), p_win: !!win } });
  return r.ok;
}
module.exports = { verifyUser, username, isBanned, nameTaken, avatarOf, cleanAvatar, award };
