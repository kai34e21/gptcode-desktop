"use client";

import { invoke } from "@tauri-apps/api/core";
import {
	ChevronDown,
	ChevronRight,
	FileCode2,
	Folder,
	FolderOpen,
	GitCompareArrows,
	Play,
	RefreshCw,
	Save,
	SquareTerminal,
	X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalPanel } from "@/components/terminal-panel";
import { Button } from "@/components/ui/button";
import { CodeDiff } from "@/components/views/chat/highlighted-code";
import { isTauriAvailable } from "@/lib/native-platform";
import {
	createTerminalTab,
	killTerminalTab,
	listTerminalTabs,
} from "@/lib/terminal-sessions";
import ServicesPanel from "./services-panel";

const CodeEditor = dynamic(() => import("./code-editor"), { ssr: false });
type Entry = { name: string; path: string; directory: boolean };
type Buffer = { path: string; base: string; text: string; saving: boolean };
const name = (path: string) => path.split(/[\\/]/).pop() ?? path;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function FileTree({
	path,
	open,
	refresh,
}: {
	path: string;
	open: (path: string) => void;
	refresh: number;
}) {
	const [entries, setEntries] = useState<Entry[]>([]);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const [error, setError] = useState("");
	// Refresh is an explicit user-requested re-read, even when path is unchanged.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh invalidates native directory data
	useEffect(() => {
		let cancelled = false;
		void invoke<Entry[]>("gptcode_entries", { path })
			.then((items) => {
				if (!cancelled) {
					setEntries(items);
					setError("");
				}
			})
			.catch((e) => {
				if (!cancelled) setError(message(e));
			});
		return () => {
			cancelled = true;
		};
	}, [path, refresh]);
	return (
		<div className="text-xs">
			{error && <p className="px-3 py-2 text-destructive">{error}</p>}
			{entries.map((entry) => (
				<div key={entry.path}>
					<button
						type="button"
						className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary"
						title={entry.path}
						aria-expanded={
							entry.directory ? expanded.has(entry.path) : undefined
						}
						onClick={() => {
							if (!entry.directory) return open(entry.path);
							setExpanded((previous) => {
								const next = new Set(previous);
								if (next.has(entry.path)) next.delete(entry.path);
								else next.add(entry.path);
								return next;
							});
						}}
					>
						{entry.directory ? (
							<>
								{expanded.has(entry.path) ? (
									<ChevronDown size={12} />
								) : (
									<ChevronRight size={12} />
								)}
								<Folder size={14} className="text-sky-400" />
							</>
						) : (
							<FileCode2 size={14} className="ml-4 text-muted-foreground" />
						)}
						<span className="truncate">{entry.name}</span>
					</button>
					{entry.directory && expanded.has(entry.path) && (
						<div className="ml-3 border-l border-border pl-1">
							<FileTree path={entry.path} open={open} refresh={refresh} />
						</div>
					)}
				</div>
			))}
		</div>
	);
}

