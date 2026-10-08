import { NextRequest, NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionToken, isAuthConfigured } from "@/lib/auth";
import {
  fromB64,
  loadPasskeys,
  relyingParty,
  savePasskeys,
  takeChallenge,
} from "@/lib/passkeys";

// Step 2 of signing in with a passkey (public): check the signature and,
// if it's good, hand out the same session cookie the password gives.
export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "Sign-in isn't configured" }, { status: 503 });
  }
  const { response } = await req.json();
  const res = NextResponse.json({ ok: true });
  const challenge = await takeChallenge(req, res);
  if (!challenge) {
    return NextResponse.json({ error: "That took too long, please try again" }, { status: 400 });
  }

  const list = await loadPasskeys();
  const passkey = list.find((p) => p.id === response?.id);
  if (!passkey) {
    return NextResponse.json(
      { error: "This passkey isn't registered here. Sign in with the password, then add it." },
      { status: 401 }
    );
  }

  const { rpID, origin } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: fromB64(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't verify the passkey" },
      { status: 401 }
    );
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "Couldn't verify the passkey" }, { status: 401 });
  }

  passkey.counter = verification.authenticationInfo.newCounter;
  passkey.lastUsedAt = new Date().toISOString();
  await savePasskeys(list);

  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
