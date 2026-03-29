# Remediate Phase

The critic evaluated epic `{{epicId}}` and found failures. Create remediation tasks to address them.

## Critic Feedback

```
{{criticComment}}
```

## Steps

1. Read the full critic comment for details:
   ```bash
   bd comments {{epicId}} --no-daemon | grep "^\[critic\]"
   ```

2. For each failed criterion, create a remediation task:
   ```bash
   bd create "<fix-description>" -t task --parent {{epicId}} --no-daemon
   ```

3. Add description to each task using this template:
   ```
   What: Fix <failed criterion>
   Why: Critic iteration {{iteration}} failed: <specific failure>
   How: <approach based on critic's Fix suggestion>
   Done: <how to verify the fix — rerun the specific check>
   ```

4. Label tasks for worker assignment:
   ```bash
   bd label add <task-id> assignee:worker --no-daemon
   bd label add <task-id> session:{{epicId}} --no-daemon
   ```

5. Advance iteration:
   ```bash
   bd label remove {{epicId}} iteration:{{iteration}} --no-daemon
   bd label add {{epicId}} iteration:{{nextIteration}} --no-daemon
   bd label add {{epicId}} phase:work --no-daemon
   ```

6. Spawn workers: tell the human to run `/beads:run` or spawn directly.

## Important

- Do NOT re-create tasks that already passed — only address failures
- Reference the critic's specific feedback in task descriptions
- If the same criterion has failed multiple iterations, escalate to human (`assignee:human`)
