import { cpSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative } from "node:path";

const require = createRequire(import.meta.url);
const app = resolve(import.meta.dir, "..");
const resources = join(app, "src-tauri/bin/gptcode-runtime");
mkdirSync(join(resources, "vendor"), { recursive: true });
const bundle = await Bun.build({ entrypoints: [join(app, "gptcode-runtime/worker.mjs")], target: "node", format: "esm", naming: "worker.mjs", outdir: resources, minify: false });
if (!bundle.success) throw new AggregateError(bundle.logs, "Bundle runtime GPTCode fallito");
copyFileSync(require.resolve("typescript-language-server/lib/cli.mjs"), join(resources, "vendor/typescript-language-server.mjs"));
const typescriptTarget = join(resources, "vendor/typescript");
if (relative(app, typescriptTarget).replace(/\\/g, "/") !== "src-tauri/bin/gptcode-runtime/vendor/typescript") throw Error("Destinazione TypeScript non valida");
rmSync(typescriptTarget, { recursive: true, force: true });
mkdirSync(typescriptTarget, { recursive: true });
cpSync(dirname(require.resolve("typescript/lib/tsserver.js")), join(typescriptTarget, "lib"), { recursive: true });
copyFileSync(require.resolve("typescript/package.json"), join(typescriptTarget, "package.json"));
const node = process.env.GPTCODE_NODE_PATH || Bun.which("node");
if (!node) throw Error("Node.js richiesto per preparare il pacchetto");
copyFileSync(node, join(resources, "node.exe"));
const nodeVersion = Bun.spawnSync([node, "--version"], { stdout: "pipe" });
if (nodeVersion.exitCode) throw Error("Versione Node.js non disponibile");
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion.stdout.toString().trim()}/LICENSE`);
if (!license.ok) throw Error("Licenza ufficiale Node.js non disponibile");
writeFileSync(join(resources, "Node-LICENSE.txt"), await license.text());
writeFileSync(join(resources, "NOTICE.txt"), "GPTCode Desktop includes Node.js (MIT), TypeScript (Apache-2.0), typescript-language-server (Apache-2.0), vscode-jsonrpc (MIT). Cline upstream license and notices remain in the repository.\n");
for (const [name, folder, file] of [
  ["typescript", resolve(dirname(require.resolve("typescript/lib/tsserver.js")), ".."), "LICENSE.txt"],
  ["typescript-language-server", resolve(dirname(require.resolve("typescript-language-server/lib/cli.mjs")), ".."), "LICENSE"],
  ["vscode-jsonrpc", resolve(dirname(require.resolve("vscode-jsonrpc/node")), "../.."), "License.txt"],
]) copyFileSync(join(folder, file), join(resources, `${name}-LICENSE.txt`));
copyFileSync(resolve(app, "../../../LICENSE"), join(resources, "Cline-LICENSE.txt"));
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: app, env: { ...process.env, NEXT_PUBLIC_GPTCODE_DESKTOP: "1", GPTCODE_NEXT_BUILD_DIR: ".next-gptcode-release" }, stdout: "inherit", stderr: "inherit" });
  if (await child.exited) throw Error(`Build fallita: ${args.join(" ")}`);
}
await run([process.execPath, "run", "build:ui"]);
await run([process.execPath, "run", "next", "build", "webview"]);
console.log("GPTCode frontend e runtime locale preparati.");
