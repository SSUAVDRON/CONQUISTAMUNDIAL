// Identidad firmada para las salas clasificatorias: cada navegador tiene un
// par de claves ECDSA P-256 (WebCrypto) y firma lo que dice de su rango en
// esa sala (código, MMR y puntos). Los demás comprueban la firma antes de
// usar ese MMR en el Elo; si no cuadra (o no hay firma), cuenta el de
// partida (1000). Así nadie puede hacerse pasar por otro jugador de la tabla
// ni reutilizar la firma de otra sala.

const KEY = 'trinchera.identidad';
const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

const subtle = () => (typeof crypto !== 'undefined' && crypto.subtle ? crypto.subtle : null);

function b64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(text) {
  const s = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

let cached = null;

/** Par de claves de este navegador (se crea la primera vez). Devuelve { pub (JWK público), priv (CryptoKey), id } o null. */
export async function getIdentity(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  if (cached) return cached;
  const s = subtle();
  if (!s) return null;
  try {
    let saved = null;
    try {
      saved = JSON.parse(storage.getItem(KEY));
    } catch {
      saved = null;
    }
    let pubJwk;
    let privJwk;
    if (saved && saved.pub && saved.priv) {
      pubJwk = saved.pub;
      privJwk = saved.priv;
    } else {
      const pair = await s.generateKey(ALG, true, ['sign', 'verify']);
      pubJwk = await s.exportKey('jwk', pair.publicKey);
      privJwk = await s.exportKey('jwk', pair.privateKey);
      try {
        storage.setItem(KEY, JSON.stringify({ pub: pubJwk, priv: privJwk }));
      } catch {
        /* sin almacenamiento: identidad solo para esta sesión */
      }
    }
    const priv = await s.importKey('jwk', privJwk, ALG, false, ['sign']);
    const pub = { kty: 'EC', crv: 'P-256', x: pubJwk.x, y: pubJwk.y };
    cached = { pub, priv, id: await keyId(pub) };
    return cached;
  } catch {
    return null;
  }
}

/** Id corto de una clave pública: los 16 primeros del sha-256 de x e y. */
export async function keyId(pub) {
  const s = subtle();
  const buf = await s.digest('SHA-256', new TextEncoder().encode(`${pub.x}.${pub.y}`));
  return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lo que se firma en una sala: el código, el MMR (entero) y los puntos. */
export function claimText(code, mmr, puntos) {
  return `trinchera|${code}|${Math.round(mmr)}|${Math.floor(puntos)}`;
}

/** Firma un texto con tu identidad: { pub, sig } o null. */
export async function signClaim(text, ident) {
  const s = subtle();
  if (!s || !ident) return null;
  const sig = await s.sign(SIGN, ident.priv, new TextEncoder().encode(text));
  return { pub: ident.pub, sig: b64u(sig) };
}

/** ¿Es `sig` una firma válida de `text` con la clave pública `pub`? */
export async function verifyClaim(text, pub, sig) {
  const s = subtle();
  if (!s || !pub || typeof pub.x !== 'string' || typeof pub.y !== 'string' || typeof sig !== 'string') return false;
  try {
    const key = await s.importKey('jwk', { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y, ext: true }, ALG, false, ['verify']);
    return await s.verify(SIGN, key, unb64u(sig), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

/**
 * Rango que anuncia un jugador en la sala `code` (presencia `rango`):
 * { mmr, puntos, id } si la firma es buena, o null.
 */
export async function verifiedRank(code, claim) {
  if (!claim || typeof claim !== 'object') return null;
  const mmr = Number(claim.mmr);
  const puntos = Number(claim.puntos);
  if (!Number.isFinite(mmr) || !Number.isFinite(puntos) || mmr < 0 || mmr > 4000 || puntos < 0 || puntos > 5000) return null;
  const ok = await verifyClaim(claimText(code, mmr, puntos), claim.pub, claim.sig);
  return ok ? { mmr: Math.round(mmr), puntos: Math.floor(puntos), id: await keyId(claim.pub) } : null;
}
