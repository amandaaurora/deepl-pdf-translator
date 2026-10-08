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

// [code, label in the dropdown, label in the sentence]
const SOURCE_LANGS: [string, string, string][] = [
  ["", "Any language (detect automatically)", "any language"],
  ["FR", "French", "French"],
  ["ID", "Indonesian", "Indonesian"],
  ["EN", "English", "English"],
  ["DE", "German", "German"],
  ["ES", "Spanish", "Spanish"],
  ["IT", "Italian", "Italian"],
  ["NL", "Dutch", "Dutch"],
  ["PT", "Portuguese", "Portuguese"],
  ["JA", "Japanese", "Japanese"],
  ["ZH", "Chinese", "Chinese"],
];

const TARGET_LANGS: [string, string, string][] = [
  ["EN-GB", "English (British)", "English (British)"],
  ["EN-US", "English (American)", "English (American)"],
  ["FR", "French", "French"],
  ["ID", "Indonesian", "Indonesian"],
  ["DE", "German", "German"],
  ["ES", "Spanish", "Spanish"],
  ["IT", "Italian", "Italian"],
  ["NL", "Dutch", "Dutch"],
  ["PT-PT", "Portuguese (European)", "Portuguese (European)"],
  ["PT-BR", "Portuguese (Brazilian)", "Portuguese (Brazilian)"],
  ["JA", "Japanese", "Japanese"],
  ["ZH-HANS", "Chinese (simplified)", "Chinese (simplified)"],
];

const FORMATS: [string, string, string][] = [
  ["docx", "Word document (editable)", "Word"],
  ["pdf", "PDF", "PDF"],
];

const ACCEPTED = ".pdf,.docx,.pptx,.xlsx,.txt";

type KeyChoice = "auto" | number;
type Stage = "drop" | "review" | "working" | "done" | "failed";

