const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

const AGENTS = {
  researcher: { agentId: "ava", name: "Ava", label: "Исследует" },
  developer: { agentId: "liam", name: "Liam", label: "Создаёт" },
  designer: { agentId: "noah", name: "Noah", label: "Проектирует" },
  reviewer: { agentId: "maya", name: "Maya", label: "Проверяет" },
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "tasks"],
  properties: {
    summary: { type: "string" },
    tasks: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "role", "title", "instructions", "depends_on"],
        properties: {
          id: { type: "string" },
          role: {
            type: "string",
            enum: ["researcher", "developer", "designer", "reviewer"],
          },
          title: { type: "string" },
          instructions: { type: "string" },
          depends_on: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
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

function getEnv(env, key, fallback = "") {
  const value = env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getModels(env, mode) {
  if (mode === "balanced") {
    return {
      planner: getEnv(env, "OPENAI_ORCHESTRATOR_MODEL", "gpt-5.6-sol"),
      worker: getEnv(env, "OPENAI_WORKER_MODEL", "gpt-5.6-terra"),
      effort: "low",
      maxTasks: 4,
      workerOutput: 1050,
    };
  }

  return {
    planner: getEnv(env, "OPENAI_ORCHESTRATOR_MODEL", "gpt-5.6-terra"),
    worker: getEnv(env, "OPENAI_WORKER_MODEL", "gpt-5.6-luna"),
    effort: "none",
    maxTasks: 3,
    workerOutput: 760,
  };
}

function extractText(response) {
  const chunks = [];

  for (const item of response?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item.content || []) {
      if (content?.type === "refusal" && content.refusal) {
        throw new Error(content.refusal);
      }
      if (content?.type === "output_text" && content.text) chunks.push(content.text);
    }
  }

  if (!chunks.length) throw new Error("Модель не вернула текстовый результат.");
  return chunks.join("\n").trim();
}

function extractUsage(response) {
  const usage = response?.usage || {};
  return {
    input: Number(usage.input_tokens || 0),
    output: Number(usage.output_tokens || 0),
    total: Number(usage.total_tokens || 0),
    cached: Number(usage.input_tokens_details?.cached_tokens || 0),
  };
}

function mergeUsage(current, next) {
  return {
    input: current.input + next.input,
    output: current.output + next.output,
    total: current.total + next.total,
    cached: current.cached + next.cached,
  };
}

async function callOpenAI({ apiKey, body, fetchImpl, signal }) {
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `OpenAI API вернул HTTP ${response.status}.`;
    throw new Error(detail);
  }

  return payload;
}

