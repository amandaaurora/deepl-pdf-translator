import { NextRequest, NextResponse } from "next/server";
import { authHeader, baseUrl, describeError, parseHandle } from "@/lib/deepl";
import type { DocumentStatus } from "@/lib/types";

export async function POST(req: NextRequest) {
  const handle = parseHandle(await req.json().catch(() => null));
  if (!handle) {
    return NextResponse.json({ error: "Invalid document reference" }, { status: 400 });
  }

  const res = await fetch(`${baseUrl(handle.key)}/v2/document/${handle.documentId}`, {
    method: "POST",
    headers: { ...authHeader(handle.key), "Content-Type": "application/json" },
    body: JSON.stringify({ document_key: handle.documentKey }),
    cache: "no-store",
  });
  if (!res.ok) {
    return NextResponse.json({ error: await describeError(res) }, { status: 502 });
  }

  const data = await res.json();
  const body: DocumentStatus = {
    status: data.status,
    secondsRemaining: data.seconds_remaining,
    billedCharacters: data.billed_characters,
    errorMessage: data.error_message ?? data.message,
  };
  return NextResponse.json(body);
}
