import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { startLocalAppServer } from "../server/local-app-server.mjs";

test("serves the packaged app and keeps the server on loopback", async (context) => {
  const clientRoot = await mkdtemp(path.join(tmpdir(), "agent-office-client-"));
  await writeFile(path.join(clientRoot, "index.html"), "<h1>Agent Office</h1>");
  await writeFile(path.join(clientRoot, "asset.txt"), "asset");

  const { server, url } = await startLocalAppServer({
    clientRoot,
    apiHandler: async () => null,
  });
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(clientRoot, { recursive: true, force: true });
  });

  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(await fetch(`${url}/asset.txt`).then((response) => response.text()), "asset");
  assert.equal(
    await fetch(`${url}/some/app/route`, {
      headers: { accept: "text/html" },
    }).then((response) => response.text()),
    "<h1>Agent Office</h1>",
  );
});
