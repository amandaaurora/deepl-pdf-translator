import { NextRequest, NextResponse } from "next/server";
import { authHeader, baseUrl, describeError, parseHandle } from "@/lib/deepl";

export const maxDuration = 60;

// Streams the translated file back. Streaming matters on Vercel: buffered
// responses over 4.5 MB are rejected, streamed ones aren't.
export async function POST(req: NextRequest) {
  const handle = parseHandle(await req.json().catch(() => null));
  if (!handle) {
    return NextResponse.json({ error: "Invalid document reference" }, { status: 400 });
  }

  const res = await fetch(
    `${baseUrl(handle.key)}/v2/document/${handle.documentId}/result`,
    {
      method: "POST",
      headers: { ...authHeader(handle.key), "Content-Type": "application/json" },
      body: JSON.stringify({ document_key: handle.documentKey }),
      cache: "no-store",
    }
  );
  if (!res.ok || !res.body) {
    return NextResponse.json({ error: await describeError(res) }, { status: 502 });
  }

  return new NextResponse(res.body, {
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
    },
  });
}
