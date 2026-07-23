import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  getCodexStatus,
  handleLocalApiRequest,
  parseCodexJsonl,
  routeRequest,
  testing,
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
    queryAccountUsage: async () => ({
      planType: "pro",
      primary: { usedPercent: 35, remainingPercent: 65 },
      lifetimeTokens: 123456,
    }),
  });

  assert.equal(status.configured, true);
  assert.equal(status.provider, "codex");
  assert.equal(status.subscription, "ChatGPT");
  assert.equal(status.accountUsage.primary.remainingPercent, 65);
});

test("normalizes subscription usage as remaining rate-limit percentage", () => {
  const usage = testing.normalizeAccountUsage(
    {
      rateLimits: {
        limitId: "codex",
        planType: "pro",
        primary: { usedPercent: 72, windowDurationMins: 10080, resetsAt: 1234 },
        secondary: null,
        credits: { hasCredits: false, unlimited: false, balance: "0" },
      },
      rateLimitsByLimitId: null,
    },
    {
      summary: { lifetimeTokens: 987654, peakDailyTokens: 123456 },
      dailyUsageBuckets: [
        { startDate: "2026-07-21", tokens: 1200 },
        { startDate: "2026-07-22", tokens: 3400 },
      ],
    },
  );

  assert.equal(usage.planType, "pro");
  assert.equal(usage.primary.remainingPercent, 28);
  assert.equal(usage.lifetimeTokens, 987654);
  assert.equal(usage.lastSevenDaysTokens, 4600);
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

test("routes simple requests to Luna without spending a model call on routing", () => {
  const routing = routeRequest("Переведи это короткое предложение на английский.");

  assert.equal(routing.model, "gpt-5.6-luna");
  assert.equal(routing.effort, "none");
  assert.equal(routing.roles, 3);
  assert.equal(routing.automatic, true);
});

test("routes ordinary multi-step work to Terra", () => {
  const routing = routeRequest(
    "Исследуй варианты, сравни их и подготовь рекомендации для запуска продукта.",
  );

  assert.equal(routing.model, "gpt-5.6-terra");
  assert.equal(routing.effort, "medium");
  assert.equal(routing.roles, 4);
});

test("routes complex quality-first work to Sol", () => {
  const routing = routeRequest(
    "Спроектируй сложную архитектуру сервиса, проведи аудит безопасности и подготовь полную миграцию в продакш.",
  );

  assert.equal(routing.model, "gpt-5.6-sol");
  assert.equal(routing.effort, "high");
  assert.equal(routing.roles, 4);
});

test("respects manual model and reasoning power overrides including Ultra", () => {
  const routing = routeRequest("Придумай короткое название.", "sol", "ultra");

  assert.equal(routing.model, "gpt-5.6-sol");
  assert.equal(routing.effort, "ultra");
  assert.equal(routing.effortLabel, "Ультра");
  assert.equal(routing.automatic, false);
  assert.match(routing.reason, /вручную/);
});

test("streams a subscription-backed Codex run into office task events", async () => {
  let attachedImagePath = "";
  const spawnImpl = (_command, args) => {
    assert.ok(args.includes("gpt-5.6-luna"));
    const imageFlag = args.indexOf("--image");
    assert.ok(imageFlag > -1);
    attachedImagePath = args[imageFlag + 1];
    assert.equal(readFileSync(attachedImagePath).subarray(0, 3).toString(), "GIF");
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
      model: "luna",
      effort: "auto",
      images: [
        {
          name: "reference.gif",
          dataUrl:
            "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
        },
      ],
    }),
  });
  const response = await handleLocalApiRequest(request, {
    runProcess: async () => ({
      code: 0,
      stdout: "Logged in using ChatGPT",
      stderr: "",
    }),
    queryAccountUsage: async () => null,
    spawnImpl,
  });
  const events = await parseEvents(response);

  assert.equal(events[0].type, "run_started");
  assert.equal(events[0].routing.modelLabel, "Luna");
  assert.equal(events[0].routing.effort, "low");
  assert.equal(events[1].type, "plan_ready");
  assert.equal(events.filter((event) => event.type === "task_started").length, 3);
  assert.equal(events.filter((event) => event.type === "task_completed").length, 3);
  assert.equal(events.at(-1).type, "run_completed");
  assert.equal(events.at(-1).result, "Final answer");
  assert.equal(events.at(-1).usage.total, 1600);
  assert.equal(existsSync(attachedImagePath), false);
});

test("uses visual context to choose at least Terra in auto mode", () => {
  const routing = routeRequest("Что здесь изображено?", "auto", "auto", 1);

  assert.equal(routing.model, "gpt-5.6-terra");
  assert.match(routing.reason, /изображен/i);
});
