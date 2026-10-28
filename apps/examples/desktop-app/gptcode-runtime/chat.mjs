import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { observeToolStream } from './stream-tap.mjs';

export class ChatService {
  constructor(root, cli, emit, files) { this.root = root; this.cli = cli; this.emit = emit; this.files = files; this.questions = new Map(); this.input = []; this.busy = false; }
  load(name) { return import(pathToFileURL(join(dirname(dirname(this.cli)), 'src', `${name}.mjs`)).href); }
  async status() {
    const { loadConfig, GLOBAL_DIR } = await this.load('config');
    const { listProviderModels } = await this.load('providers');
    const cfg = loadConfig(this.root);
    return { model: this.cfg?.model ?? cfg.model, permissionMode: this.cfg?.permissionMode ?? cfg.permissionMode, models: listProviderModels(cfg).map(m => ({ id: m.slug, name: m.name })), sessionId: this.agent ? this.session?.id : null, busy: this.busy,
      messages: [...this.input, ...(this.busy && this.currentText ? [{ role: 'assistant', content: this.currentText }] : [])],
      requests: [...this.questions].map(([id, item]) => ({ id, kind: item.kind, request: item.request })) };
  }
  async history() { const { GLOBAL_DIR } = await this.load('config'); const { listSessions } = await this.load('session'); return listSessions(GLOBAL_DIR, { cwd: this.root, limit: 30 }).map(({ id, firstMessage }) => ({ id, title: firstMessage || id })); }
  async initialize(options = {}) {
    if (this.agent) return;
    const [{ loadConfig, GLOBAL_DIR }, { createProviderRouter }, { Agent }, { Session, readSession }, { HookRunner }, skillsModule,
      { loadAgents }, { ExtensionRuntime, mergeExtensionHooks }, { getPluginExtensions }, { ModsRuntime }, { createGitHelper }] = await Promise.all([
      this.load('config'), this.load('providers'), this.load('agent'), this.load('session'), this.load('hooks'), this.load('skills'),
      this.load('subagents'), this.load('extensions'), this.load('plugins'), this.load('mods'), this.load('git'),
    ]);
    const cfg = loadConfig(this.root, options.model ? { model: options.model } : {});
    cfg.cwd = this.root;
    // Desktop owns explicit per-action approvals even when the terminal profile bypasses them.
    cfg.permissionMode = options.mode === 'plan' ? 'plan' : 'default';
    const found = options.sessionId ? readSession(options.sessionId, GLOBAL_DIR) : null;
    if (options.sessionId && (!found || !found.metadata?.cwd || resolve(found.metadata.cwd).toLowerCase() !== resolve(this.root).toLowerCase())) throw Error('Sessione non appartenente al progetto');
    this.session = new Session({ id: found?.id, globalDir: GLOBAL_DIR, cwd: this.root, model: cfg.model });
    this.input = found ? Session.toInput(found.records) : [];
    cfg.providerSessionId = this.session.id;
    const creds = await createProviderRouter(cfg);
    this.cfg = cfg; this.skillsModule = skillsModule;
    this.skills = skillsModule.loadSkills(cfg.cwd, cfg.globalDir, { disabledSkills: cfg.disabledSkills });
    this.commands = skillsModule.loadCommands(cfg.cwd, cfg.globalDir);
    this.agents = loadAgents(cfg.cwd, cfg.globalDir);
    const ui = new Proxy({
      onText: text => { this.currentText = (this.currentText ?? '') + text; this.emit('chat.text', { text }); }, onThinking: text => this.emit('chat.reasoning', { text }),
      onToolStart: data => { const event = { ...data, phase: 'start' }; this.files?.tool(event); this.emit('chat.tool', event); },
      onToolEnd: data => { const event = { ...data, phase: 'end' }; this.files?.tool(event); this.emit('chat.tool', event); },
      onError: error => this.emit('chat.error', { message: error?.message ?? String(error) }),
      onUsage: usage => this.emit('chat.usage', usage), onTodos: todos => this.emit('chat.todos', { todos }),
      askPermission: request => this.question('permission', request), askUser: request => this.question('question', request),
      write: text => this.emit('chat.log', { text }), close() {},
    }, { get(target, key) { return key in target ? target[key] : () => {}; } });
    this.extensions = new ExtensionRuntime(cfg, { log: text => this.emit('chat.log', { text }) });
    try {
      await this.extensions.start();
      const hooks = new HookRunner(mergeExtensionHooks(cfg.hooks, getPluginExtensions(cfg.globalDir).hooks), { cwd: cfg.cwd, env: cfg.env });
      this.agent = new Agent({ creds, cfg, hooks, skills: this.skills, agents: this.agents, commands: this.commands, mcpClients: this.extensions.clients, ui, log: text => this.emit('chat.log', { text }) });
      const runTurn = this.agent._runTurn.bind(this.agent);
      this.agent._runTurn = (...args) => observeToolStream(call => this.files?.stream(call), () => runTurn(...args));
      this.agent.sessionId = this.session.id; this.agent._git = createGitHelper({ cwd: this.root });
      this.extensions.attach(this.agent, { skillCatalog: skillsModule.loadSkillCatalog(cfg.cwd, cfg.globalDir) });
      this.agent.registerSkillTool();
      this.mods = new ModsRuntime({ globalDir: cfg.globalDir, cwd: cfg.cwd, model: cfg.model, sessionId: this.session.id, isInteractive: true, ui });
      await this.mods.start(); this.mods.attach(this.agent);
      if (hooks.has('SessionStart')) await hooks.run('SessionStart', { session_id: this.session.id, cwd: this.root, hook_event_name: 'SessionStart', source: found ? 'resume' : 'startup' });
      this.emit('chat.session', { id: this.session.id, model: cfg.model, mode: cfg.permissionMode, messages: this.input });
    } catch (e) { await this.mods?.close(); await this.extensions.close(); this.agent = null; throw e; }
  }
  question(kind, request) {
    const id = randomUUID();
    return new Promise(resolve => { this.questions.set(id, { resolve, kind, request }); this.emit('chat.request', { id, kind, request }); });
  }
  answer(id, answer) {
    const item = this.questions.get(id); if (!item) throw Error('Richiesta scaduta');
    this.questions.delete(id); item.resolve(answer); return { accepted: true };
  }
  async send(prompt, options) {
    if (this.busy) throw Error('Attendi il termine della risposta o premi Stop');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) throw Error('Messaggio vuoto o troppo lungo');
    this.busy = true; this.currentText = ''; if (this.files) this.files.agentRunning = true;
    try {
      await this.initialize(options);
      if (this.agent._abortController?.signal.aborted) this.agent.orchestrator.reset();
      this.turn = this.run(prompt).catch(error => this.emit('chat.error', { message: error.message })).finally(() => {
        this.busy = false; this.currentText = ''; if (this.files) this.files.agentRunning = false; for (const item of this.questions.values()) item.resolve('deny'); this.questions.clear(); this.files?.cancel(); this.emit('chat.idle', {});
      });
      return { sessionId: this.session.id };
    } catch (e) { this.busy = false; if (this.files) this.files.agentRunning = false; throw e; }
  }
  async run(prompt) {
    const submitted = await this.mods.submit(prompt);
    if (submitted.drop) throw Error(`Prompt bloccato dal plugin: ${submitted.drop}`);
    const text = submitted.text + (submitted.context.length ? `\n\n${submitted.context.join('\n')}` : '');
    this.input.push({ role: 'user', content: text }); this.session.user(text);
    const [{ buildSystemPrompt }, { readProjectDocs, readMemory }, { contextBlock }] = await Promise.all([this.load('systemprompt'), this.load('cli'), this.load('ide')]);
    const instructions = buildSystemPrompt(this.cfg, { toolSpecs: this.agent.toolSpecs(), skills: this.skills, agents: this.agents, commands: this.commands,
      projectDocs: readProjectDocs(this.root), memory: readMemory(this.root, this.cfg.globalDir), ideContext: contextBlock(this.cfg.globalDir, this.root) });
    const result = await this.agent.run({ input: this.input, instructions, maxTurns: this.cfg.maxTurns ?? 100 });
    if (result.text) this.input.push({ role: 'assistant', content: result.text });
    this.session.assistant(result.text, { model: this.cfg.model, turns: result.turns, toolUses: result.toolUses });
    this.emit('chat.done', { ...result, sessionId: this.session.id });
  }
  stop() { this.agent?.orchestrator.stop('Interrotto dal desktop'); for (const item of this.questions.values()) item.resolve('deny'); this.questions.clear(); return { stopped: true }; }
  async close() { this.stop(); await this.turn; await this.mods?.close({ notify: true }); await this.extensions?.close(); this.agent = null; this.input = []; }
}
