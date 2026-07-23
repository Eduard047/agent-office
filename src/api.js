export async function getApiStatus() {
  const response = await fetch("/api/status", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Не удалось проверить подключение к серверу.");
  return response.json();
}

export async function streamRun({ goal, model, effort, budget, signal, onEvent }) {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: {
      accept: "application/x-ndjson",
      "content-type": "application/json",
    },
    body: JSON.stringify({ goal, model, effort, budget }),
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
