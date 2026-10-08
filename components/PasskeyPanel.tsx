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
  const [message, setMessage] = useState("");
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
    setMessage("");
    try {
      await addPasskey();
      setMessage("Added. Next time, sign in with your fingerprint or face.");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };

  const remove = async (p: PasskeySummary) => {
    if (!confirm(`Remove the passkey "${p.name}"? That device will need the password again.`)) return;
    await fetch(`/api/passkeys?id=${encodeURIComponent(p.id)}`, { method: "DELETE" });
    await load();
  };

  return (
    <section className="w-full">
      <h2 className="step mb-3">passkeys</h2>
      {list && list.length > 0 ? (
        <ul className="border-t border-line">
          {list.map((p) => (
            <li key={p.id} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-left">
              <span>
                {p.name}
                <span className="block text-sm text-mute">
                  added {when(p.createdAt)} · last used {when(p.lastUsedAt)}
                </span>
              </span>
              <button onClick={() => remove(p)} className="lnk text-sm text-mute">
                remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        list && <p className="text-mute">None yet.</p>
      )}
      {supported && (
        <button onClick={add} disabled={busy} className="lnk mt-4">
          {busy ? "waiting for your device…" : "add this device"}
        </button>
      )}
      {message && <p className="mt-3 text-sm">{message}</p>}
    </section>
  );
}
