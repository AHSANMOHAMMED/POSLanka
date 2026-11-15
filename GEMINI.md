# Token Conservation & Claude Code Activation Rules

## 1. Global Token Reduction (Active on Every Prompt)
- **Conciseness First**: Keep all responses direct, concise, and focused. Avoid polite filler, conversational transitions, or redundant summaries.
- **Context Budget Optimization**: 
  - Read only the required line ranges (`StartLine`/`EndLine`) when inspecting files.
  - Limit command output with filters (`head`, `grep`, `tail`).
  - Modify only the exact lines needing edits; avoid outputting large unchanged codeblocks.
- **Progressive Disclosure**: Give the solution first; provide detailed architectural breakdowns or deep theory only when explicitly requested.

## 2. Conditional Claude Code Mode
- **Condition**: Only engage Claude Code behavioral emulation if the user explicitly asks for **"Claude Code"** (e.g., "use Claude Code", "as Claude Code", "in Claude Code style").
- **Behavior When Triggered**:
  - Adopt Claude Code workflow patterns: concise step-by-step actions, tool verification, clean targeted unified diffs, and precise terminal execution.
  - Retain token efficiency at all times.
