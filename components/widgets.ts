import type { EpicState, TaskCounts, HumanGate } from "../lib/beads.js";

// ─── Phase Model ─────────────────────────────────────────────────────────────

export const PHASES = [
  "research",
  "purpose",
  "plan",
  "decompose",
  "work",
  "evaluate",
] as const;

export type Phase = (typeof PHASES)[number];

export type PhaseStatus = "done" | "active" | "ready" | "blocked" | "failed";

export interface PhaseState {
  phase: Phase;
  status: PhaseStatus;
  detail?: string; // e.g., "4/7" for work phase
}

// Determine phase statuses from epic state
export function resolvePhases(state: EpicState, counts: TaskCounts): PhaseState[] {
  const labels = state.epic.labels;

  const hasResearch = labels.includes("research-done");
  const hasPurpose = labels.includes("purpose-done");
  const hasPlan = labels.includes("plan-approved");
  const hasDecompose = counts.total > 0;
  const allTasksDone = counts.total > 0 && counts.done === counts.total;
  const isStuck = state.stuck;
  const criticDone = state.criticSatisfied;

  // Active phase from beads labels (work/evaluate phases)
  const beadsPhase = state.phase; // decompose, work, evaluate, or ""

  const phases: PhaseState[] = [];

  // Research
  if (hasResearch) {
    phases.push({ phase: "research", status: "done" });
  } else if (!hasPurpose && !hasPlan) {
    phases.push({ phase: "research", status: "active" });
  } else {
    phases.push({ phase: "research", status: "done" }); // skipped = done
  }

  // Purpose
  if (hasPurpose || hasPlan) {
    phases.push({ phase: "purpose", status: "done" });
  } else if (hasResearch) {
    phases.push({ phase: "purpose", status: "active" });
  } else {
    phases.push({ phase: "purpose", status: "blocked" });
  }

  // Plan
  if (hasPlan) {
    phases.push({ phase: "plan", status: "done" });
  } else if (hasPurpose || hasResearch) {
    // Can plan after purpose (or research if purpose was quick)
    const purposeDone = phases.find((p) => p.phase === "purpose")?.status === "done";
    phases.push({ phase: "plan", status: purposeDone ? "active" : "blocked" });
  } else {
    phases.push({ phase: "plan", status: "blocked" });
  }

  // Decompose
  if (hasDecompose && (beadsPhase !== "decompose")) {
    phases.push({ phase: "decompose", status: "done" });
  } else if (hasPlan && beadsPhase === "decompose") {
    phases.push({ phase: "decompose", status: "active" });
  } else if (hasPlan && !hasDecompose) {
    phases.push({ phase: "decompose", status: "ready" });
  } else {
    phases.push({ phase: "decompose", status: "blocked" });
  }

  // Work
  if (allTasksDone && beadsPhase !== "work") {
    phases.push({ phase: "work", status: "done" });
  } else if (beadsPhase === "work" || (hasDecompose && !allTasksDone && hasPlan)) {
    const detail = counts.total > 0 ? `${counts.done}/${counts.total}` : undefined;
    if (isStuck) {
      phases.push({ phase: "work", status: "failed", detail });
    } else {
      phases.push({ phase: "work", status: "active", detail });
    }
  } else if (hasDecompose) {
    phases.push({ phase: "work", status: "ready" });
  } else {
    phases.push({ phase: "work", status: "blocked" });
  }

  // Evaluate
  if (criticDone) {
    phases.push({ phase: "evaluate", status: "done" });
  } else if (beadsPhase === "evaluate") {
    phases.push({ phase: "evaluate", status: "active" });
  } else if (allTasksDone) {
    phases.push({ phase: "evaluate", status: "ready" });
  } else {
    phases.push({ phase: "evaluate", status: "blocked" });
  }

  return phases;
}

// ─── ANSI Helpers ────────────────────────────────────────────────────────────

