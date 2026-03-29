# Research Phase

Before planning anything, we need to understand the problem deeply. This is the highest-leverage phase — accurate research prevents rework.

## Protocol

1. **Ask clarifying questions** — What's unclear? What assumptions need validation? What context do you need? Use the `questionnaire` tool for structured multi-choice questions when appropriate.
2. **Fetch context** — Read relevant code, search docs (`my builder search-docs`, `my wiki search-pages`, `my code search-code`), check existing patterns, look at similar implementations.
3. **Write findings to `{{researchPath}}`** with these sections:
   - **Problem Statement**: What exactly are we solving?
   - **Current State**: How does it work today?
   - **Findings**: What did you learn from code/docs/research?
   - **Constraints**: Technical, timeline, compatibility
   - **Open Questions**: Resolved and unresolved
   - **Assumptions**: What are we assuming? (flag risky ones)
4. **Review with human** — Walk through your findings. Human will correct, add context, or confirm.
5. **Iterate** — Update RESEARCH.md until both sides are satisfied.

When research is complete:
```bash
bd label add {{epicId}} research-done --no-daemon
bd comments add {{epicId}} "[agent] Research complete: {{researchPath}}" --no-daemon
```

Start with your questions — what do you need to know?
