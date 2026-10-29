---
name: gemini-cli
description: "Review Codex's outputs, code, designs, and opinions through Antigravity CLI, using Gemini with quota-aware Claude/GPT fallback and observable long-running reviews. Use for Gemini CLI, second opinions, or Codex-Gemini review and follow-up requests."
---

# Gemini collaboration from Codex

Use the official Antigravity CLI (`agy`) as the consumer Google-login backend. The user authorized its installation and this bridge on 2026-10-24. Codex remains the host; Gemini receives only the supplied brief and its own resumed conversation. This does not change the Codex model or merge the two models' context windows.

## Primary use: review Codex's work

The user's stated purpose (2026-10-24) is primarily an independent review of Codex-created artifacts and opinions. When this skill is invoked, first identify the artifact or conclusion to review. Do not default to having Gemini implement the project or explore the entire repository.

Brief the reviewer with the user's goal, relevant constraints, Codex's result/proposal, the smallest relevant code/diff/excerpts, and what tests or source checks actually ran. Distinguish established facts from Codex's assumptions. Ask for concrete bugs, unsupported claims, counterexamples, missing requirements, and tradeoffs, ranked by impact. Each finding should identify evidence/location, practical consequence, and a correction or way to check it. Limit routine output to five findings and about 500 words. Allow "no material issue found"; do not manufacture criticisms or request agreement with Codex.

Use Flash High as the default review preference; Flash Medium can be selected for routine prose. The user authorized automatic cross-family fallback on 2026-10-24. The helper checks the live model list and shared quota before each review and records all skips, attempts, and the model actually used. Honor an explicitly pinned model with `--no-fallback`. Scope reviews to supplied files/excerpts, and ask the reviewer not to run commands, edit files, or perform broad searches unless needed for the authorized review.

Default to one review call per artifact. Continue the same conversation once only when a material finding needs discussion or a revision needs checking. Codex independently checks Gemini's findings against files, primary sources, calculations, or tests and reports which were adopted, rejected, or remain uncertain. Model agreement is not validation. Use a fresh Gemini conversation for unrelated artifacts so context does not grow indefinitely.

For usage planning, query --usage around representative reviews, record the change in percentage points and whether a reset or other account activity occurred, and distinguish calls from review cycles (one review plus one follow-up is two calls). A rounded percentage and a few samples do not establish a daily allowance. Do not exhaust quota or run a stress test just to estimate it. See [review-usage-20261024.md](references/review-usage-20261024.md) for dated account observations and first-person usage reports.

## Installed entry point

```powershell
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --status
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --models
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --usage
```

`--status` checks only the binary version. `--models` queries the signed-in account. `--usage` runs the CLI's built-in /usage report; `--usage-json` returns its structured quota groups and remaining_fraction values for measurement. Inspect these before claiming a subscription, remaining quota, or model access. Installation and successful authentication do not prove inference works.

Write a UTF-8 brief in the current task's `work/` folder. Include the task, necessary code/data excerpts, Codex's proposal, and specific questions for the peer. Avoid unnecessary personal data; never send credentials, protected internal documents, or the entire Codex history. Using a third-party model sends the brief to Google.

```powershell
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --prompt-file "work/gemini-brief.txt" --model EXACT-SLUG-FROM-MODELS --effort high --cwd "C:/path/to/project" --output "work/gemini-review.json"
```

Use exact slugs from `--models`. Without `--model`, the bridge uses its review fallback chain, not the CLI's implicit default. An explicit `--model` starts the chain there; `--no-fallback` pins it. If the user explicitly requires only that model, pass both flags. Always disclose a family switch and its reason in the result; never describe Claude/GPT output as Gemini output.

## Quota fallback and long reviews

Default preference: **Flash 3.8 High → Flash 3.8 Medium → Claude Opus 4.6 Thinking → Claude Sonnet 4.6 Thinking → Flash 3.8 Low → GPT-OSS 120B Medium**. Opus precedes Sonnet for a deliberate deep-review preference; this is not a measured cross-model quality ranking. Only currently listed models are eligible, so withdrawn models are skipped. Override this order with `--fallback-models slug,slug` when requested; do not guess successor slugs.

The current `/usage` report groups Gemini variants into one weekly pool and Claude/GPT into another. A zero shared pool skips every sibling model: High → Medium cannot replenish Gemini quota, and Opus → Sonnet cannot replenish third-party quota. A model-specific 429 while the group still has quota, or an explicit unavailable/503 response, can advance to the next candidate. Refresh quota after such an error; try each eligible model at most once. Unknown quota is not zero. If both pools are exhausted, return an error and reset information from the quota snapshot; do not enable credits or change accounts.

The default **600-second total review budget** includes discovery and all fallback attempts. Use `--timeout-seconds 900` (15 minutes), up to 3600, for a larger review. The helper streams events and emits a metadata heartbeat every 20 seconds to stderr and `<output>.progress.json`. Keep the running tool session and inspect those heartbeats; do not start duplicate requests merely because the terminal is quiet.

