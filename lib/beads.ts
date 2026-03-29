import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BeadsTask {
  id: string;
  title: string;
  type: string; // epic, feature, task
  status: string; // open, in_progress, closed, blocked
  labels: string[];
  parent?: string;
}

export interface BeadsComment {
  prefix: string; // [human], [worker], [critic], [evaluator], [agent], etc.
  text: string;
  raw: string;
}

export interface EpicState {
  epic: BeadsTask;
  features: BeadsTask[];
  tasks: BeadsTask[];
  iteration: number;
  phase: string; // decompose, work, evaluate, or ""
  criticSatisfied: boolean;
  stuck: boolean;
  evaluatorCriteria: string[];
  lastCritic: string;
  humanGates: HumanGate[];
  docsDir: string; // e.g., docs/auth-refactor/
}

export interface HumanGate {
  type: "approve" | "comment" | "review";
  taskId: string;
  description: string;
}

// ─── BD CLI Wrapper ──────────────────────────────────────────────────────────

function bd(args: string, cwd?: string): string {
  try {
    const result = execSync(`bd ${args} --no-daemon`, {
      encoding: "utf-8",
      timeout: 10000,
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch (e: any) {
    return e.stdout?.trim() || "";
  }
}

function bdJson(args: string, cwd?: string): any[] {
  const raw = bd(`${args} --json`, cwd);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// ─── State Reader ────────────────────────────────────────────────────────────

export function findActiveEpic(cwd?: string): BeadsTask | null {
  const epics = bdJson("list -t epic --status open", cwd);
  if (epics.length === 0) return null;
  // Prefer epic with iteration label (active ralph loop)
  const active = epics.find((e: any) =>
    (e.labels || []).some((l: string) => l.startsWith("iteration:"))
  );
  return taskFromBd(active || epics[0]);
}

export function getEpicState(epicId: string, cwd?: string): EpicState | null {
  const epicRaw = bdJson(`show ${epicId}`, cwd);
  if (epicRaw.length === 0) return null;

  const epic = taskFromBd(epicRaw[0]);
  const labels = epic.labels;

  // Iteration and phase from labels
  const iterLabel = labels.find((l) => l.startsWith("iteration:"));
  const phaseLabel = labels.find((l) => l.startsWith("phase:"));
  const iteration = iterLabel ? parseInt(iterLabel.split(":")[1] || "0") : 0;
  const phase = phaseLabel ? phaseLabel.split(":")[1] || "" : "";
  const criticSatisfied = labels.includes("critic-satisfied");
  const stuck = labels.includes("stuck");

  // Features and tasks
  const features = bdJson(`list --parent ${epicId} -t feature`, cwd).map(taskFromBd);
  const allTasks: BeadsTask[] = [];

  // Direct tasks under epic
  const directTasks = bdJson(`list --parent ${epicId} -t task`, cwd).map(taskFromBd);
  allTasks.push(...directTasks);

  // Tasks under features
  for (const feature of features) {
    const featureTasks = bdJson(`list --parent ${feature.id} -t task`, cwd).map(taskFromBd);
    allTasks.push(...featureTasks);
  }

  // Comments for evaluator criteria and critic feedback
  const commentsRaw = bd(`comments ${epicId}`, cwd);
  const evaluatorCriteria: string[] = [];
  let lastCritic = "";

  for (const line of commentsRaw.split("\n")) {
    if (line.startsWith("[evaluator]")) {
      evaluatorCriteria.push(line.replace("[evaluator]", "").trim());
    }
    if (line.startsWith("[critic]")) {
      lastCritic = line.replace("[critic]", "").trim();
    }
  }

  // Docs directory (from name label or epic title)
  const nameLabel = labels.find((l) => l.startsWith("name:"));
  const epicSlug = nameLabel
    ? nameLabel.split(":")[1] || ""
    : epic.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const docsDir = path.join(cwd || process.cwd(), "docs", epicSlug);

  // Human gates
  const humanGates: HumanGate[] = [];

  // Research gate: only surface plan approval, not research-not-started
  if (labels.includes("research-done") && !labels.includes("plan-approved")) {
    const hasPlanDoc = fs.existsSync(path.join(docsDir, "PLAN.md"));
    if (hasPlanDoc) {
      humanGates.push({
        type: "approve",
        taskId: epicId,
        description: "Plan ready for approval",
      });
    }
  }

  // Tasks needing human attention
  for (const task of allTasks) {
    if (task.labels.includes("assignee:human")) {
      humanGates.push({
        type: "review",
        taskId: task.id,
        description: `${task.title} needs human attention`,
      });
    }
    if (task.labels.includes("stuck")) {
      humanGates.push({
        type: "comment",
        taskId: task.id,
        description: `${task.title} is stuck`,
      });
    }
  }

  return {
    epic,
    features,
    tasks: allTasks,
    iteration,
    phase,
    criticSatisfied,
    stuck,
    evaluatorCriteria,
    lastCritic,
    humanGates,
    docsDir,
  };
}

export function getReadyTasks(epicId: string, cwd?: string): BeadsTask[] {
  return bdJson(`list --parent ${epicId} --status open`, cwd)
    .map(taskFromBd)
    .filter((t) => t.type === "task" && t.labels.includes("assignee:worker"));
}

export function getTaskComments(taskId: string, cwd?: string): BeadsComment[] {
  const raw = bd(`comments ${taskId}`, cwd);
  if (!raw) return [];
  return raw.split("\n").filter(Boolean).map((line) => {
    const match = line.match(/^\[(\w+)\]\s*(.*)/);
    return {
      prefix: match ? `[${match[1]}]` : "",
      text: match ? match[2] : line,
      raw: line,
    };
  });
}

function taskFromBd(raw: any): BeadsTask {
  return {
    id: raw.id || raw.ID || "",
    title: raw.title || raw.Title || "",
    type: raw.issue_type || raw.type || raw.Type || "task",
    status: raw.status || raw.Status || "open",
    labels: raw.labels || raw.Labels || [],
    parent: raw.parent || raw.Parent || undefined,
  };
}

// ─── Task Counts ─────────────────────────────────────────────────────────────

export interface TaskCounts {
  total: number;
  done: number;
  inProgress: number;
  open: number;
  stuck: number;
  blocked: number;
}

export function countTasks(tasks: BeadsTask[]): TaskCounts {
  return {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "closed").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    open: tasks.filter((t) => t.status === "open" && !t.labels.includes("stuck")).length,
    stuck: tasks.filter((t) => t.labels.includes("stuck")).length,
    blocked: tasks.filter((t) => t.status === "blocked").length,
  };
}
