// Review preference, not a benchmark ranking. Only discovered models are used.
export const DEFAULT_MODELS = ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'claude-opus-4-6-thinking', 'claude-sonnet-4-6', 'gemini-3.8-flash-low', 'gpt-oss-120b-medium'];

export function effortArgs(model, effort = 'auto') {
  // Exact slugs already select thinking settings. Claude 4.6 rejects --effort.
  if (effort === 'auto') return [];
  if (/^(claude-|gpt-oss-)/.test(model)) throw new Error(`${model} does not accept an explicit --effort; use auto and its built-in thinking setting.`);
  const fixed = model.match(/^gemini-.+-(low|medium|high)$/)?.[1];
  if (fixed && fixed !== effort) throw new Error(`${model} conflicts with --effort ${effort}; choose its matching slug or auto.`);
  return ['--effort', effort];
}

export function modelGroup(model) {
  if (model.startsWith('gemini-')) return 'gemini';
  if (/^(claude-|gpt-oss-)/.test(model)) return 'third-party';
  return null;
}

export function exhaustedGroups(quota, now = Date.now()) {
  const exhausted = new Set();
  for (const group of quota?.command?.data?.groups || []) {
    const id = group.name === 'Gemini Models' ? 'gemini' : group.name === 'Claude and GPT models' ? 'third-party' : null;
    if (!id) continue;
    if ((group.buckets || []).some(b => typeof b.remaining_fraction === 'number' && b.remaining_fraction <= 0 && (!b.reset_time || !Number.isFinite(Date.parse(b.reset_time)) || Date.parse(b.reset_time) > now))) exhausted.add(id);
  }
  return exhausted;
}

export function failureKind(result, transport) {
  if (transport === 'deadline_exceeded') return 'deadline_exceeded';
  if (transport === 'output_limit' || transport === 'spawn_error') return transport;
  const error = typeof result.error === 'string' ? result.error : JSON.stringify(result.error || '');
  const text = `${error} ${result.detail || ''}`;
  if (/unauthenticated|authentication required|login required|sign.?in|permission_denied|ineligible|restricted_dasher|\b401\b|\b403\b/i.test(text)) return 'authentication_or_permission';
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|broken pipe|socket hang up|connection (?:reset|refused|closed|timed out)|network (?:error|unreachable)|TLS handshake/i.test(text)) return 'connection_error';
  if (/quota|resource_exhausted|rate.?limit|too many requests|\b429\b/i.test(text)) return 'quota_or_rate_limit';
  if (/--effort.*(?:not supported|conflicts)|conflicts with --effort|invalid effort/i.test(text)) return 'request_configuration_error';
  if (/model.*(?:not found|not available|unavailable|not supported|unknown)|unknown model|\b503\b|service unavailable|capacity exhausted|overloaded/i.test(text)) return 'model_unavailable';
  return 'request_error';
}

export async function reviewWithFallback({ candidates, available, getQuota, run, fallback = true, onProgress = () => {} }) {
  const attempts = [];
  const skipped = [];
  let quota = await getQuota();
  for (const model of candidates) {
    if (!available.has(model)) { skipped.push({ model, reason: 'not_in_current_model_list' }); continue; }
    if (exhaustedGroups(quota).has(modelGroup(model))) { skipped.push({ model, reason: 'shared_quota_exhausted' }); continue; }
    onProgress({ state: 'attempt_start', model, attempt: attempts.length + 1 });
    const result = await run(model);
    const kind = result.data.status === 'SUCCESS' && result.exitCode === 0 ? 'success' : failureKind(result.data, result.transport);
    attempts.push({ model, reported_model: result.reportedModel, outcome: kind, exit_code: result.exitCode, conversation_id: result.data.conversation_id || null, usage: result.data.usage || null, error: kind === 'success' ? undefined : result.data.error, diagnostics: result.diagnostics });
    if (kind === 'success') return { ...result, selectedModel: model, attempts, skipped, quota };
    if (!fallback || !['quota_or_rate_limit', 'model_unavailable'].includes(kind)) return { ...result, selectedModel: model, attempts, skipped, quota };
    // A 429 may be a short rate limit rather than an empty shared pool. Recheck.
    quota = await getQuota();
    onProgress({ state: 'fallback', model, reason: kind });
  }
  return { data: { status: 'ERROR', error: 'No eligible fallback model remains in the live model list and included quota.' }, exitCode: 1, reportedModel: null, selectedModel: null, attempts, skipped, quota };
}
