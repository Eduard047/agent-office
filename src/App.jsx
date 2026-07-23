import { useEffect, useMemo, useRef, useState } from "react";
import {
  CaretRightIcon,
  CheckIcon,
  CodeIcon,
  CopyIcon,
  DownloadSimpleIcon,
  ImageSquareIcon,
  ListBulletsIcon,
  MagnifyingGlassIcon,
  PaintBrushIcon,
  PaperclipIcon,
  PlayIcon,
  StopIcon,
  UserIcon,
  UsersThreeIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getApiStatus, MAC_APP_DOWNLOAD_URL, streamRun } from "./api.js";

const EMPTY_USAGE = { input: 0, output: 0, total: 0, cached: 0 };
const STORAGE_KEY = "agent-office:last-run";
const SUPPORTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024;
const MODEL_OPTIONS = [
  { id: "auto", label: "Auto", hint: "Сам выберет" },
  { id: "luna", label: "Luna", hint: "Быстро" },
  { id: "terra", label: "Terra", hint: "Баланс" },
  { id: "sol", label: "Sol", hint: "Максимум" },
];
const EFFORT_OPTIONS = [
  { id: "auto", label: "Авто" },
  { id: "none", label: "Без размышлений" },
  { id: "low", label: "Низкая" },
  { id: "medium", label: "Средняя" },
  { id: "high", label: "Высокая" },
  { id: "xhigh", label: "Очень высокая" },
  { id: "max", label: "Максимальная" },
  { id: "ultra", label: "Ультра" },
];

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

