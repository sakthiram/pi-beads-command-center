import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Container, Text, DynamicBorder, visibleWidth, truncateToWidth } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

import { findActiveEpic, getEpicState, getReadyTasks, getTaskComments, countTasks } from "./lib/beads.js";
import { Poller } from "./lib/poller.js";
import {
  renderStatusLine,
  renderPhasePipeline,
  renderHumanGateWidget,
  renderEpicPanel,
  renderTaskDetail,
} from "./components/widgets.js";

// ─── Settings ────────────────────────────────────────────────────────────────

interface Settings {
  pollInterval: number;
  maxClaims: number;
  maxIterations: number;
  maxConcurrentWorkers: number;
  workerTimeout: number; // seconds, 0 = no timeout
  autoAdvance: boolean;
  workerModel: string | null;
  criticModel: string | null;
  workerSkills: string[];
}

const DEFAULT_SETTINGS: Settings = {
  pollInterval: 5000,
  maxClaims: 3,
  maxIterations: 5,
  maxConcurrentWorkers: 3,
  workerTimeout: 0,
  autoAdvance: false,
  workerModel: null,
  criticModel: null,
  workerSkills: ["sakthisi-beads"],
};

function loadSettings(): Settings {
  const settingsPath = path.resolve(__dirname, "settings.json");
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// ─── Extension Entry ─────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const settings = loadSettings();
  let poller: Poller | null = null;
  let activeEpicId: string | null = null;
  let widgetCtx: any = null;

  // ─── Context Injection ───────────────────────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: event.systemPrompt + ORCHESTRATION_CONTEXT,
    };
  });

  // ─── Tool Gates ──────────────────────────────────────────────────────────

  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event)) {
      const cmd = event.input.command || "";
      if (cmd.includes("beads-executor.sh")) {
        return {
          block: true,
          reason: "beads-executor.sh is replaced by the beads-command-center extension. Use /beads:run to spawn workers, or ask the agent to spawn workers for ready tasks.",
        };
      }
      if (cmd.includes("ralph.sh")) {
        return {
          block: true,
          reason: "ralph.sh is replaced by the beads-command-center extension. The main agent session handles the decompose→work→evaluate loop. Use /beads:run to spawn workers and /beads:evaluate to spawn a critic.",
        };
      }
    }
  });

  // ─── Detect Epic Creation Mid-Session ────────────────────────────────────
  // If no epic existed at session_start, check after each bash command
  // to see if one was just created.

  pi.on("tool_result", async (event) => {
    if (!widgetCtx || activeEpicId) return;
    const beadsDir = path.join(process.cwd(), ".beads");
    if (!fs.existsSync(beadsDir)) return;
    const epic = findActiveEpic();
    if (epic) {
      activeEpicId = epic.id;
      updateWidgets(epic.id);
      startPoller(widgetCtx);
      widgetCtx.ui.notify(`Beads command center: tracking ${epic.title}`, "info");
    }
  });

  // ─── Block Orchestrator From Doing Work ──────────────────────────────────
  // During work/evaluate phases, block write/edit — orchestrator should spawn workers.

  pi.on("tool_call", async (event) => {
    if (!activeEpicId) return;
    const state = getEpicState(activeEpicId);
    if (!state) return;

    // Only block during work phase when tasks exist
    const counts = countTasks(state.tasks);
    if (counts.total === 0) return;

    const isWorkPhase = state.phase === "work" ||
      (state.epic.labels.includes("plan-approved") && counts.done < counts.total);

    if (!isWorkPhase) return;

    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const filePath = event.input.path || "";
      // Allow writing to docs/ and .beads/ (orchestrator artifacts)
      if (filePath.includes("/docs/") || filePath.includes("/.beads/") || filePath.includes("/prompts/")) {
        return;
      }
      return {
        block: true,
        reason: "You are the orchestrator — don't write code directly. Spawn a worker via /beads:run or process start to execute tasks. This session handles coordination; workers handle implementation.",
      };
    }
  });

  // ─── Session Lifecycle ───────────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    widgetCtx = ctx;
    const beadsDir = path.join(process.cwd(), ".beads");
    if (!fs.existsSync(beadsDir)) return;

    const epic = findActiveEpic();
    if (epic) {
      activeEpicId = epic.id;
      updateWidgets(epic.id);
      startPoller(ctx);
      ctx.ui.notify(`Beads command center: tracking ${epic.title}`, "info");
    }

    // Compact footer: model + beads status + context meter
    ctx.ui.setFooter((_tui, theme, _footerData) => ({
      dispose: () => {},
      invalidate() {},
      render(width: number): string[] {
        const model = ctx.model?.id || "no-model";
        const usage = ctx.getContextUsage();
        const pct = (usage && usage.percent !== null) ? usage.percent : 0;
        const filled = Math.round(pct / 10);
        const bar = "#".repeat(filled) + "-".repeat(10 - filled);

        const epicTitle = activeEpicId
          ? (getEpicState(activeEpicId)?.epic.title || activeEpicId).slice(0, 30)
          : "";
        const epicPart = epicTitle ? ` · ${epicTitle}` : "";

        const left = ` ${model}${epicPart}`;
        const right = `[${bar}] ${Math.round(pct)}% `;

        const pad = Math.max(1, width - left.length - right.length);
        return [theme.fg("dim", left) + " ".repeat(pad) + theme.fg("dim", right)];
      },
    }));
  });

  // ─── Poller Setup ────────────────────────────────────────────────────────

  // ─── Widget Update ─────────────────────────────────────────────────────

  function updateWidgets(epicId?: string) {
    if (!widgetCtx) return;
    const id = epicId || activeEpicId;
    if (!id) return;

    const state = getEpicState(id);
    if (!state) return;

    const counts = countTasks(state.tasks);
    const width = process.stdout.columns || 80;

    // Phase pipeline widget (above editor)
    const pipelineLines = renderPhasePipeline(state, counts, width);
    widgetCtx.ui.setWidget("beads-pipeline", pipelineLines);

    // Human gate widget (below editor)
    const gateLines = renderHumanGateWidget(state.humanGates);
    if (gateLines.length > 0) {
      widgetCtx.ui.setWidget("beads-gates", gateLines, { placement: "belowEditor" });
    } else {
      widgetCtx.ui.setWidget("beads-gates", undefined);
    }
  }

  // ─── Poller Setup ────────────────────────────────────────────────────────

  function startPoller(ctx: any) {
    if (poller) poller.stop();

    poller = new Poller(
      {
        onTaskCompleted(taskId, title) {
          widgetCtx?.ui.notify(`✓ ${title} (${taskId}) completed`, "info");
          updateWidgets();
        },
        onAllTasksDone(epicId) {
          widgetCtx?.ui.notify(
            `🎯 All tasks done for ${epicId}! Run /beads:evaluate to spawn a fresh critic session.`,
            "info"
          );
          updateWidgets();
        },
        onTaskStuck(taskId, title) {
          widgetCtx?.ui.notify(`✗ ${title} (${taskId}) stuck — needs attention`, "warning");
          updateWidgets();
        },
        onHumanGateAdded(description) {
          widgetCtx?.ui.notify(`⚠ ${description}`, "warning");
          updateWidgets();
        },
        onHumanGateResolved() {
          updateWidgets();
        },
        onPhaseChanged(phase, iteration) {
          widgetCtx?.ui.notify(`Phase: ${phase} (iteration ${iteration})`, "info");
          updateWidgets();
        },
        onEpicCompleted(epicId) {
          widgetCtx?.ui.notify(`🟢 Epic ${epicId} complete!`, "info");
          widgetCtx?.ui.setStatus("beads", "beads: ✓ complete");
          widgetCtx?.ui.setWidget("beads-pipeline", undefined);
          widgetCtx?.ui.setWidget("beads-gates", undefined);
        },
        onCriticDone(epicId, satisfied, lastCritic, iteration) {
          if (satisfied) {
            widgetCtx?.ui.notify(`🟢 Critic satisfied! All criteria pass. Epic ${epicId} is done.`, "info");
          } else {
            widgetCtx?.ui.notify(
              `🔴 Critic failed (iteration ${iteration}): ${lastCritic.slice(0, 100)}`,
              "warning"
            );
            const prompt = REMEDIATE_PROMPT(epicId, lastCritic, String(iteration));
            widgetCtx?.ui.setEditorText(prompt);
          }
          updateWidgets();
        },
        onStateChanged(_state, _counts) {
          updateWidgets();
        },
      },
      settings.pollInterval,
    );

    poller.start(activeEpicId || undefined);
  }

  // ─── Commands ────────────────────────────────────────────────────────────

  // /beads — Epic dashboard overlay
  pi.registerCommand("beads", {
    description: "Open beads epic dashboard",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found. Create one first.", "warning");
        return;
      }

      const state = getEpicState(epicId);
      if (!state) {
        ctx.ui.notify(`Could not read epic ${epicId}`, "error");
        return;
      }

      const counts = countTasks(state.tasks);

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(
            new Text(theme.fg("accent", theme.bold(`${state.epic.title} (${state.epic.id})`)), 1, 0)
          );
          container.addChild(new Text("", 0, 0));

          const panelLines = renderEpicPanel(state, counts, 80);
          for (const line of panelLines) {
            container.addChild(new Text(line, 1, 0));
          }

          container.addChild(new Text("", 0, 0));
          container.addChild(
            new Text(theme.fg("dim", "j/k scroll • enter task detail • r refresh • q quit"), 1, 0)
          );
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

          return {
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => {
              if (data === "q" || data === "\x1b") done();
            },
          };
        },
        { overlay: true },
      );
    },
  });

  // /beads:research — Start research phase
  pi.registerCommand("beads:research", {
    description: "Start the research phase for the active epic",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found. Create one first.", "warning");
        return;
      }

      const state = getEpicState(epicId);
      if (!state) {
        ctx.ui.notify(`Could not read epic ${epicId}`, "error");
        return;
      }

      // Create docs directory
      if (!fs.existsSync(state.docsDir)) {
        fs.mkdirSync(state.docsDir, { recursive: true });
      }

      const researchPath = path.join(state.docsDir, "RESEARCH.md");
      const relPath = path.relative(process.cwd(), researchPath);

      ctx.ui.setEditorText(RESEARCH_PROMPT(epicId, state.epic.title, relPath));
    },
  });

  // /beads:plan — Start plan phase (after research)
  pi.registerCommand("beads:plan", {
    description: "Start the plan phase (requires research-done)",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found", "warning");
        return;
      }

      const state = getEpicState(epicId);
      if (!state) return;

      if (!state.epic.labels.includes("research-done")) {
        ctx.ui.notify("Research phase not complete. Run /beads:research first.", "warning");
        return;
      }

      const planPath = path.join(state.docsDir, "PLAN.md");
      const researchPath = path.join(state.docsDir, "RESEARCH.md");
      const relPlan = path.relative(process.cwd(), planPath);
      const relResearch = path.relative(process.cwd(), researchPath);

      ctx.ui.setEditorText(PLAN_PROMPT(epicId, relResearch, relPlan));
    },
  });

  // /beads:task <id> — Task detail overlay
  pi.registerCommand("beads:task", {
    description: "Show task detail",
    handler: async (args, ctx) => {
      const taskId = args.trim();
      if (!taskId) {
        ctx.ui.notify("Usage: /beads:task <task-id>", "warning");
        return;
      }

      const state = activeEpicId ? getEpicState(activeEpicId) : null;
      const task = state?.tasks.find((t) => t.id === taskId);
      if (!task) {
        ctx.ui.notify(`Task ${taskId} not found`, "error");
        return;
      }

      const comments = getTaskComments(taskId);

      let workerLog: string[] = [];
      if (activeEpicId) {
        const logPath = path.join(
          process.cwd(), ".beads", "sessions", activeEpicId, `worker-${taskId}.log`
        );
        try {
          workerLog = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
        } catch {}
      }

      await ctx.ui.custom<void>(
        (tui, theme, _kb, done) => {
          const container = new Container();
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

          const detailLines = renderTaskDetail(task, comments, workerLog);
          for (const line of detailLines) {
            container.addChild(new Text(line, 1, 0));
          }

          container.addChild(new Text("", 0, 0));
          container.addChild(
            new Text(theme.fg("dim", "c comment • l full log • q back"), 1, 0)
          );
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

          return {
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => {
              if (data === "q" || data === "\x1b") done();
            },
          };
        },
        { overlay: true },
      );
    },
  });

  // /beads:run — Spawn workers for ready tasks
  pi.registerCommand("beads:run", {
    description: "Spawn workers for ready tasks",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found", "warning");
        return;
      }

      const ready = getReadyTasks(epicId);
      if (ready.length === 0) {
        ctx.ui.notify("No ready tasks (need assignee:worker + open status)", "info");
        return;
      }

      if (!activeEpicId) {
        activeEpicId = epicId;
        startPoller(ctx);
      }

      ctx.ui.notify(`Spawning ${ready.length} worker(s)...`, "info");

      const taskList = ready.map((t) => `- ${t.id}: ${t.title}`).join("\n");
      const cwd = process.cwd();

      ctx.ui.setEditorText(
        `Spawn workers for these ready tasks:\n${taskList}\n\n` +
        `For each task, use:\n` +
        `process start "pi -p 'Load sakthisi-beads-work skill. ` +
        `Execute task <id>: <title>. Work directory: ${cwd}. ` +
        `Epic: ${epicId}. Update beads state when done.'" ` +
        `name="worker-<id>" alertOnSuccess=true alertOnFailure=true`
      );
    },
  });

  // /beads:evaluate — Spawn critic as separate session
  pi.registerCommand("beads:evaluate", {
    description: "Spawn a fresh critic session to evaluate the epic",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found", "warning");
        return;
      }

      const state = getEpicState(epicId);
      if (!state) return;

      const counts = countTasks(state.tasks);
      if (counts.done < counts.total) {
        ctx.ui.notify(`Not all tasks done (${counts.done}/${counts.total}). Finish work first.`, "warning");
        return;
      }

      if (state.evaluatorCriteria.length === 0) {
        ctx.ui.notify("No [evaluator] criteria set on epic. Add criteria first.", "warning");
        return;
      }

      const criteria = state.evaluatorCriteria.join("; ");
      const cwd = process.cwd();
      const iteration = String(state.iteration || 1);
      const model = settings.criticModel || "";
      const modelFlag = model ? `--model ${model} ` : "";

      ctx.ui.notify("Spawning fresh critic session...", "info");

      const criticPrompt = CRITIC_PROMPT(epicId, criteria, cwd, iteration);

      ctx.ui.setEditorText(
        `Spawn a critic to evaluate epic ${epicId}:\n\n` +
        `process start "pi ${modelFlag}-p '${criticPrompt.replace(/'/g, "'\\''")}'" ` +
        `name="critic-${epicId}" alertOnSuccess=true alertOnFailure=true\n\n` +
        `The critic runs in a fresh session with no prior context. ` +
        `It will read the evaluator criteria, run checks, and write a [critic] comment to beads. ` +
        `When it exits, evaluate the [critic] comment and decide: advance or remediate.`
      );
    },
  });

  // /beads:approve — Approve pending plan
  pi.registerCommand("beads:approve", {
    description: "Approve the pending plan",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found", "warning");
        return;
      }

      ctx.ui.setEditorText(
        `Approve the plan for epic ${epicId}:\n` +
        `bd label add ${epicId} plan-approved --no-daemon\n` +
        `bd comments add ${epicId} "[APPROVED] Plan approved by human" --no-daemon`
      );
    },
  });

  // /beads:comment <id> <text> — Add human comment
  pi.registerCommand("beads:comment", {
    description: "Add a [human] comment to a task",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const taskId = parts[0];
      const text = parts.slice(1).join(" ");

      if (!taskId) {
        ctx.ui.notify("Usage: /beads:comment <task-id> <text>", "warning");
        return;
      }

      if (text) {
        ctx.ui.setEditorText(
          `Add human comment: bd comments add ${taskId} "[human] ${text}" --no-daemon`
        );
      } else {
        ctx.ui.setEditorText(
          `Add a [human] comment to task ${taskId}. What should the comment say?`
        );
      }
    },
  });

  // /beads:stop — Kill all workers
  pi.registerCommand("beads:stop", {
    description: "Stop all workers and pause execution",
    handler: async (_args, ctx) => {
      ctx.ui.setEditorText(
        "Stop all beads workers: use process list to find worker processes, then process kill each one."
      );
    },
  });

  // /beads:resume — Resume execution
  pi.registerCommand("beads:resume", {
    description: "Resume execution — re-spawn workers for ready tasks",
    handler: async (_args, ctx) => {
      const epicId = activeEpicId || findActiveEpic()?.id;
      if (!epicId) {
        ctx.ui.notify("No active epic found", "warning");
        return;
      }
      ctx.ui.setEditorText(
        `Resume execution for epic ${epicId}. Check for ready tasks and spawn workers.`
      );
    },
  });

}

