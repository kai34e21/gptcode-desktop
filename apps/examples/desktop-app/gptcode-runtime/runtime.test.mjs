import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const workerPath = process.env.GPTCODE_TEST_WORKER || fileURLToPath(new URL('./worker.mjs', import.meta.url));
class Client {
  constructor(root, env = {}) {
    this.events = []; this.pending = new Map(); this.next = 1; this.stderr = '';
    this.child = spawn(process.env.GPTCODE_TEST_NODE || process.execPath, [workerPath], { cwd: root, env: { ...process.env, GPTCODE_WORKSPACE_ROOT: root, ...env }, windowsHide: true });
    this.child.stderr.on('data', data => this.stderr += data);
    createInterface({ input: this.child.stdout }).on('line', line => {
      let data; try { data = JSON.parse(line); } catch { return; }
      if (data.id) { const entry = this.pending.get(data.id); if (!entry) return; this.pending.delete(data.id); clearTimeout(entry.timer); data.error ? entry.reject(Error(data.error)) : entry.resolve(data.result); }
      else this.events.push(data);
    });
    this.child.on('exit', () => { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(Error(this.stderr || 'Worker terminato')); } this.pending.clear(); });
  }
  request(method, data = {}) { const id = this.next++; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error(`Timeout ${method}: ${this.stderr}`)); }, 30000); this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ id, method, data }) + '\n'); }); }
  async wait(event, predicate = () => true) {
    const start = Date.now();
    while (Date.now() - start < 20000) { const index = this.events.findIndex(e => e.event === event && predicate(e.payload)); if (index >= 0) return this.events.splice(index, 1)[0].payload; await new Promise(resolve => setTimeout(resolve, 30)); }
    throw Error(`Evento assente ${event}: ${this.stderr}`);
  }
  async close() { this.child.stdin.end(); await Promise.race([new Promise(resolve => this.child.once('exit', resolve)), new Promise(resolve => setTimeout(() => { this.child.kill(); resolve(); }, 2500))]); }
}
function cleanup(root) { assert.match(relative(resolve(tmpdir()), resolve(root)), /^gptcode-desktop-(runtime|agent)-[A-Za-z0-9]+$/); rmSync(root, { recursive: true, force: true }); }
function setup(t, env) { const root = mkdtempSync(join(tmpdir(), 'gptcode-desktop-runtime-')); const client = new Client(root, env); t.after(async () => { await client.close(); cleanup(root); }); return { root, client }; }

test('LSP reale: diagnostica TypeScript, completamenti e definizione su buffer non salvato', { timeout: 60000 }, async t => {
  const { root, client } = setup(t);
  const path = join(root, 'main.ts'); writeFileSync(path, '');
  const text = 'const person = { name: "Ada", age: 21 };\nconst invalid: number = "errore";\nperson.\n';
  await client.request('lsp.open', { path, text, version: 1 });
  const diagnostics = await client.wait('lsp.diagnostics', data => data.diagnostics.some(d => d.code === 2322));
  assert.ok(diagnostics.diagnostics.some(d => d.message.includes('number')));
  const completions = await client.request('lsp.completion', { path, line: 2, character: 7 });
  assert.ok((completions.items ?? completions).some(item => item.label === 'name'));
  const definition = await client.request('lsp.definition', { path, line: 2, character: 2 });
  assert.equal(definition[0].range.start.line, 0);
  const hover = await client.request('lsp.hover', { path, line: 0, character: 7 });
  assert.ok(JSON.stringify(hover).includes('person'));
  await assert.rejects(client.request('lsp.open', { path: join(dirname(root), 'outside.ts'), text: '', version: 2 }));
});

