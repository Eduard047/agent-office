#!/usr/bin/env node

import { createReadStream, realpathSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { handleLocalApiRequest } from "./codex-local.mjs";

const SERVER_ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SERVER_ROOT, "..");
const DEFAULT_CLIENT_ROOT = path.join(APP_ROOT, "client");
const DEFAULT_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 36 * 1024 * 1024;

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function parsePort(argv = process.argv.slice(2)) {
  const index = argv.indexOf("--port");
  if (index === -1) return 0;
  const port = Number(argv[index + 1]);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0;
}

function securityHeaders(contentType = "") {
  const headers = {
    "cache-control": contentType.includes("text/html")
      ? "no-store"
      : "public, max-age=31536000, immutable",
    "content-security-policy":
      "default-src 'self'; img-src 'self' data: blob:; font-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
      "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
  if (contentType) headers["content-type"] = contentType;
  return headers;
}

async function readRequestBody(nodeRequest) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of nodeRequest) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function writeFetchResponse(nodeResponse, response) {
  nodeResponse.statusCode = response.status;
  for (const [key, value] of response.headers) nodeResponse.setHeader(key, value);
  nodeResponse.setHeader("x-content-type-options", "nosniff");
  if (!response.body) return nodeResponse.end();
  Readable.fromWeb(response.body).pipe(nodeResponse);
}

async function resolveStaticFile(clientRoot, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const candidate = path.resolve(clientRoot, relativePath);
  const rootPrefix = `${path.resolve(clientRoot)}${path.sep}`;
  if (candidate !== path.resolve(clientRoot) && !candidate.startsWith(rootPrefix)) return null;

  try {
    const details = await stat(candidate);
    return details.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export function createLocalAppServer(options = {}) {
  const clientRoot = path.resolve(options.clientRoot || DEFAULT_CLIENT_ROOT);
  const apiHandler = options.apiHandler || handleLocalApiRequest;
  const host = options.host || DEFAULT_HOST;

  return createServer(async (nodeRequest, nodeResponse) => {
    try {
      const address = nodeRequest.socket.localAddress || host;
      const port = nodeRequest.socket.localPort;
      const requestUrl = new URL(nodeRequest.url || "/", `http://${address}:${port}`);

      if (requestUrl.pathname.startsWith("/api/")) {
        const body = await readRequestBody(nodeRequest);
        const abortController = new AbortController();
        nodeRequest.once("aborted", () => abortController.abort());
        const request = new Request(requestUrl, {
          method: nodeRequest.method,
          headers: nodeRequest.headers,
          body,
          duplex: body ? "half" : undefined,
          signal: abortController.signal,
        });
        const response = await apiHandler(request);
        if (response) return writeFetchResponse(nodeResponse, response);
      }

      if (!["GET", "HEAD"].includes(nodeRequest.method || "GET")) {
        nodeResponse.writeHead(405, securityHeaders("text/plain; charset=utf-8"));
        return nodeResponse.end("Method not allowed");
      }

      let filePath = await resolveStaticFile(clientRoot, requestUrl.pathname);
      if (!filePath && nodeRequest.headers.accept?.includes("text/html")) {
        filePath = await resolveStaticFile(clientRoot, "/index.html");
      }
      if (!filePath) {
        nodeResponse.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
        return nodeResponse.end("Not found");
      }

      const contentType =
        CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      nodeResponse.writeHead(200, securityHeaders(contentType));
      if (nodeRequest.method === "HEAD") return nodeResponse.end();
      createReadStream(filePath).pipe(nodeResponse);
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      nodeResponse.writeHead(statusCode, securityHeaders("application/json; charset=utf-8"));
      nodeResponse.end(
        JSON.stringify({
          error:
            statusCode === 413
              ? "Вложения слишком большие."
              : "Встроенный сервер Agent Office не смог обработать запрос.",
        }),
      );
    }
  });
}

export async function startLocalAppServer(options = {}) {
  const server = createLocalAppServer(options);
  const host = options.host || DEFAULT_HOST;
  const port = options.port ?? parsePort();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  const url = `http://${host}:${address.port}`;
  return { server, url };
}

const launchedDirectly =
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (launchedDirectly) {
  const { server, url } = await startLocalAppServer();
  process.stdout.write(`${JSON.stringify({ type: "ready", url })}\n`);

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
