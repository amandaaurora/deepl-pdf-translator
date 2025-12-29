import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File;
  const apiKey = formData.get("apiKey") as string;

  if (!file || !apiKey) {
    return NextResponse.json(
      { error: "Missing file or API key" },
      { status: 400 }
    );
  }

  // Sanitize filename early to avoid header issues later
  // Keep original extension - DeepL returns same format as input
  const extension = file.name.split(".").pop() || "pdf";
  const baseName = file.name.replace(/\.[^/.]+$/, ""); // remove extension
  const safeBaseName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const safeFilename = `${safeBaseName}_translated.${extension}`;

  // TEST MODE: set to true to test download without using credits
  const TEST_MODE = false;

  if (TEST_MODE) {
    console.log("TEST MODE - Safe filename:", safeFilename);
    const testContent = Buffer.from("Test document content");
    return new NextResponse(testContent, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
      },
    });
  }

  const baseUrl = apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";

  // Step 1: Upload document
  const uploadForm = new FormData();
  uploadForm.append("file", file);
  uploadForm.append("target_lang", "EN-GB");

  const uploadRes = await fetch(`${baseUrl}/v2/document`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
    body: uploadForm,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.log("Upload error:", err);
    return NextResponse.json(
      { error: `Upload failed: ${err}` },
      { status: 400 }
    );
  }

  const uploadData = await uploadRes.json();
  console.log("Upload response:", uploadData);
  const { document_id, document_key } = uploadData;

  // Step 2: Poll for completion
  let status = "translating";
  while (status === "translating" || status === "queued") {
    await new Promise((r) => setTimeout(r, 2000));

    const statusRes = await fetch(`${baseUrl}/v2/document/${document_id}`, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_key }),
    });

    const statusData = await statusRes.json();
    console.log("Status check:", statusData);
    status = statusData.status;

    if (status === "error") {
      return NextResponse.json(
        { error: `Translation failed: ${statusData.message || "unknown"}` },
        { status: 500 }
      );
    }
  }

  // Step 3: Download translated document
  const downloadRes = await fetch(
    `${baseUrl}/v2/document/${document_id}/result`,
    {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ document_key }),
    }
  );

  if (!downloadRes.ok) {
    const errText = await downloadRes.text();
    console.log("Download error:", errText);
    return NextResponse.json(
      { error: `Download failed: ${errText}` },
      { status: 500 }
    );
  }

  // Debug: check what DeepL returns
  const contentType = downloadRes.headers.get("content-type");
  console.log("DeepL response content-type:", contentType);

  const docBuffer = await downloadRes.arrayBuffer();
  console.log("Buffer size:", docBuffer.byteLength);

  // Set content type based on original file extension
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
  };

  return new NextResponse(docBuffer, {
    headers: {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
    },
  });
}