type Part = {
  label: string;
  chunk: PlannedChunk;
  keyIndex: number;
  state: string;
  progress: number; // 0–1
  secondsLeft?: number;
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

// An underlined word in the sentence; tapping it opens a native dropdown.
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string, string][];
  onChange: (v: string) => void;
}) {
  const shown = options.find(([v]) => v === value)?.[2] ?? value;
  return (
    <span className="choice">
      <span aria-hidden>{shown}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </span>
  );
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
    setPlanning("reading the document");
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
        setPlanning("checking the size");
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

    const n = plan.chunks.length;
    const initial: Part[] = plan.chunks.map((chunk, i) => ({
      label: n === 1 ? "your document" : `pages ${chunk.firstPage}–${chunk.lastPage}`,
      chunk,
      keyIndex: assignment[i].keyIndex,
      state: "waiting",
      progress: 0,
    }));
    setParts(initial);
    const update = (i: number, patch: Partial<Part>) =>
      setParts((prev) =>
        prev.map((p, j) =>
          j === i
            ? { ...p, ...patch, progress: Math.max(p.progress, patch.progress ?? p.progress) }
            : p
        )
      );

    const results = await Promise.all(
      initial.map(async (part, i): Promise<Blob | null> => {
        try {
          const filename = n === 1 ? `${baseName}.${extension}` : `${baseName}_part${i + 1}of${n}.pdf`;
          const viaBlob =
            status.blobEnabled &&
            status.maxRequestBytes !== null &&
            part.chunk.bytes > status.maxRequestBytes;
          update(i, { state: "sending" });
          const handle = await startTranslation(
            part.chunk.file,
            filename,
            { keyIndex: part.keyIndex, sourceLang, targetLang, outputFormat: outExt, viaBlob },
            (pct) => update(i, { progress: (pct / 100) * 0.15 })
          );
          update(i, { state: "waiting in line", progress: 0.18 });
          // Progress while DeepL works: measured against its first time estimate.
          let firstEstimate = 0;
          let creep = 0.2;
          const final = await waitForTranslation(handle, (s) => {
            if (s.status === "translating") {
              const left = s.secondsRemaining ?? 0;
              if (left > 0 && !firstEstimate) firstEstimate = left;
              creep = Math.min(0.9, creep + 0.03);
              const progress = firstEstimate
                ? 0.2 + 0.75 * Math.max(0, 1 - left / firstEstimate)
                : creep;
              update(i, { state: "translating", progress, secondsLeft: left || undefined });
            }
          });
          update(i, {
            state: "fetching",
            progress: 0.97,
            secondsLeft: undefined,
            billed: final.billedCharacters,
          });
          const blob = await downloadTranslation(handle);
          update(i, { state: "done", done: true, progress: 1, result: blob });
          return blob;
        } catch (e) {
          update(i, { state: "failed", error: e instanceof Error ? e.message : String(e) });
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
  const overall = parts.length ? parts.reduce((a, p) => a + p.progress, 0) / parts.length : 0;
  const secondsLeft = Math.max(0, ...parts.map((p) => p.secondsLeft ?? 0));
  const partsDone = parts.filter((p) => p.done).length;
  const failedParts = parts.filter((p) => p.error);
  const stepText = stage === "drop" ? "1 / 3" : stage === "review" ? "2 / 3" : "3 / 3";

  const big = dragging
    ? "release"
    : stage === "drop"
      ? "translate"
      : stage === "review"
        ? plan
          ? "ready"
          : planError
            ? "hmm"
            : "reading"
        : stage === "working"
          ? `${Math.round(overall * 100)}%`
          : stage === "done"
            ? "done"
            : "stopped";

  const sentence = (
    <p className="mt-3 text-base leading-loose text-mute">
      from <Choice label="Written in" value={sourceLang} options={SOURCE_LANGS} onChange={setSourceLang} /> into{" "}
      <Choice label="Translate into" value={targetLang} options={TARGET_LANGS} onChange={setTargetLang} />{" "}
      {file && !isPdf ? (
        "in the same format"
      ) : (
        <>
          as <Choice label="Save as" value={outputFormat} options={FORMATS} onChange={setOutputFormat} />
        </>
      )}
    </p>
  );

  const banner =
    offerPasskey && view === "main" && !running ? (
      <p className="mt-4 text-center text-sm text-mute">
        {passkeyNote || "Sign in with your fingerprint or face next time?"}{" "}
        {!passkeyAdded && (
          <button onClick={setUpPasskey} className="lnk ml-2 text-ink">
            set it up
          </button>
        )}
        <button onClick={dismissPasskeyOffer} className="lnk ml-4">
          {passkeyAdded ? "close" : "not now"}
        </button>
      </p>
    ) : null;

  return (
    <Shell
      banner={banner}
      actions={
        <button
          onClick={() => setView(view === "main" ? "account" : "main")}
          disabled={running}
          className="lnk text-mute no-underline hover:underline"
        >
          {view === "main" ? "account" : "← back"}
        </button>
      }
      footer={
        view === "main" && (stage === "drop" || stage === "review") ? (
          // Only where there's a mouse: phones can't drag files in.
          <span className="hidden pointer-fine:inline">or drop a file anywhere</span>
        ) : null
      }
    >
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
        <div className="flex max-w-3xl flex-col items-center">
          <p className="step">{stepText}</p>
          <h1 className="big mt-5" aria-live="polite">
            {big}
          </h1>

          {stage === "drop" && (
            <>
              <p className="mt-6 text-lg">a PDF, Word, PowerPoint, Excel or text file</p>
              {sentence}
              <div className="mt-11">
                <button onClick={pickFile} className="act">
                  Choose document →
                </button>
              </div>
            </>
          )}

          {stage === "review" && (
            <>
              <p className="mt-6 text-lg break-all">
                {file!.name}
                {analysis && ` — ${analysis.pageCount} page${analysis.pageCount === 1 ? "" : "s"}`}
                {plan && ` — about ${fmt(totalCost)} characters`}
              </p>
              {sentence}
              {sourceLang === "" && (
                <p className="mt-2 max-w-md text-sm text-mute">
                  Mixed languages, like an English abstract before French text? Set “from” to the
                  main language.
                </p>
              )}
              {planError && <p className="mt-4 max-w-md text-sm">{planError}</p>}
              {!plan && !planError && <p className="mt-4 text-sm text-mute">{planning}…</p>}
              {plan && plan.chunks.length > 1 && (
                <p className="mt-4 text-sm text-mute">
                  It&apos;s a large file, so it goes in {plan.chunks.length} parts and comes back as one.
                </p>
              )}
              {shortOfQuota && (
                <p className="mt-4 text-sm font-medium">
                  There may not be enough allowance left this month for this one.
                </p>
              )}
              {keys.length === 0 && status && (
                <p className="mt-4 text-sm font-medium">Translation isn&apos;t set up yet.</p>
              )}
              <div className="mt-11 flex flex-wrap items-baseline justify-center gap-9">
                <button onClick={translate} disabled={!plan || keys.length === 0} className="act">
                  Translate →
                </button>
                <button onClick={pickFile} className="lnk text-mute">
                  replace file
                </button>
              </div>
            </>
          )}

          {stage === "working" && (
            <>
              <p className="mt-6 text-lg break-all">translating {file!.name}</p>
              <p className="mt-3 text-mute">
                {parts.length > 1 && `${partsDone} of ${parts.length} parts done · `}
                {secondsLeft > 0 ? `about ${secondsLeft}s left` : "this usually takes a minute or two"}
              </p>
              <p className="mt-11 text-mute">keep this page open</p>
            </>
          )}

          {stage === "done" && (
            <>
              <p className="mt-6 text-lg break-all">{finalFile!.name} is in your downloads</p>
              {totalBilled > 0 && (
                <p className="mt-3 text-mute">used {fmt(totalBilled)} characters</p>
              )}
              <div className="mt-11 flex flex-wrap items-baseline justify-center gap-9">
                <button onClick={() => chooseFile(null)} className="act">
                  Translate another →
                </button>
                <button onClick={() => saveFile(finalFile!.blob, finalFile!.name)} className="lnk text-mute">
                  download again
                </button>
              </div>
            </>
          )}

          {stage === "failed" && (
            <>
              <p className="mt-6 max-w-xl text-lg">{runError}</p>
              {failedParts.map((p, i) => (
                <p key={i} className="mt-2 max-w-xl text-sm text-mute">
                  {parts.length > 1 && `${p.label}: `}
                  {p.error}
                </p>
              ))}
              {parts.length > 1 && parts.some((p) => p.result) && (
                <p className="mt-4 flex flex-wrap justify-center gap-x-5 text-sm">
                  {parts.map(
                    (p, i) =>
                      p.result && (
                        <button
                          key={i}
                          className="lnk"
                          onClick={() =>
                            saveFile(p.result!, `${baseName}_translated_part${i + 1}of${parts.length}.${outExt}`)
                          }
                        >
                          download {p.label}
                        </button>
                      )
                  )}
                </p>
              )}
              <div className="mt-11 flex flex-wrap items-baseline justify-center gap-9">
                <button onClick={translate} className="act">
                  Try again →
                </button>
                <button onClick={() => chooseFile(null)} className="lnk text-mute">
                  choose another file
                </button>
              </div>
            </>
          )}
        </div>
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
  const rows: { choice: KeyChoice; title: string; detail: string; disabled?: boolean }[] = [
    ...(keys.length > 1
      ? [{ choice: "auto" as KeyChoice, title: "automatic", detail: "whichever has the most left" }]
      : []),
    ...keys.map((k) => ({
      choice: k.index as KeyChoice,
      title: k.label,
      detail: k.error
        ? k.error
        : k.limit !== null
          ? `${fmt(remaining(k))} left of ${fmt(k.limit)}`
          : "",
      disabled: !!k.error,
    })),
  ];
  const inUse = (c: KeyChoice) => choice === c || (keys.length === 1 && c !== "auto");

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      <p className="step">settings</p>
      <h1 className="big mt-5">account</h1>

      <section className="mt-14 w-full">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="step">monthly allowance</h2>
          <button onClick={onRefresh} disabled={refreshing} className="lnk text-sm text-mute">
            {refreshing ? "refreshing" : "refresh"}
          </button>
        </div>
        {statusError && <p className="text-sm">{statusError}</p>}
        {noKeys && (
          <p className="text-sm">
            No DeepL keys are configured. Add DEEPL_API_KEY_1 and DEEPL_API_KEY_2 in Vercel.
          </p>
        )}
        <ul className="border-t border-line">
          {rows.map((r) => (
            <li key={String(r.choice)} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-left">
              <span>
                {r.title}
                <span className="block text-sm text-mute tabular-nums">{r.detail}</span>
              </span>
              {inUse(r.choice) ? (
                <span className="text-sm font-medium">in use</span>
              ) : (
                <button
                  onClick={() => onChoose(r.choice)}
                  disabled={r.disabled}
                  className="lnk text-sm text-mute"
                >
                  use this
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-12 w-full">
        <PasskeyPanel />
      </div>

      <button onClick={onSignOut} className="act mt-14">
        Sign out
      </button>
    </div>
  );
}