function ansi(code: string, text: string): string {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function statusIcon(status: string, labels: string[]): string {
  if (labels.includes("stuck")) return ansi("31", "✗");
  if (labels.includes("assignee:human")) return ansi("33", "⚠");
  switch (status) {
    case "closed": return ansi("32", "■");
    case "in_progress": return ansi("33", "▶");
    case "blocked": return ansi("31", "◆");
    default: return ansi("37", "□");
  }
}

// ─── Phase Pipeline Widget (above editor) ────────────────────────────────────
// The main visual: shows all phases as a horizontal pipeline with status.

export function renderPhasePipeline(
  state: EpicState,
  counts: TaskCounts,
  width: number,
): string[] {
  const phases = resolvePhases(state, counts);

  const epicName = state.epic.title.length > 25
    ? state.epic.title.slice(0, 25) + "…"
    : state.epic.title;

  const iterStr = state.iteration > 1 ? ` [iter ${state.iteration}]` : "";

  // Render each phase token
  const tokens: string[] = phases.map((p) => {
    const detail = p.detail ? ` ${p.detail}` : "";
    switch (p.status) {
      case "done":
        return ansi("32", `✓ ${p.phase}`);
      case "active":
        return ansi("33;1", `▶ ${p.phase}${detail}`);
      case "ready":
        return `○ ${p.phase}`;
      case "failed":
        return ansi("31", `✗ ${p.phase}${detail}`);
      case "blocked":
        return ansi("2", `░ ${p.phase}`); // dim
    }
  });

  const pipeline = tokens.join(ansi("2", " → "));
  const header = ansi("1", epicName) + ansi("2", iterStr);

  return [`${header}  ${pipeline}`];
}

// ─── Status Line ─────────────────────────────────────────────────────────────

export function renderStatusLine(state: EpicState, counts: TaskCounts, maxIter: number): string {
  const phases = resolvePhases(state, counts);
  const active = phases.find((p) => p.status === "active");

  const epicName = state.epic.title.length > 20
    ? state.epic.title.slice(0, 20) + "…"
    : state.epic.title;

  const parts: string[] = [ansi("1", epicName)];

  if (state.iteration > 1) {
    parts.push(`iter ${state.iteration}/${maxIter}`);
  }

  if (active) {
    const detail = active.detail ? ` ${active.detail}` : "";
    parts.push(ansi("33", `${active.phase}${detail}`));
  }

  if (state.stuck) parts.push(ansi("31", "STUCK"));
  if (state.criticSatisfied) parts.push(ansi("32", "✓ complete"));

  return parts.join(" • ");
}

// ─── Human Gate Widget (below editor) ───────────────────────────────────────

export function renderHumanGateWidget(gates: HumanGate[]): string[] {
  if (gates.length === 0) return [];

  const lines: string[] = [];
  const header = gates.length === 1
    ? ansi("33", "⚠ 1 item needs attention:")
    : ansi("33", `⚠ ${gates.length} items need attention:`);
  lines.push(header);

  for (const gate of gates.slice(0, 3)) {
    const icon = gate.type === "approve" ? "⏳" : gate.type === "comment" ? "💬" : "👀";
    const cmd = gate.type === "approve"
      ? "/beads:approve"
      : `/beads:comment ${gate.taskId}`;
    lines.push(`  ${icon} ${gate.description} (${ansi("36", cmd)})`);
  }

  if (gates.length > 3) {
    lines.push(ansi("37", `  … and ${gates.length - 3} more (/beads)`));
  }

  return lines;
}

// ─── Epic Panel ──────────────────────────────────────────────────────────────

export function renderEpicPanel(state: EpicState, counts: TaskCounts, width: number): string[] {
  const lines: string[] = [];
  const phases = resolvePhases(state, counts);

  // Phase pipeline at top of panel too
  const tokens = phases.map((p) => {
    const detail = p.detail ? ` ${p.detail}` : "";
    switch (p.status) {
      case "done": return ansi("32", `✓ ${p.phase}`);
      case "active": return ansi("33;1", `▶ ${p.phase}${detail}`);
      case "ready": return `○ ${p.phase}`;
      case "failed": return ansi("31", `✗ ${p.phase}${detail}`);
      case "blocked": return ansi("2", `░ ${p.phase}`);
    }
  });
  lines.push(tokens.join(ansi("2", " → ")));
  lines.push("");

  // Features
  if (state.features.length > 0) {
    lines.push(ansi("1", "Features"));
    for (const f of state.features) {
      const icon = statusIcon(f.status, f.labels);
      lines.push(`  ${icon} ${f.title}`);
    }
    lines.push("");
  }

  // Tasks
  if (state.tasks.length > 0) {
    lines.push(ansi("1", `Tasks (${counts.done}/${counts.total})`));
    for (const t of state.tasks) {
      const icon = statusIcon(t.status, t.labels);
      const claimLabel = t.labels.find((l) => l.startsWith("claim:"));
      const claimStr = claimLabel ? ansi("37", ` (${claimLabel})`) : "";
      lines.push(`  ${icon} ${t.title}${claimStr}`);
    }
  }

  // Critic feedback
  if (state.lastCritic) {
    lines.push("");
    lines.push(ansi("1", "Last Critic"));
    lines.push(`  ${state.lastCritic}`);
  }

  // Evaluator criteria
  if (state.evaluatorCriteria.length > 0) {
    lines.push("");
    lines.push(ansi("1", "Evaluator Criteria"));
    for (const c of state.evaluatorCriteria) {
      lines.push(`  ${c}`);
    }
  }

  // Human gates
  if (state.humanGates.length > 0) {
    lines.push("");
    lines.push(ansi("33;1", "Needs Attention"));
    for (const g of state.humanGates) {
      const icon = g.type === "approve" ? "✅" : g.type === "comment" ? "💬" : "👀";
      lines.push(`  ${icon} ${g.description}`);
    }
  }

  return lines;
}

// ─── Task Detail ─────────────────────────────────────────────────────────────

export function renderTaskDetail(
  task: { id: string; title: string; status: string; labels: string[] },
  comments: { prefix: string; text: string }[],
  workerLog: string[],
): string[] {
  const lines: string[] = [];

  lines.push(ansi("1", `${task.title} (${task.id})`));
  lines.push(`Status: ${task.status}  Labels: ${task.labels.join(", ") || "none"}`);
  lines.push("");

  if (comments.length > 0) {
    lines.push(ansi("1", "Comments"));
    for (const c of comments.slice(-10)) {
      const color = c.prefix === "[human]" ? "33" : c.prefix === "[critic]" ? "35" : "37";
      lines.push(`  ${ansi(color, c.prefix)} ${c.text}`);
    }
    lines.push("");
  }

  if (workerLog.length > 0) {
    lines.push(ansi("1", "Worker Log (tail)"));
    for (const line of workerLog.slice(-8)) {
      lines.push(`  ${ansi("37", line)}`);
    }
  }

  return lines;
}
