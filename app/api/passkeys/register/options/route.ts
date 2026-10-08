import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { loadPasskeys, relyingParty, rememberChallenge } from "@/lib/passkeys";

// Step 1 of adding a passkey (signed-in only, see proxy.ts).
export async function POST(req: NextRequest) {
  const { rpID, rpName } = relyingParty(req);
  const existing = await loadPasskeys();
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: "owner",
    userDisplayName: "Alih Bahasa",
    // One fixed user: the site has a single owner.
    userID: new TextEncoder().encode("alih-bahasa-owner"),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  const res = NextResponse.json(options);
  await rememberChallenge(res, options.challenge);
  return res;
}
