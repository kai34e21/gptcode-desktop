import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { createServer } from 'node:http';
import { partialString, ToolStreamObserver, observeToolStream } from './stream-tap.mjs';
import { LiveFiles } from './live-files.mjs';
import { PreviewService, localPreviewUrl } from './preview.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'gptcode-live-')), events = [];
  const files = new LiveFiles(root, (event, payload) => events.push({ event, payload }));
  t.after(() => { files.close(); assert.match(relative(resolve(tmpdir()), resolve(root)), /^gptcode-live-[A-Za-z0-9]+$/); rmSync(root, { recursive: true, force: true }); });
  return { root, events, files };
}
async function waitFor(events, event, predicate = () => true) {
  for (let i = 0; i < 150; i++) { const result = events.find(item => item.event === event && predicate(item.payload)); if (result) return result.payload; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error(`Evento assente: ${event}`);
}
test('decodifica prefissi JSON con escape, Unicode spezzato e proprietà assenti', () => {
  assert.deepEqual(partialString('{"content":"riga\\n\\"due\\"', 'content'), { text: 'riga\n"due"', complete: false });
  assert.deepEqual(partialString('{"content":"\\u00e8"}', 'content'), { text: 'è', complete: true });
  assert.deepEqual(partialString('{"content":"x\\uD83D', 'content'), { text: 'x', complete: false });
  assert.equal(partialString('{"content":"x"}', 'file_path'), null);
});
test('osserva delta Responses, OpenAI e Anthropic senza attendere il tool completo', () => {
  for (const dialect of ['responses', 'openai', 'anthropic']) {
    const calls = [], observer = new ToolStreamObserver(call => calls.push(call));
    const prefix = '{"file_path":"index.html","content":"<h1>Live';
    const send = raw => { const encoded = new TextEncoder().encode(`data: ${JSON.stringify(raw)}\n\n`); for (let i = 0; i < encoded.length; i += 7) observer.push(encoded.slice(i, i + 7)); };
    if (dialect === 'responses') { send({ type: 'response.output_item.added', output_index: 0, item: { id: 'item', call_id: 'call', type: 'function_call', name: 'Write' } }); send({ type: 'response.function_call_arguments.delta', item_id: 'item', delta: prefix }); }
    if (dialect === 'openai') send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call', function: { name: 'Write', arguments: prefix } }] } }] });
    if (dialect === 'anthropic') { send({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'call', name: 'Write', input: {} } }); send({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: prefix } }); }
    assert.equal(calls.at(-1).arguments, prefix); assert.equal(calls.at(-1).complete, false);
  }
});
test('il tap conserva bytes, header e numero di richieste del trasporto originale', async t => {
  let requests = 0;
  const body = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"Write","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
  const server = createServer((_, response) => { requests++; response.writeHead(200, { 'content-type': 'text/event-stream', 'x-proof': 'same' }); response.end(body); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const calls = [];
  await observeToolStream(call => calls.push(call), async () => { const response = await fetch(`http://127.0.0.1:${server.address().port}`); assert.equal(response.headers.get('x-proof'), 'same'); assert.equal(await response.text(), body); });
  assert.equal(requests, 1); assert.equal(calls[0].name, 'Write');
});
test('Write progressivo resta in memoria fino al tool; Edit negato non cambia il file', t => {
  const { root, events, files } = setup(t), path = join(root, 'index.html');
  const prefix = JSON.stringify({ file_path: path }).slice(0, -1) + ',"content":"<h1>Primo';
  files.stream({ id: 'w', name: 'Write', arguments: prefix, complete: false });
  assert.equal(existsSync(path), false); assert.equal(events.at(-1).payload.after, '<h1>Primo');
  const content = '<h1>Primo completo</h1>';
  files.tool({ name: 'Write', callId: 'w', args: { file_path: path, content }, phase: 'start' });
  assert.equal(existsSync(path), false);
  writeFileSync(path, content);
  files.tool({ name: 'Write', callId: 'w', phase: 'end' });
  assert.equal(events.at(-1).event, 'workspace.file'); assert.equal(events.at(-1).payload.text, content);
  files.stream({ id: 'e', name: 'Edit', arguments: JSON.stringify({ file_path: path, old_string: 'Primo', new_string: 'Secondo' }), complete: true });
  assert.equal(files.drafts.get('e').after, '<h1>Secondo completo</h1>');
  files.tool({ name: 'Edit', callId: 'e', phase: 'end', denied: true });
  assert.equal(readFileSync(path, 'utf8'), content); assert.equal(files.drafts.get('e').phase, 'denied');
});
test('monitoraggio automatico dei file e esclusione dei percorsi sensibili/esterni', async t => {
  const { root, files, events } = setup(t), path = join(root, 'watch.txt');
  writeFileSync(path, 'AGGIORNATO');
  assert.equal((await waitFor(events, 'workspace.file', event => event.path === path)).text, 'AGGIORNATO');
  const count = events.length;
  for (const file of ['.env', '.gptcode/providers.json', '../outside.txt']) files.stream({ id: file, name: 'Write', arguments: JSON.stringify({ file_path: file, content: 'NO' }), complete: true });
  assert.equal(events.length, count);
});
test('anteprima serve la proposta prima del salvataggio, poi il file; blocca token e traversal', async t => {
  const { root, files, events } = setup(t), preview = new PreviewService(files, (event, payload) => events.push({ event, payload }));
  t.after(() => preview.close());
  const path = join(root, 'index.html');
  files.stream({ id: 'w', name: 'Write', arguments: JSON.stringify({ file_path: path, content: '<h1>Proposta</h1>' }), complete: false });
  const state = await waitFor(events, 'preview.state', value => value.url);
  assert.equal(await (await fetch(state.url)).text(), '<h1>Proposta</h1>'); assert.equal(existsSync(path), false);
  const response = await fetch(state.url); assert.match(response.headers.get('content-security-policy'), /sandbox allow-scripts/);
  assert.equal((await fetch(new URL('/wrong/index.html', state.url))).status, 404);
  const base = state.url.split('index.html')[0];
  assert.equal((await fetch(base + '.env')).status, 403);
  assert.equal((await fetch(base + '..%2foutside.html')).status, 403);
  files.tool({ name: 'Write', callId: 'w', phase: 'end', denied: true });
  assert.equal((await fetch(state.url)).status, 404);
});
test('URL framework limitati al loopback e senza credenziali', () => {
  assert.equal(localPreviewUrl('http://localhost:5173'), 'http://localhost:5173/');
  assert.throws(() => localPreviewUrl('https://example.com'));
  assert.throws(() => localPreviewUrl('file:///C:/secret'));
  assert.throws(() => localPreviewUrl('http://user:password@localhost:5173'));
});
