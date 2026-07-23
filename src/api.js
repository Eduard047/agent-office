const LOCAL_BRIDGE_ORIGINS = [
  "http://127.0.0.1:4173",
  "http://localhost:4173",
  "http://192.168.50.99:4173",
];

export const LOCAL_OFFICE_URL = LOCAL_BRIDGE_ORIGINS[0];

let apiOrigin = "";

async function fetchStatus(origin = "", timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/api/status`, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/json")) {
      throw new Error("Status endpoint is unavailable.");
    }
    return response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getApiStatus() {
  const hostedStatic = window.location.hostname.endsWith("github.io");

  if (hostedStatic) {
    for (const origin of LOCAL_BRIDGE_ORIGINS) {
      try {
        const status = await fetchStatus(origin, 1800);
        if (status?.provider === "codex") {
          apiOrigin = origin;
          return { ...status, bridgeOrigin: origin };
        }
      } catch {
        // Try the next local address. Browsers may block one loopback alias.
      }
    }

    apiOrigin = "";
    return {
      configured: false,
      provider: "static",
      subscription: null,
      accountUsage: null,
      bridgeOrigin: null,
    };
  }

  apiOrigin = "";
  return fetchStatus();
}

export async function streamRun({
  goal,
  images = [],
  model,
  effort,
  budget,
  signal,
  onEvent,
}) {
  const response = await fetch(`${apiOrigin}/api/runs`, {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify({ goal, images, model, effort, budget }),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Сервер вернул HTTP ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) onEvent(JSON.parse(line));
      newline = buffer.indexOf("\n");
    }

    if (done) break;
  }

  if (buffer.trim()) onEvent(JSON.parse(buffer));
}
