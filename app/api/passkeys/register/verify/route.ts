import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { loadPasskeys, relyingParty, savePasskeys, takeChallenge, toB64 } from "@/lib/passkeys";

// Step 2 of adding a passkey: check the device's response and store its public key.
export async function POST(req: NextRequest) {
  const { response, name } = await req.json();
  const res = NextResponse.json({ ok: true });
  const challenge = await takeChallenge(req, res);
  if (!challenge) {
    return NextResponse.json({ error: "That took too long, please try again" }, { status: 400 });
  }
  const { rpID, origin } = relyingParty(req);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Couldn't verify the passkey" },
      { status: 400 }
    );
  }
  if (!verification.verified) {
    return NextResponse.json({ error: "Couldn't verify the passkey" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const list = await loadPasskeys();
  list.push({
    id: credential.id,
    publicKey: toB64(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    name: String(name || "Passkey").slice(0, 60),
    createdAt: new Date().toISOString(),
  });
  await savePasskeys(list);
  return res;
}
