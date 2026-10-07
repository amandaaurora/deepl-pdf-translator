import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { isAuthConfigured } from "@/lib/auth";
import { relyingParty, rememberChallenge } from "@/lib/passkeys";

// Step 1 of signing in with a passkey (public).
export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "Sign-in isn't configured" }, { status: 503 });
  }
  const { rpID } = relyingParty(req);
  // No allowCredentials: the device offers whichever passkey it has for this site.
  const options = await generateAuthenticationOptions({ rpID, userVerification: "required" });
  const res = NextResponse.json(options);
  await rememberChallenge(res, options.challenge);
  return res;
}
