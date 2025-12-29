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
  const [agreedToTerms, setAgreedToTerms] = useState(false);

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
        const text = await res.text();
        let errorMsg = "Translation failed";
        try {
          const data = JSON.parse(text);
          errorMsg = data.error || errorMsg;
        } catch {
          errorMsg = text || errorMsg;
        }
        throw new Error(errorMsg);
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
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 10px 0" }}>
          Don't have one?{" "}
          <a
            href="https://www.deepl.com/en/your-account/keys"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get your free API key from DeepL
          </a>{" "}
          (500k chars/month free)
        </p>
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
        <div
          style={{
            fontSize: 12,
            color: "#666",
            backgroundColor: "#fff3cd",
            padding: 12,
            borderRadius: 4,
            marginTop: 10,
          }}
        >
          <strong>⚠️ DeepL Document Pricing:</strong>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
            <li>
              PDF, DOCX, XLSX, PPTX: <strong>50,000 character minimum</strong>{" "}
              per file
            </li>
            <li>Even a 1-page document costs 50k characters</li>
            <li>Free tier (500k chars) = ~10 documents max</li>
          </ul>
        </div>
      </section>

      <div style={{ marginTop: 20, marginBottom: 20 }}>
        <label
          style={{
            fontSize: 13,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            I agree that my documents will be sent to DeepL for translation. I
            accept the{" "}
            <a
              href="https://www.deepl.com/en/pro-license"
              target="_blank"
              rel="noopener noreferrer"
            >
              DeepL Terms and Conditions
            </a>{" "}
            and understand that this app does not store my API key or documents.
          </span>
        </label>
      </div>

      <button
        onClick={translateDocument}
        disabled={!file || !apiKey || !agreedToTerms || translating}
        style={{ padding: "15px 30px", fontSize: 16 }}
      >
        {translating ? "Translating..." : "Translate to English (GB)"}
      </button>

      {error && <p style={{ color: "red", marginTop: 20 }}>{error}</p>}

      <footer
        style={{
          marginTop: 40,
          paddingTop: 20,
          borderTop: "1px solid #ddd",
          fontSize: 12,
          color: "#666",
        }}
      >
        <p style={{ marginBottom: 8 }}>
          <strong>Privacy:</strong> Your API key and documents are not stored.
          Files are sent to DeepL for translation and returned directly to you.
        </p>
        <p>
          This app uses the{" "}
          <a
            href="https://www.deepl.com/en/pro-api"
            target="_blank"
            rel="noopener noreferrer"
          >
            DeepL API
          </a>
          . By using this service, you agree to{" "}
          <a
            href="https://www.deepl.com/en/pro-license"
            target="_blank"
            rel="noopener noreferrer"
          >
            DeepL's Terms and Conditions
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
