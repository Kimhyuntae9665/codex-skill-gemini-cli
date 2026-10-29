export function parseResult(stdout, expectedConversation) {
  const events = stdout.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const results = events.filter(event => event.event === 'result');
  if (results.length !== 1 || !results[0].result) throw new Error('Expected exactly one Antigravity result event.');
  const data = results[0].result;
  if (expectedConversation && data.conversation_id !== expectedConversation) throw new Error('Antigravity did not resume the requested conversation; refusing to report continuity.');
  if (data.status === 'SUCCESS' && (typeof data.response !== 'string' || !data.response.trim())) throw new Error('Antigravity reported success without an answer.');
  return { data, reportedModel: events.find(event => event.event === 'init')?.init?.model || null };
}
