// Native WebView2 E2E. Isolated synthetic project and local simulated model;
// no user input injection, no external inference, no modification of global profiles.
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import assert from 'node:assert/strict';

const executable = process.env.GPTCODE_TEST_APP;
const cli = process.env.GPTCODE_CLI_PATH;
if (!executable || !cli) throw Error('Impostare GPTCODE_TEST_APP e GPTCODE_CLI_PATH');
const root = mkdtempSync(join(tmpdir(), 'gptcode-native-e2e-'));
const report = resolve(process.env.GPTCODE_TEST_REPORT || 'gptcode-e2e-report'); mkdirSync(report, { recursive: true });
const home = join(root, 'home'); mkdirSync(join(home, '.gptcode'), { recursive: true }); mkdirSync(join(root, '.gptcode'));
const main = join(root, 'main.mjs'), types = join(root, 'types.ts'), proof = join(root, 'agent-proof.txt');
writeFileSync(main, 'const value = 40;\nconst answer = value + 2;\nconsole.log(answer);\n');
writeFileSync(types, 'const person = { name: "Ada", age: 21 };\nconst invalid: number = "errore";\nperson.\n');
writeFileSync(join(root, 'edit.txt'), 'BEFORE_NATIVE_EDIT\r\n');
const modelServer = createServer(async (request, response) => {
  let raw = ''; for await (const part of request) raw += part;
  const body = JSON.parse(raw), done = body.messages.some(m => m.role === 'tool');
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ choices: [{ message: done ? { role: 'assistant', content: 'NATIVE_AGENT_OK' } : { role: 'assistant', content: null,
    tool_calls: [{ id: 'native-write', type: 'function', function: { name: 'Write', arguments: JSON.stringify({ file_path: proof, content: 'WRITTEN_FROM_NATIVE_CHAT' }) } }],
  }, finish_reason: done ? 'stop' : 'tool_calls' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
});
await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
writeFileSync(join(home, '.gptcode/providers.json'), JSON.stringify({ version: 1, providers: { fixture: { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, protocol: 'chat-completions', models: [{ id: 'test-model' }] } } }));
writeFileSync(join(root, '.gptcode/settings.json'), JSON.stringify({ model: 'fixture/test-model', checkpoints: false, autoCompact: false, nativeCapabilities: { enabled: false }, permissions: { allow: [], deny: [], ask: ['Write'] } }));
const reservation = netServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve)); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const env = { ...process.env, GPTCODE_CLI_PATH: cli, GPTCODE_WORKSPACE_ROOT: root, GPTCODE_QA_HIDDEN: '1',
  WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview-profile'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
  GPTCODE_PROFILE_ROOT: home, OPENAI_API_KEY: '', GPTCODE_MODEL: 'fixture/test-model', CODEX_AUTH_PATH: join(home, 'absent.json') };
delete env.GPTCODE_DESKTOP_RUNTIME; delete env.GPTCODE_NODE_PATH;
const child = spawn(executable, [], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
console.log(`QA_PID=${child.pid} QA_PORT=${port}`);
let appOutput = ''; child.stdout.on('data', data => appOutput += data); child.stderr.on('data', data => appOutput += data);
let browser; const proofResults = {};
async function until(fn, timeout = 60000) { const start = Date.now(); let error; while (Date.now() - start < timeout) { try { return await fn(); } catch (e) { error = e; await new Promise(resolve => setTimeout(resolve, 150)); } } throw error; }
try {
  await until(async () => { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (!response.ok) throw Error('CDP non pronto'); return response.json(); });
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = await until(async () => { const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('tauri.localhost') || p.url().includes('tauri://')); if (!page) throw Error('WebView Tauri non trovata'); return page; });
  const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
  await page.getByRole('button', { name: 'edit.txt', exact: true }).click();
  const editor = page.locator('.cm-content[contenteditable=true]:visible');
  await editor.fill('AFTER_NATIVE_EDIT\n');
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await until(async () => assert.equal(readFileSync(join(root, 'edit.txt'), 'utf8'), 'AFTER_NATIVE_EDIT\r\n'));
  proofResults.editorSave = 'real_native_ipc_and_disk';
  console.log('PASS native editor save');
  await page.getByRole('button', { name: 'types.ts', exact: true }).click();
  await until(async () => assert.ok(await page.locator('.cm-lintRange-error').count() > 0));
  proofResults.diagnostics = 'real_typescript_language_server';
  console.log('PASS native TypeScript diagnostics');
  await page.getByRole('textbox', { name: 'Messaggio a GPTCode' }).fill('Scrivi il file di prova del collaudo.');
  await page.getByRole('button', { name: 'Invia', exact: true }).click();
  await page.getByRole('button', { name: 'Consenti una volta', exact: true }).waitFor();
  assert.equal(existsSync(proof), false);
  await page.getByRole('button', { name: 'Consenti una volta', exact: true }).click();
  await page.getByText('NATIVE_AGENT_OK', { exact: true }).waitFor();
  assert.equal(readFileSync(proof, 'utf8'), 'WRITTEN_FROM_NATIVE_CHAT');
  proofResults.chat = 'real_GPTCode_engine_native_UI_local_simulated_provider';
  console.log('PASS native chat permission and disk write');
  await page.getByRole('button', { name: 'main.mjs', exact: true }).click();
  await page.locator('.gptcode-breakpoints:visible .cm-gutterElement').nth(3).click();
  await page.getByRole('tab', { name: 'Debug Node' }).click();
  await page.getByRole('button', { name: 'Avvia', exact: true }).click();
  await page.getByRole('button', { name: 'Continua', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Continua', exact: true }).click();
  await page.getByRole('button', { name: 'Continua', exact: true }).waitFor();
  await page.getByRole('button', { name: /\(programma\).*:3/ }).waitFor();
  await page.getByLabel('Valuta senza effetti collaterali').fill('answer');
  await page.getByRole('button', { name: 'Valuta', exact: true }).click();
  await page.locator('form').filter({ has: page.getByLabel('Valuta senza effetti collaterali') }).locator('pre').filter({ hasText: '42' }).waitFor();
  proofResults.debug = 'real_Node_Inspector_breakpoint_and_variable';
  await page.screenshot({ path: join(report, 'native-workbench.png') });
  await page.getByRole('button', { name: 'Ferma debug', exact: true }).click();
  assert.deepEqual(pageErrors, []);
  writeFileSync(join(report, 'result.json'), JSON.stringify({ passed: true, proof: proofResults, pageErrors }, null, 2));
  console.log(JSON.stringify(proofResults));
} catch (error) {
  writeFileSync(join(report, 'result.json'), JSON.stringify({ passed: false, proof: proofResults, error: error.message, exitCode: child.exitCode, appOutput }, null, 2));
  if (browser) { const page = browser.contexts().flatMap(c => c.pages())[0]; await page?.screenshot({ path: join(report, 'native-failure.png') }).catch(() => {}); }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  modelServer.closeAllConnections(); await new Promise(resolve => modelServer.close(resolve));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.match(relative(resolve(tmpdir()), resolve(root)), /^gptcode-native-e2e-[A-Za-z0-9]+$/);
  rmSync(root, { recursive: true, force: true, maxRetries: 6, retryDelay: 300 });
}
