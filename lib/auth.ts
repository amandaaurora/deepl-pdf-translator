// Shared-password session handling. No database: the session cookie is
// "<expiry>.<signature>", where the signature is an HMAC over the expiry and
// the current password, keyed with SESSION_SECRET. Changing SITE_PASSWORD or
// SESSION_SECRET therefore signs everyone out.

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

const encoder = new TextEncoder();

function getSecrets() {
  const password = process.env.SITE_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!password || !secret) return null;
  return { password, secret };
}

export function isAuthConfigured(): boolean {
  return getSecrets() !== null;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message))
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function checkPassword(candidate: string): Promise<boolean> {
  const secrets = getSecrets();
  if (!secrets) return false;
  // Compare HMACs rather than raw strings so the comparison is constant-time
  // regardless of the lengths involved.
  const [a, b] = await Promise.all([
    hmac(secrets.secret, `pw|${candidate}`),
    hmac(secrets.secret, `pw|${secrets.password}`),
  ]);
  return timingSafeEqual(a, b);
}

async function sign(expiry: number, secrets: { password: string; secret: string }) {
  return toBase64Url(
    await hmac(secrets.secret, `session|${expiry}|${secrets.password}`)
  );
}

export async function createSessionToken(): Promise<string> {
  const secrets = getSecrets();
  if (!secrets) throw new Error("Authentication is not configured");
  const expiry = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  return `${expiry}.${await sign(expiry, secrets)}`;
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  const secrets = getSecrets();
  if (!secrets || !token) return false;
  const [expiryStr, signature] = token.split(".");
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || !signature) return false;
  if (expiry < Date.now() / 1000) return false;
  const expected = await sign(expiry, secrets);
  return timingSafeEqual(encoder.encode(signature), encoder.encode(expected));
}

// Short-lived signed values (used for passkey challenges): "<value>.<expiry>.<sig>".
export async function signValue(value: string, ttlSeconds: number): Promise<string> {
  const secrets = getSecrets();
  if (!secrets) throw new Error("Authentication is not configured");
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = toBase64Url(await hmac(secrets.secret, `value|${value}|${expiry}`));
  return `${value}.${expiry}.${sig}`;
}

export async function readSignedValue(token: string | undefined): Promise<string | null> {
  const secrets = getSecrets();
  if (!secrets || !token) return null;
  const [value, expiryStr, sig] = token.split(".");
  const expiry = Number(expiryStr);
  if (!value || !sig || !Number.isFinite(expiry) || expiry < Date.now() / 1000) return null;
  const expected = toBase64Url(await hmac(secrets.secret, `value|${value}|${expiry}`));
  return timingSafeEqual(encoder.encode(sig), encoder.encode(expected)) ? value : null;
}
