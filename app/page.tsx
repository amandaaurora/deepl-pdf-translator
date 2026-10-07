"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyInfo, StatusResponse } from "@/lib/types";
import type { PdfAnalysis, PlannedChunk } from "@/lib/client/pdf";
import {
  DEEPL_LIMITS,
  assignKeys,
  billedEstimate,
  downloadTranslation,
  remaining,
  saveFile,
  startTranslation,
  waitForTranslation,
} from "@/lib/client/translate";

const SOURCE_LANGS: [string, string][] = [
  ["", "Auto-detect"],
  ["FR", "French"],
  ["ID", "Indonesian"],
  ["EN", "English"],
  ["DE", "German"],
  ["ES", "Spanish"],
  ["IT", "Italian"],
  ["NL", "Dutch"],
  ["PT", "Portuguese"],
  ["JA", "Japanese"],
  ["ZH", "Chinese"],
];

const TARGET_LANGS: [string, string][] = [
  ["EN-GB", "English (British)"],
  ["EN-US", "English (American)"],
  ["FR", "French"],
  ["ID", "Indonesian"],
  ["DE", "German"],
  ["ES", "Spanish"],
  ["IT", "Italian"],
  ["NL", "Dutch"],
  ["PT-PT", "Portuguese (European)"],
  ["PT-BR", "Portuguese (Brazilian)"],
  ["JA", "Japanese"],
  ["ZH-HANS", "Chinese (simplified)"],
];

const ACCEPTED = ".pdf,.docx,.pptx,.xlsx,.txt";

type KeyChoice = "auto" | number;

type Part = {
  label: string;
  chunk: PlannedChunk;
  keyIndex: number;
  state: string;
  billed?: number;
  error?: string;
  done?: boolean;
  result?: Blob;
};

type Plan = {
  chunks: PlannedChunk[];
  costs: number[];
};

function fmt(n: number) {
  return n.toLocaleString("en-GB");
}

function mb(bytes: number) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

function safeBaseName(name: string) {
  return (
    name
      .replace(/\.[^/.]+$/, "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9.\-_]/g, "_") || "document"
  );
}

function usePref<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored !== null) setValue(JSON.parse(stored));
    } catch {
      // storage unavailable: keep the default
    }
  }, [key]);
  const update = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // ignore
      }
    },
    [key]
  );
  return [value, update] as const;
}

