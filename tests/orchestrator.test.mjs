import assert from "node:assert/strict";
import test from "node:test";
import { handleApiRequest, testing } from "../server/orchestrator.mjs";

function modelResponse(text, usage = { input_tokens: 100, output_tokens: 50, total_tokens: 150 }) {
  return new Response(
    JSON.stringify({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text }],
        },
      ],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function parseEvents(response) {
  return response
    .text()
    .then((text) => text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

test("reports whether the OpenAI API is configured", async () => {
  const missing = await handleApiRequest(new Request("https://office.test/api/status"), {});
  const configured = await handleApiRequest(
    new Request("https://office.test/api/status"),
    { OPENAI_API_KEY: "test-key" },
  );

  assert.equal((await missing.json()).configured, false);
  assert.equal((await configured.json()).configured, true);
});

test("normalizes the last planned task into a reviewer", () => {
  const plan = testing.normalizePlan(
    {
      summary: "Plan",
      tasks: [
        {
          id: "discover",
          role: "researcher",
          title: "Discover",
          instructions: "Find facts",
          depends_on: [],
        },
        {
          id: "draft",
          role: "developer",
          title: "Draft",
          instructions: "Create the answer",
          depends_on: [],
        },
      ],
    },
    "eco",
  );

  assert.equal(plan.tasks[0].agentId, "ava");
  assert.equal(plan.tasks[1].role, "reviewer");
  assert.equal(plan.tasks[1].agentId, "maya");
  assert.deepEqual(plan.tasks[1].dependsOn, ["discover"]);
});

test("streams a real plan, task progress, token usage, and final result", async () => {
  const calls = [];
  const fetchImpl = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) {
      return modelResponse(
        JSON.stringify({
          summary: "Two compact steps",
          tasks: [
            {
              id: "research",
              role: "researcher",
              title: "Research",
              instructions: "Collect the essentials",
              depends_on: [],
            },
            {
              id: "review",
              role: "reviewer",
              title: "Final answer",
              instructions: "Review and answer",
              depends_on: ["research"],
            },
          ],
        }),
      );
    }
    if (calls.length === 2) return modelResponse("Research result");
    return modelResponse("Final useful answer");
  };

  const request = new Request("https://office.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Prepare a short launch checklist",
      mode: "eco",
      budget: 6000,
    }),
  });
  const response = await handleApiRequest(
    request,
    { OPENAI_API_KEY: "test-key" },
    { fetchImpl },
  );
  const events = await parseEvents(response);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].model, "gpt-5.6-terra");
  assert.equal(calls[1].model, "gpt-5.6-luna");
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "run_started",
      "plan_ready",
      "task_started",
      "task_completed",
      "task_started",
      "task_completed",
      "run_completed",
    ],
  );
  assert.equal(events.at(-1).result, "Final useful answer");
  assert.equal(events.at(-1).usage.total, 450);
});

test("returns a streamed setup error when the server key is missing", async () => {
  const request = new Request("https://office.test/api/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Do something useful", mode: "eco", budget: 6000 }),
  });
  const response = await handleApiRequest(request, {});
  const events = await parseEvents(response);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, "run_error");
  assert.match(events[0].message, /OPENAI_API_KEY/);
});
