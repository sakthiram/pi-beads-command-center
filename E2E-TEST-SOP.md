# E2E Test SOP for Beads Command Center

Run this test to verify the extension works end-to-end. Tested and passing as of 2026-03-29.

## Prerequisites

- `pi` installed with `beads-command-center` package
- `pi-processes` extension installed (`pi install npm:@aliou/pi-processes`)
- `questionnaire` extension installed (in `~/.pi/agent/extensions/questionnaire/`)
- `bd` CLI installed (`curl -fsSL https://raw.githubusercontent.com/steveyegge/beads/main/scripts/install.sh | bash`)

## Test Setup

```bash
# Create fresh test repo
mkdir -p /tmp/bcc-e2e-test && cd /tmp/bcc-e2e-test
git init -q && echo "# Test" > README.md && git add . && git commit -q -m "init"
bd init --stealth

# Create tmux window and start pi with the extension
tmux new-window -n bcc-e2e -c /tmp/bcc-e2e-test
tmux send-keys -t bcc-e2e "pi -e ~/.pi/packages/beads-command-center" Enter

# Wait for pi to initialize (~15s)
sleep 15
```

## Verify Extension Loaded

```bash
tmux capture-pane -t bcc-e2e -p | tail -10
```

**Expected:** Status line shows `beads: no active epic` (no epic created yet).

---

## Test: Full Lifecycle (Hello World)

This single test covers the entire flow: research → plan → decompose → work → evaluate → complete.

### Step 1: Send Initial Request

```bash
tmux send-keys -t bcc-e2e "Start an epic for: Create a Python script called hello.py that prints 'Hello, World!' and accepts an optional name argument to print 'Hello, <name>!'. Include a test file." Enter
```

**Expected (within ~30s):**
- Agent creates epic via `bd create`
- Agent enters research phase
- Agent uses `questionnaire` tool to ask structured questions (Python version, arg parsing, test framework)
- Pipeline widget appears: `▶ research → ░ purpose → ░ plan → ░ decompose → ░ work → ░ evaluate`

### Step 2: Answer Questionnaire

The agent presents a tab-based questionnaire. Answer with arrow keys + Enter:

1. **Python Version** → Select `Python 3.8+` (Enter on first option)
2. **Arg Parsing** → Select `sys.argv` (Down, Enter)
3. **Test Framework** → Select `unittest` (Down, Enter)
4. **Submit** → Press Enter

**Expected (within ~30s):**
- Agent writes `docs/hello-py/RESEARCH.md` with findings
- Agent marks `research-done` label
- Agent writes `docs/hello-py/PLAN.md` with PURPOSE, APPROACH, TASKS, ACCEPTANCE CRITERIA
- Agent asks for plan approval

### Step 3: Approve and Execute

```bash
tmux send-keys -t bcc-e2e "Looks good, approve the plan and decompose into tasks, then start workers" Enter
```

**Expected (within ~60s):**
- Agent adds `plan-approved` label
- Agent decomposes into tasks (creates features + tasks with descriptions)
- Agent labels tasks with `assignee:worker` and `session:<epic-id>`
- Agent executes the work (writes `hello.py` + `test_hello.py`)
- Agent runs tests to verify
- Agent closes tasks with completion reasons

### Step 4: Automatic Evaluation

**Expected (within ~30s after tasks close):**
- Agent spawns a critic session via `process start`
- Critic runs acceptance criteria checks (runs hello.py, runs tests)
- Critic reports all criteria PASS
- Agent closes epic with reason: "All acceptance criteria passed"

### Verify Results

```bash
# Check files
cd /tmp/bcc-e2e-test
cat hello.py                          # Should have greet() function
python3 hello.py                      # → Hello, World!
python3 hello.py Alice                # → Hello, Alice!
python3 -m unittest test_hello        # → OK

# Check docs
ls docs/hello-py/                     # RESEARCH.md, PLAN.md

# Check beads state
bd list --all --no-daemon             # All items closed
```

**Expected output:**
```
✓ <epic-id>.2 [P2] [task] [assignee:worker] - task
✓ <epic-id>.1 [P2] [task] [assignee:worker] - task
✓ <epic-id> [P2] [task] [plan-approved research-done] - epic
```

---

## What the Test Validates

| Phase | Validated |
|-------|-----------|
| Extension load | Pipeline widget renders, status line shows |
| Research | Questionnaire tool used, RESEARCH.md created, `research-done` label |
| Plan | PLAN.md with all sections, agent waits for approval |
| Approve | `plan-approved` label added on human approval |
| Decompose | Tasks created with descriptions and labels |
| Work | Code written, tests pass, tasks closed |
| Evaluate | Critic spawned as separate process, criteria checked, epic closed |
| Artifacts | `docs/hello-py/` has RESEARCH.md + PLAN.md |
| Tool gates | Agent uses extension flow, not `beads-executor.sh` or `ralph.sh` |

## Cleanup

```bash
tmux kill-window -t bcc-e2e 2>/dev/null
rm -rf /tmp/bcc-e2e-test
```
