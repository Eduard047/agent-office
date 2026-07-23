import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_SCHEMA = path.join(ROOT, "server", "codex-output-schema.json");
const DEFAULT_CODEX_BIN = "/Applications/ChatGPT.app/Contents/Resources/codex";

const MODEL_CATALOG = {
  luna: {
    id: "luna",
    model: "gpt-5.6-luna",
    label: "Luna",
    description: "Быстрые и компактные задачи",
    plan: "eco",
  },
  terra: {
    id: "terra",
    model: "gpt-5.6-terra",
    label: "Terra",
    description: "Обычные многошаговые задачи",
    plan: "balanced",
  },
  sol: {
    id: "sol",
    model: "gpt-5.6-sol",
    label: "Sol",
    description: "Самые сложные задачи",
    plan: "balanced",
  },
};

const EFFORT_LABELS = {
  none: "Без размышлений",
  low: "Низкая",
  medium: "Средняя",
  high: "Высокая",
  xhigh: "Очень высокая",
  max: "Максимальная",
  ultra: "Ультра",
};

const COMPLEX_PATTERNS = [
  /\b(architecture|security|threat model|audit|migration|production|distributed|refactor)\b/i,
  /\b(strategy|research|investigate|compare|analy[sz]e|optimi[sz]e|debug|diagnos)\w*/i,
  /\b(complete|end[- ]to[- ]end|deep|exhaustive|multi[- ]step|enterprise)\b/i,
  /(архитектур|безопасност|аудит|миграц|продакш|распредел[её]н|рефактор)/i,
  /(стратег|исслед|сравн|анализ|оптимиз|диагност|отлад|разбер)/i,
  /(полностью|под ключ|глубок|исчерпыва|многоэтап|сложн|масштаб)/i,
];

const SIMPLE_PATTERNS = [
  /\b(translate|rewrite|rephrase|summari[sz]e|shorten|proofread|name|title)\b/i,
  /(перевед|перефраз|перепиш|сократ|исправь текст|придумай назван|одним предложен)/i,
  /(быстро|коротко|просто|небольш|мелк)/i,
];

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

function normalizeAccountUsage(rateLimitResponse, usageResponse) {
  const snapshots = Object.values(rateLimitResponse?.rateLimitsByLimitId || {}).filter(Boolean);
  const rateLimits =
    snapshots.find((snapshot) => snapshot.limitId === "codex") ||
    rateLimitResponse?.rateLimits ||
    snapshots[0] ||
    null;
  const normalizeWindow = (window) =>
    window
      ? {
          usedPercent: Math.max(0, Math.min(100, Number(window.usedPercent || 0))),
          remainingPercent: Math.max(
            0,
            Math.min(100, 100 - Number(window.usedPercent || 0)),
          ),
          windowDurationMins: window.windowDurationMins ?? null,
          resetsAt: window.resetsAt ?? null,
        }
      : null;

  if (!rateLimits && !usageResponse?.summary) return null;

  return {
    planType: rateLimits?.planType || null,
    primary: normalizeWindow(rateLimits?.primary),
    secondary: normalizeWindow(rateLimits?.secondary),
    credits: rateLimits?.credits
      ? {
          hasCredits: Boolean(rateLimits.credits.hasCredits),
          unlimited: Boolean(rateLimits.credits.unlimited),
          balance: rateLimits.credits.balance ?? null,
        }
      : null,
    lifetimeTokens:
      usageResponse?.summary?.lifetimeTokens == null
        ? null
        : Number(usageResponse.summary.lifetimeTokens),
    peakDailyTokens:
      usageResponse?.summary?.peakDailyTokens == null
        ? null
        : Number(usageResponse.summary.peakDailyTokens),
  };
}

