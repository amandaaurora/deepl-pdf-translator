import { NextResponse } from "next/server";
import { getConfiguredKeys, getKeyInfo } from "@/lib/deepl";
import type { StatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const keys = await Promise.all(getConfiguredKeys().map(getKeyInfo));
  const body: StatusResponse = {
    keys,
    blobEnabled: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    // Vercel rejects request bodies over 4.5 MB; leave headroom for the form encoding.
    maxRequestBytes: process.env.VERCEL ? 4_000_000 : null,
  };
  return NextResponse.json(body);
}