// ─── Prompt Templates ──────────────────────────────────────────────────────

function loadPrompt(name: string, vars: Record<string, string>): string {
  const promptPath = path.resolve(__dirname, "prompts", `${name}.md`);
  try {
    let content = fs.readFileSync(promptPath, "utf-8");
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
    return content;
  } catch {
    return `Error: could not load prompt template '${name}.md'`;
  }
}

function RESEARCH_PROMPT(epicId: string, title: string, researchPath: string): string {
  return `Start the RESEARCH phase for epic ${epicId}: "${title}"\n\n`
    + loadPrompt("research", { epicId, researchPath });
}

function PLAN_PROMPT(epicId: string, researchPath: string, planPath: string): string {
  return `Start the PLAN phase for epic ${epicId}.\n\n`
    + loadPrompt("plan", { epicId, researchPath, planPath });
}

function DECOMPOSE_PROMPT(epicId: string, planPath: string, taskCount: string): string {
  return `Start the DECOMPOSE phase for epic ${epicId}.\n\n`
    + loadPrompt("decompose", { epicId, planPath, taskCount });
}

function CRITIC_PROMPT(epicId: string, criteria: string, cwd: string, iteration: string): string {
  return loadPrompt("critic", { epicId, criteria, cwd, iteration });
}

function REMEDIATE_PROMPT(epicId: string, criticComment: string, iteration: string): string {
  const nextIteration = String(parseInt(iteration) + 1);
  return loadPrompt("remediate", { epicId, criticComment, iteration, nextIteration });
}

