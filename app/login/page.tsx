"use client";

import { useState } from "react";
import { Shell } from "@/components/Shell";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next?.startsWith("/") && !next.startsWith("//") ? next : "/";
      return;
    }
    const data = await res?.json().catch(() => null);
    setError(data?.error || "Couldn't sign in");
    setBusy(false);
  };

  return (
    <Shell>
      <div className="grid md:grid-cols-2">
        <form
          onSubmit={submit}
          className="flex flex-col justify-between gap-10 px-5 py-8 md:border-r md:border-line md:px-6 md:py-10"
        >
          <div>
            <p className="micro">[ 00 ] Entrance</p>
            <h1 className="display mt-6">
              Private
              <br />
              access.
            </h1>
          </div>
          <div>
            <label className="field">
              <span className="micro">01 / Password</span>
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error && <p className="mt-3 text-sm text-alert">{error}</p>}
            <button type="submit" disabled={!password || busy} className="pill pill-solid mt-6">
              {busy ? "Signing in" : "Enter →"}
            </button>
          </div>
        </form>
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
