import { promises as fs } from "node:fs";
import path from "node:path";
import { get, put } from "@vercel/blob";
import type { NextRequest, NextResponse } from "next/server";
import { readSignedValue, signValue } from "@/lib/auth";

// Registered passkeys. Only public keys are stored, so the list isn't secret,
// but it is what decides who can sign in, so only the server writes to it.
export type StoredPasskey = {
  id: string; // credential id, base64url
  publicKey: string; // base64url
  counter: number;
  transports?: string[];
  name: string;
  createdAt: string;
  lastUsedAt?: string;
};

const BLOB_PATH = "auth/passkeys.json";
// Local development without a Blob store keeps them in a git-ignored file.
const LOCAL_PATH = path.join(process.cwd(), ".data", "passkeys.json");

const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function loadPasskeys(): Promise<StoredPasskey[]> {
  try {
    if (blobConfigured()) {
      const res = await get(BLOB_PATH, { access: "private", useCache: false });
      if (!res || res.statusCode !== 200) return [];
      return JSON.parse(await new Response(res.stream).text());
    }
    return JSON.parse(await fs.readFile(LOCAL_PATH, "utf8"));
  } catch (e) {
    if (e instanceof Error && /not.?found|ENOENT/i.test(`${e.name} ${e.message}`)) return [];
    throw e;
  }
}

export async function savePasskeys(list: StoredPasskey[]) {
  const body = JSON.stringify(list, null, 2);
  if (blobConfigured()) {
    await put(BLOB_PATH, body, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
    });
    return;
  }
  if (process.env.VERCEL) {
    throw new Error("Passkeys need the Vercel Blob store to be connected.");
  }
  await fs.mkdir(path.dirname(LOCAL_PATH), { recursive: true });
  await fs.writeFile(LOCAL_PATH, body);
}

// Passkeys are bound to the site's domain. PASSKEY_RP_ID can pin it; by
// default it's whatever domain the site is being visited on.
export function relyingParty(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const rpID = process.env.PASSKEY_RP_ID || req.nextUrl.hostname;
  return { rpID, origin, rpName: "Alih Bahasa" };
}

const CHALLENGE_COOKIE = "pk_challenge";

export async function rememberChallenge(res: NextResponse, challenge: string) {
  res.cookies.set(CHALLENGE_COOKIE, await signValue(challenge, 300), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/passkeys",
    maxAge: 300,
  });
}

export async function takeChallenge(req: NextRequest, res: NextResponse) {
  res.cookies.delete({ name: CHALLENGE_COOKIE, path: "/api/passkeys" });
  return readSignedValue(req.cookies.get(CHALLENGE_COOKIE)?.value);
}

export const toB64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
export const fromB64 = (s: string) => new Uint8Array(Buffer.from(s, "base64url"));