test('Debugger reale: breakpoint, variabili, valutazione e stop su Node Inspector', { timeout: 60000 }, async t => {
  const { root, client } = setup(t);
  const path = join(root, 'main.mjs'); writeFileSync(path, 'const value = 40;\nconst answer = value + 2;\nconsole.log(answer);\n');
  await client.request('debug.start', { path, breakpoints: [{ path, line: 3 }] });
  await client.wait('debug.paused');
  await client.request('debug.action', { action: 'continue' });
  const paused = await client.wait('debug.paused', event => event.frames[0].location.lineNumber === 2);
  const frame = paused.frames[0], scope = frame.scopeChain.find(s => ['local', 'module', 'script'].includes(s.type));
  const variables = await client.request('debug.variables', { objectId: scope.object.objectId });
  assert.ok(variables.some(v => v.name === 'answer' && v.value === 42));
  assert.deepEqual(await client.request('debug.evaluate', { frameId: frame.callFrameId, expression: 'answer' }), { value: 42 });
  await client.request('debug.stop'); await client.wait('debug.ended');
});

test('Chat: legge configurazione e sessioni dal CLI reale senza inviare inferenze', { timeout: 60000 }, async t => {
  const cli = process.env.GPTCODE_CLI_PATH;
  if (!cli) return t.skip('GPTCODE_CLI_PATH richiesto per la verifica del CLI installato');
  const { client } = setup(t, { GPTCODE_CLI_PATH: cli });
  const status = await client.request('chat.status');
  assert.equal(typeof status.model, 'string'); assert.equal(status.busy, false);
  assert.ok(Array.isArray(await client.request('chat.history')));
  await assert.rejects(client.request('chat.answer', { id: 'inesistente', answer: 'allow' }), /scaduta/);
  await assert.rejects(client.request('chat.send', { prompt: '' }), /vuoto/);
});

