import { watch, existsSync, realpathSync, statSync, readFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { partialString } from './stream-tap.mjs';

const LIMIT = 4 * 1024 * 1024;
const ignored = path => path.split(/[\\/]/).some(part => ['.git', '.gptcode', '.codex', '.aws', '.ssh', 'node_modules', 'target', '.next', '.next-gptcode-release', 'webview-profile', 'auth.json', 'credentials.json', 'providers.json'].includes(part.toLowerCase()) || part.toLowerCase().startsWith('.env'));
export class LiveFiles {
  constructor(root, emit) {
    this.root = realpathSync(root); this.emit = emit; this.drafts = new Map(); this.sequence = 0; this.timers = new Map(); this.baselines = new Map(); this.listeners = new Set();
    try { this.watcher = watch(root, { recursive: true }, (_, file) => {
      if (!file || ignored(String(file))) return;
      const path = resolve(root, String(file)); clearTimeout(this.timers.get(path));
      this.timers.set(path, setTimeout(() => { this.timers.delete(path); this.changed(path); }, 90));
    }); this.watcher.on('error', () => this.emit('workspace.error', { message: 'Monitoraggio del progetto interrotto' })); }
    catch { this.emit('workspace.error', { message: 'Monitoraggio del progetto non disponibile' }); }
  }
  path(input) {
    if (typeof input !== 'string' || !input || input.includes('\0')) throw Error('Percorso file non valido');
    const path = resolve(this.root, input); if (ignored(relative(this.root, path))) throw Error('Percorso escluso');
    let parent = path; while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
    const real = realpathSync(parent), rel = relative(this.root, real);
    if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw Error('File fuori dal progetto');
    return existsSync(path) ? real : resolve(real, relative(parent, path));
  }
  read(path) {
    path = this.path(path); if (!existsSync(path)) return null;
    const stat = statSync(path); if (!stat.isFile() || stat.size > LIMIT) throw Error('File non visualizzabile');
    const bytes = readFileSync(path); if (bytes.includes(0)) throw Error('File binario');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  publish(event, payload) { this.emit(event, payload); for (const listener of this.listeners) listener(event, payload); }
  stream(call) {
    try {
      const pathValue = partialString(call.arguments, 'file_path') ?? partialString(call.arguments, 'path');
      if (!pathValue?.complete) return;
      const path = this.path(pathValue.text), key = String(call.id);
      let previous = this.drafts.get(key);
      if (!previous || previous.path !== path || ['saved', 'denied', 'error', 'cancelled'].includes(previous.phase)) {
        previous = { callId: key, path, name: call.name, before: this.read(path), after: '', phase: 'streaming' };
      }
      let after;
      if (call.name === 'Write') after = partialString(call.arguments, 'content')?.text;
      else if (call.name === 'Edit') {
        const old = partialString(call.arguments, 'old_string'), replacement = partialString(call.arguments, 'new_string');
        if (!old?.complete || !replacement || previous.before === null || !old.text) return;
        const occurrences = previous.before.split(old.text).length - 1;
        const all = /"replace_all"\s*:\s*true/.test(call.arguments);
        if (!occurrences || (occurrences > 1 && !all)) return;
        after = all ? previous.before.split(old.text).join(replacement.text) : previous.before.replace(old.text, replacement.text);
      }
      if (after === undefined || after.length > LIMIT) return;
      const phase = call.complete ? 'approval' : 'streaming';
      if (previous.after === after && previous.phase === phase && this.drafts.has(key)) return;
      const draft = { ...previous, after, phase, version: ++this.sequence };
      this.drafts.set(key, draft); this.trim(); this.publish('workspace.draft', draft);
    } catch { /* Invalid/outside paths never become editor content. */ }
  }
  tool(data) {
    if (['Write', 'Edit'].includes(data.name) && data.phase === 'start') this.stream({ id: data.callId, name: data.name, arguments: JSON.stringify(data.args), complete: true });
    if (data.phase !== 'end') return;
    const draft = this.drafts.get(String(data.callId));
    if (!draft) return;
    const phase = data.denied || data.blocked ? 'denied' : data.error ? 'error' : 'saved';
    const updated = { ...draft, phase, version: ++this.sequence };
    this.drafts.set(updated.callId, updated); this.publish('workspace.draft', updated);
    if (phase === 'saved') this.changed(updated.path, updated);
  }
  changed(input, draft) {
    try {
      const path = this.path(input), text = this.read(path), hash = text === null ? null : createHash('sha256').update(text).digest('hex');
      if (!draft && this.baselines.get(path) === hash) return;
      this.baselines.set(path, hash);
      this.publish('workspace.file', { path, text, deleted: text === null, version: ++this.sequence, source: draft ? 'agent' : this.agentRunning ? 'activity' : 'disk', before: draft?.before });
    } catch {
      try { const path = this.path(input); if (/\.(png|jpe?g|gif|webp|ico|woff2?|wasm)$/i.test(path) && existsSync(path) && statSync(path).isFile()) this.publish('workspace.asset', { path, version: ++this.sequence }); } catch {}
    }
  }
  trim() { while (this.drafts.size > 80) this.drafts.delete(this.drafts.keys().next().value); }
  state() {
    const files = [], paths = new Set();
    for (const draft of [...this.drafts.values()].reverse()) if (draft.phase === 'saved' && !paths.has(draft.path)) {
      paths.add(draft.path); try { const text = this.read(draft.path); files.push({ path: draft.path, text, deleted: text === null, source: 'agent', before: draft.before, version: ++this.sequence }); } catch {}
    }
    return { drafts: [...this.drafts.values()], files, version: this.sequence };
  }
  cancel() {
    for (const [key, draft] of this.drafts) if (['streaming', 'approval'].includes(draft.phase)) {
      const updated = { ...draft, phase: 'cancelled', version: ++this.sequence }; this.drafts.set(key, updated); this.publish('workspace.draft', updated);
    }
  }
  close() { this.watcher?.close(); for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.listeners.clear(); }
}
