/* בדיקת ההצפנה מול דוגמת הבדיקה הרשמית של RFC 8291, פרק 5 ונספח A.
 *
 * זאת הבדיקה שמאפשרת לכתוב את ההצפנה ביד בלי מפתחות אמיתיים ובלי
 * מכשיר: ב-RFC נתונים המלח, שני זוגות המפתחות וה-auth, ולכן התוצאה
 * חייבת לצאת זהה בייט-בייט. אם היא יוצאת זהה — ההצפנה נכונה.
 *
 * להרצה (אין צורך בשום התקנה, Node 23 ומעלה מריץ TypeScript ישר):
 *   node supabase/tests/webpush.test.ts
 *
 * רץ גם ב-Deno:
 *   deno run --allow-read supabase/tests/webpush.test.ts
 */

import {
  b64urlToBytes,
  bytesToB64url,
  encrypt,
  senderFromRaw,
  vapidHeader,
} from "../functions/daily-push/webpush.ts";

/* ---------- הנתונים מתוך ה-RFC ---------- */

const V = {
  plaintext:  "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  salt:       "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPrivate:  "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic:   "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPrivate:  "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  asPublic:   "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  // הגוף המוצפן המלא, פרק 5
  expected:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/* ---------- עזרי בדיקה ---------- */

let failures = 0;

function check(name: string, got: unknown, want: unknown): void {
  if (got === want) {
    console.log("  ok   " + name);
  } else {
    failures++;
    console.log("  FAIL " + name);
    console.log("       got:  " + String(got));
    console.log("       want: " + String(want));
  }
}

function ok(name: string, cond: boolean): void {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name); }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// HKDF כתוב כאן מחדש בכוונה, כדי שהבדיקה לא תסתמך על אותו קוד שהיא בודקת
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8,
  ));
}

/* ---------- 1. הגוף המוצפן, מול ה-RFC ---------- */

async function testAgainstRfc(): Promise<Uint8Array> {
  console.log("RFC 8291 §5 — הגוף המוצפן");

  const sender = await senderFromRaw(
    b64urlToBytes(V.asPrivate),
    b64urlToBytes(V.asPublic),
  );

  const body = await encrypt(
    b64urlToBytes(V.plaintext),
    b64urlToBytes(V.uaPublic),
    b64urlToBytes(V.authSecret),
    { salt: b64urlToBytes(V.salt), sender },
  );

  check("הגוף זהה בייט-בייט לדוגמה שב-RFC", bytesToB64url(body), V.expected);
  check("אורך הגוף", body.length, 144);

  // מבנה הכותרת לפי RFC 8188
  check("מלח בראש הגוף", bytesToB64url(body.slice(0, 16)), V.salt);
  check("גודל רשומה = 4096", new DataView(body.buffer, body.byteOffset).getUint32(16, false), 4096);
  check("אורך המזהה = 65", body[20], 65);
  check("המפתח הציבורי של השולח בכותרת", bytesToB64url(body.slice(21, 86)), V.asPublic);

  return body;
}

/* ---------- 2. פענוח: מה שהמכשיר באמת עושה ---------- */

async function testRoundTrip(body: Uint8Array): Promise<void> {
  console.log("פענוח מהצד של המכשיר");

  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);

  // המכשיר מחשב את אותו סוד משותף, מהכיוון ההפוך
  const uaPrivate = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256",
      d: V.uaPrivate,
      x: bytesToB64url(b64urlToBytes(V.uaPublic).slice(1, 33)),
      y: bytesToB64url(b64urlToBytes(V.uaPublic).slice(33, 65)),
      ext: true,
    },
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const asKey = await crypto.subtle.importKey(
    "raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256),
  );
  check("הסוד המשותף כמו בנספח A", bytesToB64url(ecdh), "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs");

  const keyInfo = concat(
    utf8("WebPush: info"), new Uint8Array([0]),
    b64urlToBytes(V.uaPublic), asPublic,
  );
  const ikm = await hkdf(b64urlToBytes(V.authSecret), ecdh, keyInfo, 32);
  check("IKM כמו בנספח A", bytesToB64url(ikm), "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg");

  const cek = await hkdf(salt, ikm, concat(utf8("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concat(utf8("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  check("CEK כמו בנספח A", bytesToB64url(cek), "oIhVW04MRdy2XN9CiKLxTg");
  check("NONCE כמו בנספח A", bytesToB64url(nonce), "4h_95klXJ5E_qnoN");

  const aes = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const open = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, sealed,
  ));

  check("מפריד הריפוד בסוף", open[open.length - 1], 2);
  check("הטקסט חזר שלם", new TextDecoder().decode(open.slice(0, -1)),
    "When I grow up, I want to be a watermelon");
}

