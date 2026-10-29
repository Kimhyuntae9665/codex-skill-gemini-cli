import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DEFAULT_MODELS, effortArgs, exhaustedGroups, failureKind, reviewWithFallback } from '../review-policy.mjs';
import { runStream } from '../stream-runner.mjs';
const [high, medium, opus, sonnet, low, gpt] = DEFAULT_MODELS;
const quota = (g = 1, t = 1) => ({ command: { data: { groups: [{ name: 'Gemini Models', buckets: [{ remaining_fraction: g }] }, { name: 'Claude and GPT models', buckets: [{ remaining_fraction: t }] }] } } });
const ok = model => ({ data: { status: 'SUCCESS', response: 'review' }, reportedModel: model, exitCode: 0 });
const failed = (error, transport) => ({ data: { status: 'ERROR', error }, exitCode: 1, transport });
async function simulate({ q = quota(), results = {}, candidates = DEFAULT_MODELS, available = DEFAULT_MODELS, fallback = true } = {}) {
  const calls = []; let n = 0;
  const result = await reviewWithFallback({ candidates, available: new Set(available), fallback, getQuota: async () => typeof q === 'function' ? q(n++) : q, run: async model => { calls.push(model); return results[model] || ok(model); } });
  return { ...result, calls };
}
test('starts with the preferred available model and stops after success', async () => {
  const r = await simulate(); assert.deepEqual(r.calls, [high]); assert.equal(r.selectedModel, high);
});
test('zero shared Gemini quota skips High, Medium, Low and reaches Opus', async () => {
  const r = await simulate({ q: quota(0) }); assert.deepEqual(r.calls, [opus]); assert.equal(r.skipped.length, 2);
});
test('a model-specific 429 with remaining shared quota reaches Medium once', async () => {
  const r = await simulate({ results: { [high]: failed('429 too many requests') } }); assert.deepEqual(r.calls, [high, medium]);
});
test('newly exhausted quota after a request skips sibling models', async () => {
  const r = await simulate({ q: n => quota(n === 0 ? 1 : 0), results: { [high]: failed('RESOURCE_EXHAUSTED quota') } }); assert.deepEqual(r.calls, [high, opus]);
});
test('capacity/model availability errors try the next discovered candidate', async () => {
  const r = await simulate({ available: [high, sonnet], results: { [high]: failed('503 service unavailable') } }); assert.deepEqual(r.calls, [high, sonnet]);
});
test('both shared pools exhausted makes no inference calls', async () => {
  const r = await simulate({ q: quota(0, 0) }); assert.deepEqual(r.calls, []); assert.equal(r.data.status, 'ERROR');
});
test('timeout, broken connection, auth and generic errors never cause fallback', async () => {
  for (const result of [failed('deadline', 'deadline_exceeded'), failed('ECONNRESET'), failed('401 unauthenticated'), failed('unexpected failure')]) {
    const r = await simulate({ results: { [high]: result } }); assert.deepEqual(r.calls, [high]); assert.equal(r.data.status, 'ERROR');
  }
});
test('quota unknown does not mean quota zero; no-fallback pins one attempt', async () => {
  assert.deepEqual((await simulate({ q: null })).calls, [high]);
  assert.deepEqual((await simulate({ fallback: false, results: { [high]: failed('quota exhausted') } })).calls, [high]);
});
test('bounded chain never retries a model indefinitely', async () => {
  const r = await simulate({ results: Object.fromEntries(DEFAULT_MODELS.map(m => [m, failed('model unavailable')])) }); assert.deepEqual(r.calls, DEFAULT_MODELS); assert.equal(r.data.status, 'ERROR');
});
test('an expired zero-quota snapshot does not suppress a refreshed bucket', () => {
  const q = quota(0); q.command.data.groups[0].buckets[0].reset_time = '2000-01-01T00:00:00Z'; assert.equal(exhaustedGroups(q).size, 0);
});
test('response prose cannot trigger fallback; nested error codes can', () => {
  assert.equal(failureKind({ response: '429 is a HTTP error' }), 'request_error');
  assert.equal(failureKind({ error: { code: 429, message: 'exhausted' } }), 'quota_or_rate_limit');
});
test('exact model slugs use native thinking; explicit conflicting effort fails before inference', () => {
  for (const m of DEFAULT_MODELS) assert.deepEqual(effortArgs(m), []);
  assert.deepEqual(effortArgs(high, 'high'), ['--effort', 'high']);
  assert.throws(() => effortArgs(medium, 'high'), /conflicts/);
  assert.throws(() => effortArgs(sonnet, 'high'), /does not accept/);
  assert.equal(failureKind({ error: 'invalid model selection --effort is not supported for model claude-sonnet-4-6' }), 'request_configuration_error');
});
const fixture = fileURLToPath(new URL('./fake-agy-stream.mjs', import.meta.url));
async function stream(scenario, options = {}) {
  const progress = [];
  const r = await runStream(process.execPath, [fixture, scenario], { cwd: process.cwd(), env: process.env, input: '', timeoutMs: 2000, expectedModel: 'test-model', heartbeatMs: 30, onProgress: p => progress.push(p), ...options });
  return { ...r, progress };
}
test('real child pipe receives events, survives silence, preserves Unicode and reasoning usage', async () => {
  const r = await stream('slow'); assert.equal(r.data.status, 'SUCCESS'); assert.equal(r.data.response, '검토 완료'); assert.equal(r.data.usage.thinking_tokens, 42);
  assert.ok(r.progress.some(p => p.state === 'receiving_events')); assert.ok(r.progress.some(p => p.state === 'waiting_no_recent_event'));
  assert.ok(!JSON.stringify(r.progress).includes('not persisted as progress')); assert.equal(r.diagnostics.process_alive, false);
});
test('a deadline terminates an alive silent process and reports uncertainty, not disconnection', async () => {
  const r = await stream('timeout', { timeoutMs: 160 }); assert.equal(r.data.status, 'ERROR'); assert.equal(r.transport, 'deadline_exceeded'); assert.match(r.data.error, /unknown/); assert.equal(r.diagnostics.process_alive, false);
  assert.ok(r.progress.some(p => p.state === 'waiting_no_recent_event' && p.process_alive));
});
test('explicit connection reset is distinguished from a deadline', async () => {
  const r = await stream('disconnect'); assert.equal(failureKind(r.data, r.transport), 'connection_error');
});
test('abrupt process exit cannot be mistaken for successful thought', async () => {
  const r = await stream('crash'); assert.equal(r.exitCode, 7); assert.equal(r.data.status, 'ERROR'); assert.equal(r.diagnostics.process_alive, false);
});
test('model mismatch is an error, not a successful fallback', async () => {
  const r = await stream('slow', { expectedModel: 'another-model' }); assert.equal(r.data.status, 'ERROR'); assert.match(r.data.error, /mismatch/);
});
test('explicit stderr quota detail remains available to terminal classification', async () => {
  const r = await stream('stderr-quota'); assert.equal(failureKind(r.data), 'quota_or_rate_limit');
});
test('end-to-end child streams: quota error, refreshed shared pool, then actual next-model response', async () => {
  let q = 0; const calls = [];
  const r = await reviewWithFallback({ candidates: DEFAULT_MODELS, available: new Set(DEFAULT_MODELS), getQuota: async () => quota(q++ ? 0 : 1), run: async model => {
    calls.push(model);
    return runStream(process.execPath, [fixture, model === high ? 'quota' : 'slow', model], { cwd: process.cwd(), env: process.env, input: '', timeoutMs: 2000, expectedModel: model });
  } });
  assert.deepEqual(calls, [high, opus]); assert.equal(r.data.status, 'SUCCESS'); assert.equal(r.reportedModel, opus); assert.equal(r.attempts[0].outcome, 'quota_or_rate_limit'); assert.equal(r.attempts[1].diagnostics.process_alive, false);
});
test('entrypoint dry-run can resume across model families without inheriting incompatible effort', { skip: process.platform !== 'win32' }, () => {
  mkdirSync(resolve('work'), { recursive: true });
  const dir = mkdtempSync(resolve('work', 'bridge-args-'));
  const prompt = join(dir, 'prompt.txt'), previous = join(dir, 'previous.json');
  writeFileSync(prompt, 'Review this bounded brief.');
  writeFileSync(previous, JSON.stringify({ status: 'SUCCESS', conversation_id: '055a398f-db14-4c5f-abbb-1bf03f8120a7', bridge: { selected_model: high, effort: 'high' } }));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../ask-antigravity.mjs', import.meta.url)), '--prompt-file', prompt, '--conversation-file', previous, '--model', sonnet, '--no-fallback', '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); const data = JSON.parse(r.stdout); assert.equal(data.effort, 'auto'); assert.deepEqual(data.candidates, [sonnet]); assert.equal(data.networkRequest, false); assert.equal(data.timeout_seconds, 600);
});
test('entrypoint configuration failure replaces a stale success file with ERROR without networking', { skip: process.platform !== 'win32' }, () => {
  mkdirSync(resolve('work'), { recursive: true });
  const dir = mkdtempSync(resolve('work', 'bridge-failure-'));
  const prompt = join(dir, 'prompt.txt'), output = join(dir, 'result.json');
  writeFileSync(prompt, 'Review.'); writeFileSync(output, '{"status":"SUCCESS"}');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../ask-antigravity.mjs', import.meta.url)), '--prompt-file', prompt, '--model', sonnet, '--effort', 'high', '--output', output], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 1); assert.equal(JSON.parse(readFileSync(output, 'utf8')).status, 'ERROR'); assert.match(r.stderr, /does not accept/);
});
test('inherited pipe handles cannot keep a completed review waiting indefinitely', async () => {
  const started = Date.now(); const r = await stream('inherited-pipe', { timeoutMs: 5000 });
  assert.equal(r.data.status, 'SUCCESS'); assert.equal(r.diagnostics.process_alive, false); assert.ok(Date.now() - started < 2500);
});
test('an effort-only Medium request chooses the matching Gemini slug without a default-High conflict', { skip: process.platform !== 'win32' }, () => {
  mkdirSync(resolve('work'), { recursive: true });
  const dir = mkdtempSync(resolve('work', 'bridge-effort-')), prompt = join(dir, 'prompt.txt'); writeFileSync(prompt, 'Review.');
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('../ask-antigravity.mjs', import.meta.url)), '--prompt-file', prompt, '--effort', 'medium', '--dry-run'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).candidates[0], medium); assert.equal(JSON.parse(r.stdout).networkRequest, false);
});

