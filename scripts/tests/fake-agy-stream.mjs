const scenario = process.argv[2];
const { spawn } = await import('node:child_process');
const model = process.argv[3] || 'test-model';
const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
emit({ event: 'init', conversation_id: '055a398f-db14-4c5f-abbb-1bf03f8120a7', init: { model } });
if (scenario === 'timeout') setInterval(() => {}, 1000);
else if (scenario === 'inherited-pipe') {
  spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 3000)'], { stdio: ['ignore', process.stdout, process.stderr], windowsHide: true }).unref();
  emit({ event: 'result', result: { status: 'SUCCESS', response: 'complete before inherited pipe closes' } });
  process.exit(0);
}
else if (scenario === 'crash') { process.stderr.write('transport stopped unexpectedly'); process.exit(7); }
else if (scenario === 'disconnect') emit({ event: 'result', result: { status: 'ERROR', error: 'ECONNRESET: connection reset by peer' } });
else if (scenario === 'quota') emit({ event: 'result', result: { status: 'ERROR', error: '429 RESOURCE_EXHAUSTED quota' } });
else if (scenario === 'stderr-quota') { process.stderr.write('RESOURCE_EXHAUSTED quota'); emit({ event: 'result', result: { status: 'ERROR', error: 'request failed' } }); }
else {
  setTimeout(() => emit({ event: 'step_update', step_update: { state: 'ACTIVE', step_type: 'agent_response', text_delta: 'not persisted as progress' } }), 25);
  setTimeout(() => emit({ event: 'result', result: { status: 'SUCCESS', response: '검토 완료', conversation_id: '055a398f-db14-4c5f-abbb-1bf03f8120a7', usage: { thinking_tokens: 42 } } }), 220);
}

