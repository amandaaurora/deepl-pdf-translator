import { NextRequest, NextResponse } from "next/server";
import { loadPasskeys, savePasskeys } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

// List registered passkeys (signed-in only, see proxy.ts).
export async function GET() {
  const list = await loadPasskeys();
  return NextResponse.json(
    list.map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt }))
  );
}

// Remove one: DELETE /api/passkeys?id=…
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const list = await loadPasskeys();
  const next = list.filter((p) => p.id !== id);
  if (next.length === list.length) {
    return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
  }
  await savePasskeys(next);
  return NextResponse.json({ ok: true });
}
