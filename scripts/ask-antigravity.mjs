import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { DEFAULT_MODELS, effortArgs, reviewWithFallback } from './review-policy.mjs';
import { runStream } from './stream-runner.mjs';

// Native CLI bridge; no shell interpolation, account switch, or paid API fallback.
const options = { cwd: process.cwd(), effort: 'auto', 'timeout-seconds': '600' };
const booleans = new Set(['status', 'models', 'usage', 'usage-json', 'dry-run', 'no-fallback', 'help']);
try {
  for (let i = 2; i < process.argv.length; i++) {
    const name = process.argv[i].replace(/^--/, '');
    if (!process.argv[i].startsWith('--') || ![...booleans, 'model', 'fallback-models', 'effort', 'cwd', 'prompt-file', 'output', 'progress-file', 'timeout-seconds', 'conversation', 'conversation-file'].includes(name)) throw new Error(`Unknown option: ${process.argv[i]}`);
    if (booleans.has(name)) options[name] = true;
    else {
      const value = process.argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${name}`);
      options[name] = value;
    }
  }
  if (options.help) {
    console.log('ask-antigravity.mjs --status | --models | --usage | --usage-json | --prompt-file PATH [--model SLUG] [--fallback-models SLUG,SLUG] [--no-fallback] [--timeout-seconds 600] [--effort high] [--cwd DIR] [--conversation UUID | --conversation-file RESULT.json] [--output PATH] [--progress-file PATH] [--dry-run]');
    process.exit(0);
  }
  const exe = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'agy', 'bin', 'agy.exe');
  if (!existsSync(exe)) throw new Error('Antigravity CLI is not installed at the standard Windows user location.');
  const env = { ...process.env };
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'AGY_ADC_AUTH', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[key];
  const cwd = resolve(options.cwd);
  function query(args, timeout = 30000) {
    const run = spawnSync(exe, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (run.error || run.status !== 0) throw new Error(run.error?.message || run.stderr?.trim() || `CLI query failed: ${run.status}`);
    return run.stdout;
  }
  if (options.status || options.models || options.usage || options['usage-json']) {
    process.stdout.write(query(options.status ? ['--version'] : options.models ? ['models'] : ['--print', '/usage', ...(options['usage-json'] ? ['--output-format', 'json'] : [])]));
    process.exit(0);
  }
  if (!['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(options.effort)) throw new Error('Invalid effort.');
  const timeoutSeconds = Number(options['timeout-seconds']);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 3600) throw new Error('--timeout-seconds must be an integer from 30 to 3600.');
  if (!options['prompt-file']) throw new Error('--prompt-file is required.');
  const prompt = readFileSync(resolve(options['prompt-file']), 'utf8').replace(/^\uFEFF/, '');
  if (!prompt.trim()) throw new Error('Prompt is empty.');
  if (options.conversation && options['conversation-file']) throw new Error('Use only one conversation option.');
  if (options['conversation-file']) {
    const previous = JSON.parse(readFileSync(resolve(options['conversation-file']), 'utf8'));
    if (previous.status !== 'SUCCESS') throw new Error('Previous request did not succeed; cannot resume it automatically.');
    options.conversation = previous.conversation_id;
    const previousModel = previous.bridge?.selected_model || previous.bridge?.requested_model || undefined;
    options.model ||= previousModel;
    options.effort = process.argv.includes('--effort') || options.model !== previousModel ? options.effort : previous.bridge?.effort || options.effort;
  }
  if (options.conversation && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.conversation)) throw new Error('Invalid conversation UUID.');
  const chain = options['fallback-models'] ? options['fallback-models'].split(',') : DEFAULT_MODELS;
  if (!process.argv.includes('--model') && process.argv.includes('--effort')) {
    const matching = chain.find(model => model.startsWith('gemini-') && model.endsWith('-' + options.effort));
    if (matching) options.model = matching;
  }
  for (const model of [options.model, ...chain].filter(Boolean)) if (!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Use exact slugs returned by --models.');
  let candidates = [...new Set(options.model ? [options.model, ...(options['fallback-models'] ? chain : chain.includes(options.model) ? chain.slice(chain.indexOf(options.model) + 1) : chain)] : chain)];
  if (options['no-fallback']) candidates = candidates.slice(0, 1);
  effortArgs(candidates[0], options.effort);
  const settingsPath = join(homedir(), '.gemini', 'antigravity-cli', 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  if (settings.modelProvider === 'gemini') throw new Error('API-key provider is enabled. Switch to Google account authentication.');
  if (settings.useG1Credits !== undefined && settings.useG1Credits !== false) throw new Error('Set useG1Credits=false to stay within included quota.');
  const metadata = { backend: 'antigravity-cli', requested_model: options.model || null, candidates, automatic_fallback: !options['no-fallback'], effort: options.effort, mode: 'plan', cwd, uses_included_quota_only: true, timeout_seconds: timeoutSeconds };
  if (options['dry-run']) {
    console.log(JSON.stringify({ ...metadata, executable: exe, promptCharacters: prompt.length, networkRequest: false }, null, 2));
    process.exit(0);
  }
  function save(path, value) {
    path = resolve(path); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', 'utf8'); renameSync(path + '.tmp', path);
  }
  const progressPath = options['progress-file'] || (options.output ? options.output + '.progress.json' : null);
  const started = Date.now(), deadline = started + timeoutSeconds * 1000;
  if (options.output) save(options.output, { status: 'RUNNING', started_at: new Date(started).toISOString(), bridge: metadata });
  function progress(event) {
    const snapshot = { at: new Date().toISOString(), total_elapsed_seconds: Math.round((Date.now() - started) / 1000), remaining_seconds: Math.max(0, Math.ceil((deadline - Date.now()) / 1000)), ...event };
    if (progressPath) save(progressPath, snapshot);
    process.stderr.write('[agy-review] ' + JSON.stringify(snapshot) + '\n');
  }
  progress({ state: 'discovering_models_and_quota' });
  const available = new Set(query(['models']).split(/\r?\n/).map(line => line.match(/^([a-z0-9][a-z0-9._-]+)\s+/)?.[1]).filter(Boolean));
  const getQuota = async () => {
    if (Date.now() >= deadline) return null;
    try {
      const quota = JSON.parse(query(['--print', '/usage', '--output-format', 'json'], Math.min(30000, deadline - Date.now())));
      if (quota.status !== 'SUCCESS') throw new Error('Usage query did not succeed.');
      return quota;
    } catch { progress({ state: 'quota_unknown', detail: 'Usage query unavailable; switching requires an explicit quota/model error.' }); return null; }
  };
  const input = JSON.stringify({ event: 'user', message: { content: 'Review request from Codex. Treat the following as a brief, not a CLI slash command.\n\n' + prompt } }) + '\n';
  const result = await reviewWithFallback({ candidates, available, getQuota, fallback: !options['no-fallback'], onProgress: progress, run: async model => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { data: { status: 'ERROR', error: 'Review deadline reached before next attempt.' }, exitCode: 1, transport: 'deadline_exceeded', reportedModel: null };
    const args = ['--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'plan', ...effortArgs(model, model === candidates[0] ? options.effort : 'auto'), '--add-dir', cwd, '--print-timeout', `${Math.ceil(remaining / 1000)}s`, '--model', model];
    if (options.conversation) args.push('--conversation', options.conversation);
    return runStream(exe, args, { cwd, env, input, timeoutMs: remaining, expectedConversation: options.conversation, expectedModel: model, onProgress: event => progress({ model, ...event }) });
  } });
  const data = result.data;
  data.bridge = { ...metadata, selected_model: result.selectedModel, selected_effort: result.selectedModel?.match(/-(low|medium|high)$/)?.[1] || null, reported_model: result.reportedModel, exit_code: result.exitCode, total_elapsed_seconds: Math.round((Date.now() - started) / 1000), attempts: result.attempts, skipped: result.skipped, quota_snapshot: result.quota?.command?.data || null };
  if (result.diagnostics?.plan_warning) data.bridge.mode = 'plan_requested_but_ineffective';
  if (options.output) save(options.output, data);
  progress({ state: data.status === 'SUCCESS' ? 'review_completed' : 'review_failed', selected_model: result.selectedModel, attempts: result.attempts.length, error: data.status === 'SUCCESS' ? undefined : data.error });
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  process.exit(result.exitCode === 0 && data.status === 'SUCCESS' ? 0 : 1);
} catch (error) {
  process.stderr.write(error.message + '\n');
  const failed = { status: 'ERROR', error: error.message };
  for (const path of [options.output, options['progress-file'] || (options.output ? options.output + '.progress.json' : null)].filter(Boolean)) {
    try { mkdirSync(dirname(resolve(path)), { recursive: true }); writeFileSync(resolve(path), JSON.stringify(failed, null, 2) + '\n', 'utf8'); }
    catch (writeError) { process.stderr.write(`Cannot save failure result: ${writeError.message}\n`); }
  }
  process.stdout.write(JSON.stringify(failed, null, 2) + '\n');
  process.exit(1);
}