// ─── Context Injection ─────────────────────────────────────────────────────

const ORCHESTRATION_CONTEXT = `

## Beads Command Center — Orchestration Protocol

This session uses the beads-command-center extension. One session = one epic.

### Phase Flow (shown in the pipeline widget above)

\`\`\`
research → purpose → plan → decompose → work → evaluate
\`\`\`

Each phase must complete before the next unlocks. The widget shows blocked phases as dimmed.

### Phase Rules

1. **RESEARCH** (first, always): Ask clarifying questions. Fetch context (code, docs, wiki via \`my\` CLI). Write findings to \`docs/<epic-name>/RESEARCH.md\`. Iterate with human until satisfied. Mark done: \`bd label add <epic> research-done --no-daemon\`

2. **PURPOSE**: From research, define WHY. Write the PURPOSE section in PLAN.md. What problem? What success looks like? What constraints?

3. **PLAN**: Write \`docs/<epic-name>/PLAN.md\` with approach, risks, task breakdown, acceptance criteria. Work back and forth with human. Human approves via \`/beads:approve\`.

4. **DECOMPOSE**: Break plan into beads features and tasks. Use \`sakthisi-beads-decompose\` skill.

5. **WORK**: Spawn workers via \`/beads:run\` or \`process start\`. When notified of worker completion, evaluate the output:
   - Done correctly → \`bd close <id> --reason "completed" --no-daemon\`
   - Failed, retryable → add remediation comment, re-spawn
   - Stuck → mark stuck, surface to human

6. **EVALUATE**: Spawn a fresh critic session via \`/beads:evaluate\`. The critic is a separate, unbiased session. Read its \`[critic]\` comment and decide next steps.

7. **REMEDIATE** (if critic failed): Read the \`[critic]\` comment. Create remediation tasks for each failed criterion. Label them \`assignee:worker\`. Advance the iteration label. Spawn workers via \`/beads:run\`. Loop back to step 5 (work). Repeat until critic passes or max iterations hit.

8. **RESEARCH QUESTIONS**: When you need to ask the user clarifying questions during research, use the \`questionnaire\` tool for structured multi-choice questions. It provides a tab-based UI for multiple questions.

### Execution Rules

- **NEVER do task work directly in this session.** You are the orchestrator, not a worker. Even for trivial tasks, spawn a worker via \`process start\` or \`/beads:run\`. This session handles: research, planning, decomposition, evaluation, and coordination. Workers handle: writing code, running tests, making changes.
- Do NOT run \`beads-executor.sh\` or \`ralph.sh\` directly (blocked).
- All \`bd\` commands must use \`--no-daemon\`.
- Never use \`bd onboard\`, \`bd prime\`, or \`bd sync\`.
- Human artifacts go in \`docs/<epic-name>/\` (committable).
- Machine artifacts go in \`.beads/sessions/<epic>/\` (ephemeral).
- Surface human gates via the dashboard — don't ask the human to run \`bd\` commands.
`;
