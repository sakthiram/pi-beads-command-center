# Beads Command Center

Pi extension for observable, human-in-the-loop task orchestration. Replaces `beads-executor.sh` and `ralph.sh` with an integrated TUI that keeps the main agent session as the orchestrator.

One session = one epic. The phase pipeline guides you through the workflow — no tribal knowledge needed.

Tested and working end-to-end as of 2026-03-29.

## Install

```bash
# Load directly
pi -e ~/.pi/packages/beads-command-center

# Or add to pi-with for composable loading
pi-with beads-command-center
```

## Prerequisites

- [pi-processes](https://github.com/aliou/pi-processes) — `pi install npm:@aliou/pi-processes`
- [beads](https://github.com/steveyegge/beads) CLI (`bd`) installed
- `questionnaire` extension in `~/.pi/agent/extensions/questionnaire/`
- `sakthisi-beads` skill (optional — extension works without it)

## Phase Pipeline

The widget above the editor shows all phases. Blocked phases are dimmed until prerequisites are met:

```
┌─ auth-refactor ──────────────────────────────────────────────────────────┐
│ ✓ research → ✓ purpose → ▶ plan → ░ decompose → ░ work → ░ evaluate   │
└──────────────────────────────────────────────────────────────────────────┘
```

| Phase | What happens | Gate |
|-------|-------------|------|
| **research** | Agent asks questions (via `questionnaire` tool), fetches context, writes RESEARCH.md | `research-done` label |
| **purpose** | Define WHY — problem, success criteria, constraints | Part of PLAN.md |
| **plan** | Write PLAN.md — approach, risks, tasks, acceptance criteria | `plan-approved` label (human) |
| **decompose** | Break plan into beads features and tasks with full descriptions | Tasks created with `assignee:worker` |
| **work** | Agent executes tasks (or spawns background workers for larger epics) | All tasks closed |
| **evaluate** | Fresh critic session evaluates against acceptance criteria | `critic-satisfied` label |

Research always comes first. Accurate research prevents rework.

## Quick Start

```
1. pi -e ~/.pi/packages/beads-command-center    (start pi with extension)
2. "Start an epic for: <your goal>"             (agent creates epic, enters research)
3. Answer the questionnaire                      (agent asks clarifying questions)
4. Review RESEARCH.md + PLAN.md                  (agent writes both)
5. "Approve the plan"                            (agent decomposes and executes)
6. Agent evaluates via critic                    (spawns fresh session)
7. Done — or remediate and loop                  (automatic on critic failure)
```

In the hello world E2E test, only one human interaction was needed after the initial request: answering 3 questionnaire questions and saying "approve". Everything else was autonomous.

## Commands

| Command | Phase | Description |
|---------|-------|-------------|
| `/beads` | any | Epic dashboard — phases, features, tasks, critic |
| `/beads:research` | research | Start research phase — questions, context, RESEARCH.md |
| `/beads:plan` | plan | Start plan phase (requires `research-done`) |
| `/beads:run` | work | Spawn background workers for ready tasks |
| `/beads:evaluate` | evaluate | Spawn fresh, unbiased critic session |
| `/beads:task <id>` | any | Task detail — comments, worker log, status |
| `/beads:approve` | plan | Approve pending plan |
| `/beads:comment <id> <text>` | any | Add `[human]` comment to a task |
| `/beads:stop` | work | Kill all workers, pause execution |
| `/beads:resume` | work | Resume — re-spawn workers for ready tasks |

## TUI Surfaces

### Phase Pipeline (above editor, always visible)

Shows all phases with status. Blocked phases are dimmed:

```
┌─ hello-py [iter 2] ─────────────────────────────────────────────────────┐
│ ✓ research → ✓ purpose → ✓ plan → ✓ decompose → ▶ work 4/7 → ○ eval │
└──────────────────────────────────────────────────────────────────────────┘
```

Phase states:
- `✓` green — completed
- `▶` yellow — active (current phase)
- `○` white — ready (prerequisites met)
- `░` dim — blocked (prerequisites not met)
- `✗` red — failed/stuck

### Human Gate Widget (below editor)

Only appears when human action is needed:

```
⚠ 1 item needs attention:
  ✅ Plan ready for approval (/beads:approve)
```

### Status Line (footer)

```
hello-py • research
```

### Epic Dashboard (`/beads`)

Full overlay with phase pipeline, features, tasks, critic feedback, and human gates.

## How It Works

### Agent-Driven Loop

The extension drives the agent through notifications and prompt injection:

1. **All tasks done** → notification: "🎯 All tasks done! Run /beads:evaluate"
2. **Critic passes** → notification: "🟢 Critic satisfied! Epic complete."
3. **Critic fails** → notification: "🔴 Critic failed" + remediate prompt auto-loaded into editor
4. **Agent creates fix tasks** → `/beads:run` → workers execute → back to step 1

The agent doesn't need to remember the loop — the extension handles transitions.

### Critic as Separate Session

The evaluate phase spawns a fresh pi session for the critic. The main session has been involved in research, planning, and orchestration — it's biased. The critic:

- Starts with zero conversation history
- Only sees acceptance criteria + task output
- Evaluates purely on output quality
- Can use a different model (`criticModel` setting)

### Tool Gates

The extension blocks direct execution of old orchestration scripts:
- `beads-executor.sh` → blocked, redirects to `/beads:run`
- `ralph.sh` → blocked, redirects to extension commands

Skills don't need modification — the extension overrides at the pi level.

## Artifact Organization

Human-facing artifacts (committable):
```
docs/<epic-name>/
├── RESEARCH.md      # Research findings, constraints, assumptions
└── PLAN.md          # Purpose, approach, risks, acceptance criteria
```

Machine artifacts (ephemeral, git-ignored):
```
.beads/sessions/<epic-id>/
├── critic-iter-1.md
├── worker-task-57.log
└── executor.log
```

## Prompt Templates

Phase prompts are separated from code in `prompts/`:
```
prompts/
├── research.md      # Research protocol with questionnaire guidance
├── plan.md          # Plan structure (PURPOSE, APPROACH, RISKS, TASKS, CRITERIA)
├── decompose.md     # Task description templates, labeling rules, dependency patterns
├── critic.md        # Unbiased evaluation protocol
└── remediate.md     # Fix task creation from critic failures
```

Templates use `{{var}}` placeholders, resolved at runtime by `loadPrompt()`.

## Configuration

Settings via `~/.pi/packages/beads-command-center/settings.json`:

```json
{
  "pollInterval": 5000,
  "maxClaims": 3,
  "maxIterations": 20,
  "maxConcurrentWorkers": 10,
  "workerTimeout": 3600,
  "autoAdvance": false,
  "workerModel": null,
  "criticModel": null,
  "workerSkills": ["sakthisi-beads"]
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `pollInterval` | `5000` | Beads state poll interval (ms) |
| `maxClaims` | `3` | Max worker attempts before marking stuck |
| `maxIterations` | `20` | Max evaluate→remediate loops before stopping |
| `maxConcurrentWorkers` | `10` | Max workers running in parallel |
| `workerTimeout` | `3600` | Kill worker after N seconds (0 = no timeout) |
| `autoAdvance` | `false` | Auto-advance phases without human confirmation |
| `workerModel` | `null` | Model for workers (null = session default) |
| `criticModel` | `null` | Model for critic (null = session default) |
| `workerSkills` | `["sakthisi-beads"]` | Skills to load in worker sessions |

## Testing

See [E2E-TEST-SOP.md](./E2E-TEST-SOP.md) for the full test procedure. The hello world test covers the entire lifecycle in one run.

## Architecture

See [DESIGN.md](./DESIGN.md) for the full design document with mermaid diagrams, design decisions, and TODO items for future work.