export default function Workbench() {
	const [root, setRoot] = useState("");
	const [buffers, setBuffers] = useState<Buffer[]>([]);
	const buffersRef = useRef(buffers);
	buffersRef.current = buffers;
	const [active, setActive] = useState("");
	const [error, setError] = useState("");
	const [status, setStatus] = useState("Pronto");
	const [refresh, setRefresh] = useState(0);
	const [diff, setDiff] = useState(false);
	const [height, setHeight] = useState(350);
	const [terminal, setTerminal] = useState(true);
	const [breakpoints, setBreakpoints] = useState<Record<string, number[]>>({});
	const [paused, setPaused] = useState<{ path: string; line: number } | null>(
		null,
	);
	const [jump, setJump] = useState<{ path: string; line: number } | null>(null);
	const opening = useRef(new Set<string>());
	const saving = useRef(new Set<string>());
	const current = buffers.find((buffer) => buffer.path === active);
	const dirty = buffers.some((buffer) => buffer.text !== buffer.base);
	useEffect(() => {
		if (isTauriAvailable())
			void invoke("gptcode_dirty", { dirty }).catch(() => {});
	}, [dirty]);

	useEffect(() => {
		document.title = "GPTCode Desktop";
		if (!isTauriAvailable()) {
			setError(
				"Apri l’app nativa con Avvia-GPTCode-Desktop.ps1: file e terminali richiedono il desktop.",
			);
			return;
		}
		void invoke<string>("gptcode_workspace")
			.then(setRoot)
			.catch((e) => setError(message(e)));
	}, []);

	useEffect(() => {
		const beforeUnload = (event: BeforeUnloadEvent) => {
			if (buffersRef.current.some((b) => b.text !== b.base)) {
				event.preventDefault();
				event.returnValue = "";
			}
		};
		window.addEventListener("beforeunload", beforeUnload);
		return () => window.removeEventListener("beforeunload", beforeUnload);
	}, []);

	const open = useCallback(async (path: string) => {
		if (buffersRef.current.some((buffer) => buffer.path === path)) {
			setActive(path);
			setDiff(false);
			return;
		}
		if (opening.current.has(path)) return;
		opening.current.add(path);
		try {
			const text = await invoke<string>("gptcode_read", { path });
			setBuffers((previous) =>
				previous.some((b) => b.path === path)
					? previous
					: [...previous, { path, base: text, text, saving: false }],
			);
			setActive(path);
			setDiff(false);
			setError("");
		} catch (e) {
			setError(message(e));
		} finally {
			opening.current.delete(path);
		}
	}, []);

	const navigate = useCallback(
		(path: string, line: number) => {
			void open(path).then(() => setJump({ path, line }));
		},
		[open],
	);
	const onPaused = useCallback(
		(path: string | null, line = 0) => setPaused(path ? { path, line } : null),
		[],
	);

	const save = useCallback(async (path: string) => {
		const buffer = buffersRef.current.find((b) => b.path === path);
		if (!buffer || buffer.text === buffer.base || saving.current.has(path))
			return;
		saving.current.add(path);
		setBuffers((previous) =>
			previous.map((b) => (b.path === path ? { ...b, saving: true } : b)),
		);
		try {
			const content = buffer.base.includes("\r\n")
				? buffer.text.replace(/\r?\n/g, "\r\n")
				: buffer.text;
			await invoke("gptcode_save", { path, expected: buffer.base, content });
			setBuffers((previous) =>
				previous.map((b) =>
					b.path === path
						? {
								...b,
								base: content,
								text: b.text === buffer.text ? content : b.text,
							}
						: b,
				),
			);
			setStatus(`Salvato ${name(path)}`);
			setError("");
			setRefresh((n) => n + 1);
		} catch (e) {
			setError(message(e));
		} finally {
			saving.current.delete(path);
			setBuffers((previous) =>
				previous.map((b) => (b.path === path ? { ...b, saving: false } : b)),
			);
		}
	}, []);

	async function chooseWorkspace() {
		if (dirty) {
			setError(
				"Salva o chiudi le schede modificate prima di cambiare progetto.",
			);
			return;
		}
		if (saving.current.size || opening.current.size) {
			setError("Attendi il completamento dei file in apertura o salvataggio.");
			return;
		}
		try {
			const picked = await invoke<string | null>("pick_workspace_directory", {
				initialPath: root || null,
			});
			if (!picked || picked === root) return;
			const previous = root;
			await invoke("gptcode_runtime_stop");
			const next = await invoke<string>("gptcode_workspace", { root: picked });
			for (const tab of listTerminalTabs(previous)) await killTerminalTab(tab);
			setRoot(next);
			setPaused(null);
			setBreakpoints({});
			setJump(null);
			setBuffers([]);
			setActive("");
			setError("");
		} catch (e) {
			setError(message(e));
		}
	}

	function close(buffer: Buffer) {
		if (buffer.saving) return;
		if (
			buffer.text !== buffer.base &&
			!window.confirm(
				`Scartare le modifiche non salvate di ${name(buffer.path)}?`,
			)
		)
			return;
		const remaining = buffers.filter((b) => b.path !== buffer.path);
		setBuffers(remaining);
		if (active === buffer.path) setActive(remaining.at(-1)?.path ?? "");
	}

	async function reload() {
		if (!current || current.saving) return;
		if (
			current.text !== current.base &&
			!window.confirm(
				"Ricaricare dal disco e scartare le modifiche nell’editor?",
			)
		)
			return;
		try {
			const text = await invoke<string>("gptcode_read", { path: current.path });
			const latest = buffersRef.current.find((b) => b.path === current.path);
			if (
				!latest ||
				latest.text !== current.text ||
				latest.base !== current.base
			) {
				setError(
					"Il buffer è cambiato durante la lettura: le tue modifiche sono state conservate.",
				);
				return;
			}
			setBuffers((previous) =>
				previous.map((b) =>
					b.path === current.path ? { ...b, base: text, text } : b,
				),
			);
			setError("");
			setRefresh((n) => n + 1);
		} catch (e) {
			setError(message(e));
		}
	}

	return (
		<main className="flex h-screen min-w-[640px] flex-col bg-background text-foreground">
			<header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
				<div className="flex min-w-0 items-center gap-4">
					<strong className="shrink-0 text-sm tracking-tight">
						GPTCode{" "}
						<span className="font-normal text-muted-foreground">Desktop</span>
					</strong>
					<span className="truncate text-xs text-muted-foreground" title={root}>
						{root || "Apri un progetto"}
					</span>
				</div>
				<div className="flex shrink-0 gap-1">
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void chooseWorkspace()}
					>
						<FolderOpen size={15} />
						Apri progetto
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={!root}
						onClick={() => {
							createTerminalTab(root, { agent: true });
							setTerminal(true);
						}}
					>
						<Play size={14} />
						GPTCode
					</Button>
					<Button
						size="sm"
						variant="ghost"
						disabled={!root}
						onClick={() => {
							createTerminalTab(root);
							setTerminal(true);
						}}
					>
						<SquareTerminal size={15} />
						Terminale
					</Button>
				</div>
			</header>
			{error && (
				<div
					role="alert"
					className="flex shrink-0 items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs"
				>
					<span className="min-w-0 flex-1 select-text">{error}</span>
					<button
						type="button"
						aria-label="Chiudi errore"
						onClick={() => setError("")}
					>
						<X size={14} />
					</button>
				</div>
			)}
			<div className="flex min-h-0 flex-1">
				<aside
					aria-label="Esplora progetto"
					className="w-56 shrink-0 overflow-auto border-r border-border bg-muted/10 p-2 max-md:w-40"
				>
					<div className="mb-3 flex items-center justify-between px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						<span>Esplora progetto</span>
						<button
							type="button"
							title="Aggiorna file"
							aria-label="Aggiorna file"
							onClick={() => setRefresh((n) => n + 1)}
						>
							<RefreshCw size={12} />
						</button>
					</div>
					{root && (
						<FileTree
							key={root}
							path={root}
							open={(path) => void open(path)}
							refresh={refresh}
						/>
					)}
				</aside>
				<section
					aria-label="Area editor"
					className="flex min-w-0 flex-1 flex-col"
				>
					<div
						role="tablist"
						aria-label="File aperti"
						className="flex h-10 shrink-0 overflow-x-auto border-b border-border"
					>
						{buffers.map((buffer) => (
							<div
								key={buffer.path}
								className={`flex shrink-0 items-center border-r border-border ${active === buffer.path ? "border-t-2 border-t-sky-400 bg-muted/25" : "text-muted-foreground"}`}
							>
								<button
									role="tab"
									type="button"
									aria-selected={active === buffer.path}
									title={buffer.path}
									className="flex h-full items-center gap-2 px-3 text-xs"
									onClick={() => {
										setActive(buffer.path);
										setDiff(false);
									}}
								>
									<FileCode2 size={13} />
									{name(buffer.path)}
									{buffer.text !== buffer.base && (
										<span
											role="img"
											aria-label="Modificato"
											className="text-sky-400"
										>
											●
										</span>
									)}
								</button>
								<button
									type="button"
									aria-label={`Chiudi ${name(buffer.path)}`}
									className="mr-2 rounded p-1 hover:bg-muted"
									onClick={() => close(buffer)}
								>
									<X size={12} />
								</button>
							</div>
						))}
					</div>
					{current ? (
						<>
							<div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
								<span className="truncate text-[11px] text-muted-foreground">
									{current.path.slice(root.length).replace(/^[\\/]/, "")}
								</span>
								<div className="flex shrink-0 gap-1">
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs"
										onClick={() => setDiff(!diff)}
									>
										<GitCompareArrows size={13} />
										{diff ? "Editor" : "Diff"}
									</Button>
									<Button
										size="sm"
										variant="ghost"
										className="h-7 text-xs"
										disabled={current.saving}
										onClick={() => void reload()}
									>
										<RefreshCw size={13} />
										Ricarica
									</Button>
									<Button
										size="sm"
										className="h-7 text-xs"
										disabled={current.text === current.base || current.saving}
										onClick={() => void save(current.path)}
									>
										<Save size={13} />
										{current.saving ? "Salvataggio…" : "Salva"}
									</Button>
								</div>
							</div>
							<div className="relative min-h-0 flex-1">
								{buffers.map((buffer) => (
									<div
										key={buffer.path}
										className="absolute inset-0"
										style={{
											display:
												buffer.path === active && !diff ? "block" : "none",
										}}
									>
										<CodeEditor
											path={buffer.path}
											breakpoints={breakpoints[buffer.path]}
											pausedLine={
												paused?.path.toLowerCase() === buffer.path.toLowerCase()
													? paused.line
													: 0
											}
											jumpLine={jump?.path === buffer.path ? jump.line : 0}
											onNavigate={navigate}
											onServiceError={setError}
											onBreakpoint={(line) =>
												setBreakpoints((previous) => {
													const lines = previous[buffer.path] ?? [];
													return {
														...previous,
														[buffer.path]: lines.includes(line)
															? lines.filter((n) => n !== line)
															: [...lines, line].sort((a, b) => a - b),
													};
												})
											}
											value={buffer.text}
											onChange={(text) =>
												setBuffers((previous) =>
													previous.map((b) =>
														b.path === buffer.path ? { ...b, text } : b,
													),
												)
											}
											onSave={() => void save(buffer.path)}
										/>
									</div>
								))}
								{diff && (
									<div className="absolute inset-0 overflow-auto">
										<CodeDiff
											path={current.path}
											oldText={current.base}
											newText={current.text}
										/>
									</div>
								)}
							</div>
						</>
					) : (
						<div className="grid flex-1 place-items-center text-center">
							<div className="max-w-sm px-6">
								<FileCode2 className="mx-auto mb-5 text-sky-400" size={32} />
								<h1 className="mb-3 text-xl font-medium tracking-tight">
									Il tuo codice. Il tuo agente.
								</h1>
								<p className="text-sm leading-relaxed text-muted-foreground">
									Apri un file dal progetto per iniziare. Avvia GPTCode per
									lavorare con il tuo CLI, oppure un terminale per eseguire i
									comandi.
								</p>
								<p className="mt-5 text-xs text-muted-foreground">
									Ctrl+S salva · Ctrl+F cerca · Ctrl+H sostituisce
								</p>
							</div>
						</div>
					)}
				</section>
				{root && (
					<ServicesPanel
						key={root}
						root={root}
						file={
							current
								? {
										path: current.path,
										text: current.text,
										dirty: current.text !== current.base,
									}
								: undefined
						}
						breakpoints={breakpoints}
						navigate={navigate}
						onPaused={onPaused}
					/>
				)}
			</div>
			{root && terminal && (
				<TerminalPanel
					cwd={root}
					height={height}
					onHeightChange={setHeight}
					onClose={() => setTerminal(false)}
				/>
			)}
			<footer className="flex h-6 shrink-0 items-center justify-between border-t border-border bg-muted/15 px-3 text-[10px] text-muted-foreground">
				<span aria-live="polite">
					{status}
					{dirty ? " · Modifiche non salvate" : ""}
				</span>
				<span>
					UTF-8 · {current?.base.includes("\r\n") ? "CRLF" : "LF"} · GPTCode CLI
				</span>
			</footer>
		</main>
	);
}
