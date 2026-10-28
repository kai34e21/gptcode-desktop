import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node';
const require = createRequire(import.meta.url);
const vendor = join(dirname(fileURLToPath(import.meta.url)), 'vendor');
const vendorPath = (name, fallback) => existsSync(join(vendor, name)) ? join(vendor, name) : require.resolve(fallback);

export class LanguageServer {
  constructor(root, emit) { this.root = root; this.emit = emit; this.documents = new Map(); }
  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.child = spawn(process.execPath, [vendorPath('typescript-language-server.mjs', 'typescript-language-server/lib/cli.mjs'), '--stdio'], {
        cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child.stderr.resume();
      this.child.on('error', e => this.emit('lsp.error', { message: e.message }));
      this.connection = createMessageConnection(new StreamMessageReader(this.child.stdout), new StreamMessageWriter(this.child.stdin));
      this.connection.onRequest('workspace/configuration', ({ items }) => items.map(() => ({})));
      this.connection.onRequest('client/registerCapability', () => null);
      this.connection.onRequest('window/workDoneProgress/create', () => null);
      this.connection.onNotification('textDocument/publishDiagnostics', data => this.emit('lsp.diagnostics', data));
      this.connection.onClose(() => this.emit('lsp.closed', {}));
      this.connection.listen();
      const result = await this.connection.sendRequest('initialize', {
        processId: process.pid, rootUri: pathToFileURL(this.root).href,
        workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: 'GPTCode' }],
        capabilities: { workspace: { configuration: true }, textDocument: {
          synchronization: { didSave: true }, completion: { completionItem: { snippetSupport: false } },
          hover: { contentFormat: ['plaintext'] }, publishDiagnostics: { versionSupport: true },
        } },
        initializationOptions: { hostInfo: 'gptcode-desktop', tsserver: {
          path: vendorPath('typescript/lib/tsserver.js', 'typescript/lib/tsserver.js'), disableAutomaticTypingAcquisition: true,
        } },
      });
      await this.connection.sendNotification('initialized', {});
      return { capabilities: result.capabilities };
    })();
    return this.ready;
  }
  async open(path, text, version) {
    await this.start();
    const uri = pathToFileURL(path).href;
    const previous = this.documents.get(uri);
    if (previous !== undefined && version <= previous) return { uri, version: previous };
    this.documents.set(uri, version);
    if (previous === undefined) await this.connection.sendNotification('textDocument/didOpen', {
      textDocument: { uri, text, version, languageId: /\.[cm]?tsx?$/.test(path) ? (/tsx$/.test(path) ? 'typescriptreact' : 'typescript') : (/jsx$/.test(path) ? 'javascriptreact' : 'javascript') },
    });
    else await this.connection.sendNotification('textDocument/didChange', { textDocument: { uri, version }, contentChanges: [{ text }] });
    return { uri, version };
  }
  async request(method, path, position) {
    await this.start();
    const allowed = { completion: 'textDocument/completion', hover: 'textDocument/hover', definition: 'textDocument/definition' };
    if (!allowed[method]) throw Error('Richiesta LSP non supportata');
    return this.connection.sendRequest(allowed[method], { textDocument: { uri: pathToFileURL(path).href }, position });
  }
  async close() {
    if (!this.connection) return;
    try { await Promise.race([this.connection.sendRequest('shutdown'), new Promise(resolve => setTimeout(resolve, 750))]); await this.connection.sendNotification('exit'); } catch {}
    this.connection.dispose();
    const child = this.child;
    if (child && child.exitCode === null) { await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 500))]); if (child.exitCode === null) child.kill(); }
  }
}
