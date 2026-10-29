import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const options = { model: 'pro', cwd: process.cwd() };
const flags = new Set(['status', 'dry-run', 'help']);
try {
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].replace(/^--/, '');
    if (!['model', 'cwd', 'prompt-file', 'output', ...flags].includes(key) || !process.argv[i].startsWith('--')) throw new Error(`Unknown option: ${process.argv[i]}`);
    if (flags.has(key)) options[key] = true;
    else {
      const value = process.argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[key] = value;
    }
  }
  if (options.help) {
    console.log('ask-gemini.mjs --status | --model pro|flash|auto|gemini-* --prompt-file PATH [--cwd DIR] [--output PATH] [--dry-run]');
    process.exit(0);
  }
  const cli = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'npm', 'node_modules', '@google', 'gemini-cli', 'bundle', 'gemini.js');
  if (!existsSync(cli)) throw new Error('Gemini CLI missing. Install with npm install -g @google/gemini-cli.');
  if (options.status) {
    const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: 15000 });
    if (version.status !== 0) throw new Error('Gemini CLI version check failed.');
    console.log(JSON.stringify({ installed: true, version: version.stdout.trim(), oauthCachePresent: existsSync(join(homedir(), '.gemini', 'oauth_creds.json')), accessVerified: false, note: 'Cache presence does not prove account eligibility. Run a prompt to verify access.' }, null, 2));
    process.exit(0);
  }
  if (!['pro', 'flash', 'auto'].includes(options.model) && !/^gemini-[a-zA-Z0-9._-]+$/.test(options.model)) throw new Error('Use pro, flash, auto or an exact gemini-* model ID.');
  if (!options['prompt-file']) throw new Error('--prompt-file is required.');
  const prompt = readFileSync(resolve(options['prompt-file']), 'utf8').replace(/^\uFEFF/, '');
  if (!prompt.trim()) throw new Error('Prompt file is empty.');
  const cwd = resolve(options.cwd);
  const args = [cli, '--model', options.model, '--approval-mode', 'plan', '--output-format', 'json', '--extensions', '', '--skip-trust', '--include-directories', cwd, '--prompt', `Answer the request supplied on stdin. Remain read-only. The requested project directory is ${cwd}.`];
  const env = { ...process.env };
  // Gemini invokes Windows PowerShell for ACL checks. Do not inherit PS7 modules.
  if (process.platform === 'win32') env.PSModulePath = join(process.env.SystemRoot || 'C:/Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules');
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI', 'GOOGLE_APPLICATION_CREDENTIALS']) delete env[key];
  if (options['dry-run']) {
    console.log(JSON.stringify({ cli, model: options.model, cwd, approvalMode: 'plan', auth: 'oauth-personal', promptCharacters: prompt.length, networkRequest: false }, null, 2));
    process.exit(0);
  }
  // Project-local settings are supported for user-owned files. System settings
  // require administrator ownership and must not be used for a personal skill.
  const runBase = join(cwd, 'work', 'gemini-cli-runs');
  mkdirSync(runBase, { recursive: true });
  const runDir = mkdtempSync(join(runBase, 'run-'));
  mkdirSync(join(runDir, '.gemini'));
  writeFileSync(join(runDir, '.gemini', 'settings.json'), readFileSync(join(scriptDir, 'oauth-readonly.json')));
  const result = spawnSync(process.execPath, args, { cwd: runDir, env, input: prompt, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.stderr) process.stderr.write(result.stderr);
  let data;
  try { data = JSON.parse(result.stdout); }
  catch { data = { error: { message: result.error?.message || 'Gemini CLI did not return JSON.', detail: (result.stderr || result.stdout || '').trim() } }; }
  const output = JSON.stringify(data, null, 2) + '\n';
  if (options.output) {
    const target = resolve(options.output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output, 'utf8');
  }
  process.stdout.write(output);
  process.exit(result.status || (result.error || data.error ? 1 : 0));
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exit(1);
}
