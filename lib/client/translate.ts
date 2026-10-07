import type { DocumentHandle, DocumentStatus, KeyInfo } from "@/lib/types";

// DeepL bills every PDF, Word, PowerPoint and Excel file at 50,000
// characters or more, whatever its length.
export const MIN_BILLED_CHARS = 50_000;

// Per-file limits for document translation (characters are for PDFs).
// https://developers.deepl.com/docs/resources/usage-limits
export const DEEPL_LIMITS = {
  free: { maxBytes: 10 * 1000 * 1000, maxChars: 500_000 },
  pro: { maxBytes: 30 * 1000 * 1000, maxChars: 1_000_000 },
};

export function billedEstimate(chars: number, extension: string) {
  return extension === "txt" ? chars : Math.max(MIN_BILLED_CHARS, chars);
}

export function remaining(k: KeyInfo) {
  return k.used === null || k.limit === null ? 0 : Math.max(0, k.limit - k.used);
}

/**
 * Chooses a key for each part. With a key chosen by hand, every part uses
 * it. On "auto", each part goes to whichever key has the most quota left,
 * so a long document can spread over both keys.
 */
export function assignKeys(
  keys: KeyInfo[],
  partCosts: number[],
  chosen: number | "auto"
): { keyIndex: number; enough: boolean }[] {
  const usable = keys.filter((k) => !k.error);
  if (chosen !== "auto") {
    const k = keys.find((x) => x.index === chosen);
    let left = k ? remaining(k) : 0;
    return partCosts.map((cost) => {
      left -= cost;
      return { keyIndex: chosen, enough: left >= 0 };
    });
  }
  const left = new Map(usable.map((k) => [k.index, remaining(k)]));
  return partCosts.map((cost) => {
    let best: number | null = null;
    for (const [index, l] of left) {
      if (best === null || l > left.get(best)!) best = index;
    }
    if (best === null) return { keyIndex: keys[0]?.index ?? 1, enough: false };
    const l = left.get(best)! - cost;
    left.set(best, l);
    return { keyIndex: best, enough: l >= 0 };
  });
}

async function errorFrom(res: Response, fallback: string) {
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text).error || fallback;
  } catch {
    return text || fallback;
  }
}

export type TranslateOptions = {
  keyIndex: number;
  sourceLang: string;
  targetLang: string;
  outputFormat: string;
  // Send via Vercel Blob instead of in the request body.
  viaBlob: boolean;
};

export async function startTranslation(
  file: Blob,
  filename: string,
  opts: TranslateOptions,
  onUploadProgress?: (pct: number) => void
): Promise<DocumentHandle> {
  const form = new FormData();
  form.append("filename", filename);
  form.append("keyIndex", String(opts.keyIndex));
  form.append("sourceLang", opts.sourceLang);
  form.append("targetLang", opts.targetLang);
  form.append("outputFormat", opts.outputFormat);

  if (opts.viaBlob) {
    const { upload } = await import("@vercel/blob/client");
    const blob = await upload(`uploads/${filename}`, file, {
      access: "private",
      handleUploadUrl: "/api/blob-upload",
      multipart: file.size > 5 * 1024 * 1024,
      onUploadProgress: (e) => onUploadProgress?.(e.percentage),
    });
    form.append("blobUrl", blob.url);
  } else {
    form.append("file", file, filename);
  }

  const res = await fetch("/api/translate/start", { method: "POST", body: form });
  if (!res.ok) throw new Error(await errorFrom(res, "Upload to DeepL failed"));
  return res.json();
}

export async function waitForTranslation(
  handle: DocumentHandle,
  onStatus: (s: DocumentStatus) => void,
  signal?: AbortSignal
): Promise<DocumentStatus> {
  for (;;) {
    const res = await fetch("/api/translate/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(handle),
      signal,
    });
    if (!res.ok) throw new Error(await errorFrom(res, "Couldn't check progress"));
    const status: DocumentStatus = await res.json();
    onStatus(status);
    if (status.status === "done") return status;
    if (status.status === "error") {
      throw new Error(`DeepL couldn't translate it: ${status.errorMessage || "unknown error"}`);
    }
    const wait = Math.min(10, Math.max(2, (status.secondsRemaining ?? 3) / 2));
    await new Promise((r) => setTimeout(r, wait * 1000));
  }
}

export async function downloadTranslation(handle: DocumentHandle): Promise<Blob> {
  const res = await fetch("/api/translate/result", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(handle),
  });
  if (!res.ok) throw new Error(await errorFrom(res, "Download failed"));
  return res.blob();
}

export function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
