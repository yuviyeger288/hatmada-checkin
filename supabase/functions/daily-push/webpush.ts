/* Web Push — הצפנה וחתימה, בלי שום תלות חיצונית.
 *
 * למה בכתיב יד ולא ספרייה: הפונקציה רצה על Deno, והספריות המוכרות
 * (npm:web-push) כתובות ל-Node. ייבוא שנשבר מתגלה רק בפריסה, ואז אין
 * מה לעשות איתו מכאן. כל מה שצריך כאן קיים ב-Web Crypto, שהוא תקני
 * גם ב-Deno וגם בדפדפן וגם ב-Node.
 *
 * המימוש הוא בדיוק שלושת התקנים:
 *   RFC 8291 — הצפנת גוף ההודעה (aes128gcm מעל ECDH על P-256)
 *   RFC 8188 — מבנה הגוף המוצפן
 *   RFC 8292 — חתימת VAPID, שמוכיחה לשירות ההתראות מי שולח
 *
 * הנכונות נבדקת מול דוגמת הבדיקה הרשמית של RFC 8291 פרק 5,
 * ב-supabase/tests/webpush.test.ts. אם משנים כאן משהו — להריץ אותו.
 */

/* ---------- בייטים ו-base64url ---------- */

export function b64urlToBytes(s: string): Uint8Array {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const raw = atob(t);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: Uint8Array | ArrayBuffer): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/* ---------- HKDF, בדיוק כמו ששני התקנים מגדירים ---------- */

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  bytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/* ---------- מפתחות ---------- */

export interface Sender {
  privateKey: CryptoKey;
  publicRaw: Uint8Array;
}

/* P-256 נשמר אצלנו כשני מספרים ב-base64url: הפרטי הוא 32 בייט,
   והציבורי הוא נקודה לא דחוסה של 65 בייט (0x04 ואחריו X ו-Y).
   Web Crypto מייבא צורה כזאת רק דרך JWK, ו-X ו-Y נחתכים מהציבורי. */
function jwkFromRaw(d: Uint8Array | null, pub: Uint8Array): JsonWebKey {
  if (pub.length !== 65 || pub[0] !== 4) {
    throw new Error("public key must be 65 bytes, uncompressed");
  }
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  if (d) jwk.d = bytesToB64url(d);
  return jwk;
}

/* זוג מפתחות חד-פעמי לכל הודעה, כמו שהתקן דורש */
export async function newSender(): Promise<Sender> {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  ) as CryptoKeyPair;
  return {
    privateKey: pair.privateKey,
    publicRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
  };
}

/* זוג מפתחות קבוע מתוך בייטים — משמש את בדיקת ה-RFC, שבה
   המפתחות והמלח נתונים ולכן התוצאה חייבת לצאת זהה בייט-בייט. */
export async function senderFromRaw(d: Uint8Array, pub: Uint8Array): Promise<Sender> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    jwkFromRaw(d, pub),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  return { privateKey, publicRaw: pub };
}

/* ---------- RFC 8291: הצפנת הגוף ---------- */

const RECORD_SIZE = 4096;

export async function encrypt(
  plaintext: Uint8Array,
  uaPublic: Uint8Array,   // p256dh של המכשיר
  authSecret: Uint8Array, // auth של המכשיר
  opts: { salt?: Uint8Array; sender?: Sender } = {},
): Promise<Uint8Array> {
  const salt = opts.salt || crypto.getRandomValues(new Uint8Array(16));
  const sender = opts.sender || await newSender();

  // ECDH: סוד משותף בין המפתח החד-פעמי שלנו למפתח של המכשיר
  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256),
  );

  // IKM = HKDF(salt=auth_secret, ikm=ecdh, info="WebPush: info" 0x00 ua as)
  const keyInfo = concat(utf8("WebPush: info"), new Uint8Array([0]), uaPublic, sender.publicRaw);
  const ikm = await hkdf(authSecret, ecdh, keyInfo, 32);

  // ומכאן aes128gcm הרגיל של RFC 8188
  const cek = await hkdf(salt, ikm, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // 0x02 הוא מפריד הריפוד שסוגר את הרשומה האחרונה, וכאן היא גם היחידה
  const body = concat(plaintext, new Uint8Array([2]));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, body),
  );

  // כותרת הרשומה: מלח(16) | גודל רשומה(4) | אורך מזהה(1) | המפתח שלנו(65)
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, RECORD_SIZE, false);
  head[20] = sender.publicRaw.length;

  return concat(head, sender.publicRaw, sealed);
}

/* ---------- RFC 8292: חתימת VAPID ---------- */

export interface Vapid {
  publicKey: string;   // base64url
  privateKey: string;  // base64url
  subject: string;     // mailto:... או כתובת האתר
}

export async function vapidHeader(audience: string, v: Vapid, ttlSeconds = 12 * 3600): Promise<string> {
  const head = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: v.subject,
  };
  const signing = bytesToB64url(utf8(JSON.stringify(head))) + "." +
                  bytesToB64url(utf8(JSON.stringify(claims)));

  const key = await crypto.subtle.importKey(
    "jwk",
    jwkFromRaw(b64urlToBytes(v.privateKey), b64urlToBytes(v.publicKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // Web Crypto מחזיר r||s, וזה בדיוק מה ש-ES256 של JWT מצפה לו
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signing),
  );

  return "vapid t=" + signing + "." + bytesToB64url(sig) + ", k=" + v.publicKey;
}

/* ---------- השליחה עצמה ---------- */

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendResult {
  ok: boolean;
  status: number;
  gone: boolean;   // המנוי מת ואין טעם לנסות שוב
  detail: string;
}

/* TTL קצר בכוונה: תזכורת של "עוד לא דיווחת היום" שמגיעה מחר בבוקר
   היא הודעה שקרית, ועדיף שתיפול מלהגיע באיחור. */
export async function send(
  sub: Subscription,
  payload: unknown,
  vapid: Vapid,
  ttl = 3600,
): Promise<SendResult> {
  let audience: string;
  try {
    audience = new URL(sub.endpoint).origin;
  } catch {
    return { ok: false, status: 0, gone: true, detail: "bad endpoint" };
  }

  const body = await encrypt(
    utf8(JSON.stringify(payload)),
    b64urlToBytes(sub.p256dh),
    b64urlToBytes(sub.auth),
  );

  let res: Response;
  try {
    res = await fetch(sub.endpoint, {
      method: "POST",
      headers: {
        "Authorization": await vapidHeader(audience, vapid),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": String(ttl),
      },
      body,
    });
  } catch (e) {
    return { ok: false, status: 0, gone: false, detail: String(e) };
  }

  // 404 ו-410 הם "המכשיר הזה לא קיים יותר" — השורה נמחקת, אחרת היא
  // תיכשל כל יום לנצח.
  const gone = res.status === 404 || res.status === 410;
  let detail = "";
  if (!res.ok) {
    try { detail = (await res.text()).slice(0, 300); } catch { detail = ""; }
  }
  return { ok: res.ok, status: res.status, gone, detail };
}
