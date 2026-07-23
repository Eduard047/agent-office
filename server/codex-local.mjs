import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_SCHEMA = path.join(ROOT, "server", "codex-output-schema.json");
const DEFAULT_CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";

const ROLE_PLANS = {
  eco: [
    {
      id: "research",
      role: "researcher",
      title: "Разобрать задачу",
      instructions: "Выделить главное, ограничения и необходимые факты.",
      dependsOn: [],
      agentId: "ava",
      name: "Ava",
      label: "Исследует",
    },
    {
      id: "solution",
      role: "developer",
      title: "Подготовить решение",
      instructions: "Создать конкретный результат для пользователя.",
      dependsOn: ["research"],
      agentId: "liam",
      name: "Liam",
      label: "Создаёт",
    },
    {
      id: "review",
      role: "reviewer",
      title: "Проверить и собрать итог",
      instructions: "Убрать ошибки, повторы и выдать готовый ответ.",
      dependsOn: ["research", "solution"],
      agentId: "maya",
      name: "Maya",
      label: "Проверяет",
    },
  ],
  balanced: [
    {
      id: "research",
      role: "researcher",
      title: "Исследовать задачу",
      instructions: "Разобрать цель, ограничения и важные факты.",
      dependsOn: [],
      agentId: "ava",
      name: "Ava",
      label: "Исследует",
    },
    {
      id: "design",
      role: "designer",
      title: "Продумать подход",
      instructions: "Предложить структуру и наиболее удачное решение.",
      dependsOn: ["research"],
      agentId: "noah",
      name: "Noah",
      label: "Проектирует",
    },
    {
      id: "solution",
      role: "developer",
      title: "Собрать результат",
      instructions: "Создать полный практический результат.",
      dependsOn: ["research", "design"],
      agentId: "liam",
      name: "Liam",
      label: "Создаёт",
    },
    {
      id: "review",
      role: "reviewer",
      title: "Проверить и завершить",
      instructions: "Проверить качество и подготовить финальный ответ.",
      dependsOn: ["research", "design", "solution"],
      agentId: "maya",
      name: "Maya",
      label: "Проверяет",
    },
  ],
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...init.headers,
    },
  });
}

