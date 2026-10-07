import { NextRequest, NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import { authHeader, baseUrl, describeError, getKey } from "@/lib/deepl";

export const maxDuration = 60;

const ALLOWED_EXTENSIONS = ["pdf", "docx", "pptx", "xlsx", "txt"];
const OUTPUT_FORMATS = ["docx", "pdf"];

// Reads the document either from the request itself (small files) or from
// Vercel Blob (large files), then hands it to DeepL. Returns the identifiers
// the browser needs to poll for and download the result.
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const blobUrl = form.get("blobUrl");
  try {
    return await translate(form, typeof blobUrl === "string" ? blobUrl : "");
  } finally {
    // The copy in Blob storage is only needed until DeepL has it, and must
    // go even if the request is rejected.
    if (typeof blobUrl === "string" && blobUrl) {
      await del(blobUrl).catch(() => {});
    }
  }
}

async function translate(form: FormData, blobUrl: string) {
  const key = getKey(form.get("keyIndex"));
  if (!key) {
    return NextResponse.json({ error: "Unknown API key" }, { status: 400 });
  }

  const filename = String(form.get("filename") || "");
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return NextResponse.json(
      { error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}` },
      { status: 400 }
    );
  }

  let file: Blob;
  if (blobUrl) {
    const blob = await get(blobUrl, { access: "private", useCache: false });
    if (!blob || blob.statusCode !== 200) {
      return NextResponse.json({ error: "Uploaded file not found" }, { status: 400 });
    }
    file = await new Response(blob.stream).blob();
  } else {
    const uploaded = form.get("file");
    if (!(uploaded instanceof Blob)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    file = uploaded;
  }

  const upload = new FormData();
  upload.append("file", file, filename);
  upload.append("target_lang", String(form.get("targetLang") || "EN-GB"));
  const sourceLang = String(form.get("sourceLang") || "");
  if (sourceLang) upload.append("source_lang", sourceLang);
  const outputFormat = String(form.get("outputFormat") || "");
  if (OUTPUT_FORMATS.includes(outputFormat) && outputFormat !== extension) {
    upload.append("output_format", outputFormat);
  }

  const res = await fetch(`${baseUrl(key.key)}/v2/document`, {
    method: "POST",
    headers: authHeader(key.key),
    body: upload,
  });
  if (!res.ok) {
    return NextResponse.json({ error: await describeError(res) }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json({
    keyIndex: key.index,
    documentId: data.document_id,
    documentKey: data.document_key,
  });
}
