---
name: token-saver
description: Token conservation and efficiency protocol. Always apply these guidelines on every prompt, and enable full Claude-style deep execution only when Claude Code is explicitly requested.
---

# Token Conservation & Efficiency Protocol

This protocol must be applied across interactions to minimize token consumption and stay well within context and quota limits.

## 1. Universal Token Reduction Rules (Every Prompt)
- **High-Density Output**: Be direct, precise, and concise. Avoid conversational filler, excessive preamble, or repetitive closing remarks.
- **Minimal Code Diffs**: When modifying code, emit targeted replacements or only the changed segments rather than rewriting whole files.
- **Targeted Inspection**:
  - Read specific line ranges using `StartLine` and `EndLine` rather than dumping entire large files.
  - Avoid wide directory listings (`find`, large `ls -R`). Filter specifically to target paths.
- **Context Economy**: Do not repeat questions, duplicate previous explanations, or re-summarize unchanged file content.

## 2. Execution Profiles: Standard vs. Claude Code Mode

### Default Mode (Standard / Efficiency Mode)
- Keep responses short, concise, and focused strictly on the immediate goal.
- Run commands with precise filters (`grep`, `head`, `tail`, specific line numbers).
- Skip verbose architectural explanations unless explicitly asked.

### Claude Code Mode (Triggered Only When "Claude Code" is Requested)
Activate this mode **only** if the user explicitly mentions or asks for **"Claude Code"**:
- **Role Emulation**: Emulate Claude Code CLI conventions (clean concise diffs, agentic command executions, step-by-step progress tracking).
- **Targeted Deep Reasoning**: Perform thorough step-by-step verification and validation while maintaining high token efficiency.
- **Claude Formatting**: Provide compact, well-structured output matching Claude Code CLI workflows.
