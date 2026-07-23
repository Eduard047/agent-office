import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  getCodexStatus,
  handleLocalApiRequest,
  parseCodexJsonl,
} from "../server/codex-local.mjs";

function parseEvents(response) {
  return response
    .text()
    .then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

test("detects ChatGPT subscription authentication without exposing credentials", async () => {
  const status = await getCodexStatus({
    runProcess: async () => ({
      code: 0,
      stdout: "Logged in using ChatGPT\n",
      stderr: "",
    }),
  });

  assert.equal(status.configured, true);
  assert.equal(status.provider, "codex");
  assert.equal(status.subscription, "ChatGPT");
});

test("extracts the structured final message and Codex usage", () => {
  const parsed = parseCodexJsonl(
    [
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: '{"final_answer":"done"}' },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1200,
          output_tokens: 80,
          reasoning_output_tokens: 20,
          cached_input_tokens: 300,
        },
      }),
    ].join("\n"),
  );

  assert.equal(parsed.message, '{"final_answer":"done"}');
  assert.deepEqual(parsed.usage, {
    input: 1200,
    output: 100,
    total: 1300,
    cached: 300,
  });
});

test("streams a subscription-backed Codex run into office task events", async () => {
  const spawnImpl = (_command, args) => {
    assert.ok(args.includes("gpt-5.6-luna"));
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      return true;
    };

    queueMicrotask(() => {
      child.stdout.write(
        `${JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: JSON.stringify({
              summary: "Compact team run",
              tasks: [
                { title: "Research", result: "Facts" },
                { title: "Solution", result: "Draft" },
                { title: "Review", result: "Checked" },
              ],
              final_answer: "Final answer",
            }),
          },
        })}\n`,
      );
      child.stdout.write(
        `${JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 1500, output_tokens: 100, reasoning_output_tokens: 0 },
        })}\n`,
      );
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };

  const request = new Request("http://localhost/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Prepare a compact launch checklist",
      mode: "eco",
    }),
  });
  const response = await handleLocalApiRequest(request, {
    runProcess: async () => ({
      code: 0,
      stdout: "Logged in using ChatGPT",
      stderr: "",
    }),
    spawnImpl,
  });
  const events = await parseEvents(response);

  assert.equal(events[0].type, "run_started");
  assert.equal(events[1].type, "plan_ready");
  assert.equal(events.filter((event) => event.type === "task_started").length, 3);
  assert.equal(events.filter((event) => event.type === "task_completed").length, 3);
  assert.equal(events.at(-1).type, "run_completed");
  assert.equal(events.at(-1).result, "Final answer");
  assert.equal(events.at(-1).usage.total, 1600);
});
