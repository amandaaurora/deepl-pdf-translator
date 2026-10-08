"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/Shell";
import { hasPasskeyHere, passkeysSupported, signInWithPasskey } from "@/lib/client/passkeys";

function goNext() {
  const next = new URLSearchParams(window.location.search).get("next");
  window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "password" | "passkey">("");
  const [passkeys, setPasskeys] = useState<{ supported: boolean; here: boolean }>({
    supported: false,
    here: false,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPasskeys({ supported: passkeysSupported(), here: hasPasskeyHere() });
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("password");
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      // Lets the main page offer to set up a passkey on this device.
      try {
        sessionStorage.setItem("offerPasskey", "1");
      } catch {
        // ignore
      }
      return goNext();
    }
    const data = await res?.json().catch(() => null);
    setError(data?.error || "Couldn't sign in");
    setBusy("");
  };

  const usePasskey = async () => {
    setBusy("passkey");
    setError("");
    try {
      await signInWithPasskey();
      goNext();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  };

  return (
    <Shell footer="powered by DeepL">
      <div className="flex w-full max-w-sm flex-col items-center">
        <p className="step">private</p>
        <h1 className="big mt-5">enter</h1>

        {passkeys.supported && (
          <>
            <button
              type="button"
              onClick={usePasskey}
              disabled={!!busy}
              className={passkeys.here ? "act mt-12" : "lnk mt-12 text-lg"}
            >
              {busy === "passkey" ? "waiting for your device…" : "Sign in with passkey →"}
            </button>
            <p className="mt-3 text-sm text-mute">fingerprint, face or device PIN</p>
            <p className="step mt-10">or</p>
          </>
        )}

        <form onSubmit={submit} className="mt-6 flex w-full flex-col items-center">
          <label htmlFor="password" className="sr-only">
            Password
          </label>
          <input
            id="password"
            type="password"
            placeholder="password"
            autoFocus={!passkeys.here}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field placeholder:text-mute"
          />
          <button
            type="submit"
            disabled={!password || !!busy}
            className={passkeys.here ? "lnk mt-8 text-lg" : "act mt-10"}
          >
            {busy === "password" ? "signing in…" : "Enter →"}
          </button>
        </form>
        {error && <p className="mt-6 text-sm">{error}</p>}
      </div>
    </Shell>
  );
}
