# Plan Phase

Read the research doc at `{{researchPath}}` first. Then write `{{planPath}}` with these sections:

## Required Sections

### 1. PURPOSE
- Why are we doing this? What problem does it solve?
- What does success look like?
- What are the constraints?

### 2. APPROACH
- How will we solve it?
- Key design decisions and trade-offs
- What alternatives were considered and why rejected?

### 3. RISKS
- What could go wrong?
- Mitigation strategies for each risk
- Dependencies on external systems/teams

### 4. TASKS
- High-level breakdown: features → tasks
- Don't over-decompose yet — that's the decompose phase
- Identify parallelizable vs sequential work
- Flag tasks that need human attention (`assignee:human`)

### 5. ACCEPTANCE CRITERIA
- How do we know it's done?
- These become the `[evaluator]` criteria for the critic
- Be specific and testable (e.g., "all tests pass", "coverage >= 80%", "auth flow works e2e")

## Process

Work back and forth with the human — show the outline first, then flesh it out based on feedback.

When the plan is ready for approval, tell the human. They will run `/beads:approve` when satisfied.

After approval:
```bash
bd comments add {{epicId}} "[agent] Plan approved. Proceeding to decomposition." --no-daemon
```