/* ---------- 3. מלח ומפתח חדשים בכל הודעה ---------- */

async function testFreshness(): Promise<void> {
  console.log("מלח ומפתח חד-פעמיים");

  const args = [
    utf8("{\"title\":\"x\"}"),
    b64urlToBytes(V.uaPublic),
    b64urlToBytes(V.authSecret),
  ] as const;

  const a = await encrypt(args[0], args[1], args[2]);
  const b = await encrypt(args[0], args[1], args[2]);

  ok("שתי הצפנות של אותו טקסט יוצאות שונות", bytesToB64url(a) !== bytesToB64url(b));
  ok("המלח שונה", bytesToB64url(a.slice(0, 16)) !== bytesToB64url(b.slice(0, 16)));
  ok("המפתח החד-פעמי שונה", bytesToB64url(a.slice(21, 86)) !== bytesToB64url(b.slice(21, 86)));
  check("אורך מזהה גם כאן 65", a[20], 65);
}

/* ---------- 4. חתימת VAPID ---------- */

async function testVapid(): Promise<void> {
  console.log("RFC 8292 — חתימת VAPID");

  // זוג מפתחות אמיתי, נוצר כאן ברגע זה. אין צורך במפתחות של הפרויקט.
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const pubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey;

  const vapid = {
    publicKey: bytesToB64url(pubRaw),
    privateKey: String(jwk.d),
    subject: "mailto:a@b.co",
  };

  const header = await vapidHeader("https://push.example.net", vapid);

  ok("הכותרת פותחת ב-vapid t=", header.indexOf("vapid t=") === 0);
  ok("הכותרת נושאת את המפתח הציבורי", header.indexOf(", k=" + vapid.publicKey) > 0);

  const jwt = header.slice("vapid t=".length, header.indexOf(", k="));
  const parts = jwt.split(".");
  check("ל-JWT שלושה חלקים", parts.length, 3);

  const head = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
  check("alg", head.alg, "ES256");
  check("typ", head.typ, "JWT");
  check("aud הוא המוצא של שירות ההתראות", claims.aud, "https://push.example.net");
  check("sub", claims.sub, "mailto:a@b.co");
  ok("exp בעתיד ובתוך 24 שעות", claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);

  const sig = b64urlToBytes(parts[2]);
  check("אורך החתימה r||s", sig.length, 64);
  const good = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    sig,
    utf8(parts[0] + "." + parts[1]),
  );
  ok("החתימה מאומתת מול המפתח הציבורי", good === true);

  // חתימה על תוכן אחר לא תאומת מול אותה חתימה
  const bad = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    sig,
    utf8(parts[0] + "." + parts[1] + "x"),
  );
  ok("חתימה לא עוברת על תוכן שהשתנה", bad === false);
}

/* ---------- הרצה ---------- */

const body = await testAgainstRfc();
await testRoundTrip(body);
await testFreshness();
await testVapid();

console.log("");
if (failures) {
  console.log(failures + " בדיקות נכשלו");
  if (typeof process !== "undefined") process.exitCode = 1;
} else {
  console.log("כל הבדיקות עברו");
}
