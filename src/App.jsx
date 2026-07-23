import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaretRightIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadSimpleIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  PlayIcon,
  StopIcon,
  UserIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getApiStatus, streamRun } from "./api.js";

const EMPTY_USAGE = { input: 0, output: 0, total: 0, cached: 0 };
const STORAGE_KEY = "agent-office:last-run";

const AGENT_SEED = [
  {
    id: "ava",
    name: "Ava",
    defaultRole: "Исследователь",
    accent: "green",
    position: { left: "28.5%", top: "22.5%" },
  },
  {
    id: "liam",
    name: "Liam",
    defaultRole: "Разработчик",
    accent: "green",
    position: { left: "66%", top: "16.5%" },
  },
  {
    id: "noah",
    name: "Noah",
    defaultRole: "Дизайнер",
    accent: "green",
    position: { left: "43.5%", top: "52%" },
  },
  {
    id: "maya",
    name: "Maya",
    defaultRole: "Ревьюер",
    accent: "blue",
    position: { left: "75%", top: "52%" },
  },
];

const ROLE_UI = {
  researcher: { icon: MagnifyingGlassIcon, accent: "green" },
  developer: { icon: CodeIcon, accent: "blue" },
  designer: { icon: PaintBrushIcon, accent: "yellow" },
  reviewer: { icon: CheckIcon, accent: "purple" },
};

function formatTokens(value) {
  const tokens = Number(value || 0);
  if (tokens < 1000) return String(tokens);
  const compact = tokens >= 10000 ? Math.round(tokens / 1000) : (tokens / 1000).toFixed(1);
  return `${compact}k`;
}

function loadLastRun() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved?.result ? saved : null;
  } catch {
    return null;
  }
}

function AgentMarker({ agent, selected, onSelect }) {
  return (
    <button
      className={`agent-marker agent-marker--${agent.accent} agent-marker--${agent.status}${
        selected ? " is-selected" : ""
      }`}
      style={agent.position}
      onClick={() => onSelect(agent.id)}
      aria-label={`${agent.name}: ${agent.statusLabel}`}
      aria-pressed={selected}
    >
      <span className="agent-status-dot" aria-hidden="true" />
      <span>
        <strong>{agent.name}</strong>
        <small>{agent.statusLabel}</small>
      </span>
    </button>
  );
}

function TaskCard({ task, active, onClick }) {
  const roleUi = ROLE_UI[task.role] || ROLE_UI.reviewer;
  const Icon = roleUi.icon;
  const stateLabel = {
    waiting: "Ожидает",
    working: "В работе",
    done: "Готово",
    skipped: "Пропущено",
  }[task.status];

  return (
    <button
      className={`task-card task-card--${roleUi.accent}${active ? " is-active" : ""}`}
      onClick={onClick}
      aria-label={`${task.title}, ${stateLabel}`}
    >
      <span className="task-icon" aria-hidden="true">
        <Icon size={26} weight="regular" />
      </span>
      <span className="task-copy">
        <strong>{task.title}</strong>
        <span className="task-agent">{task.name}</span>
        <small className={`task-state task-state--${task.status}`}>{stateLabel}</small>
      </span>
      <CaretRightIcon className="task-caret" size={18} weight="bold" />
    </button>
  );
}

function ResultPanel({ run, onClose, onCopy, onDownload }) {
  return (
    <aside className="result-panel" aria-label="Результат команды">
      <div className="result-heading">
        <div>
          <p className="popover-eyebrow">Готовый результат</p>
          <h2>{run.stoppedByBudget ? "Команда остановилась по лимиту" : "Команда закончила"}</h2>
        </div>
        <button onClick={onClose} aria-label="Закрыть результат">
          <XIcon size={18} weight="bold" />
        </button>
      </div>
      <div className="result-body">{run.result}</div>
      <div className="result-actions">
        <span>{formatTokens(run.usage.total)} токенов</span>
        <button onClick={onCopy}>
          <CopyIcon size={17} />
          Копировать
        </button>
        <button onClick={onDownload}>
          <DownloadSimpleIcon size={17} />
          Скачать
        </button>
      </div>
    </aside>
  );
}