test('Agente GPTCode reale con provider locale simulato: permesso negato e poi autorizzato, file e sessioni reali', { timeout: 60000 }, async t => {
  const cli = process.env.GPTCODE_CLI_PATH;
  if (!cli) return t.skip('GPTCODE_CLI_PATH richiesto');
  const root = mkdtempSync(join(tmpdir(), 'gptcode-desktop-agent-'));
  const home = join(root, 'home'); mkdirSync(join(home, '.gptcode'), { recursive: true }); mkdirSync(join(root, '.gptcode'));
  const proof = join(root, 'proof.txt');
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    const completed = body.messages.some(m => m.role === 'tool');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ choices: [{ message: completed ? { role: 'assistant', content: 'LOCAL_AGENT_DONE' } : {
      role: 'assistant', content: null, tool_calls: [{ id: 'write-proof', type: 'function', function: { name: 'Write', arguments: JSON.stringify({ file_path: proof, content: 'REAL_AGENT_WRITE' }) } }],
    }, finish_reason: completed ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(home, '.gptcode', 'providers.json'), JSON.stringify({ version: 1, providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat-completions', models: [{ id: 'test-model' }] } } }));
  writeFileSync(join(root, '.gptcode', 'settings.json'), JSON.stringify({ model: 'fixture/test-model', checkpoints: false, autoCompact: false, nativeCapabilities: { enabled: false }, permissions: { allow: [], deny: [], ask: ['Write'] } }));
  const client = new Client(root, { GPTCODE_CLI_PATH: cli, USERPROFILE: home, HOME: home, OPENAI_API_KEY: '', GPTCODE_MODEL: 'fixture/test-model', CODEX_AUTH_PATH: join(home, 'absent.json') });
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); cleanup(root); });
  await client.request('chat.send', { prompt: 'Scrivi il file di prova.', model: 'fixture/test-model' });
  const denied = await client.wait('chat.request', event => event.kind === 'permission');
  const pending = await client.request('chat.status');
  assert.equal(pending.requests[0].id, denied.id); assert.equal(pending.busy, true);
  assert.equal(denied.request.name, 'Write'); assert.equal(existsSync(proof), false);
  await client.request('chat.answer', { id: denied.id, answer: 'deny' }); await client.wait('chat.idle');
  assert.equal(existsSync(proof), false);
  await client.request('chat.reset');
  await client.request('chat.send', { prompt: 'Scrivi il file di prova.', model: 'fixture/test-model' });
  const allowed = await client.wait('chat.request', event => event.kind === 'permission');
  await client.request('chat.answer', { id: allowed.id, answer: 'allow' });
  const done = await client.wait('chat.done'); await client.wait('chat.idle');
  assert.equal(done.text, 'LOCAL_AGENT_DONE'); assert.equal(readFileSync(proof, 'utf8'), 'REAL_AGENT_WRITE');
  assert.ok((await client.request('chat.history')).length >= 2);
});

test('stream reale prima della fine del modello: codice e anteprima proposti, nessuna scrittura prima del consenso', { timeout: 60000 }, async t => {
  const cli = process.env.GPTCODE_CLI_PATH; if (!cli) return t.skip('GPTCODE_CLI_PATH richiesto');
  const root = mkdtempSync(join(tmpdir(), 'gptcode-desktop-agent-'));
  const home = join(root, 'home'); mkdirSync(join(home, '.gptcode'), { recursive: true }); mkdirSync(join(root, '.gptcode'));
  const path = join(root, 'index.html'), first = '<!doctype html><h1>FASE_UNO</h1>', content = first + '<p>FASE_DUE</p>';
  let release, modelRequests = 0;
  const server = createServer(async (request, response) => {
    let body = ''; for await (const part of request) body += part; const input = JSON.parse(body); modelRequests++;
    if (input.messages.some(m => m.role === 'tool')) { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'STREAM_OK' }, finish_reason: 'stop' }] })); return; }
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const full = JSON.stringify({ file_path: path, content }), prefix = JSON.stringify({ file_path: path, content: first }).slice(0, -2);
    const packet = delta => response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`);
    packet({ tool_calls: [{ index: 0, id: 'stream-write', function: { name: 'Write', arguments: prefix } }] });
    release = () => { packet({ tool_calls: [{ index: 0, function: { arguments: full.slice(prefix.length) } }] }); response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`); };
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(home, '.gptcode/providers.json'), JSON.stringify({ version: 1, providers: { fixture: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'chat-completions', models: [{ id: 'test-model' }] } } }));
  writeFileSync(join(root, '.gptcode/settings.json'), JSON.stringify({ model: 'fixture/test-model', checkpoints: false, autoCompact: false, nativeCapabilities: { enabled: false }, permissions: { allow: [], deny: [], ask: ['Write'] } }));
  const client = new Client(root, { GPTCODE_CLI_PATH: cli, USERPROFILE: home, HOME: home, OPENAI_API_KEY: '', GPTCODE_MODEL: 'fixture/test-model', CODEX_AUTH_PATH: join(home, 'absent.json') });
  t.after(async () => { release?.(); await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); cleanup(root); });
  await client.request('chat.send', { prompt: 'Genera il sito con lo stream di prova.', model: 'fixture/test-model' });
  const partial = await client.wait('workspace.draft', event => event.phase === 'streaming' && event.after.includes('FASE_UNO'));
  assert.equal(partial.after, first); assert.equal(existsSync(path), false);
  const preview = await client.wait('preview.state', event => event.url && event.proposed);
  assert.equal(await (await fetch(preview.url)).text(), first);
  assert.equal(client.events.some(event => event.event === 'chat.request'), false);
  release(); release = null;
  const permission = await client.wait('chat.request');
  assert.equal(existsSync(path), false);
  const complete = await client.wait('workspace.draft', event => event.phase === 'approval' && event.after.includes('FASE_DUE'));
  assert.equal(complete.after, content);
  await client.request('chat.answer', { id: permission.id, answer: 'allow' }); await client.wait('chat.idle');
  assert.equal(readFileSync(path, 'utf8'), content); assert.equal(modelRequests, 2);
  writeFileSync(path, content + '<footer>AGGIORNATO</footer>');
  await client.wait('workspace.file', event => event.text?.includes('AGGIORNATO'));
});
