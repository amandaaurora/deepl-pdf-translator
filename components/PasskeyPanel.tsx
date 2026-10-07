"use client";

import { useCallback, useEffect, useState } from "react";
import { addPasskey, passkeysSupported, type PasskeySummary } from "@/lib/client/passkeys";

function when(iso?: string) {
  return iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "never";
}

// Lists registered passkeys and lets you add one for this device.
export function PasskeyPanel() {
  const [list, setList] = useState<PasskeySummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [supported, setSupported] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/passkeys", { cache: "no-store" });
    if (res.ok) setList(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupported(passkeysSupported());
    load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await addPasskey();
      setMessage({ text: "Added. Next time, sign in with your fingerprint or face." });
      await load();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    }
    setBusy(false);
  };

  const remove = async (p: PasskeySummary) => {
    if (!confirm(`Remove the passkey "${p.name}"? That device will need the password again.`)) return;
    await fetch(`/api/passkeys?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    await load();
  };

  return (
    <div className="border-b border-line px-5 py-6 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="micro">Index_05 · Passkeys</p>
        {supported && (
          <button onClick={add} disabled={busy} className="pill">
            {busy ? "Waiting for your device" : "+ Add this device"}
          </button>
        )}
      </div>
      {list && list.length > 0 ? (
        <ul className="mt-4 border-t border-line text-sm">
          {list.map((p, i) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-2.5">
              <span>
                <span className="micro mr-3">{String(i + 1).padStart(2, "0")}</span>
                {p.name}
                <span className="text-ink-soft">
                  {" "}
                  · added {when(p.createdAt)} · last used {when(p.lastUsedAt)}
                </span>
              </span>
              <button onClick={() => remove(p)} className="micro link">
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        list && (
          <p className="mt-3 text-sm text-ink-soft">
            None yet. Add one to sign in with your fingerprint or face instead of the password.
          </p>
        )
      )}
      {message && (
        <p className={`mt-3 text-sm ${message.error ? "text-alert" : "text-ink"}`}>{message.text}</p>
      )}
    </div>
  );
}
