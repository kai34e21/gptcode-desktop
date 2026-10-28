import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export class NodeDebugger {
  constructor(root, emit) { this.root = root; this.emit = emit; this.next = 1; this.pending = new Map(); this.frames = []; this.objects = new Set(); this.scripts = new Map(); }
  async start(file, breakpoints = []) {
    if (this.child) throw Error('Ferma la sessione debug prima di avviarne un’altra');
    this.child = spawn(process.execPath, ['--inspect-brk=127.0.0.1:0', file], { cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const child = this.child;
    child.stdout.on('data', data => this.emit('debug.output', { text: data.toString() }));
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Inspector non disponibile entro 10 secondi')), 10000);
      let stderr = '';
      const fail = e => { clearTimeout(timeout); reject(e); };
      child.once('error', fail);
      child.once('exit', code => fail(Error(`Il processo debug è terminato: ${code}`)));
      child.stderr.on('data', data => {
        stderr = (stderr + data).slice(-16000);
        const match = stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
        else if (!stderr.includes('Debugger')) this.emit('debug.output', { text: data.toString() });
        if (stderr.includes('Waiting for the debugger to disconnect')) this.socket?.close();
      });
    }).catch(e => { this.stop(); throw e; });
    this.socket = new WebSocket(endpoint);
    this.socket.addEventListener('message', e => {
      const message = JSON.parse(String(e.data));
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timeout);
        if (message.error) pending.reject(Error(message.error.message)); else pending.resolve(message.result);
      } else if (message.method === 'Debugger.scriptParsed') {
        this.scripts.set(message.params.scriptId, message.params.url);
      } else if (message.method === 'Debugger.paused') {
        this.frames = message.params.callFrames.map(frame => ({ ...frame, url: frame.url || this.scripts.get(frame.location.scriptId) || '' }));
        this.objects.clear();
        for (const frame of this.frames) for (const scope of frame.scopeChain) if (scope.object.objectId) this.objects.add(scope.object.objectId);
        this.emit('debug.paused', { reason: message.params.reason, frames: this.frames });
      } else if (message.method === 'Debugger.resumed') { this.frames = []; this.emit('debug.resumed', {}); }
    });
    this.socket.addEventListener('close', () => { for (const item of this.pending.values()) { clearTimeout(item.timeout); item.reject(Error('Debugger disconnesso')); } this.pending.clear(); });
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', () => reject(Error('Connessione Inspector fallita')), { once: true }); });
    child.once('exit', code => { if (this.child === child) { this.child = null; this.socket?.close(); this.emit('debug.ended', { code }); } });
    await this.send('Runtime.enable');
    await this.send('Debugger.enable');
    for (const point of breakpoints) await this.send('Debugger.setBreakpointByUrl', { url: pathToFileURL(point.path).href, lineNumber: point.line - 1 });
    await this.send('Runtime.runIfWaitingForDebugger');
    return { file };
  }
  send(method, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(Error('Debugger non connesso'));
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(Error(`Timeout debugger: ${method}`)); }, 10000);
      this.pending.set(id, { resolve, reject, timeout }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async action(action) {
    const method = { continue: 'Debugger.resume', next: 'Debugger.stepOver', into: 'Debugger.stepInto', out: 'Debugger.stepOut', pause: 'Debugger.pause' }[action];
    if (!method) throw Error('Azione debugger non supportata');
    return this.send(method);
  }
  async variables(objectId) {
    if (!this.objects.has(objectId)) throw Error('Scope debug non valido');
    const result = await this.send('Runtime.getProperties', { objectId, ownProperties: true, generatePreview: true });
    return result.result.filter(x => x.enumerable).map(x => ({ name: x.name, value: x.value?.value ?? x.value?.description ?? x.value?.type ?? 'getter' }));
  }
  async evaluate(frameId, expression) {
    if (!this.frames.some(f => f.callFrameId === frameId)) throw Error('Frame debug non valido');
    const result = await this.send('Debugger.evaluateOnCallFrame', { callFrameId: frameId, expression, returnByValue: true, throwOnSideEffect: true });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return { value: result.result.value ?? result.result.description };
  }
  stop() { const child = this.child; this.child = null; this.socket?.close(); child?.kill(); this.frames = []; this.objects.clear(); this.emit('debug.ended', { stopped: true }); }
}
