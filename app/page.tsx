"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyInfo, StatusResponse } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { PasskeyPanel } from "@/components/PasskeyPanel";
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
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
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

  const figState = running ? "busy" : runError || planError ? "error" : finalFile ? "done" : "idle";
  const choiceCells: { choice: KeyChoice; title: string; key?: KeyInfo }[] = [
    ...(keys.length > 1 ? [{ choice: "auto" as KeyChoice, title: "Automatic" }] : []),
    ...keys.map((k) => ({ choice: k.index as KeyChoice, title: k.label, key: k })),
  ];
  const isChosen = (c: KeyChoice) => effectiveChoice === c || (keys.length === 1 && c !== "auto");

  return (
    <Shell onSignOut={signOut}>
      {/* Hero: intro on the left, the drop zone as a "figure" on the right */}
      <div className="grid border-b border-line md:grid-cols-2">
        <div className="flex flex-col justify-between gap-8 px-5 py-8 md:border-r md:border-line md:px-6 md:py-10">
          <div>
            <p className="micro">[ 01 ] Translate</p>
            <h1 className="display mt-6">
              Alih
              <br />
              bahasa.
            </h1>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
            Documents in, translations out. PDFs too large for DeepL are split, translated and
            bound back into a single file.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a document"
          onClick={() => !running && fileInput.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f && !running) chooseFile(f);
          }}
          className={`figure figure-${figState} ${dragging ? "figure-drag" : ""} group relative min-h-72 cursor-pointer border-t border-line md:border-t-0`}
        >
          <span className="crosshair" aria-hidden />
          <span className="corner corner-tl" aria-hidden />
          <span className="corner corner-br" aria-hidden />
          <div className="absolute inset-x-4 bottom-4 md:inset-x-5">
            <p className="micro text-ink">
              Fig 01.{" "}
              {file ? (running ? "In translation" : finalFile ? "Translated" : "Document") : "Drop a document"}
            </p>
            {file ? (
              <>
                <p className="mt-1 text-base break-all text-ink">{file.name}</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {mb(file.size)}
                  {analysis && ` · ${analysis.pageCount} page${analysis.pageCount === 1 ? "" : "s"} · ~${fmt(analysis.totalChars)} characters`}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-ink-soft">
                or click to choose · PDF, Word, PowerPoint, Excel, text
              </p>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {/* Keys as a row of index cells */}
      <div className="border-b border-line">
        <div className="flex items-center justify-between px-5 pt-5 md:px-6">
          <p className="micro">Index_02 · API keys</p>
          <button onClick={loadStatus} disabled={refreshing} className="micro link">
            {refreshing ? "Refreshing" : "Refresh ↻"}
          </button>
        </div>
        {statusError && <p className="px-5 pt-3 text-sm text-alert md:px-6">{statusError}</p>}
        {status && keys.length === 0 && (
          <p className="px-5 pt-3 text-sm text-alert md:px-6">
            No keys configured. Add DEEPL_API_KEY_1 (and DEEPL_API_KEY_2) in Vercel&apos;s
            environment variables.
          </p>
        )}
        <div className="mt-4 grid border-t border-line sm:grid-cols-2 lg:grid-cols-3">
          {choiceCells.map((c, i) => (
            <KeyCell
              key={String(c.choice)}
              n={i}
              title={c.title}
              usage={c.key}
              checked={isChosen(c.choice)}
              onSelect={() => setKeyChoice(c.choice)}
            />
          ))}
        </div>
      </div>

      {/* Settings */}
      <div className="grid border-b border-line sm:grid-cols-3">
        <Field n="03" label="From">
          <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
            {SOURCE_LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field n="04" label="To">
          <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {TARGET_LANGS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field n="05" label="Save as" last>
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
        </Field>
      </div>

      {/* Estimate */}
      {file && (
        <div className="border-b border-line px-5 py-6 md:px-6">
          <p className="micro">Index_03 · Estimate</p>
          {planError ? (
            <p className="mt-3 text-sm text-alert">{planError}</p>
          ) : !plan ? (
            <p className="mt-3 text-sm text-ink-soft">{planning || "Checking…"}</p>
          ) : (
            <>
              <h2 className="mt-2 text-2xl font-normal tracking-tight">
                {plan.chunks.length > 1 ? `${plan.chunks.length} parts, bound as one.` : "A single file."}
              </h2>
              <ul className="mt-4 border-t border-line text-sm">
                {plan.chunks.map((c, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-line py-2.5">
                    <span>
                      <span className="micro mr-3">{String(i + 1).padStart(2, "0")}</span>
                      {plan.chunks.length > 1 && `Pages ${c.firstPage}–${c.lastPage} · `}
                      {mb(c.bytes)}
                      {assignment[i] && keys.length > 1 && (
                        <span className="text-ink-soft"> · {keyLabel(assignment[i].keyIndex)}</span>
                      )}
                    </span>
                    <span className="text-ink-soft tabular-nums">~{fmt(plan.costs[i])} chars</span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                <span className="micro">
                  Total
                  {extension !== "txt" && " · DeepL bills ≥ 50,000 per file"}
                </span>
                <span className="text-lg tabular-nums">{fmt(totalCost)} characters</span>
              </div>
              {isPdf && analysis?.totalChars === 0 && (
                <p className="mt-2 text-xs text-ink-soft">
                  This PDF looks scanned, so the real count may be higher.
                </p>
              )}
              {shortOfQuota && (
                <p className="mt-3 text-sm text-alert">
                  ⚠ That may be more than the quota left on{" "}
                  {effectiveChoice === "auto" ? "your keys" : "this key"}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-6 md:px-6">
        <p className="micro">
          {running ? "Working…" : plan ? "Ready" : file ? "Preparing" : "Awaiting document"}
        </p>
        <button
          onClick={translate}
          disabled={!plan || running || keys.length === 0}
          className="pill pill-solid"
        >
          {running ? "Translating" : "Translate →"}
        </button>
      </div>

      {/* Progress */}
      {parts.length > 0 && (
        <div className="border-b border-line px-5 py-6 md:px-6">
          <p className="micro">Index_04 · Progress</p>
          <ul className="mt-4 border-t border-line text-sm">
            {parts.map((p, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5">
                <span>
                  <span className="micro mr-3">{String(i + 1).padStart(2, "0")}</span>
                  {p.label}
                </span>
                <span className={p.error ? "text-alert" : p.done ? "text-ink" : "text-ink-soft"}>
                  {p.done && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-ok align-middle" />}
                  {p.state}
                  {p.billed !== undefined && ` · ${fmt(p.billed)} chars`}
                  {p.result && parts.length > 1 && (
                    <button
                      className="link ml-3"
                      onClick={() =>
                        saveFile(p.result!, `${baseName}_translated_part${i + 1}of${parts.length}.${outExt}`)
                      }
                    >
                      ↓ part
                    </button>
                  )}
                </span>
                {p.error && <span className="w-full text-alert">{p.error}</span>}
              </li>
            ))}
          </ul>
          {runError && <p className="mt-3 text-sm text-alert">{runError}</p>}
          {finalFile && (
            <button onClick={() => saveFile(finalFile.blob, finalFile.name)} className="pill mt-5 tracking-normal normal-case">
              ↓ {finalFile.name}
            </button>
          )}
        </div>
      )}

      <PasskeyPanel />
    </Shell>
  );
}

function Field({
  n,
  label,
  last,
  children,
}: {
  n: string;
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label
      className={`field px-5 py-5 md:px-6 ${last ? "" : "border-b border-line sm:border-r sm:border-b-0"}`}
    >
      <span className="micro">
        {n} / {label}
      </span>
      {children}
    </label>
  );
}

function KeyCell({
  n,
  title,
  usage,
  checked,
  onSelect,
}: {
  n: number;
  title: string;
  usage?: KeyInfo;
  checked: boolean;
  onSelect: () => void;
}) {
  const disabled = !!usage?.error;
  const pct = usage?.limit ? Math.min(100, ((usage.used ?? 0) / usage.limit) * 100) : 0;
  const tag = usage ? (usage.plan === "free" ? "Free" : "Pro") : "Mode";
  return (
    <label
      className={`keycell relative block cursor-pointer border-b border-line px-5 py-5 transition-colors sm:border-r md:px-6 ${
        checked ? "keycell-on" : "hover:bg-paper"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="radio"
        name="key"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="sr-only"
      />
      <span className="micro">
        {String(n).padStart(2, "0")} / {tag}
        {checked && " · selected"}
      </span>
      <span className="mt-1.5 block text-base">{title}</span>
      {!usage && <span className="mt-1 block text-xs text-ink-soft">Most quota left goes first</span>}
      {usage?.error && <span className="mt-1 block text-xs text-alert">{usage.error}</span>}
      {usage && !usage.error && usage.limit !== null && (
        <>
          <span className="mt-3 block h-px bg-line">
            <span
              className={`block h-px ${pct > 90 ? "bg-alert" : "bg-ink"}`}
              style={{ width: `${pct}%` }}
            />
          </span>
          <span className="mt-2 block text-xs text-ink-soft tabular-nums">
            {fmt(remaining(usage))} left of {fmt(usage.limit)}
          </span>
        </>
      )}
    </label>
  );
}
