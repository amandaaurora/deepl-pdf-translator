"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyInfo, StatusResponse } from "@/lib/types";
import { Shell } from "@/components/Shell";
import { PasskeyPanel } from "@/components/PasskeyPanel";
import type { PdfAnalysis, PlannedChunk } from "@/lib/client/pdf";
import { addPasskey, hasPasskeyHere, passkeysSupported } from "@/lib/client/passkeys";
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
  ["", "Detect automatically"],
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

const FORMAT_NAMES: Record<string, string> = {
  docx: "Word document",
  pdf: "PDF",
  pptx: "PowerPoint",
  xlsx: "Excel file",
  txt: "text file",
};

const ACCEPTED = ".pdf,.docx,.pptx,.xlsx,.txt";

type KeyChoice = "auto" | number;
type Stage = "drop" | "review" | "working" | "done" | "failed";

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

const langName = (list: [string, string][], code: string) =>
  list.find(([c]) => c === code)?.[1] ?? code;

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
  const [view, setView] = useState<"main" | "account">("main");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusError, setStatusError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const [keyChoice, setKeyChoice] = usePref<KeyChoice>("keyChoice", "auto");
  const [sourceLang, setSourceLang] = usePref("sourceLang", "");
  const [targetLang, setTargetLang] = usePref("targetLang", "EN-GB");
  const [outputFormat, setOutputFormat] = usePref("outputFormat", "docx");
  const [showOptions, setShowOptions] = useState(false);

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
  const [offerPasskey, setOfferPasskey] = useState(false);
  const [passkeyNote, setPasskeyNote] = useState("");
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const extension = file?.name.split(".").pop()?.toLowerCase() ?? "";
  const isPdf = extension === "pdf";
  const outExt = isPdf ? outputFormat : extension;
  const baseName = file ? safeBaseName(file.name) : "";

  const stage: Stage = !file
    ? "drop"
    : running
      ? "working"
      : finalFile
        ? "done"
        : runError
          ? "failed"
          : "review";

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
      setStatusError("Couldn't check the translation allowance.");
    }
    setRefreshing(false);
  }, []);

  useEffect(() => {
     
    loadStatus();
    try {
      if (sessionStorage.getItem("offerPasskey") && passkeysSupported() && !hasPasskeyHere()) {
        setOfferPasskey(true);
      }
    } catch {
      // ignore
    }
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
    setPlanning("Reading the document…");
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
        setPlanning("Checking the size…");
        const { splitPdf } = await import("@/lib/client/pdf");
        chunks = await splitPdf(file, analysis, limits);
      } else {
        if (file.size > limits.maxBytes) {
          throw new Error(
            `This file is ${mb(file.size)}, which is over the ${mb(limits.maxBytes)} limit. ` +
              `Only PDFs can be split up automatically.`
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

  const chooseFile = useCallback((f: File | null) => {
    setFile(f);
    setParts([]);
    setFinalFile(null);
    setRunError("");
    setPlanError("");
    if (fileInput.current) fileInput.current.value = "";
  }, []);

  const pickFile = () => fileInput.current?.click();

  // Accept a document dropped anywhere on the page.
  useEffect(() => {
    if (view !== "main" || running) return;
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) chooseFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [view, running, chooseFile]);

  const translate = async () => {
    if (!file || !plan || !status) return;
    setRunning(true);
    setRunError("");
    setFinalFile(null);
    window.scrollTo({ top: 0, behavior: "smooth" });

    const n = plan.chunks.length;
    const initial: Part[] = plan.chunks.map((chunk, i) => ({
      label: n === 1 ? "Your document" : `Pages ${chunk.firstPage}–${chunk.lastPage}`,
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
          update(i, { state: "Sending" });
          const handle = await startTranslation(
            part.chunk.file,
            filename,
            { keyIndex: part.keyIndex, sourceLang, targetLang, outputFormat: outExt, viaBlob },
            (pct) => update(i, { state: `Sending · ${Math.round(pct)}%` })
          );
          update(i, { state: "Waiting in line" });
          const final = await waitForTranslation(handle, (s) =>
            update(i, {
              state:
                s.status === "translating"
                  ? `Translating${s.secondsRemaining ? ` · about ${s.secondsRemaining}s left` : ""}`
                  : s.status === "queued"
                    ? "Waiting in line"
                    : "Translated",
            })
          );
          update(i, { state: "Fetching the translation", billed: final.billedCharacters });
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
          `Every part was translated, but joining them into one file failed ` +
            `(${e instanceof Error ? e.message : e}). You can still download each part.`
        );
      }
    } else {
      setRunError(
        n === 1
          ? "The translation didn't go through."
          : "Some parts didn't go through. Any that finished can still be downloaded."
      );
    }
    setRunning(false);
    loadStatus();
  };

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  };

  const forgetPasskeyOffer = () => {
    try {
      sessionStorage.removeItem("offerPasskey");
    } catch {
      // ignore
    }
  };

  const dismissPasskeyOffer = () => {
    setOfferPasskey(false);
    forgetPasskeyOffer();
  };

  const setUpPasskey = async () => {
    try {
      await addPasskey();
      setPasskeyAdded(true);
      setPasskeyNote("Done. Next time, sign in with your fingerprint or face.");
      forgetPasskeyOffer();
    } catch (e) {
      setPasskeyNote(e instanceof Error ? e.message : String(e));
    }
  };

  const totalCost = plan?.costs.reduce((a, b) => a + b, 0) ?? 0;
  const totalBilled = parts.reduce((a, p) => a + (p.billed ?? 0), 0);
  const shortOfQuota = assignment.some((a) => !a.enough);
  const step = stage === "drop" ? 1 : stage === "review" ? 2 : 3;
  const figState =
    stage === "working" ? "busy" : stage === "failed" || planError ? "error" : stage === "done" ? "done" : "idle";
  const summary = `${langName(SOURCE_LANGS, sourceLang) === "Detect automatically" ? "Any language" : langName(SOURCE_LANGS, sourceLang)} → ${langName(TARGET_LANGS, targetLang)}`;
  const failedParts = parts.filter((p) => p.error);
  const finishedParts = parts.filter((p) => p.result);

  const options = (
    <div className="grid gap-5 sm:grid-cols-2">
      <label className="field sm:col-span-2">
        <span className="micro">Written in</span>
        <select value={sourceLang} onChange={(e) => setSourceLang(e.target.value)}>
          {SOURCE_LANGS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <span className="text-xs leading-relaxed text-ink-soft">
          Usually best left on automatic. If the document opens in a different language from the
          rest (say, an English abstract before French text), choose the main language here.
        </span>
      </label>
      <label className="field">
        <span className="micro">Translate into</span>
        <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
          {TARGET_LANGS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="micro">Save as</span>
        <select
          value={isPdf || !file ? outputFormat : extension}
          disabled={!!file && !isPdf}
          onChange={(e) => setOutputFormat(e.target.value)}
        >
          {file && !isPdf ? (
            <option value={extension}>Same as the original</option>
          ) : (
            <>
              <option value="docx">Word document (editable)</option>
              <option value="pdf">PDF</option>
            </>
          )}
        </select>
      </label>
    </div>
  );

  return (
    <Shell
      nav={view === "main" ? <Steps current={step} /> : <span className="micro text-ink">Account</span>}
      actions={
        <button
          onClick={() => setView(view === "main" ? "account" : "main")}
          disabled={running}
          className="micro link shrink-0"
        >
          {view === "main" ? "Account" : "← Back"}
        </button>
      }
    >
      {offerPasskey && view === "main" && !running && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-paper px-5 py-3 md:px-6">
          <p className="text-sm">
            {passkeyNote || "Skip the password next time: sign in on this device with your fingerprint or face."}
          </p>
          <div className="flex gap-4">
            {!passkeyAdded && (
              <button onClick={setUpPasskey} className="micro link text-ink">
                Set it up
              </button>
            )}
            <button onClick={dismissPasskeyOffer} className="micro link">
              {passkeyAdded ? "Close" : "Not now"}
            </button>
          </div>
        </div>
      )}

      {view === "account" ? (
        <Account
          keys={keys}
          statusError={statusError}
          refreshing={refreshing}
          onRefresh={loadStatus}
          choice={effectiveChoice}
          onChoose={setKeyChoice}
          onSignOut={signOut}
          noKeys={!!status && keys.length === 0}
        />
      ) : (
        <>
          <div className="grid border-b border-line md:grid-cols-2">
            {/* Left: what to do now */}
            <div className="flex flex-col gap-8 px-5 py-8 md:border-r md:border-line md:px-6 md:py-10">
              {stage === "drop" && (
                <>
                  <div>
                    <p className="micro">[ 01 ] Document</p>
                    <h1 className="display mt-6">
                      Drop a
                      <br />
                      document.
                    </h1>
                  </div>
                  <div>
                    <p className="max-w-sm text-sm leading-relaxed text-ink-soft">
                      A PDF, Word, PowerPoint, Excel or text file. It&apos;s translated into{" "}
                      <strong className="font-medium text-ink">{langName(TARGET_LANGS, targetLang)}</strong>
                      {outputFormat === "docx" ? ", and PDFs come back as editable Word documents. " : ". "}
                      <button onClick={() => setShowOptions(!showOptions)} className="link underline underline-offset-4">
                        {showOptions ? "Hide options" : "Change"}
                      </button>
                    </p>
                    {showOptions && <div className="mt-6">{options}</div>}
                    <div className="mt-7 flex flex-wrap items-center gap-4">
                      <button onClick={pickFile} className="pill pill-solid">
                        Choose document
                      </button>
                      <span className="text-xs text-ink-soft">or drag it anywhere onto this page</span>
                    </div>
                  </div>
                </>
              )}

              {stage === "review" && (
                <>
                  <div>
                    <p className="micro">[ 02 ] Check</p>
                    <h1 className="mt-5 text-3xl leading-tight font-normal tracking-tight break-all sm:text-4xl">
                      {file!.name}
                    </h1>
                    <p className="mt-2 text-sm text-ink-soft">
                      {mb(file!.size)}
                      {analysis &&
                        ` · ${analysis.pageCount} page${analysis.pageCount === 1 ? "" : "s"}`}
                      {" · "}
                      <button onClick={pickFile} className="link underline underline-offset-4">
                        Choose a different file
                      </button>
                    </p>
                  </div>
                  {options}
                  <div className="border-t border-line pt-5 text-sm leading-relaxed">
                    {planError ? (
                      <p className="text-alert">{planError}</p>
                    ) : !plan ? (
                      <p className="text-ink-soft">{planning || "Checking…"}</p>
                    ) : (
                      <>
                        {plan.chunks.length > 1 && (
                          <p className="mb-2">
                            It&apos;s a large file, so it will be sent in {plan.chunks.length} parts and
                            joined back into one.
                          </p>
                        )}
                        <p>
                          Uses about <strong className="font-medium">{fmt(totalCost)}</strong> characters
                          of this month&apos;s allowance.
                        </p>
                        {extension !== "txt" && (
                          <p className="mt-1 text-xs text-ink-soft">
                            DeepL counts every document as at least 50,000 characters, however short.
                          </p>
                        )}
                        {shortOfQuota && (
                          <p className="mt-3 text-alert">
                            There may not be enough allowance left this month for this one.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </>
              )}

              {stage === "working" && (
                <>
                  <div>
                    <p className="micro">[ 03 ] Translating</p>
                    <h1 className="display mt-6">
                      Working
                      <br />
                      on it.
                    </h1>
                  </div>
                  <div>
                    <p className="text-sm text-ink-soft">
                      Keep this page open. It usually takes a minute or two.
                    </p>
                    <PartList parts={parts} />
                  </div>
                </>
              )}

              {stage === "done" && (
                <>
                  <div>
                    <p className="micro">[ 03 ] Done</p>
                    <h1 className="display mt-6">Done.</h1>
                  </div>
                  <div>
                    <p className="text-sm leading-relaxed">
                      <strong className="font-medium break-all">{finalFile!.name}</strong> has been
                      downloaded.
                    </p>
                    {totalBilled > 0 && (
                      <p className="mt-1 text-xs text-ink-soft">
                        Used {fmt(totalBilled)} characters of the allowance.
                      </p>
                    )}
                    <div className="mt-7 flex flex-wrap gap-3">
                      <button onClick={() => saveFile(finalFile!.blob, finalFile!.name)} className="pill pill-solid">
                        ↓ Download again
                      </button>
                      <button onClick={() => chooseFile(null)} className="pill">
                        Translate another
                      </button>
                    </div>
                  </div>
                </>
              )}

              {stage === "failed" && (
                <>
                  <div>
                    <p className="micro">[ 03 ] Not translated</p>
                    <h1 className="display mt-6">
                      That
                      <br />
                      didn&apos;t work.
                    </h1>
                  </div>
                  <div>
                    <p className="text-sm text-alert">{runError}</p>
                    {failedParts.map((p, i) => (
                      <p key={i} className="mt-2 text-xs text-ink-soft">
                        {parts.length > 1 && `${p.label}: `}
                        {p.error}
                      </p>
                    ))}
                    {finishedParts.length > 0 && parts.length > 1 && (
                      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
                        {parts.map(
                          (p, i) =>
                            p.result && (
                              <button
                                key={i}
                                className="micro link text-ink"
                                onClick={() =>
                                  saveFile(p.result!, `${baseName}_translated_part${i + 1}of${parts.length}.${outExt}`)
                                }
                              >
                                ↓ {p.label}
                              </button>
                            )
                        )}
                      </div>
                    )}
                    <div className="mt-7 flex flex-wrap gap-3">
                      <button onClick={translate} className="pill pill-solid">
                        Try again
                      </button>
                      <button onClick={() => chooseFile(null)} className="pill">
                        Choose a different file
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Right: the figure, which is also the drop target */}
            <div
              role={stage === "drop" || stage === "review" ? "button" : undefined}
              tabIndex={stage === "drop" || stage === "review" ? 0 : undefined}
              aria-label={stage === "drop" || stage === "review" ? "Choose a document" : undefined}
              onClick={() => (stage === "drop" || stage === "review") && pickFile()}
              onKeyDown={(e) =>
                (stage === "drop" || stage === "review") && (e.key === "Enter" || e.key === " ") && pickFile()
              }
              className={`figure figure-${figState} ${dragging ? "figure-drag" : ""} relative min-h-64 border-t border-line md:min-h-full md:border-t-0 ${
                stage === "drop" || stage === "review" ? "cursor-pointer" : ""
              }`}
            >
              <span className="crosshair" aria-hidden />
              <span className="corner corner-tl" aria-hidden />
              <span className="corner corner-br" aria-hidden />
              {dragging && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="micro bg-white/80 px-3 py-1.5 text-ink">Release to add</span>
                </span>
              )}
              <p className="micro absolute bottom-4 left-4 text-ink md:left-5">
                {stage === "drop" && "Fig 01. Drop it here"}
                {stage === "review" && "Fig 02. Ready to translate"}
                {stage === "working" && "Fig 03. In translation"}
                {stage === "done" && "Fig 03. Translated"}
                {stage === "failed" && "Fig 03. Interrupted"}
              </p>
            </div>
          </div>

          {/* The one action, always within reach */}
          {(stage === "review" || stage === "working") && (
            <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-b border-line bg-white px-5 py-4 md:px-6">
              <p className="micro text-ink-soft">
                {stage === "working" ? (
                  "Keep this page open"
                ) : (
                  <>
                    <span className="hidden sm:inline">
                      {summary} · {FORMAT_NAMES[outExt] ?? outExt}
                      {plan && " · "}
                    </span>
                    {plan ? `~${fmt(totalCost)} characters` : "Checking…"}
                  </>
                )}
              </p>
              <button
                onClick={translate}
                disabled={stage === "working" || !plan || keys.length === 0}
                className="pill pill-solid"
              >
                {stage === "working" ? "Translating" : "Translate →"}
              </button>
            </div>
          )}

          {keys.length === 0 && status && (
            <p className="border-b border-line px-5 py-4 text-sm text-alert md:px-6">
              Translation isn&apos;t set up yet: no DeepL keys are configured.
            </p>
          )}
        </>
      )}

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && chooseFile(e.target.files[0])}
      />
    </Shell>
  );
}

function Steps({ current }: { current: number }) {
  const names = ["Document", "Check", "Translate"];
  return (
    <>
      <ol className="hidden items-center gap-3 sm:flex">
        {names.map((name, i) => (
          <li key={name} className="flex items-center gap-3">
            {i > 0 && <span className="h-px w-6 bg-line" aria-hidden />}
            <span
              className={`micro ${i + 1 === current ? "text-ink" : ""}`}
              aria-current={i + 1 === current ? "step" : undefined}
            >
              {String(i + 1).padStart(2, "0")} {name}
            </span>
          </li>
        ))}
      </ol>
      <span className="micro whitespace-nowrap text-ink sm:hidden">
        {current}/3 {names[current - 1]}
      </span>
    </>
  );
}

function PartList({ parts }: { parts: Part[] }) {
  return (
    <ul className="mt-4 border-t border-line text-sm">
      {parts.map((p, i) => (
        <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5">
          <span>{p.label}</span>
          <span className={p.error ? "text-alert" : p.done ? "text-ink" : "text-ink-soft"}>
            {p.done && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-ok align-middle" />}
            {p.state}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Account({
  keys,
  statusError,
  refreshing,
  onRefresh,
  choice,
  onChoose,
  onSignOut,
  noKeys,
}: {
  keys: KeyInfo[];
  statusError: string;
  refreshing: boolean;
  onRefresh: () => void;
  choice: KeyChoice;
  onChoose: (c: KeyChoice) => void;
  onSignOut: () => void;
  noKeys: boolean;
}) {
  const cells: { choice: KeyChoice; title: string; key?: KeyInfo }[] = [
    ...(keys.length > 1 ? [{ choice: "auto" as KeyChoice, title: "Automatic" }] : []),
    ...keys.map((k) => ({ choice: k.index as KeyChoice, title: k.label, key: k })),
  ];
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line px-5 py-8 md:px-6">
        <div>
          <p className="micro">[ A ] Account</p>
          <h1 className="display mt-6">Account.</h1>
        </div>
        <button onClick={onSignOut} className="pill">
          Sign out
        </button>
      </div>

      <div className="border-b border-line">
        <div className="flex items-center justify-between px-5 pt-5 md:px-6">
          <p className="micro">Translation allowance</p>
          <button onClick={onRefresh} disabled={refreshing} className="micro link">
            {refreshing ? "Refreshing" : "Refresh ↻"}
          </button>
        </div>
        <p className="px-5 pt-2 text-sm text-ink-soft md:px-6">
          Each DeepL key has its own monthly allowance. Choose which one translations use.
        </p>
        {statusError && <p className="px-5 pt-3 text-sm text-alert md:px-6">{statusError}</p>}
        {noKeys && (
          <p className="px-5 pt-3 text-sm text-alert md:px-6">
            No keys configured. Add DEEPL_API_KEY_1 (and DEEPL_API_KEY_2) in Vercel&apos;s
            environment variables.
          </p>
        )}
        <div className="mt-4 grid border-t border-line sm:grid-cols-2 lg:grid-cols-3">
          {cells.map((c, i) => (
            <KeyCell
              key={String(c.choice)}
              n={i}
              title={c.title}
              usage={c.key}
              checked={choice === c.choice || (keys.length === 1 && c.choice !== "auto")}
              onSelect={() => onChoose(c.choice)}
            />
          ))}
        </div>
      </div>

      <PasskeyPanel />
    </>
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
  // Share of the allowance still left, to match the "left of" text.
  const pct = usage?.limit ? Math.max(0, Math.min(100, (remaining(usage) / usage.limit) * 100)) : 0;
  const tag = usage ? (usage.plan === "free" ? "Free" : "Pro") : "Mode";
  return (
    <label
      className={`relative block cursor-pointer border-b border-line px-5 py-5 transition-colors sm:border-r md:px-6 ${
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
        {checked && " · in use"}
      </span>
      <span className="mt-1.5 block text-base">{title}</span>
      {!usage && <span className="mt-1 block text-xs text-ink-soft">Whichever has the most left</span>}
      {usage?.error && <span className="mt-1 block text-xs text-alert">{usage.error}</span>}
      {usage && !usage.error && usage.limit !== null && (
        <>
          <span className="mt-3 block h-px bg-line">
            <span
              className={`block h-px ${pct < 10 ? "bg-alert" : "bg-ink"}`}
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