function formatExactTokens(value) {
  return `${Number(value || 0).toLocaleString("ru-RU")} токенов`;
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Не удалось прочитать ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function formatResetTime(timestamp) {
  if (!timestamp) return "не указан";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(Number(timestamp) * 1000));
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
        <span>
          {run.routing
            ? `${run.routing.modelLabel} · ${run.routing.effortLabel} · `
            : ""}
          {formatTokens(run.usage.total)} токенов
        </span>
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
    solModel: "",
    accountUsage: null,
  });
  const [goal, setGoal] = useState("");
  const [modelChoice, setModelChoice] = useState("auto");
  const [effortChoice, setEffortChoice] = useState("auto");
  const [budget, setBudget] = useState(6000);
  const [showBudget, setShowBudget] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [showResult, setShowResult] = useState(Boolean(loadLastRun()));
  const [attachments, setAttachments] = useState([]);
  const [draggingImages, setDraggingImages] = useState(false);
  const [toast, setToast] = useState("");
  const [run, setRun] = useState(() => {
    const lastRun = loadLastRun();
    return (
      lastRun || {
        status: "idle",
        goal: "",
        routing: null,
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
  const fileInputRef = useRef(null);
  const attachmentsRef = useRef([]);

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

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((attachment) =>
        URL.revokeObjectURL(attachment.previewUrl),
      );
    },
    [],
  );

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
  const subscriptionWindow = apiStatus.accountUsage?.primary || null;
  const remainingPercent = subscriptionWindow
    ? Math.round(subscriptionWindow.remainingPercent)
    : null;

  const notify = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  };

  const addImageFiles = (fileList) => {
    if (running) return;
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    const unsupported = incoming.find((file) => !SUPPORTED_IMAGE_TYPES.has(file.type));
    if (unsupported) {
      return notify("Поддерживаются PNG, JPG, WebP и GIF");
    }
    const oversized = incoming.find((file) => file.size > MAX_IMAGE_BYTES);
    if (oversized) {
      return notify(`${oversized.name}: изображение больше 8 МБ`);
    }
    if (attachments.length + incoming.length > MAX_IMAGE_COUNT) {
      return notify(`Можно прикрепить не больше ${MAX_IMAGE_COUNT} изображений`);
    }
    const totalBytes =
      attachments.reduce((sum, attachment) => sum + attachment.file.size, 0) +
      incoming.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      return notify("Общий размер изображений не должен превышать 24 МБ");
    }

    setAttachments((current) => [
      ...current,
      ...incoming.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const removeAttachment = (id) => {
    setAttachments((current) =>
      current.filter((attachment) => {
        if (attachment.id === id) URL.revokeObjectURL(attachment.previewUrl);
        return attachment.id !== id;
      }),
    );
  };

  const handleComposerPaste = (event) => {
    const pastedImages = Array.from(event.clipboardData?.files || []).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (!pastedImages.length) return;
    event.preventDefault();
    addImageFiles(pastedImages);
  };

  const handleImageDrop = (event) => {
    event.preventDefault();
    setDraggingImages(false);
    addImageFiles(event.dataTransfer?.files);
  };

  const handleRunEvent = (event) => {
    if (event.type === "run_started") {
      setRun((current) => ({
        ...current,
        status: "planning",
        goal: event.goal,
        routing: event.routing,
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
    const cleanGoal =
      goal.trim() ||
      (attachments.length
        ? "Проанализируй приложенные изображения и подготовь полезный результат."
        : "");
    if (!cleanGoal) return notify("Опишите задачу или прикрепите изображение");
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
      routing: null,
      planSummary: "",
      tasks: [],
      usage: EMPTY_USAGE,
      result: "",
      error: "",
      stoppedByBudget: false,
    });

    try {
      const images = await Promise.all(
        attachments.map(async ({ file }) => ({
          name: file.name || "image",
          type: file.type,
          size: file.size,
          dataUrl: await readFileAsDataUrl(file),
        })),
      );
      await streamRun({
        goal: cleanGoal,
        images,
        model: modelChoice,
        effort: effortChoice,
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
      getApiStatus()
        .then((status) => setApiStatus({ ...status, loading: false }))
        .catch(() => {});
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
              className={`token-pill${
                remainingPercent != null && remainingPercent <= 10 ? " is-low" : ""
              }`}
              onClick={() => {
                setShowBudget((value) => !value);
                setShowTeam(false);
              }}
              aria-expanded={showBudget}
            >
              {apiStatus.provider === "codex" && apiStatus.configured ? (
                remainingPercent == null ? (
                  <>
                    <strong>Pro</strong> активно
                  </>
                ) : (
                  <>
                    <strong>{remainingPercent}%</strong> лимита
                  </>
                )
              ) : apiStatus.provider === "codex" ? (
                <>
                  <strong>Pro</strong> войти
                </>
              ) : !apiStatus.configured ? (
                <>
                  <strong>Mac</strong> скачать
                </>
              ) : (
                <>
                  <strong>{formatTokens(run.usage.total)}</strong> токенов
                </>
              )}
            </button>
            {showBudget && (
              <div className="mini-popover budget-popover">
                {apiStatus.provider === "codex" ? (
                  <>
                    <p className="popover-eyebrow">Подписка ChatGPT Pro</p>
                    <div className="budget-row">
                      <span>Осталось в окне</span>
                      <strong>
                        {remainingPercent == null ? "Данные недоступны" : `${remainingPercent}%`}
                      </strong>
                    </div>
                    {subscriptionWindow && (
                      <>
                        <div
                          className="budget-meter budget-meter--remaining"
                          aria-label={`${remainingPercent}% лимита осталось`}
                        >
                          <span style={{ width: `${remainingPercent}%` }} />
                        </div>
                        <div className="usage-detail-row">
                          <span>Обновится</span>
                          <strong>{formatResetTime(subscriptionWindow.resetsAt)}</strong>
                        </div>
                      </>
                    )}
                    <div className="usage-detail-row">
                      <span>Этот запуск</span>
                      <strong>{formatExactTokens(run.usage.total)}</strong>
                    </div>
                    {apiStatus.accountUsage?.lastSevenDaysTokens != null && (
                      <div className="usage-detail-row">
                        <span>За 7 дней</span>
                        <strong>
                          {formatExactTokens(apiStatus.accountUsage.lastSevenDaysTokens)}
                        </strong>
                      </div>
                    )}
                    {apiStatus.accountUsage?.lifetimeTokens != null && (
                      <div className="usage-detail-row">
                        <span>Всего обработано</span>
                        <strong>{formatExactTokens(apiStatus.accountUsage.lifetimeTokens)}</strong>
                      </div>
                    )}
                    <p>
                      Подписка — это окно использования, а не кошелёк с фиксированным числом
                      токенов. Поэтому остаток показан в процентах, а токены — как фактический
                      расход.
                    </p>
                  </>
                ) : !apiStatus.configured ? (
                  <>
                    <p className="popover-eyebrow">Автономное приложение</p>
                    <p>
                      Запускает офис и Codex Pro прямо на вашем Mac. Локальный проект
                      и dev-сервер не нужны.
                    </p>
                    <a
                      className="bridge-button bridge-button--primary"
                      href={MAC_APP_DOWNLOAD_URL}
                    >
                      Скачать для Apple Silicon
                    </a>
                  </>
                ) : (
                  <>
                    <p className="popover-eyebrow">Текущий запуск</p>
                    <div className="budget-row">
                      <span>Использовано</span>
                      <strong>
                        {run.usage.total.toLocaleString("ru-RU")} /{" "}
                        {budget.toLocaleString("ru-RU")}
                      </strong>
                    </div>
                    <div
                      className="budget-meter"
                      aria-label={`${usagePercent}% лимита использовано`}
                    >
                      <span style={{ width: `${usagePercent}%` }} />
                    </div>
                    <p>
                      В токены уходят только реальные вызовы агентов. Анимация офиса и интерфейс
                      работают локально.
                    </p>
                  </>
                )}
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
            src={`${import.meta.env.BASE_URL}assets/office-room.png`}
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
              Оркестратор выбирает модель и собирает план…
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
                        transform: `scaleX(${
                          selectedAgent.status === "done"
                            ? 1
                            : selectedAgent.status === "working"
                              ? 0.58
                              : 0.08
                        })`,
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
                  {apiStatus.provider === "codex"
                    ? "Нужно войти в Codex"
                    : "Agent Office для Mac"}
                </strong>
                {apiStatus.provider === "codex" ? (
                  <p>
                    Выполните <code>codex login</code> и войдите через аккаунт ChatGPT Pro.
                  </p>
                ) : (
                  <>
                    <p>
                      Сайт показывает интерфейс, но не ищет сервер на вашем Mac. Скачайте
                      автономное приложение: оно само запускает офис и использует вашу
                      подписку ChatGPT Pro.
                    </p>
                    <div className="bridge-actions">
                      <a
                        className="bridge-button bridge-button--primary"
                        href={MAC_APP_DOWNLOAD_URL}
                      >
                        Скачать для Mac
                      </a>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <form className="run-form" onSubmit={startRun}>
            <label htmlFor="run-goal">Задача для команды</label>
            <div
              className={`composer${draggingImages ? " is-dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                if (!running) setDraggingImages(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  setDraggingImages(false);
                }
              }}
              onDrop={handleImageDrop}
            >
              {attachments.length > 0 && (
                <div className="attachment-strip" aria-label="Прикреплённые изображения">
                  {attachments.map((attachment) => (
                    <div className="attachment-card" key={attachment.id}>
                      <img src={attachment.previewUrl} alt="" />
                      <span>
                        <strong>{attachment.file.name || "Изображение"}</strong>
                        <small>{formatFileSize(attachment.file.size)}</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(attachment.id)}
                        disabled={running}
                        aria-label={`Удалить ${attachment.file.name || "изображение"}`}
                      >
                        <XIcon size={13} weight="bold" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <textarea
                id="run-goal"
                value={goal}
                onChange={(event) => setGoal(event.target.value)}
                onPaste={handleComposerPaste}
                placeholder="Опишите задачу, вставьте скриншот ⌘V или перетащите изображение…"
                rows={4}
                disabled={running}
              />

              <div className="composer-footer">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  hidden
                  disabled={running}
                  onChange={(event) => {
                    addImageFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={running || attachments.length >= MAX_IMAGE_COUNT}
                >
                  <PaperclipIcon size={16} weight="bold" />
                  Добавить изображение
                </button>
                <span>{attachments.length}/{MAX_IMAGE_COUNT} · до 8 МБ</span>
              </div>

              {draggingImages && (
                <div className="drop-overlay" aria-hidden="true">
                  <ImageSquareIcon size={25} weight="duotone" />
                  <strong>Отпустите изображение</strong>
                </div>
              )}
            </div>

            <div className="control-heading">
              <span>Модель</span>
              <small>{modelChoice === "auto" ? "офис решит сам" : "ручной выбор"}</small>
            </div>
            <div className="model-switch" aria-label="Выбор модели">
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={modelChoice === option.id ? "is-active" : ""}
                  onClick={() => setModelChoice(option.id)}
                  disabled={running}
                  aria-pressed={modelChoice === option.id}
                >
                  {option.label}
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>

            <div className="power-control">
              <div>
                <label htmlFor="reasoning-power">Мощность</label>
                <strong>
                  {EFFORT_OPTIONS.find((option) => option.id === effortChoice)?.label}
                </strong>
              </div>
              <input
                id="reasoning-power"
                type="range"
                min="0"
                max={EFFORT_OPTIONS.length - 1}
                step="1"
                value={EFFORT_OPTIONS.findIndex((option) => option.id === effortChoice)}
                onChange={(event) =>
                  setEffortChoice(EFFORT_OPTIONS[Number(event.target.value)].id)
                }
                disabled={running}
                aria-valuetext={
                  EFFORT_OPTIONS.find((option) => option.id === effortChoice)?.label
                }
              />
              <div className="power-scale" aria-hidden="true">
                <span>Авто</span>
                <span>Ultra</span>
              </div>
            </div>

            {apiStatus.provider === "api" && apiStatus.configured && (
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

          {run.routing && (
            <div className="route-decision" aria-live="polite">
              <div>
                <span>{run.routing.automatic ? "Auto-маршрут" : "Ручной маршрут"}</span>
                <strong>
                  {run.routing.modelLabel} · {run.routing.effortLabel}
                </strong>
              </div>
              <p>{run.routing.reason}</p>
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
