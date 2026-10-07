// Types shared between the browser and the API routes.

export type KeyInfo = {
  index: number;
  label: string;
  plan: "free" | "pro";
  // null when DeepL couldn't be reached or rejected the key
  used: number | null;
  limit: number | null;
  error?: string;
};

export type StatusResponse = {
  keys: KeyInfo[];
  // Upload via Vercel Blob when configured; otherwise straight to the API route.
  blobEnabled: boolean;
  // Largest body a single API request can carry (Vercel caps it at 4.5 MB).
  // null when there's no platform limit (e.g. running locally).
  maxRequestBytes: number | null;
};

export type DocumentHandle = {
  keyIndex: number;
  documentId: string;
  documentKey: string;
};

export type DocumentStatus = {
  status: "queued" | "translating" | "done" | "error";
  secondsRemaining?: number;
  billedCharacters?: number;
  errorMessage?: string;
};
