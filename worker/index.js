import { handleApiRequest } from "../server/orchestrator.mjs";

async function withRequestOrigin(response, request) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = (await response.text()).replaceAll(
    "__SITE_ORIGIN__",
    new URL(request.url).origin,
  );
  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const apiResponse = await handleApiRequest(request, env);
    if (apiResponse) return apiResponse;

    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");

    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) {
      return withRequestOrigin(response, request);
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    const indexResponse = await env.ASSETS.fetch(new Request(indexUrl, request));
    return withRequestOrigin(indexResponse, request);
  },
};
