# Included-quota review fallback

The user authorized this policy on 2026-10-24. The chain in `scripts/review-policy.mjs` is a review preference, not a universal quality ranking. Candidate availability and group usage are queried afresh; no quota exhaustion is inferred from silence.

```powershell
# Default chain, ten-minute total budget; JSON result plus metadata progress sidecar.
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --prompt-file "work/review.txt" --output "work/review.json"

# A larger review, up to fifteen minutes across all attempts.
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --prompt-file "work/review.txt" --timeout-seconds 900 --output "work/review.json"

# User-selected order (also filtered by live model availability and shared quota).
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --prompt-file "work/review.txt" --fallback-models gemini-3.8-flash-high,gemini-3.8-flash-medium,claude-sonnet-4-6 --output "work/review.json"

# Pin one exact model; no cross-model fallback.
node "C:/Users/user/.codex/skills/gemini-cli/scripts/ask-antigravity.mjs" --prompt-file "work/review.txt" --model gemini-3.8-flash-high --no-fallback --output "work/review.json"
```

Default `--effort auto` passes the exact model slug without a separate effort flag. Live CLI 1.4.7 testing showed that Gemini Medium rejects a conflicting high effort and Claude 4.6 rejects the effort flag altogether. Explicit matching Gemini effort is supported for the first candidate; subsequent fallback candidates use their native settings. Incompatible explicit combinations fail locally before inference and are never classified as quota exhaustion. The result records the requested policy and selected slug's effort where known; Claude's numeric effort is left unknown rather than invented.

The 2026-10-24 account report explicitly states models within a group share a weekly limit. Gemini Flash and Pro share the Gemini pool; Claude Opus, Sonnet and GPT-OSS share the third-party pool. The helper checks all non-expired quota buckets with numeric fractions, and skips an exhausted group. Expired zero snapshots are not treated as current exhaustion. An unavailable usage query is recorded as unknown, not full or empty.

Each candidate is attempted at most once per invocation. Only an explicit quota/rate-limit or unavailable/capacity error allows automatic switching. After these failures, the bridge rechecks usage before choosing another candidate. There is no paid-credit, API-key, account, or backend fallback. It rejects enabled credit overages and API-key-provider settings and removes inherited key/ADC overrides.

The native streamed protocol supplies init, step-update and terminal-result events. The bridge records timestamps/types/counts, never private reasoning text in the progress sidecar. A live local process with no recent event does not establish whether remote inference is still working. Explicit terminal transport errors and abnormal exits are distinguishable from this unknown state. A 600-second deadline does not establish a broken connection; it terminates the local request and stops, with no automatic replay. A server-side job might persist after a client timeout, so a manual retry is a new decision.

A final successful response must be non-empty, have exactly one valid result event, exit with code zero, preserve a requested native conversation UUID, and match the requested model if the CLI reports an init model. Missing model reporting remains null and must not be presented as observed model confirmation. Inspect `denied_actions`; permission denials can coexist with a successful answer.

Tests should cover shared-pool exhaustion before/after a request, model-specific 429, missing model, 503, bounded attempts, auth/transport/timeout stop conditions, malformed output, wrong conversation/model, slow event streams, and a live silent child being terminated at deadline. Simulated failures verify policy without burning real quota. Live reviews separately verify authentication, protocol, actual reported model, response correctness and token accounting. Never claim a real exhausted-account fallback was observed unless it actually occurred.

Run the included regression tests locally (no model calls):

```powershell
node --test "C:/Users/user/.codex/skills/gemini-cli/scripts/tests/test-antigravity-bridge.mjs" "C:/Users/user/.codex/skills/gemini-cli/scripts/tests/test-fallback.mjs"
```

The entrypoint argument tests require the installed Windows CLI binary and account settings but use dry-run/local validation only. Process-stream and fallback-policy tests use local fixtures; no quota is consumed.

Official protocol: https://antigravity.google/docs/cli/headless/
Official live model availability/removals: https://antigravity.google/docs/models
The 2026-10-24 model page schedules Claude 4.6 and GPT-OSS removal for 2026-11-02; the bridge must skip them once absent. If no supported candidate remains, report it and update the preference using newly verified slugs, rather than silently selecting an unknown future model.
