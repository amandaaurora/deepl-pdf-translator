import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

// Remembers that this browser has a passkey, so the login page can lead with it.
const FLAG = "passkeyOnThisDevice";

export type PasskeySummary = { id: string; name: string; createdAt: string; lastUsedAt?: string };

export function passkeysSupported() {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";
}

export function hasPasskeyHere() {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

function markPasskeyHere() {
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    // ignore
  }
}

// A readable name such as "iPhone · Safari" for the list of passkeys.
export function deviceName() {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  return browser ? `${device} · ${browser}` : device;
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function friendly(e: unknown): Error {
  if (e instanceof Error && e.name === "NotAllowedError") {
    return new Error("Cancelled, or no passkey for this site on this device.");
  }
  if (e instanceof Error && e.name === "InvalidStateError") {
    return new Error("This device already has a passkey for this site.");
  }
  return e instanceof Error ? e : new Error(String(e));
}

export async function addPasskey() {
  try {
    const optionsJSON = await post("/api/passkeys/register/options");
    const response = await startRegistration({ optionsJSON });
    await post("/api/passkeys/register/verify", { response, name: deviceName() });
    markPasskeyHere();
  } catch (e) {
    throw friendly(e);
  }
}

export async function signInWithPasskey() {
  try {
    const optionsJSON = await post("/api/passkeys/login/options");
    const response = await startAuthentication({ optionsJSON });
    await post("/api/passkeys/login/verify", { response });
    markPasskeyHere();
  } catch (e) {
    throw friendly(e);
  }
}
