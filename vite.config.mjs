import { Readable } from "node:stream";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { handleLocalApiRequest } from "./server/codex-local.mjs";
import { handleApiRequest } from "./server/orchestrator.mjs";

function apiPlugin(env) {
  return {
    name: "agent-office-api",
    configureServer(server) {
      server.middlewares.use(async (nodeRequest, nodeResponse, next) => {
        const requestUrl = new URL(nodeRequest.url || "/", "http://localhost");
        if (!requestUrl.pathname.startsWith("/api/")) return next();

        try {
          const chunks = [];
          for await (const chunk of nodeRequest) chunks.push(chunk);
          const abortController = new AbortController();
          const abortUpstream = () => abortController.abort();
          nodeRequest.once("aborted", abortUpstream);
          nodeResponse.once("close", () => {
            if (!nodeResponse.writableEnded) abortUpstream();
          });
          const request = new Request(requestUrl, {
            method: nodeRequest.method,
            headers: nodeRequest.headers,
            body: chunks.length ? Buffer.concat(chunks) : undefined,
            duplex: chunks.length ? "half" : undefined,
            signal: abortController.signal,
          });
          const response =
            (await handleLocalApiRequest(request)) || (await handleApiRequest(request, env));
          if (!response) return next();

          nodeResponse.statusCode = response.status;
          for (const [key, value] of response.headers) nodeResponse.setHeader(key, value);
          if (!response.body) return nodeResponse.end();

          Readable.fromWeb(response.body).pipe(nodeResponse);
        } catch (error) {
          server.config.logger.error(error);
          nodeResponse.statusCode = 500;
          nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
          nodeResponse.end(JSON.stringify({ error: "Local API middleware failed." }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), "") };

  return {
    build: {
      outDir: "dist/client",
    },
    optimizeDeps: {
      include: ["react", "react-dom/client"],
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      warmup: {
        clientFiles: ["./src/main.jsx"],
      },
    },
    plugins: [apiPlugin(env), react()],
  };
});