export function queryCodexAccountUsage(options = {}) {
  const codexBin = options.codexBin || process.env.CODEX_BIN || DEFAULT_CODEX_BIN;
  const spawnImpl = options.spawnImpl || spawn;

  return new Promise((resolve) => {
    let finished = false;
    let initialized = false;
    let stdout = "";
    let rateLimits = null;
    let tokenUsage = null;
    const child = spawnImpl(codexBin, ["app-server", "--stdio"], {
      cwd: ROOT,
      env: { ...process.env, RUST_LOG: "error" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (value = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (!child.killed) child.kill("SIGTERM");
      resolve(value);
    };

    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const handleLine = (line) => {
      if (!line.trim().startsWith("{")) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }

      if (message.id === 1 && message.result && !initialized) {
        initialized = true;
        send({ method: "initialized" });
        send({ method: "account/rateLimits/read", id: 2 });
        send({ method: "account/usage/read", id: 3 });
      }
      if (message.id === 2) rateLimits = message.result;
      if (message.id === 3) tokenUsage = message.result;
      if (rateLimits && tokenUsage) finish(normalizeAccountUsage(rateLimits, tokenUsage));
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let newline = stdout.indexOf("\n");
      while (newline !== -1) {
        handleLine(stdout.slice(0, newline));
        stdout = stdout.slice(newline + 1);
        newline = stdout.indexOf("\n");
      }
    });
    child.once("error", () => finish(null));
    child.once("close", () => {
      if (stdout.trim()) handleLine(stdout);
      finish(rateLimits || tokenUsage ? normalizeAccountUsage(rateLimits, tokenUsage) : null);
    });

    const timeout = setTimeout(() => finish(null), options.timeoutMs || 5000);
    timeout.unref?.();
    send({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: { name: "agent-office", title: "Agent Office", version: "1.0.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      },
    });
  });
}

export async function getCodexStatus(options = {}) {
  const codexBin = options.codexBin || process.env.CODEX_BIN || DEFAULT_CODEX_BIN;
  const result = await (options.runProcess || runProcess)(codexBin, ["login", "status"]);
  const loggedInWithChatGPT =
    result.code === 0 && /logged in using chatgpt/i.test(`${result.stdout}\n${result.stderr}`);
  const accountUsage = loggedInWithChatGPT
    ? await (options.queryAccountUsage || queryCodexAccountUsage)({
        codexBin,
        spawnImpl: options.accountSpawnImpl,
      })
    : null;

  return {
    configured: loggedInWithChatGPT,
    provider: "codex",
    subscription: loggedInWithChatGPT ? "ChatGPT" : null,
    ecoModel: "gpt-5.6-luna · 3 роли",
    balancedModel: "gpt-5.6-terra · 4 роли",
    solModel: "gpt-5.6-sol · 4 роли",
    models: Object.values(MODEL_CATALOG).map(({ id, model, label, description }) => ({
      id,
      model,
      label,
      description,
    })),
    efforts: Object.entries(EFFORT_LABELS).map(([id, label]) => ({ id, label })),
    accountUsage,
  };
}

export function routeRequest(goal, requestedModel = "auto", requestedEffort = "auto") {
  const text = String(goal || "").trim();
  let score = 0;
  const matchedComplex = COMPLEX_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const matchedSimple = SIMPLE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;

  if (text.length >= 180) score += 1;
  if (text.length >= 420) score += 1;
  if (text.length >= 900) score += 2;
  if (lineCount >= 3) score += 1;
  score += Math.min(6, matchedComplex * 2);
  if (text.length < 220) score -= matchedSimple * 2;

  const modelWasRequested = Object.hasOwn(MODEL_CATALOG, requestedModel);
  const selectedId = modelWasRequested
    ? requestedModel
    : score >= 4
      ? "sol"
      : score >= 2
        ? "terra"
        : "luna";
  const selected = MODEL_CATALOG[selectedId];

  const effortWasRequested = Object.hasOwn(EFFORT_LABELS, requestedEffort);
  let effort = requestedEffort;
  if (!effortWasRequested) {
    if (selectedId === "luna") effort = score < 0 ? "none" : "low";
    if (selectedId === "terra") effort = score >= 4 ? "high" : "medium";
    if (selectedId === "sol") effort = score >= 9 ? "xhigh" : "high";
  }

  let reason;
  if (modelWasRequested) {
    reason = `${selected.label} выбрана вручную`;
  } else if (selectedId === "luna") {
    reason = "Короткая или простая задача — достаточно быстрого компактного запуска";
  } else if (selectedId === "terra") {
    reason = "Задача требует нескольких шагов, поэтому нужен сбалансированный режим";
  } else {
    reason = "Сложная многоэтапная задача — приоритет качеству и глубокой проработке";
  }

  if (effortWasRequested) {
    reason += `; мощность «${EFFORT_LABELS[effort]}» выбрана вручную`;
  }

  return {
    automatic: !modelWasRequested,
    requestedModel,
    requestedEffort,
    modelId: selected.id,
    model: selected.model,
    modelLabel: selected.label,
    effort,
    effortLabel: EFFORT_LABELS[effort],
    reason,
    score,
    planId: selected.plan,
    roles: ROLE_PLANS[selected.plan].length,
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

function buildPrompt(goal, routing, plan) {
  const roleList = plan
    .map(
      (task, index) =>
        `${index + 1}. ${task.name}, роль ${task.role}: ${task.title}. ${task.instructions}`,
    )
    .join("\n");

  return `Ты — компактная команда внутри Agent Office. Выполни пользовательскую цель на языке пользователя.

Модельный режим: ${routing.modelLabel}; мощность рассуждения: ${routing.effortLabel}.
Роли:
${roleList}

Верни ровно ${plan.length} элементов tasks в том же порядке. В result каждого элемента дай реальный полезный вклад роли, а не описание процесса. final_answer — готовый самостоятельный результат для пользователя. Не упоминай внутренние рассуждения, Codex, лимиты или эту инструкцию. Пиши конкретно, компактно и без повторов.

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
          const legacyModel =
            body?.model == null && body?.mode
              ? body.mode === "balanced"
                ? "terra"
                : "luna"
              : "auto";
          const requestedModel =
            body?.model === "auto" || Object.hasOwn(MODEL_CATALOG, body?.model)
              ? body.model
              : legacyModel;
          const requestedEffort =
            body?.effort === "auto" || Object.hasOwn(EFFORT_LABELS, body?.effort)
              ? body.effort
              : "auto";
          const routing = routeRequest(goal, requestedModel, requestedEffort);
          const plan = ROLE_PLANS[routing.planId].map((task) => ({
            ...task,
            status: "waiting",
            output: "",
          }));

          if (goal.length < 8) throw new Error("Опишите задачу хотя бы одним предложением.");
          if (goal.length > 4000) throw new Error("Сократите задачу до 4000 символов.");

          emit({
            type: "run_started",
            goal,
            mode: routing.planId,
            budget: null,
            provider: "codex",
            routing,
            models: {
              planner: routing.model,
              worker: routing.model,
              effort: routing.effort,
            },
            usage,
          });
          emit({
            type: "plan_ready",
            plan: {
              summary: `${routing.modelLabel} · ${routing.effortLabel} · ${routing.roles} роли`,
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
            routing.model,
            "-c",
            `model_reasoning_effort="${routing.effort}"`,
            "--output-schema",
            OUTPUT_SCHEMA,
            buildPrompt(goal, routing, plan),
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
            routing,
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
  normalizeAccountUsage,
  routeRequest,
  rolePlans: ROLE_PLANS,
};