export function App() {
  const [apiStatus, setApiStatus] = useState({
    loading: true,
    configured: false,
    provider: "",
    subscription: null,
    ecoModel: "",
    balancedModel: "",
  });
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState("eco");
  const [budget, setBudget] = useState(6000);
  const [showBudget, setShowBudget] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [showResult, setShowResult] = useState(Boolean(loadLastRun()));
  const [toast, setToast] = useState("");
  const [run, setRun] = useState(() => {
    const lastRun = loadLastRun();
    return (
      lastRun || {
        status: "idle",
        goal: "",
        planSummary: "",
        tasks: [],
        usage: EMPTY_USAGE,
        result: "",
        error: "",
        stoppedByBudget: false,
      }
    );
  });
  const abortRef = useRef(null);

  useEffect(() => {
    getApiStatus()
      .then((status) => setApiStatus({ ...status, loading: false }))
      .catch(() => setApiStatus((current) => ({ ...current, loading: false })));
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (run.status === "done" && run.result) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(run));
    }
  }, [run]);

  const running = ["planning", "running"].includes(run.status);
  const agents = useMemo(
    () =>
      AGENT_SEED.map((agent) => {
        const agentTasks = run.tasks.filter((task) => task.agentId === agent.id);
        const workingTask = agentTasks.find((task) => task.status === "working");
        const waitingTask = agentTasks.find((task) => task.status === "waiting");
        const lastDoneTask = [...agentTasks].reverse().find((task) => task.status === "done");
        const currentTask = workingTask || waitingTask || lastDoneTask || null;
        const status = workingTask
          ? "working"
          : waitingTask
            ? "waiting"
            : lastDoneTask
              ? "done"
              : "idle";
        const statusLabel = {
          working: currentTask?.label || "Работает",
          waiting: "Ожидает",
          done: "Готово",
          idle: "Свободен",
        }[status];

        return { ...agent, status, statusLabel, currentTask };
      }),
    [run.tasks],
  );

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId);
  const usagePercent = Math.min(100, Math.round((run.usage.total / budget) * 100));

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const handleRunEvent = (event) => {
    if (event.type === "run_started") {
      setRun((current) => ({
        ...current,
        status: "planning",
        goal: event.goal,
        usage: event.usage,
      }));
    }

    if (event.type === "plan_ready") {
      setRun((current) => ({
        ...current,
        status: "running",
        planSummary: event.plan.summary,
        tasks: event.plan.tasks,
        usage: event.usage,
      }));
    }

    if (event.type === "task_started") {
      setSelectedAgentId(event.agentId);
      setRun((current) => ({
        ...current,
        status: "running",
        tasks: current.tasks.map((task) =>
          task.id === event.taskId ? { ...task, status: "working" } : task,
        ),
        usage: event.usage,
      }));
    }

    if (event.type === "task_completed") {
      setRun((current) => ({
        ...current,
        tasks: current.tasks.map((task) =>
          task.id === event.taskId
            ? { ...task, status: "done", output: event.output, usage: event.taskUsage }
            : task,
        ),
        usage: event.usage,
      }));
    }

    if (event.type === "budget_reached") {
      setRun((current) => ({ ...current, stoppedByBudget: true, usage: event.usage }));
    }

    if (event.type === "run_completed") {
      setRun((current) => ({
        ...current,
        status: "done",
        result: event.result,
        usage: event.usage,
        stoppedByBudget: event.stoppedByBudget,
        tasks: current.tasks.map((task) =>
          task.status === "waiting" ? { ...task, status: "skipped" } : task,
        ),
      }));
      setSelectedAgentId(null);
      setShowResult(true);
    }

    if (event.type === "run_cancelled") {
      setRun((current) => ({ ...current, status: "cancelled", usage: event.usage }));
      setSelectedAgentId(null);
    }

    if (event.type === "run_error") {
      setRun((current) => ({
        ...current,
        status: "error",
        error: event.message,
        usage: event.usage,
      }));
      setSelectedAgentId(null);
    }
  };

  const startRun = async (event) => {
    event.preventDefault();
    const cleanGoal = goal.trim();
    if (!cleanGoal) return notify("Сначала опишите задачу");
    if (!apiStatus.configured) {
      return notify(
        apiStatus.provider === "codex"
          ? "Сначала войдите в Codex через ChatGPT"
          : "Сервер моделей ещё не подключён",
      );
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setShowResult(false);
    setSelectedAgentId(null);
    setRun({
      status: "planning",
      goal: cleanGoal,
      planSummary: "",
      tasks: [],
      usage: EMPTY_USAGE,
      result: "",
      error: "",
      stoppedByBudget: false,
    });

    try {
      await streamRun({
        goal: cleanGoal,
        mode,
        budget,
        signal: controller.signal,
        onEvent: handleRunEvent,
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setRun((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error.message : "Запуск не удался.",
        }));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  };

  const stopRun = () => {
    abortRef.current?.abort();
    setRun((current) => ({ ...current, status: "cancelled" }));
    setSelectedAgentId(null);
  };

  const copyResult = async () => {
    await navigator.clipboard.writeText(run.result);
    notify("Результат скопирован");
  };

  const downloadResult = () => {
    const blob = new Blob([run.result], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agent-office-result.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-group">
          <div>
            <h1>Agent Office</h1>
            <span className="brand-subtitle">рабочая команда</span>
          </div>
          <div className="header-popover-wrap">
            <button
              className="quiet-button team-button"
              onClick={() => {
                setShowTeam((value) => !value);
                setShowBudget(false);
              }}
              aria-expanded={showTeam}
            >
              <UsersThreeIcon size={25} weight="regular" />
              <span>4 агента</span>
            </button>
            {showTeam && (
              <div className="mini-popover team-popover">
                <p className="popover-eyebrow">Команда</p>
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      setSelectedAgentId(agent.id);
                      setShowTeam(false);
                    }}
                  >
                    <span className={`mini-dot mini-dot--${agent.accent}`} />
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agent.statusLabel}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="header-actions">
          <span
            className={`connection-dot${apiStatus.configured ? " is-online" : ""}`}
            title={
              apiStatus.configured
                ? apiStatus.provider === "codex"
                  ? "Codex подключён через ChatGPT Pro"
                  : "OpenAI API подключён"
                : "Модельный сервер не настроен"
            }
          />
          <div className="header-popover-wrap">
            <button
              className="token-pill"
              onClick={() => {
                setShowBudget((value) => !value);
                setShowTeam(false);
              }}
              aria-expanded={showBudget}
            >
              <strong>{formatTokens(run.usage.total)}</strong> токенов
            </button>
            {showBudget && (
              <div className="mini-popover budget-popover">
                <p className="popover-eyebrow">Текущий запуск</p>
                <div className="budget-row">
                  <span>Использовано</span>
                  <strong>
                    {run.usage.total.toLocaleString("ru-RU")} / {budget.toLocaleString("ru-RU")}
                  </strong>
                </div>
                <div className="budget-meter" aria-label={`${usagePercent}% лимита использовано`}>
                  <span style={{ width: `${usagePercent}%` }} />
                </div>
                <p>
                  {apiStatus.provider === "codex"
                    ? "Это справочная статистика Codex. Отдельной оплаты API нет — используется лимит вашей подписки ChatGPT."
                    : "В токены уходят только реальные вызовы агентов. Анимация офиса и интерфейс работают локально."}
                </p>
              </div>
            )}
          </div>
          <button className="profile-button" aria-label="Профиль">
            <UserIcon size={24} weight="regular" />
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="office-panel">
          <img
            className="office-image"
            src="/assets/office-room.png"
            alt="Светлый офис с четырьмя AI-агентами за рабочими столами"
          />

          <div className="agent-layer">
            {agents.map((agent) => (
              <AgentMarker
                key={agent.id}
                agent={agent}
                selected={selectedAgentId === agent.id}
                onSelect={setSelectedAgentId}
              />
            ))}
          </div>

          {run.status === "planning" && (
            <div className="planning-badge" role="status">
              <span />
              Оркестратор собирает план…
            </div>
          )}

          {selectedAgent && (
            <aside className="agent-detail" aria-label={`${selectedAgent.name}: детали`}>
              <button
                className="detail-close"
                onClick={() => setSelectedAgentId(null)}
                aria-label="Закрыть"
              >
                <XIcon size={18} weight="bold" />
              </button>
              <div className="agent-detail-heading">
                <span className={`detail-avatar detail-avatar--${selectedAgent.accent}`}>
                  {selectedAgent.name.slice(0, 1)}
                </span>
                <div>
                  <p className="popover-eyebrow">{selectedAgent.defaultRole}</p>
                  <h2>{selectedAgent.name}</h2>
                </div>
              </div>

              {selectedAgent.currentTask ? (
                <>
                  <div className="current-task">
                    <div>
                      <span>Текущая задача</span>
                      <strong>{selectedAgent.currentTask.title}</strong>
                    </div>
                    <b>{selectedAgent.statusLabel}</b>
                  </div>
                  <div className="agent-progress">
                    <span
                      style={{
                        width:
                          selectedAgent.status === "done"
                            ? "100%"
                            : selectedAgent.status === "working"
                              ? "58%"
                              : "8%",
                      }}
                    />
                  </div>
                  {selectedAgent.currentTask.output && (
                    <div className="agent-output">{selectedAgent.currentTask.output}</div>
                  )}
                </>
              ) : (
                <p className="agent-idle-copy">
                  Агент свободен. Оркестратор подключит его, если роль нужна для задачи.
                </p>
              )}
            </aside>
          )}

          {showResult && run.result && (
            <ResultPanel
              run={run}
              onClose={() => setShowResult(false)}
              onCopy={copyResult}
              onDownload={downloadResult}
            />
          )}
        </div>

        <aside className="task-rail">
          <div className="task-rail-heading">
            <div>
              <p className="popover-eyebrow">Новый запуск</p>
              <h2>Что нужно сделать?</h2>
            </div>
            <ListBulletsIcon size={23} />
          </div>

          {!apiStatus.loading && apiStatus.provider === "codex" && apiStatus.configured && (
            <div className="subscription-notice">
              <CheckIcon size={20} weight="bold" />
              <div>
                <strong>Codex Pro подключён</strong>
                <p>Работа идёт через вашу подписку ChatGPT — покупать API-токены не нужно.</p>
              </div>
            </div>
          )}

          {!apiStatus.loading && !apiStatus.configured && (
            <div className="setup-notice">
              <WarningCircleIcon size={21} weight="fill" />
              <div>
                <strong>
                  {apiStatus.provider === "codex" ? "Нужно войти в Codex" : "Локальный режим"}
                </strong>
                {apiStatus.provider === "codex" ? (
                  <p>
                    Выполните <code>codex login</code> и войдите через аккаунт ChatGPT Pro.
                  </p>
                ) : (
                  <p>
                    Эта опубликованная версия не видит Codex на вашем Mac. Запустите проект
                    локально, чтобы использовать подписку ChatGPT.
                  </p>
                )}
              </div>
            </div>
          )}

          <form className="run-form" onSubmit={startRun}>
            <label htmlFor="run-goal">Задача для команды</label>
            <textarea
              id="run-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Например: придумай структуру лендинга и подготовь готовый текст…"
              rows={4}
              disabled={running}
            />

            <div className="mode-switch" aria-label="Режим работы">
              <button
                type="button"
                className={mode === "eco" ? "is-active" : ""}
                onClick={() => setMode("eco")}
                disabled={running}
              >
                Экономно
                <small>{apiStatus.ecoModel || "Luna · 3 роли"}</small>
              </button>
              <button
                type="button"
                className={mode === "balanced" ? "is-active" : ""}
                onClick={() => setMode("balanced")}
                disabled={running}
              >
                Точнее
                <small>{apiStatus.balancedModel || "Terra · 4 роли"}</small>
              </button>
            </div>

            {apiStatus.provider !== "codex" && (
              <div className="budget-control">
                <div>
                  <label htmlFor="token-budget">Мягкий лимит</label>
                  <strong>{formatTokens(budget)} токенов</strong>
                </div>
                <input
                  id="token-budget"
                  type="range"
                  min="3000"
                  max="16000"
                  step="1000"
                  value={budget}
                  onChange={(event) => setBudget(Number(event.target.value))}
                  disabled={running}
                />
              </div>
            )}

            {running ? (
              <button type="button" className="run-button run-button--stop" onClick={stopRun}>
                <StopIcon size={18} weight="fill" />
                Остановить команду
              </button>
            ) : (
              <button
                type="submit"
                className="run-button"
                disabled={!apiStatus.configured || apiStatus.loading}
              >
                <PlayIcon size={18} weight="fill" />
                Запустить команду
              </button>
            )}
          </form>

          {run.error && (
            <div className="run-error" role="alert">
              <WarningCircleIcon size={20} />
              <span>{run.error}</span>
            </div>
          )}

          <div className="task-section-heading">
            <h3>Задачи</h3>
            {run.planSummary && <span>{run.planSummary}</span>}
          </div>

          <div className="task-list">
            {run.tasks.length ? (
              run.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  active={selectedAgentId === task.agentId}
                  onClick={() => setSelectedAgentId(task.agentId)}
                />
              ))
            ) : (
              <div className="empty-tasks">
                <UsersThreeIcon size={29} />
                <strong>Команда пока свободна</strong>
                <p>Опишите цель — оркестратор сам раздаст минимальное число задач.</p>
              </div>
            )}
          </div>

          {run.status === "done" && run.result && !showResult && (
            <button className="show-result-button" onClick={() => setShowResult(true)}>
              Показать результат
              <CaretRightIcon size={17} weight="bold" />
            </button>
          )}
        </aside>
      </section>

      <div className={`toast${toast ? " is-visible" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </main>
  );
}
