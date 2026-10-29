import test from 'node:test';
import assert from 'node:assert/strict';
import { parseResult } from '../parse-antigravity.mjs';

const id = '055a398f-db14-4c5f-abbb-1bf03f8120a7';
const event = data => JSON.stringify({ event: 'result', result: data });
const good = { status: 'SUCCESS', response: '검토 완료', conversation_id: id, usage: { thinking_tokens: 41 } };
test('preserves a real-format response and reasoning usage', () => {
  const stream = JSON.stringify({ event: 'init', init: { model: 'example-model' } }) + '\n' + event(good) + '\n';
  const parsed = parseResult(stream, id);
  assert.equal(parsed.data.response, '검토 완료');
  assert.equal(parsed.data.usage.thinking_tokens, 41);
  assert.equal(parsed.reportedModel, 'example-model');
});
test('rejects silently replaced conversation and false success', () => {
  assert.throws(() => parseResult(event(good), '00000000-0000-0000-0000-000000000000'), /resume/);
  assert.throws(() => parseResult(event({ ...good, response: '' })), /without an answer/);
});
test('rejects broken, missing or duplicate terminal events', () => {
  assert.throws(() => parseResult('not json'));
  assert.throws(() => parseResult('{"event":"init"}'), /exactly one/);
  assert.throws(() => parseResult(event(good) + '\n' + event(good)), /exactly one/);
});
test('preserves authentication and permission failures for the caller', () => {
  const failed = parseResult(event({ status: 'ERROR', error: 'authentication required' }));
  assert.equal(failed.data.status, 'ERROR');
  assert.equal(failed.data.error, 'authentication required');
  const denied = [{ action: 'command(git)' }];
  assert.deepEqual(parseResult(event({ ...good, denied_actions: denied })).data.denied_actions, denied);
});