function normalizePlan(rawPlan, mode) {
  const maxTasks = mode === "balanced" ? 4 : 3;
  const seen = new Set();
  const tasks = [];

  for (const [index, rawTask] of (rawPlan?.tasks || []).slice(0, maxTasks).entries()) {
    const role = AGENTS[rawTask.role] ? rawTask.role : "reviewer";
    let id = String(rawTask.id || `task-${index + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!id || seen.has(id)) id = `task-${index + 1}`;
    seen.add(id);

    tasks.push({
      id,
      role,
      title: String(rawTask.title || `Задача ${index + 1}`).slice(0, 90),
      instructions: String(rawTask.instructions || "").slice(0, 1200),
      dependsOn: Array.isArray(rawTask.depends_on)
        ? rawTask.depends_on.map(String).filter((dependency) => seen.has(dependency))
        : [],
      status: "waiting",
      output: "",
      usage: { input: 0, output: 0, total: 0, cached: 0 },
      ...AGENTS[role],
    });
  }

  if (tasks.length < 2) {
    throw new Error("Оркестратор составил слишком короткий план.");
  }

  const finalTask = tasks.at(-1);
  finalTask.role = "reviewer";
  Object.assign(finalTask, AGENTS.reviewer);
  finalTask.dependsOn = tasks.slice(0, -1).map((task) => task.id);
  if (!finalTask.instructions) {
    finalTask.instructions = "Проверь результаты команды и собери итоговый ответ для пользователя.";
  }

  return {
    summary: String(rawPlan?.summary || "План команды").slice(0, 220),
    tasks,
  };
}

function buildContext(task, outputs) {
  const dependencies = task.dependsOn
    .map((id) => outputs.get(id))
    .filter(Boolean)
    .map((item) => `### ${item.title}\n${item.output}`)
    .join("\n\n");

  return dependencies.slice(0, 9000);
}

function createEmitter(controller) {
  const encoder = new TextEncoder();
  return (event) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };
}

async function executeRun({ request, env, controller, fetchImpl }) {
  const emit = createEmitter(controller);
  let usage = { input: 0, output: 0, total: 0, cached: 0 };

  try {
    const body = await request.json();
    const goal = String(body?.goal || "").trim();
    const mode = body?.mode === "balanced" ? "balanced" : "eco";
    const budget = Math.max(2000, Math.min(24000, Number(body?.budget) || 8000));
    const apiKey = getEnv(env, "OPENAI_API_KEY");
    const models = getModels(env, mode);

    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY не настроен на сервере. Добавьте ключ в локальный .env и перезапустите приложение.",
      );
    }
    if (goal.length < 8) throw new Error("Опишите задачу хотя бы одним предложением.");
    if (goal.length > 4000) throw new Error("Задача слишком длинная. Сократите её до 4000 символов.");

    emit({
      type: "run_started",
      goal,
      mode,
      budget,
      models,
      usage,
    });

    const planResponse = await callOpenAI({
      apiKey,
      fetchImpl,
      signal: request.signal,
      body: {
        model: models.planner,
        store: false,
        reasoning: { effort: models.effort },
        max_output_tokens: mode === "balanced" ? 900 : 700,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "orchestration_plan",
            strict: true,
            schema: PLAN_SCHEMA,
          },
        },
        instructions:
          "Ты экономный оркестратор маленькой команды. Разбей цель на минимальное число самостоятельных задач. " +
          `Режим ${mode}: создай ${mode === "balanced" ? "3–4" : "2–3"} задачи. ` +
          "Последняя задача — проверка и сборка полезного итогового ответа. Не повторяй контекст и не придумывай внешние действия.",
        input: `Цель пользователя:\n${goal}`,
      },
    });

    usage = mergeUsage(usage, extractUsage(planResponse));
    const plan = normalizePlan(JSON.parse(extractText(planResponse)), mode);
    emit({ type: "plan_ready", plan, usage });

    const outputs = new Map();
    for (const [index, task] of plan.tasks.entries()) {
      if (usage.total >= budget) {
        emit({
          type: "budget_reached",
          message: "Мягкий лимит токенов достигнут — новые вызовы остановлены.",
          usage,
        });
        break;
      }

      emit({ type: "task_started", taskId: task.id, agentId: task.agentId, usage });
      const context = buildContext(task, outputs);
      const remaining = Math.max(260, budget - usage.total);
      const callsLeft = Math.max(1, plan.tasks.length - index);
      const maxOutputTokens = Math.max(
        260,
        Math.min(models.workerOutput, Math.floor(remaining / callsLeft)),
      );

      const workerResponse = await callOpenAI({
        apiKey,
        fetchImpl,
        signal: request.signal,
        body: {
          model: models.worker,
          store: false,
          reasoning: { effort: models.effort },
          max_output_tokens: maxOutputTokens,
          text: { verbosity: mode === "balanced" ? "medium" : "low" },
          instructions:
            `Ты агент роли ${task.role}. Выполни только свою задачу и дай готовый полезный результат. ` +
            "Отвечай на языке пользователя. Не описывай внутренние рассуждения. Будь конкретным и компактным.",
          input:
            `Общая цель:\n${goal}\n\nТвоя задача:\n${task.title}\n${task.instructions}` +
            (context ? `\n\nРезультаты зависимых задач:\n${context}` : ""),
        },
      });

      const taskUsage = extractUsage(workerResponse);
      usage = mergeUsage(usage, taskUsage);
      const output = extractText(workerResponse);
      outputs.set(task.id, { title: task.title, output });
      emit({
        type: "task_completed",
        taskId: task.id,
        output,
        taskUsage,
        usage,
      });
    }

    const completed = plan.tasks
      .map((task) => ({ ...task, result: outputs.get(task.id)?.output || "" }))
      .filter((task) => task.result);
    const finalTask = [...completed].reverse().find((task) => task.role === "reviewer");
    const fallbackResult = completed
      .map((task) => `## ${task.title}\n\n${task.result}`)
      .join("\n\n");

    emit({
      type: "run_completed",
      result: finalTask?.result || fallbackResult || "Команда не успела завершить ни одной задачи.",
      usage,
      stoppedByBudget: completed.length < plan.tasks.length,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      emit({ type: "run_cancelled", usage });
    } else {
      emit({
        type: "run_error",
        message: error instanceof Error ? error.message : "Неизвестная ошибка запуска.",
        usage,
      });
    }
  } finally {
    controller.close();
  }
}

export function createRunResponse(request, env, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const stream = new ReadableStream({
    start(controller) {
      void executeRun({ request, env, controller, fetchImpl });
    },
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

export async function handleApiRequest(request, env, options = {}) {
  const url = new URL(request.url);

  if (url.pathname === "/api/status" && request.method === "GET") {
    return json({
      configured: Boolean(getEnv(env, "OPENAI_API_KEY")),
      ecoModel: getModels(env, "eco").worker,
      balancedModel: getModels(env, "balanced").worker,
    });
  }

  if (url.pathname === "/api/runs" && request.method === "POST") {
    return createRunResponse(request, env, options);
  }

  return null;
}

export const testing = {
  extractText,
  extractUsage,
  normalizePlan,
};
