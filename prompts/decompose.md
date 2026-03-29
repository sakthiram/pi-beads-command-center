# Decompose Phase

Break the approved plan into beads features and tasks.

## Prerequisites

- Epic `{{epicId}}` has `plan-approved` label
- PLAN.md exists at `{{planPath}}`

## Human Override Rule

Check for human directives first:
```bash
bd comments {{epicId}} --no-daemon | grep "^\[human\]"
```
If found, follow that guidance over default approaches.

## Decomposition Modes

| Mode | When | Action |
|------|------|--------|
| **Fresh** | plan-approved + no features | Create all from scratch |
| **Augmentation** | plan-approved + existing features | Add to existing |
| **Remediation** | [critic] + explicit request | Fix critic failures |

## Principles

### Atomic Tasks
- **Completable**: Can be done in one work session (1-4 hours)
- **Testable**: Clear way to verify it's done
- **Independent**: Minimal coupling to other tasks

### Task Sizing
- Too big (multiple days, multiple outcomes) → split it
- Too small (minutes, trivial) → combine with related work
- Just right: 1-4 hours, single clear outcome

## Process

### Step 1: Features from Plan

Read the plan and create one feature per planned feature:
```bash
bd create "Feature: <name>" -t feature --parent {{epicId}} -d "<feature description>" --no-daemon
```

Use the feature description template:
```markdown
## Frozen Plan

[Paste the relevant section from PLAN.md]

## Overview
[Brief description of what this feature accomplishes]

## Child Tasks
1. [Task 1]
2. [Task 2]

## Success Criteria
- [ ] All child tasks completed
- [ ] Integration tested
```

### Step 2: Tasks from Features

Break each feature into tasks with FULL descriptions:
```bash
bd create "<task-title>" -t task --parent <feature-id> -d "<description>" --no-daemon
```

**CRITICAL**: Every task MUST use this description template:

```markdown
## Background
[Why this task exists, how it fits into the larger plan]

## Objective
[Clear statement of what needs to be accomplished]

## Context
- **Feature**: <feature-id>
- **Dependencies**: [What must complete first and why]
- **Dependents**: [What's waiting on this and why]

## Implementation Details
[Specific guidance from the plan]

### Files to Modify:
- `path/to/file.ext` - [what changes]

### Code References:
- Similar pattern: `file:line`

## Acceptance Criteria
- [ ] Tests pass
- [ ] Build succeeds
- [ ] [specific behavior to verify]

## Considerations
- [Edge cases to handle]
- [Potential gotchas]
```

### Step 3: Dependencies

Set blocking relationships where needed:
```bash
# task-B depends on task-A (task-A must complete first)
bd dep add <task-B-id> <task-A-id> --no-daemon
```

Prefer parallel work. Only add dependencies when strict ordering is required.

Avoid file conflicts: if tasks modify same files, add explicit dependency or designate one as "integration" task.

### Step 4: Label ALL Tasks

Label every task — including those with blockers:
```bash
bd label add <task-id> assignee:worker --no-daemon
bd label add <task-id> session:{{epicId}} --no-daemon
```

> **Why label blocked tasks?** The executor uses `bd ready --label "assignee:worker"` which only returns tasks whose dependencies are resolved. If you skip the label on blocked tasks, they'll never be picked up even after dependencies complete.

Tasks needing human action (review gates, sign-offs):
```bash
bd label add <task-id> assignee:human --no-daemon
```

### Step 5: Verify

```bash
bd dep cycles --no-daemon          # No cycles
bd list --parent {{epicId}} --no-daemon  # All tasks listed
```

## After Decomposition

```bash
bd label add {{epicId}} phase:work --no-daemon
bd comments add {{epicId}} "[agent] Decomposition complete. Tasks created and labeled." --no-daemon
```

Then tell the human: "Tasks are ready. Run `/beads:run` to spawn workers, or review the breakdown first with `/beads`."
