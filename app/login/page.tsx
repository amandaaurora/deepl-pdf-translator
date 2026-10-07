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
    if (res?.ok) return goNext();
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
    <Shell>
      <div className="grid md:grid-cols-2">
        <div className="flex flex-col justify-between gap-10 px-5 py-8 md:border-r md:border-line md:px-6 md:py-10">
          <div>
            <p className="micro">[ 00 ] Entrance</p>
            <h1 className="display mt-6">
              Private
              <br />
              access.
            </h1>
          </div>

          <div>
            {passkeys.supported && (
              <>
                <button
                  type="button"
                  onClick={usePasskey}
                  disabled={!!busy}
                  className={`pill ${passkeys.here ? "pill-solid" : ""}`}
                >
                  {busy === "passkey" ? "Waiting for your device" : "Sign in with passkey"}
                </button>
                <p className="mt-2 text-xs text-ink-soft">
                  Fingerprint, face or device PIN.
                </p>
                <div className="my-7 flex items-center gap-3">
                  <span className="h-px flex-1 bg-line" />
                  <span className="micro">or password</span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              </>
            )}
            <form onSubmit={submit}>
              <label className="field">
                <span className="micro">01 / Password</span>
                <input
                  type="password"
                  autoFocus={!passkeys.here}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={!password || !!busy}
                className={`pill mt-6 ${passkeys.here ? "" : "pill-solid"}`}
              >
                {busy === "password" ? "Signing in" : "Enter →"}
              </button>
            </form>
            {error && <p className="mt-4 text-sm text-alert">{error}</p>}
          </div>
        </div>
        <div className="figure figure-idle relative min-h-64 border-t border-line md:border-t-0" aria-hidden>
          <span className="crosshair" />
          <span className="corner corner-tl" />
          <span className="corner corner-br" />
          <p className="micro absolute bottom-4 left-4 text-ink md:left-5">Fig 00. Study of a closed door</p>
        </div>
      </div>
    </Shell>
  );
}
