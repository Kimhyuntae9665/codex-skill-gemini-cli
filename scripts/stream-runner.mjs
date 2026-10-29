import { spawn } from 'node:child_process';
import { parseResult } from './parse-antigravity.mjs';

// Persist metadata only: no response/thinking deltas in the progress sidecar.
export function runStream(exe, args, { cwd, env, input, timeoutMs, expectedConversation, expectedModel, onProgress = () => {}, heartbeatMs = 20000 }) {
  return new Promise(resolve => {
    const started = Date.now();
    let stdout = '', stderr = '', pending = '', lastEventAt = null, lastOutputAt = null;
    let lastEvent = null, eventCount = 0, bytes = 0, transport = null, spawnError = null;
    let reportedModel = null, conversationId = null, childExited = false, settled = false, closeGrace, killGrace;
    const child = spawn(exe, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const diagnostics = () => ({ elapsed_seconds: Math.round((Date.now() - started) / 1000), pid: child.pid || null, process_alive: !childExited, event_count: eventCount, last_event: lastEvent, last_event_at: lastEventAt, last_output_at: lastOutputAt, silence_seconds: Math.round((Date.now() - (lastEventAt ? Date.parse(lastEventAt) : started)) / 1000), reported_model: reportedModel, conversation_id: conversationId });
    function report(state) { onProgress({ state, ...diagnostics() }); }
    function stop(reason) {
      transport = reason; child.kill();
      // Do not wait indefinitely for inherited pipe handles or an unconfirmed kill.
      killGrace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(null, 'termination_unconfirmed'); }, 5000);
    }
    const heartbeat = setInterval(() => report(lastEventAt && Date.now() - Date.parse(lastEventAt) < heartbeatMs * 2 ? 'receiving_events' : 'waiting_no_recent_event'), heartbeatMs);
    const deadline = setTimeout(() => { report('deadline_exceeded_activity_unknown'); stop('deadline_exceeded'); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 32 * 1024 * 1024) { stop('output_limit'); return; }
      stdout += chunk;
      pending += chunk;
      lastOutputAt = new Date().toISOString();
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          eventCount++; lastEventAt = new Date().toISOString();
          lastEvent = { type: event.event, step_type: event.step_update?.step_type, state: event.step_update?.state };
          if (event.event === 'init') { reportedModel = event.init?.model || null; conversationId = event.conversation_id || event.init?.conversation_id || null; }
          if (event.event === 'result') conversationId = event.result?.conversation_id || conversationId;
        } catch { /* Strict complete-stream validation occurs at exit. */ }
      }
    });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); lastOutputAt = new Date().toISOString(); });
    child.stdin.on('error', error => { spawnError ||= error; });
    child.on('error', error => { spawnError = error; transport = 'spawn_error'; });
    child.on('exit', (code, signal) => {
      childExited = true;
      closeGrace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(code, signal); }, 1000);
    });
    function finish(exitCode, signal) {
      if (settled) return;
      settled = true; clearInterval(heartbeat); clearTimeout(deadline); clearTimeout(closeGrace); clearTimeout(killGrace);
      let parsed;
      try { parsed = parseResult(stdout, expectedConversation); }
      catch (error) { parsed = { data: { status: 'ERROR', error: spawnError?.message || error.message, detail: stderr.trim() }, reportedModel }; }
      if (parsed.data.status !== 'SUCCESS' && stderr.trim() && !parsed.data.detail) parsed.data.detail = stderr.trim();
      if (transport) parsed.data = { ...parsed.data, status: 'ERROR', error: transport === 'deadline_exceeded' ? 'Review deadline reached; server activity is unknown. No automatic retry.' : transport };
      if (parsed.data.status === 'SUCCESS' && exitCode !== 0) parsed.data = { ...parsed.data, status: 'ERROR', error: `CLI exited abnormally (${exitCode}, ${signal || 'no signal'}).` };
      if (parsed.reportedModel && expectedModel && parsed.reportedModel !== expectedModel) parsed.data = { ...parsed.data, status: 'ERROR', error: `Model mismatch: requested ${expectedModel}, received ${parsed.reportedModel}` };
      report(parsed.data.status === 'SUCCESS' ? 'completed' : 'failed');
      resolve({ ...parsed, exitCode, transport, diagnostics: { ...diagnostics(), signal: signal || null, transport, plan_warning: stderr.includes('--mode plan has no effect') } });
    }
    child.on('close', (code, signal) => { childExited = true; finish(code, signal); });
    child.stdin.end(input);
    report('process_started');
  });
}