export default function Home() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [keyChoice, setKeyChoice] = usePref<KeyChoice>("keyChoice", "auto");
  const [sourceLang, setSourceLang] = usePref("sourceLang", "");
  const [targetLang, setTargetLang] = usePref("targetLang", "EN-GB");
  const [outputFormat, setOutputFormat] = usePref("outputFormat", "docx");

  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<PdfAnalysis | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planning, setPlanning] = useState("");
  const [planError, setPlanError] = useState("");

  const [parts, setParts] = useState<Part[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [finalFile, setFinalFile] = useState<{ blob: Blob; name: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = extension === "pdf";
  const outExt = isPdf ? outputFormat : extension;
  const baseName = file ? safeBaseName(file.name) : "";

  const loadStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error();
      setStatus(await res.json());
      setStatusError("");
    } catch {
      setStatusError("Couldn't load your DeepL keys.");
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
     
    loadStatus();
  }, [loadStatus]);

  const keys = useMemo(() => status?.keys ?? [], [status]);
  const effectiveChoice: KeyChoice =
    keyChoice !== "auto" && !keys.some((k) => k.index === keyChoice) ? "auto" : keyChoice;

  // The tightest limits that apply to whichever key(s) may be used.
  const limits = useMemo(() => {
    if (!status) return null;
    const relevant =
      effectiveChoice === "auto"
        ? keys.filter((k) => !k.error)
        : keys.filter((k) => k.index === effectiveChoice);
    const planType = relevant.length && relevant.every((k) => k.plan === "pro") ? "pro" : "free";
    let maxBytes = DEEPL_LIMITS[planType].maxBytes;
    if (!status.blobEnabled && status.maxRequestBytes) {
      maxBytes = Math.min(maxBytes, status.maxRequestBytes);
    }
    // Leave a margin: our character count is an estimate.
    return {
      maxBytes: Math.floor(maxBytes * 0.98),
      maxChars: Math.floor(DEEPL_LIMITS[planType].maxChars * 0.95),
    };
  }, [status, keys, effectiveChoice]);

  // Read the PDF's text to estimate characters.
  useEffect(() => {
     
    setAnalysis(null);
    if (!file || !isPdf) return;
    let cancelled = false;
    setPlanning("Reading the PDF…");
    import("@/lib/client/pdf")
      .then(({ analysePdf }) => analysePdf(file))
      .then((a) => !cancelled && setAnalysis(a))
      .catch(
        (e) =>
          !cancelled &&
          setPlanError(`Couldn't read this PDF: ${e instanceof Error ? e.message : e}`)
      );
    return () => {
      cancelled = true;
    };
  }, [file, isPdf]);

  // Work out the parts, what they'll cost and which key each goes to.
  const limitsKey = limits ? `${limits.maxBytes}/${limits.maxChars}` : "";
  useEffect(() => {
     
    setPlan(null);
    setPlanError("");
    if (!file || !limits) return;
    let cancelled = false;

    (async () => {
      let chunks: PlannedChunk[];
      if (isPdf) {
        if (!analysis) return;
        setPlanning("Working out how to split it…");
        const { splitPdf } = await import("@/lib/client/pdf");
        chunks = await splitPdf(file, analysis, limits, (m) => !cancelled && setPlanning(m));
      } else {
        if (file.size > limits.maxBytes) {
          throw new Error(
            `This file is ${mb(file.size)}, over the ${mb(limits.maxBytes)} limit. ` +
              `Only PDFs can be split automatically.`
          );
        }
        const chars = extension === "txt" ? file.size : 0;
        chunks = [{ firstPage: 1, lastPage: 1, chars, bytes: file.size, file }];
      }
      if (cancelled) return;
      const costs = chunks.map((c) => billedEstimate(c.chars, extension));
      setPlan({ chunks, costs });
      setPlanning("");
    })().catch((e) => {
      if (cancelled) return;
      setPlanning("");
      setPlanError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, analysis, limitsKey, isPdf, extension]);

  const assignment = useMemo(
    () => (plan ? assignKeys(keys, plan.costs, effectiveChoice) : []),
    [plan, keys, effectiveChoice]
  );

  const chooseFile = (f: File | null) => {
    setFile(f);
    setParts([]);
    setFinalFile(null);
    setRunError("");
    setPlanError("");
  };

  const translate = async () => {
    if (!file || !plan || !status) return;
    setRunning(true);
    setRunError("");
    setFinalFile(null);

    const n = plan.chunks.length;
    const initial: Part[] = plan.chunks.map((chunk, i) => ({
      label: n === 1 ? file.name : `Part ${i + 1} of ${n} (pages ${chunk.firstPage}–${chunk.lastPage})`,
      chunk,
      keyIndex: assignment[i].keyIndex,
      state: "Waiting",
    }));
    setParts(initial);
    const update = (i: number, patch: Partial<Part>) =>
      setParts((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

    const results = await Promise.all(
      initial.map(async (part, i): Promise<Blob | null> => {
        try {
          const filename = n === 1 ? `${baseName}.${extension}` : `${baseName}_part${i + 1}of${n}.pdf`;
          const viaBlob =
            status.blobEnabled &&
            status.maxRequestBytes !== null &&
            part.chunk.bytes > status.maxRequestBytes;
          update(i, { state: "Uploading" });
          const handle = await startTranslation(
            part.chunk.file,
            filename,
            { keyIndex: part.keyIndex, sourceLang, targetLang, outputFormat: outExt, viaBlob },
            (pct) => update(i, { state: `Uploading (${Math.round(pct)}%)` })
          );
          update(i, { state: "Queued at DeepL" });
          const final = await waitForTranslation(handle, (s) =>
            update(i, {
              state:
                s.status === "translating"
                  ? `Translating${s.secondsRemaining ? ` (about ${s.secondsRemaining}s left)` : ""}`
                  : s.status === "queued"
                    ? "Queued at DeepL"
                    : "Translated",
            })
          );
          update(i, { state: "Downloading", billed: final.billedCharacters });
          const blob = await downloadTranslation(handle);
          update(i, { state: "Done", done: true, result: blob });
          return blob;
        } catch (e) {
          update(i, { state: "Failed", error: e instanceof Error ? e.message : String(e) });
          return null;
        }
      })
    );

    const outName = `${baseName}_translated.${outExt}`;
    if (results.every((r): r is Blob => r !== null)) {
      try {
        let merged: Blob;
        if (results.length === 1) {
          merged = results[0];
        } else if (outExt === "docx") {
          const { mergeDocx } = await import("@/lib/client/merge-docx");
          merged = await mergeDocx(results);
        } else {
          const { mergePdfs } = await import("@/lib/client/pdf");
          merged = await mergePdfs(results);
        }
        setFinalFile({ blob: merged, name: outName });
        saveFile(merged, outName);
      } catch (e) {
        setRunError(
          `The parts translated, but joining them failed (${e instanceof Error ? e.message : e}). ` +
            `You can download each part below.`
        );
      }
    } else {
      setRunError("Some parts failed. Parts that finished can still be downloaded below.");
    }
    setRunning(false);
    loadStatus();
  };

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const totalCost = plan?.costs.reduce((a, b) => a + b, 0) ?? 0;
  const shortOfQuota = assignment.some((a) => !a.enough);
  const keyLabel = (index: number) => keys.find((k) => k.index === index)?.label ?? `Key ${index}`;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">DeepL Translator</h1>
        <button onClick={signOut} className="text-sm text-stone-500 hover:text-stone-800">
          Sign out
        </button>
      </header>

      {/* Keys */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">API keys</h2>
          <button
            onClick={loadStatus}
            disabled={refreshing}
            className="text-sm text-stone-500 hover:text-stone-800 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {statusError && <p className="text-sm text-red-700">{statusError}</p>}
        {status && keys.length === 0 && (
          <p className="text-sm text-red-700">
            No keys configured. Add DEEPL_API_KEY_1 (and DEEPL_API_KEY_2) in Vercel&apos;s
            environment variables.
          </p>
        )}
        <div className="space-y-2">
          {keys.length > 1 && (
            <KeyOption
              checked={effectiveChoice === "auto"}
              onSelect={() => setKeyChoice("auto")}
              title="Automatic"
              subtitle="Use whichever key has the most quota left"
            />
          )}
          {keys.map((k) => (
            <KeyOption
              key={k.index}
              checked={effectiveChoice === k.index || (keys.length === 1 && !k.error)}
              onSelect={() => setKeyChoice(k.index)}
              title={k.label}
              badge={k.plan === "free" ? "Free" : "Pro"}
              usage={k}
            />
          ))}
        </div>
      </section>

      {/* File */}
      <section className="card">
        <h2 className="section-title mb-3">Document</h2>
        <div
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) chooseFile(f);
          }}
          className={`cursor-pointer rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
            dragging ? "border-blue-500 bg-blue-50" : "border-stone-300 hover:border-stone-400"
          }`}
        >
          {file ? (
            <>
              <p className="font-medium break-all">{file.name}</p>
              <p className="mt-1 text-sm text-stone-500">
                {mb(file.size)}
                {analysis &&
                  ` · ${analysis.pageCount} pages · about ${fmt(analysis.totalChars)} characters`}
              </p>
            </>
          ) : (
            <p className="text-stone-500">
              Drop a file here or <span className="text-blue-700 underline">choose one</span>
              <br />
              <span className="text-xs">PDF, Word, PowerPoint, Excel or text</span>
            </p>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="field">
            <span>From</span>
            <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
              {SOURCE_LANGS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
              {TARGET_LANGS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Save as</span>
            <select
              value={isPdf || !file ? outputFormat : extension}
              disabled={!!file && !isPdf}
              onChange={(e) => setOutputFormat(e.target.value)}
            >
              {file && !isPdf ? (
                <option value={extension}>.{extension}</option>
              ) : (
                <>
                  <option value="docx">Word (.docx)</option>
                  <option value="pdf">PDF</option>
                </>
              )}
            </select>
          </label>
        </div>

        {/* Plan */}
        {file && (
          <div className="mt-4 rounded-lg bg-stone-100 p-4 text-sm">
            {planError ? (
              <p className="text-red-700">{planError}</p>
            ) : !plan ? (
              <p className="text-stone-500">{planning || "Checking…"}</p>
            ) : (
              <>
                {plan.chunks.length > 1 ? (
                  <p>
                    Too big for DeepL in one go, so it&apos;ll be sent as{" "}
                    <strong>{plan.chunks.length} parts</strong> and joined back together afterwards:
                  </p>
                ) : (
                  <p>Sent to DeepL as a single file.</p>
                )}
                <ul className="mt-2 space-y-1">
                  {plan.chunks.map((c, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>
                        {plan.chunks.length > 1 && `Pages ${c.firstPage}–${c.lastPage} · `}
                        {mb(c.bytes)}
                        {assignment[i] && keys.length > 1 && ` · ${keyLabel(assignment[i].keyIndex)}`}
                      </span>
                      <span className="text-stone-500">~{fmt(plan.costs[i])} chars billed</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 border-t border-stone-300 pt-2">
                  Estimated cost: <strong>{fmt(totalCost)} characters</strong>
                  {extension !== "txt" && (
                    <span className="text-stone-500">
                      {" "}
                      (DeepL charges at least {fmt(50_000)} per file
                      {isPdf && analysis?.totalChars === 0 && "; this PDF looks scanned, so the real count may be higher"})
                    </span>
                  )}
                </p>
                {shortOfQuota && (
                  <p className="mt-2 text-amber-800">
                    ⚠ That may be more than the quota left on{" "}
                    {effectiveChoice === "auto" ? "your keys" : "this key"}.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <button
          onClick={translate}
          disabled={!plan || running || keys.length === 0}
          className="mt-4 w-full rounded-lg bg-stone-900 px-4 py-3 font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Translating…" : "Translate"}
        </button>
      </section>

      {/* Progress */}
      {parts.length > 0 && (
        <section className="card">
          <h2 className="section-title mb-3">Progress</h2>
          <ul className="space-y-2 text-sm">
            {parts.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>{p.label}</span>
                <span className={p.error ? "text-red-700" : p.done ? "text-green-700" : "text-stone-500"}>
                  {p.state}
                  {p.billed !== undefined && ` · ${fmt(p.billed)} chars billed`}
                  {p.result && parts.length > 1 && (
                    <>
                      {" · "}
                      <button
                        className="underline"
                        onClick={() =>
                          saveFile(p.result!, `${baseName}_translated_part${i + 1}of${parts.length}.${outExt}`)
                        }
                      >
                        download
                      </button>
                    </>
                  )}
                </span>
                {p.error && <span className="w-full text-red-700">{p.error}</span>}
              </li>
            ))}
          </ul>
          {runError && <p className="mt-3 text-sm text-red-700">{runError}</p>}
          {finalFile && (
            <button
              onClick={() => saveFile(finalFile.blob, finalFile.name)}
              className="mt-4 w-full rounded-lg border border-stone-900 px-4 py-2 font-medium hover:bg-stone-100"
            >
              Download {finalFile.name} again
            </button>
          )}
        </section>
      )}
    </main>
  );
}

function KeyOption({
  checked,
  onSelect,
  title,
  subtitle,
  badge,
  usage,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string;
  badge?: string;
  usage?: KeyInfo;
}) {
  const disabled = !!usage?.error;
  const pct = usage?.limit ? Math.min(100, ((usage.used ?? 0) / usage.limit) * 100) : 0;
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${
        checked ? "border-stone-900 bg-stone-50" : "border-stone-200 hover:border-stone-300"
      } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
    >
      <input
        type="radio"
        name="key"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge && (
            <span className="rounded bg-stone-200 px-1.5 py-0.5 text-xs text-stone-600">{badge}</span>
          )}
        </div>
        {subtitle && <p className="text-sm text-stone-500">{subtitle}</p>}
        {usage?.error && <p className="text-sm text-red-700">{usage.error}</p>}
        {usage && !usage.error && usage.limit !== null && (
          <>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-stone-200">
              <div
                className={`h-full ${pct > 90 ? "bg-red-600" : pct > 70 ? "bg-amber-500" : "bg-green-600"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {fmt(remaining(usage))} characters left of {fmt(usage.limit)}
            </p>
          </>
        )}
      </div>
    </label>
  );
}
