import { createInterface } from 'node:readline';
import { realpathSync, statSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { LanguageServer } from './language-server.mjs';
import { NodeDebugger } from './debugger.mjs';
import { ChatService } from './chat.mjs';
import { LiveFiles } from './live-files.mjs';
import { PreviewService } from './preview.mjs';

const output = process.stdout.write.bind(process.stdout);
console.log = (...args) => console.error(...args);
const send = value => output(JSON.stringify(value) + '\n');
const emit = (event, payload) => send({ event, payload });
function real(path) { return realpathSync(process.platform === 'win32' ? path.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '') : path); }
const root = real(process.env.GPTCODE_WORKSPACE_ROOT || process.cwd());
process.chdir(root);
const lsp = new LanguageServer(root, emit), debug = new NodeDebugger(root, emit);
const files = new LiveFiles(root, emit), preview = new PreviewService(files, emit);
let chat = new ChatService(root, process.env.GPTCODE_CLI_PATH || '', emit, files);
let resettingChat = false;
function file(path) {
  if (typeof path !== 'string') throw Error('Percorso richiesto');
  const target = real(path), rel = relative(root, target);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel) || !statSync(target).isFile()) throw Error('File fuori dal progetto');
  return target;
}
async function command(method, data = {}) {
  if (method === 'ping') return { root, protocol: 1 };
  if (method === 'workspace.state') return files.state();
  if (method === 'preview.state') return preview.state();
  if (method === 'preview.open') return preview.open(data.path);
  if (method === 'preview.local') return preview.local(data.url);
  if (method === 'preview.refresh') { await preview.update(); return preview.state(); }
  if (method === 'lsp.open') {
    if (typeof data.text !== 'string' || data.text.length > 4 * 1024 * 1024 || !Number.isSafeInteger(data.version) || data.version < 1) throw Error('Documento LSP non valido');
    return lsp.open(file(data.path), data.text, data.version);
  }
  if (['lsp.completion', 'lsp.hover', 'lsp.definition'].includes(method)) {
    if (!Number.isSafeInteger(data.line) || data.line < 0 || !Number.isSafeInteger(data.character) || data.character < 0) throw Error('Posizione non valida');
    return lsp.request(method.slice(4), file(data.path), { line: data.line, character: data.character });
  }
  if (method === 'debug.start') {
    const entry = file(data.path);
    if (!/\.[cm]?[jt]s$/.test(entry)) throw Error('Debug disponibile per file Node.js: JS, MJS, CJS e TypeScript compatibile con Node');
    return debug.start(entry, (data.breakpoints ?? []).slice(0, 100).map(b => {
      if (!Number.isSafeInteger(b.line) || b.line < 1) throw Error('Breakpoint non valido');
      return { path: file(b.path), line: b.line };
    })).catch(error => { debug.stop(); throw error; });
  }
  if (method === 'debug.action') return debug.action(data.action);
  if (method === 'debug.variables') return debug.variables(data.objectId);
  if (method === 'debug.evaluate') {
    if (typeof data.expression !== 'string' || data.expression.length > 5000) throw Error('Espressione non valida');
    return debug.evaluate(data.frameId, data.expression);
  }
  if (method === 'debug.stop') { debug.stop(); return {}; }
  if (method === 'chat.status') return chat.status();
  if (method === 'chat.history') return chat.history();
  if (method === 'chat.send') { if (resettingChat) throw Error('Attendi la preparazione della nuova chat'); return chat.send(data.prompt, data); }
  if (method === 'chat.answer') {
    if (typeof data.answer !== 'string' || data.answer.length > 20000) throw Error('Risposta non valida');
    return chat.answer(data.id, data.answer);
  }
  if (method === 'chat.stop') return chat.stop();
  if (method === 'chat.reset') { if (chat.busy || resettingChat) throw Error('Ferma prima la risposta e attendi la preparazione della chat'); resettingChat = true; try { await chat.close(); chat = new ChatService(root, process.env.GPTCODE_CLI_PATH || '', emit, files); return {}; } finally { resettingChat = false; } }
  throw Error(`Operazione non supportata: ${method}`);
}
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', async line => {
  let request;
  try {
    if (line.length > 32 * 1024 * 1024) throw Error('Messaggio troppo grande');
    request = JSON.parse(line);
    if (!Number.isSafeInteger(request.id) || typeof request.method !== 'string') throw Error('Richiesta non valida');
    send({ id: request.id, result: await command(request.method, request.data) });
  } catch (error) { send({ id: request?.id ?? null, error: error.message }); }
});
async function shutdown() { debug.stop(); preview.close(); files.close(); await Promise.race([Promise.allSettled([lsp.close(), chat.close()]), new Promise(resolve => setTimeout(resolve, 1500))]); process.exit(0); }
lines.on('close', shutdown); process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
