import type { EpicState, TaskCounts } from "./beads.js";
import { findActiveEpic, getEpicState, countTasks } from "./beads.js";

// ─── Poller ──────────────────────────────────────────────────────────────────
// Periodically reads beads state and detects changes.
// Does NOT make decisions — only reports state changes via callbacks.

export interface PollerCallbacks {
  onTaskCompleted: (taskId: string, title: string) => void;
  onAllTasksDone: (epicId: string) => void;
  onTaskStuck: (taskId: string, title: string) => void;
  onHumanGateAdded: (description: string) => void;
  onHumanGateResolved: () => void;
  onPhaseChanged: (phase: string, iteration: number) => void;
  onEpicCompleted: (epicId: string) => void;
  onCriticDone: (epicId: string, satisfied: boolean, lastCritic: string, iteration: number) => void;
  onStateChanged: (state: EpicState, counts: TaskCounts) => void;
}

export class Poller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastState: EpicState | null = null;
  private lastCounts: TaskCounts | null = null;
  private callbacks: PollerCallbacks;
  private pollMs: number;
  private epicId: string | null = null;
  private cwd: string;

  constructor(callbacks: PollerCallbacks, pollMs = 5000, cwd?: string) {
    this.callbacks = callbacks;
    this.pollMs = pollMs;
    this.cwd = cwd || process.cwd();
  }

  start(epicId?: string): void {
    this.epicId = epicId || null;
    this.stop();
    this.poll(); // immediate first poll
    this.interval = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  getState(): EpicState | null {
    return this.lastState;
  }

  getCounts(): TaskCounts | null {
    return this.lastCounts;
  }

  private poll(): void {
    try {
      // Find epic if not set
      if (!this.epicId) {
        const epic = findActiveEpic(this.cwd);
        if (!epic) return;
        this.epicId = epic.id;
      }

      const state = getEpicState(this.epicId, this.cwd);
      if (!state) return;

      const counts = countTasks(state.tasks);
      const prev = this.lastState;
      const prevCounts = this.lastCounts;

      // Detect changes
      if (prev) {
        // Task completions
        for (const task of state.tasks) {
          const prevTask = prev.tasks.find((t) => t.id === task.id);
          if (prevTask && prevTask.status !== "closed" && task.status === "closed") {
            this.callbacks.onTaskCompleted(task.id, task.title);
          }
          if (prevTask && !prevTask.labels.includes("stuck") && task.labels.includes("stuck")) {
            this.callbacks.onTaskStuck(task.id, task.title);
          }
        }

        // Phase changes
        if (prev.phase !== state.phase || prev.iteration !== state.iteration) {
          this.callbacks.onPhaseChanged(state.phase, state.iteration);
        }

        // All tasks done detection
        if (counts.total > 0 && counts.done === counts.total) {
          const prevCounts = this.lastCounts;
          if (!prevCounts || prevCounts.done < prevCounts.total) {
            this.callbacks.onAllTasksDone(state.epic.id);
          }
        }

        // Human gates
        if (state.humanGates.length > prev.humanGates.length) {
          const newGate = state.humanGates[state.humanGates.length - 1];
          if (newGate) {
            this.callbacks.onHumanGateAdded(newGate.description);
          }
        }
        if (state.humanGates.length < prev.humanGates.length) {
          this.callbacks.onHumanGateResolved();
        }

        // Epic completion
        if (prev.epic.status !== "closed" && state.epic.status === "closed") {
          this.callbacks.onEpicCompleted(state.epic.id);
        }

        // Critic done detection (new critic comment appeared)
        if (state.lastCritic && state.lastCritic !== prev.lastCritic) {
          this.callbacks.onCriticDone(
            state.epic.id,
            state.criticSatisfied,
            state.lastCritic,
            state.iteration,
          );
        }
      }

      // Always fire state changed on first poll or when counts differ
      if (!prevCounts || counts.done !== prevCounts.done ||
          counts.inProgress !== prevCounts.inProgress ||
          counts.stuck !== prevCounts.stuck ||
          counts.total !== prevCounts.total) {
        this.callbacks.onStateChanged(state, counts);
      }

      this.lastState = state;
      this.lastCounts = counts;
    } catch {
      // Silently skip poll errors (bd not available, no .beads, etc.)
    }
  }
}