- `receiving_events`: recent structured CLI events were received. This is evidence of recent CLI activity, not proof of a currently healthy server connection.
- `waiting_no_recent_event` with `process_alive=true`: the local CLI is alive, but current remote work is unknown. It may be reasoning, queued, retrying internally, or stalled. Never label silence as confirmed thinking or confirmed disconnection.
- `connection_error`: a terminal explicit connection/reset/DNS/TLS error; record the error.
- `deadline_exceeded`: the budget expired and the child process was terminated. Server activity is unknown. **Do not automatically retry or switch models** on this ambiguity, a connection failure, authentication/permission failure, malformed output, or unexpected process exit.

Read the final result's `bridge.attempts[].diagnostics` for elapsed time, event count, last received event, process exit, and transport outcome. A recent event may contain partial response/tool activity; progress files intentionally omit response/thinking text. A failed/incomplete request cannot be resumed automatically through `--conversation-file`. See [fallback-and-progress.md](references/fallback-and-progress.md) for options and validation scope.

Default `--effort auto` uses the exact model slug's native thinking setting: High/Medium/Low for Gemini, and the built-in mode of Claude/GPT. Do not pass a generic `--effort high` to every model: CLI 1.4.7 rejects it for Claude 4.6 and for the Gemini Medium slug. Effort-only requests such as `--effort medium` select a matching Gemini candidate when no model is explicitly pinned. An explicit compatible effort applies to the first candidate; fallback candidates use their own native setting and the result records the selection. The CLI accepts low|medium|high|xhigh|max syntactically, but support depends on the model. The helper reports requested/reported model, selected effort when encoded in the slug, response, conversation ID, and token usage including `thinking_tokens`. Inspect `denied_actions` even on SUCCESS and report blocked verification. An effort request alone does not prove inference or a Deep Think entitlement. Ask for a concise reasoning summary, never private chain of thought.

## Collaborate over multiple turns

1. Codex forms a proposal or implements within the user's authorized scope.
2. Send the relevant brief to Gemini for independent critique.
3. Read `status`, `response`, `usage`, and bridge metadata. Verify advice against code, sources, and tests before accepting it.
4. Codex revises and sends a follow-up in the same Gemini conversation:

```powershell
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --prompt-file "work/gemini-followup.txt" --conversation-file "work/gemini-review.json" --output "work/gemini-followup.json" --cwd "C:/path/to/project"
```

The helper starts with the previous successfully selected model and effort unless explicitly changed. `--conversation UUID` also resumes a native session. The requested UUID must match the final response, including across a model change; otherwise continuity is rejected. Use separate result files/UUIDs for unrelated chats, and do not run simultaneous requests against the same conversation. Normally use one review plus one follow-up; stop when checks pass or a substantive disagreement needs user input. Do not recurse into Codex/other peers from the reviewer or create an unbounded exchange.

## Account, permissions, and cost boundaries

- Student AI Pro uses account authentication, not a Gemini API key. Run the installed `%LOCALAPPDATA%/agy/bin/agy.exe` interactively if sign-in is required. Let the user complete Google OAuth in a visible terminal/browser, including code entry there when needed; never ask for an auth code in chat or print token contents.
- The helper removes API-key and ADC environment overrides, rejects `modelProvider=gemini`, and requires credit overages to be off in `~/.gemini/antigravity-cli/settings.json` (`useG1Credits=false`, or absent because false is the documented default). This disables automatic credit overages; it does not measure remaining quota. Never purchase credits, upgrade a plan, or enable overages without explicit authorization.
- Official plans include a weekly free baseline; Pro has a higher allowance with five-hour refresh until a weekly cap. Exact counts are capacity/workload dependent. Student/trial Pro can have fewer available models than paid Pro. Use the actual account list and quota report.
- Run requests in plan mode without `--dangerously-skip-permissions`. This is a review/planning workflow, not an operating-system security sandbox: CLI artifacts/session files may be written. Honor existing permissions and do not claim plan mode guarantees zero filesystem writes. Codex applies changes and runs checks within task authorization.
- Inspect both process exit and JSON status. Quota/model availability may use the bounded chain above; authentication/eligibility, transport, or ambiguous timeout errors stop automatically. Do not swap account/backend/paid route.
- `--dry-run` checks arguments without a model request. It does not validate authentication or model access.

## Legacy Gemini CLI

The original open-source `gemini` CLI 0.65.0 remains installed. Its consumer Google login failed with `IneligibleTierError / RESTRICTED_DASHER_USER`. Google's current shutdown notice says AI Pro/Ultra and free individual Google-login access ended 2026-06-18. Old authentication/quota pages still describe the previous arrangement. The old `scripts/ask-gemini.mjs` is retained for explicitly requested legacy use only; do not retry that route for this consumer account.

For research, model/credit caveats, and inspected open-source examples, read [references/integration-notes.md](references/integration-notes.md). The bridge is original local glue around the official CLI protocol; it is not a copied or installed PAL/agent-bridge stack.
