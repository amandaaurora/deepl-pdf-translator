"use client";

import { useState } from "react";

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState<{
    valid: boolean;
    usage?: { used: number; limit: number };
  } | null>(null);
  const [checking, setChecking] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");

  const checkApiKey = async () => {
    setChecking(true);
    setError("");
    try {
      const res = await fetch("/api/check-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (res.ok) {
        setKeyStatus({ valid: true, usage: data });
      } else {
        setKeyStatus({ valid: false });
        setError(data.error || "Invalid API key");
      }
    } catch {
      setError("Failed to check API key");
    }
    setChecking(false);
  };

  const translateDocument = async () => {
    if (!file || !apiKey) return;
    setTranslating(true);
    setError("");

    const formData = new FormData();
    formData.append("file", file);
    formData.append("apiKey", apiKey);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Translation failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(".pdf", ".docx");
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation failed");
    }
    setTranslating(false);
  };

  return (
    <main
      style={{
        maxWidth: 600,
        margin: "40px auto",
        padding: 20,
        fontFamily: "system-ui",
      }}
    >
      <h1>DeepL PDF Translator</h1>

      <section style={{ marginBottom: 30 }}>
        <h2>1. API Key</h2>
        <input
          type="text"
          placeholder="Enter DeepL API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ width: "100%", padding: 10, marginBottom: 10 }}
        />
        <button
          onClick={checkApiKey}
          disabled={!apiKey || checking}
          style={{ padding: "10px 20px" }}
        >
          {checking ? "Checking..." : "Check Key"}
        </button>

        {keyStatus?.valid && keyStatus.usage && (
          <p style={{ color: "green" }}>
            ✓ Valid! Usage: {keyStatus.usage.used.toLocaleString()} /{" "}
            {keyStatus.usage.limit.toLocaleString()} characters
          </p>
        )}
      </section>

      <section style={{ marginBottom: 30 }}>
        <h2>2. Upload PDF</h2>
        <input
          type="file"
          accept=".pdf"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          style={{ marginBottom: 10 }}
        />
        {file && (
          <p>
            Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
          </p>
        )}
        <p style={{ fontSize: 12, color: "#666" }}>
          Note: DeepL charges ~1 char per byte for documents. A 100KB PDF ≈ 100k
          characters.
        </p>
      </section>

      <button
        onClick={translateDocument}
        disabled={!file || !apiKey || translating}
        style={{ padding: "15px 30px", fontSize: 16 }}
      >
        {translating ? "Translating..." : "Translate to English (GB)"}
      </button>

      {error && <p style={{ color: "red", marginTop: 20 }}>{error}</p>}
    </main>
  );
}
