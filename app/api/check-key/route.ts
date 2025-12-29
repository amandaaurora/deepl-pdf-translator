import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { apiKey } = await req.json();

  // DeepL Free API uses api-free.deepl.com, Pro uses api.deepl.com
  const baseUrl = apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";

  try {
    const res = await fetch(`${baseUrl}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const data = await res.json();
    return NextResponse.json({
      used: data.character_count,
      limit: data.character_limit,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to connect to DeepL" },
      { status: 500 }
    );
  }
}