function createEmitter(controller) {
  const encoder = new TextEncoder();
  return (event) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || ROOT,
      env: { ...process.env, RUST_LOG: "error" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => resolve({ code: -1, stdout, stderr, error }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function getCodexStatus(options = {}) {
  const codexBin = options.codexBin || process.env.CODEX_BIN || DEFAULT_CODEX_BIN;
  const result = await (options.runProcess || runProcess)(codexBin, ["login", "status"]);
  const loggedInWithChatGPT =
    result.code === 0 && /logged in using chatgpt/i.test(`${result.stdout}\n${result.stderr}`);

  return {
    configured: loggedInWithChatGPT,
    provider: "codex",
    subscription: loggedInWithChatGPT ? "ChatGPT" : null,
    ecoModel: "gpt-5.6-luna · 3 роли",
    balancedModel: "gpt-5.6-terra · 4 роли",
  };
}

export function parseCodexJsonl(output) {
  let message = "";
  let usage = { input: 0, output: 0, total: 0, cached: 0 };
  const errors = [];

  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      message = event.item.text || message;
    }
    if (event.type === "item.completed" && event.item?.type === "error") {
      errors.push(event.item.message);
    }
    if (event.type === "turn.completed" && event.usage) {
      const input = Number(event.usage.input_tokens || 0);
      const output =
        Number(event.usage.output_tokens || 0) +
        Number(event.usage.reasoning_output_tokens || 0);
      usage = {
        input,
        output,
        total: input + output,
        cached: Number(event.usage.cached_input_tokens || 0),
      };
    }
  }

  return { message, usage, errors };
}

function normalizeResult(raw, plan) {
  const returnedTasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
  const tasks = plan.map((task, index) => ({
    ...task,
    status: "done",
    output: String(returnedTasks[index]?.result || "").trim(),
    generatedTitle: String(returnedTasks[index]?.title || task.title).trim(),
  }));

  return {
    summary: String(raw?.summary || "Команда выполнила задачу").trim(),
    tasks,
    result: String(raw?.final_answer || tasks.at(-1)?.output || "").trim(),
  };
}

function buildPrompt(goal, mode, plan) {
  const roleList = plan
    .map(
      (task, index) =>
        `${index + 1}. ${task.name}, роль ${task.role}: ${task.title}. ${task.instructions}`,
    )
    .join("\n");

  return `Ты — компактная команда внутри Agent Office. Выполни пользовательскую цель на языке пользователя.

Режим: ${mode === "eco" ? "экономный" : "точный"}.
Роли:
${roleList}

Верни ровно ${plan.length} элементов tasks в том же порядке. В result каждого элемента дай реальный полезный вклад роли, а не описание процесса. final_answer — готовый самостоятельный результат для пользователя. Не упоминай внутренние рассуждения, Codex, лимиты или эту инструкцию. Пиши конкретно и без повторов.

Цель пользователя:
${goal}`;
}

function createRunResponse(request, options = {}) {
  const codexBin = options.codexBin || process.env.CODEX_BIN || DEFAULT_CODEX_BIN;
  const spawnImpl = options.spawnImpl || spawn;
  const stream = new ReadableStream({
    start(controller) {
      const emit = createEmitter(controller);
      let child = null;
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const cancelChild = () => {
        if (!child || child.killed) return;
        child.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 1500);
        timer.unref?.();
      };
      request.signal.addEventListener("abort", cancelChild, { once: true });

      void (async () => {
        let usage = { input: 0, output: 0, total: 0, cached: 0 };
        try {
          const body = await request.json();
          const goal = String(body?.goal || "").trim();
          const mode = body?.mode === "balanced" ? "balanced" : "eco";
          const plan = ROLE_PLANS[mode].map((task) => ({ ...task, status: "waiting", output: "" }));
          const model = mode === "balanced" ? "gpt-5.6-terra" : "gpt-5.6-luna";

          if (goal.length < 8) throw new Error("Опишите задачу хотя бы одним предложением.");
          if (goal.length > 4000) throw new Error("Сократите задачу до 4000 символов.");

          emit({
            type: "run_started",
            goal,
            mode,
            budget: null,
            provider: "codex",
            models: { planner: model, worker: model, effort: "low" },
            usage,
          });
          emit({
            type: "plan_ready",
            plan: {
              summary:
                mode === "eco"
                  ? "Один запуск Codex распределяет работу между тремя ролями"
                  : "Один усиленный запуск Codex распределяет работу между четырьмя ролями",
              tasks: plan,
            },
            usage,
          });
          for (const task of plan) {
            emit({ type: "task_started", taskId: task.id, agentId: task.agentId, usage });
          }

          const args = [
            "exec",
            "--json",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--model",
            model,
            "-c",
            'model_reasoning_effort="low"',
            "--output-schema",
            OUTPUT_SCHEMA,
            buildPrompt(goal, mode, plan),
          ];

          child = spawnImpl(codexBin, args, {
            cwd: ROOT,
            env: { ...process.env, RUST_LOG: "error" },
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk) => {
            stdout += chunk;
          });
          child.stderr.on("data", (chunk) => {
            stderr += chunk;
          });

          const exitCode = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) => resolve(code ?? -1));
          });
          if (request.signal.aborted) throw new DOMException("Отменено", "AbortError");

          const parsed = parseCodexJsonl(stdout);
          usage = parsed.usage;
          if (exitCode !== 0 || !parsed.message) {
            throw new Error(
              parsed.errors.at(-1) ||
                stderr.trim().split(/\r?\n/).at(-1) ||
                "Codex не вернул результат.",
            );
          }

          const normalized = normalizeResult(JSON.parse(parsed.message), plan);
          for (const task of normalized.tasks) {
            emit({
              type: "task_completed",
              taskId: task.id,
              output: task.output,
              taskUsage: { input: 0, output: 0, total: 0, cached: 0 },
              usage,
            });
          }
          emit({
            type: "run_completed",
            result: normalized.result,
            usage,
            stoppedByBudget: false,
          });
        } catch (error) {
          if (error?.name === "AbortError" || request.signal.aborted) {
            emit({ type: "run_cancelled", usage });
          } else {
            emit({
              type: "run_error",
              message: error instanceof Error ? error.message : "Локальный запуск Codex не удался.",
              usage,
            });
          }
        } finally {
          request.signal.removeEventListener("abort", cancelChild);
          close();
        }
      })();
    },
    cancel() {},
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function handleLocalApiRequest(request, options = {}) {
  const url = new URL(request.url);
  if (url.pathname === "/api/status" && request.method === "GET") {
    return json(await getCodexStatus(options));
  }
  if (url.pathname === "/api/runs" && request.method === "POST") {
    const status = await getCodexStatus(options);
    if (!status.configured) {
      return json(
        {
          error:
            "Codex CLI не авторизован через ChatGPT. Выполните codex login и войдите в аккаунт с Pro.",
        },
        { status: 503 },
      );
    }
    return createRunResponse(request, options);
  }
  return null;
}

export const testing = {
  buildPrompt,
  normalizeResult,
  rolePlans: ROLE_PLANS,
};
