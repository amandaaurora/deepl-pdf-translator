import type { DocumentHandle, KeyInfo } from "@/lib/types";

type ConfiguredKey = { index: number; label: string; key: string };

// Keys come from DEEPL_API_KEY_1, DEEPL_API_KEY_2, … (optionally labelled with
// DEEPL_API_KEY_1_LABEL etc.). They never leave the server: the browser only
// ever sees the index and a masked label.
export function getConfiguredKeys(): ConfiguredKey[] {
  const keys: ConfiguredKey[] = [];
  for (let i = 1; i <= 9; i++) {
    const key = process.env[`DEEPL_API_KEY_${i}`]?.trim();
    if (!key) continue;
    const label = process.env[`DEEPL_API_KEY_${i}_LABEL`]?.trim() || `Key ${i}`;
    keys.push({ index: i, label, key });
  }
  return keys;
}

export function getKey(index: unknown): ConfiguredKey | null {
  return getConfiguredKeys().find((k) => k.index === Number(index)) ?? null;
}

function planOf(key: string): "free" | "pro" {
  return key.endsWith(":fx") ? "free" : "pro";
}

export function baseUrl(key: string): string {
  // Lets local tests point at a stand-in for DeepL.
  if (process.env.DEEPL_API_BASE_URL) return process.env.DEEPL_API_BASE_URL;
  return planOf(key) === "free"
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
}

export function authHeader(key: string) {
  return { Authorization: `DeepL-Auth-Key ${key}` };
}

export async function getKeyInfo(k: ConfiguredKey): Promise<KeyInfo> {
  const masked = `${k.label} (…${k.key.replace(/:fx$/, "").slice(-4)})`;
  const info: KeyInfo = {
    index: k.index,
    label: masked,
    plan: planOf(k.key),
    used: null,
    limit: null,
  };
  try {
    const res = await fetch(`${baseUrl(k.key)}/v2/usage`, {
      headers: authHeader(k.key),
      cache: "no-store",
    });
    if (!res.ok) return { ...info, error: await describeError(res) };
    const data = await res.json();
    return { ...info, used: data.character_count, limit: data.character_limit };
  } catch {
    return { ...info, error: "Couldn't reach DeepL" };
  }
}

// Turn a failed DeepL response into a readable message.
export async function describeError(res: Response): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      detail = data.message || data.detail || text;
    } catch {
      detail = text;
    }
  } catch {
    // ignore
  }
  const known: Record<number, string> = {
    403: "DeepL rejected the API key",
    413: "File too large for DeepL",
    429: "Too many requests to DeepL, try again shortly",
    456: "Character quota for this key is used up",
  };
  const base = known[res.status] ?? `DeepL error ${res.status}`;
  return detail ? `${base}: ${detail}` : base;
}

// Validates the identifiers the browser sends back for an in-progress document.
export function parseHandle(body: unknown): (DocumentHandle & { key: string }) | null {
  if (!body || typeof body !== "object") return null;
  const { keyIndex, documentId, documentKey } = body as Record<string, unknown>;
  const k = getKey(keyIndex);
  if (!k) return null;
  if (typeof documentId !== "string" || !/^[A-Za-z0-9]+$/.test(documentId)) return null;
  if (typeof documentKey !== "string" || !documentKey) return null;
  return { keyIndex: k.index, documentId, documentKey, key: k.key };
}
