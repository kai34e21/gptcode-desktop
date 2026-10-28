import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { extname, relative, resolve } from 'node:path';
import { existsSync, statSync, createReadStream } from 'node:fs';

const types = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
export function localPreviewUrl(input) {
  const url = new URL(input);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) throw Error('Inserisci un URL HTTP locale (localhost o 127.0.0.1)');
  return url.href;
}
export class PreviewService {
  constructor(files, emit) {
    this.files = files; this.emit = emit; this.token = randomBytes(24).toString('hex'); this.revision = 0; this.current = null;
    this.listener = (event, data) => {
      if (event === 'workspace.draft' && /\.html?$/i.test(data.path) && ['streaming', 'approval'].includes(data.phase)) {
        this.current = { path: data.path, mode: 'static', proposed: true }; this.schedule();
      } else if (event === 'workspace.draft' && this.current?.path === data.path && ['denied', 'cancelled', 'error', 'saved'].includes(data.phase)) {
        this.current.proposed = false; this.schedule();
      } else if (['workspace.file', 'workspace.asset'].includes(event) && this.current?.mode === 'static') this.schedule();
      else if (event === 'workspace.draft' && this.current?.mode === 'static') this.schedule();
    };
    files.listeners.add(this.listener);
  }
  async start() {
    if (this.starting) return this.starting;
    this.starting = new Promise((resolveStart, reject) => {
      this.server = createServer((request, response) => this.serve(request, response));
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.origin = `http://127.0.0.1:${this.server.address().port}`; resolveStart(); });
    });
    return this.starting;
  }
  virtual(path) {
    return [...this.files.drafts.values()].reverse().find(draft => draft.path === path && ['streaming', 'approval'].includes(draft.phase));
  }
  async open(path) {
    path = this.files.path(path);
    if (!/\.html?$/i.test(path)) throw Error('Per i file locali scegli HTML; per Vite/Next usa URL locale');
    if (!existsSync(path) && !this.virtual(path)) throw Error('File anteprima non ancora disponibile');
    this.current = { path, mode: 'static', proposed: Boolean(this.virtual(path)) }; await this.update(); return this.state();
  }
  local(url) { this.current = { mode: 'local', url: localPreviewUrl(url), proposed: false }; this.revision++; this.emit('preview.state', this.state()); return this.state(); }
  schedule() { if (this.timer) return; this.timer = setTimeout(() => { this.timer = null; void this.update().catch(() => this.emit('preview.error', { message: 'Anteprima locale non disponibile' })); }, 180); }
  async update() { if (!this.current) return; if (this.current.mode === 'static') await this.start(); this.revision++; this.emit('preview.state', this.state()); }
  state() {
    if (!this.current) return { mode: 'empty', revision: this.revision };
    const path = this.current.path;
    const url = this.current.mode === 'local' ? this.current.url : this.origin ? `${this.origin}/p/${this.token}/${relative(this.files.root, path).split(/[\\/]/).map(encodeURIComponent).join('/')}?revision=${this.revision}` : null;
    return { ...this.current, proposed: this.current.mode === 'static' ? [...this.files.drafts.values()].some(draft => ['streaming', 'approval'].includes(draft.phase)) : false, url, revision: this.revision };
  }
  serve(request, response) {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const url = new URL(request.url, this.origin);
      const prefix = `/p/${this.token}/`;
      if (!url.pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const name = decodeURIComponent(url.pathname.slice(prefix.length));
      if (name.split(/[\\/]/).some(segment => segment.startsWith('.') || ['node_modules', 'target', 'credentials.json', 'auth.json', 'providers.json'].includes(segment.toLowerCase()))) { response.writeHead(403).end(); return; }
      const path = this.files.path(resolve(this.files.root, name)), type = types[extname(path).toLowerCase()];
      if (!type) { response.writeHead(415).end(); return; }
      const virtual = this.virtual(path);
      if (!virtual && (!existsSync(path) || !statSync(path).isFile())) { response.writeHead(404).end('Il file non è stato salvato.'); return; }
      if (!virtual && statSync(path).size > 20 * 1024 * 1024) { response.writeHead(413).end(); return; }
      response.writeHead(200, {
        'content-type': type, 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
        'content-security-policy': `default-src ${this.origin} data: blob:; script-src ${this.origin} 'unsafe-inline' 'unsafe-eval' blob:; style-src ${this.origin} 'unsafe-inline'; connect-src ${this.origin}; img-src ${this.origin} data: blob:; frame-src 'none'; object-src 'none'; base-uri ${this.origin}; form-action 'none'; sandbox allow-scripts`,
      });
      if (request.method === 'HEAD') response.end();
      else if (virtual) response.end(virtual.after);
      else { const stream = createReadStream(path); stream.on('error', () => response.destroy()); stream.pipe(response); }
    } catch { if (!response.headersSent) response.writeHead(403); response.end(); }
  }
  close() { clearTimeout(this.timer); this.files.listeners.delete(this.listener); this.server?.closeAllConnections(); this.server?.close(); }
}
