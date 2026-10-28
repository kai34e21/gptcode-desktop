"use client";
import {
	ArrowDownToLine,
	ArrowUpFromLine,
	Bug,
	MessageSquare,
	Pause,
	Play,
	Plus,
	Send,
	Square,
	StepForward,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { pathFromUri, runtime, subscribeRuntime } from "@/lib/gptcode-runtime";

type Message = { role: "user" | "assistant"; content: string };
type Question = { id: string; kind: string; request: Record<string, any> };
type Props = {
	root: string;
	file?: { path: string; text: string; dirty: boolean };
	breakpoints: Record<string, number[]>;
	navigate: (path: string, line: number) => void;
	onPaused: (path: string | null, line?: number) => void;
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function ServicesPanel(props: Props) {
	const [tab, setTab] = useState<"chat" | "debug">("chat");
	return (
		<aside
			aria-label="Assistente e debugger"
			className="flex w-[370px] min-w-[280px] max-w-[45vw] shrink-0 flex-col border-l border-border bg-muted/5 max-lg:w-[300px]"
		>
			<div
				role="tablist"
				aria-label="Strumenti"
				className="flex h-10 shrink-0 items-center border-b border-border px-2"
			>
				<button
					role="tab"
					type="button"
					aria-selected={tab === "chat"}
					onClick={() => setTab("chat")}
					className={`flex h-full items-center gap-2 px-3 text-xs ${tab === "chat" ? "border-b-2 border-sky-400" : "text-muted-foreground"}`}
				>
					<MessageSquare size={14} />
					GPTCode
				</button>
				<button
					role="tab"
					type="button"
					aria-selected={tab === "debug"}
					onClick={() => setTab("debug")}
					className={`flex h-full items-center gap-2 px-3 text-xs ${tab === "debug" ? "border-b-2 border-sky-400" : "text-muted-foreground"}`}
				>
					<Bug size={14} />
					Debug Node
				</button>
			</div>
			<div
				className={`min-h-0 flex-1 ${tab !== "chat" ? "hidden" : "flex flex-col"}`}
			>
				<ChatPanel {...props} />
			</div>
			<div
				className={`min-h-0 flex-1 ${tab !== "debug" ? "hidden" : "flex flex-col"}`}
			>
				<DebugPanel {...props} />
			</div>
		</aside>
	);
}

function ChatPanel({ root, file }: Props) {
	const [messages, setMessages] = useState<Message[]>([]),
		[prompt, setPrompt] = useState("");
	const [busy, setBusy] = useState(false),
		[ready, setReady] = useState(false),
		[error, setError] = useState("");
	const [model, setModel] = useState(""),
		[models, setModels] = useState<{ id: string; name: string }[]>([]);
	const [mode, setMode] = useState("default"),
		[session, setSession] = useState("");
	const [history, setHistory] = useState<{ id: string; title: string }[]>([]),
		[resume, setResume] = useState("");
	const [requests, setRequests] = useState<Question[]>([]),
		[answer, setAnswer] = useState("");
	const [tools, setTools] = useState<Record<string, any>>({}),
		[reasoning, setReasoning] = useState("");
	const [includeFile, setIncludeFile] = useState(false);
	const bottom = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (messages.length || requests.length)
			bottom.current?.scrollIntoView({ block: "end" });
	}, [messages, requests]);
	useEffect(() => {
		if (!root) return;
		let disposed = false;
		let unsubscribe: (() => void) | undefined;
		void subscribeRuntime((event) => {
			if (disposed) return;
			const data = event.payload;
			if (event.event === "chat.text")
				setMessages((previous) =>
					previous.at(-1)?.role === "assistant"
						? [
								...previous.slice(0, -1),
								{
									role: "assistant",
									content: previous.at(-1)!.content + data.text,
								},
							]
						: [...previous, { role: "assistant", content: data.text }],
				);
			if (event.event === "chat.reasoning")
				setReasoning((previous) => (previous + data.text).slice(-100000));
			if (event.event === "chat.tool")
				setTools((previous) => ({
					...previous,
					[data.callId ?? data.name]: data,
				}));
			if (event.event === "chat.request")
				setRequests((previous) => [...previous, data as Question]);
			if (event.event === "chat.session") {
				setSession(data.id);
				setMessages((previous) => [
					...(data.messages ?? []).filter(
						(m: any) =>
							["user", "assistant"].includes(m.role) &&
							typeof m.content === "string",
					),
					...(previous.at(-1)?.role === "user" ? [previous.at(-1)!] : []),
				]);
			}
			if (event.event === "chat.error") setError(data.message);
			if (event.event === "chat.done" && data.text)
				setMessages((previous) =>
					previous.at(-1)?.role === "assistant"
						? [
								...previous.slice(0, -1),
								{ role: "assistant", content: data.text },
							]
						: [...previous, { role: "assistant", content: data.text }],
				);
			if (["chat.idle", "runtime.closed"].includes(event.event)) {
				setBusy(false);
				setRequests([]);
			}
		}, root)
			.then((fn) => {
				if (disposed) fn();
				else {
					unsubscribe = fn;
					setReady(true);
				}
			})
			.catch((e) => setError(errorText(e)));
		void runtime("chat.status")
			.then((data) => {
				if (!disposed) {
					setModel(data.model);
					setModels(data.models ?? []);
					setBusy(data.busy ?? false);
					setSession(data.sessionId ?? "");
					setRequests(data.requests ?? []);
					if (data.messages?.length)
						setMessages(
							data.messages.filter(
								(m: Message) =>
									["user", "assistant"].includes(m.role) &&
									typeof m.content === "string",
							),
						);
				}
			})
			.catch((e) => {
				if (!disposed) setError(errorText(e));
			});
		void runtime("chat.history")
			.then((data) => {
				if (!disposed) setHistory(data);
			})
			.catch(() => {});
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [root]);
	async function send() {
		if (!prompt.trim() || busy) return;
		let text = prompt.trim();
		if (includeFile && file)
			text += `\n\nFile corrente${file.dirty ? " (buffer non salvato)" : ""}: ${file.path}\n\`\`\`\n${file.text}\n\`\`\``;
		setMessages((previous) => [...previous, { role: "user", content: text }]);
		setPrompt("");
		setBusy(true);
		setError("");
		setReasoning("");
		setTools({});
		try {
			await runtime("chat.send", {
				prompt: text,
				model,
				mode,
				sessionId: resume || undefined,
			});
		} catch (e) {
			setBusy(false);
			setError(errorText(e));
		}
	}
	async function respond(id: string, value: string) {
		try {
			await runtime("chat.answer", { id, answer: value });
			setRequests((previous) => previous.filter((r) => r.id !== id));
			setAnswer("");
		} catch (e) {
			setError(errorText(e));
		}
	}
	const question = requests[0];
	return (
		<>
			<div className="space-y-2 border-b border-border p-3">
				<div className="flex items-center gap-2">
					<select
						aria-label="Modello GPTCode"
						className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
						disabled={busy || !!session}
						value={model}
						onChange={(e) => setModel(e.target.value)}
					>
						{!models.some((m) => m.id === model) && (
							<option value={model}>{model || "Modello del CLI"}</option>
						)}
						{models.map((m) => (
							<option key={m.id} value={m.id}>
								{m.name || m.id}
							</option>
						))}
					</select>
					<Button
						size="sm"
						variant="ghost"
						title="Nuova chat"
						aria-label="Nuova chat"
						disabled={busy}
						onClick={() =>
							void runtime("chat.reset")
								.then(() => {
									setSession("");
									setResume("");
									setMessages([]);
									setError("");
									setTools({});
									setReasoning("");
								})
								.catch((e) => setError(errorText(e)))
						}
					>
						<Plus size={14} />
					</Button>
				</div>
				<div className="flex gap-2">
					<select
						aria-label="Modalità agente"
						value={mode}
						disabled={busy || !!session}
						onChange={(e) => setMode(e.target.value)}
						className="rounded border border-border bg-background p-1 text-xs"
					>
						<option value="default">Agisci · permessi</option>
						<option value="plan">Pianifica</option>
					</select>
					<select
						aria-label="Riprendi sessione"
						disabled={busy || !!session}
						value={resume}
						onChange={(e) => setResume(e.target.value)}
						className="min-w-0 flex-1 rounded border border-border bg-background p-1 text-xs"
					>
						<option value="">Nuova sessione</option>
						{history.map((s) => (
							<option key={s.id} value={s.id}>
								{s.title.slice(0, 70)}
							</option>
						))}
					</select>
				</div>
			</div>
			<section
				className="min-h-0 flex-1 space-y-4 overflow-auto p-3"
				aria-label="Conversazione"
			>
				{!messages.length && (
					<p className="py-6 text-xs leading-relaxed text-muted-foreground">
						Lavora nel progetto con GPTCode. Il modello e il login sono quelli
						del CLI. Le richieste di permesso appariranno qui.
					</p>
				)}
				{messages.map((m, index) => (
					<div
						key={`${index}-${m.role}`}
						className={`rounded p-3 text-xs leading-relaxed ${m.role === "user" ? "border border-border bg-muted/40" : "bg-transparent"}`}
					>
						<p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
							{m.role === "user" ? "Tu" : "GPTCode"}
						</p>
						<pre className="select-text whitespace-pre-wrap break-words font-sans">
							{m.content}
						</pre>
					</div>
				))}
				{reasoning && (
					<details className="text-xs text-muted-foreground">
						<summary>Ragionamento</summary>
						<pre className="mt-2 whitespace-pre-wrap font-sans">
							{reasoning}
						</pre>
					</details>
				)}
				{Object.entries(tools)
					.slice(-30)
					.map(([id, tool]) => (
						<details
							key={id}
							className="rounded border border-border p-2 text-xs"
						>
							<summary>
								{tool.phase === "start"
									? "In corso"
									: tool.denied || tool.blocked
										? "Negato"
										: tool.error
											? "Errore"
											: "Eseguito"}{" "}
								· {tool.name}
							</summary>
							<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-[11px]">
								{tool.phase === "start"
									? JSON.stringify(tool.args, null, 2)
									: typeof tool.output === "string"
										? tool.output
										: JSON.stringify(tool.output, null, 2)}
							</pre>
						</details>
					))}
				{busy && (
					<output className="text-xs text-sky-400">
						GPTCode sta lavorando…
					</output>
				)}
				{error && (
					<p
						role="alert"
						className="select-text whitespace-pre-wrap text-xs text-destructive"
					>
						{error}
					</p>
				)}
				<div ref={bottom} />
			</section>
			{question && (
				<div className="space-y-2 border-t border-sky-400/40 bg-sky-400/5 p-3 text-xs">
					<strong>
						{question.kind === "permission"
							? `Permesso: ${question.request.name}`
							: question.request.header || "Domanda"}
					</strong>
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px]">
						{question.kind === "permission"
							? JSON.stringify(question.request.args, null, 2)
							: question.request.question}
					</pre>
					{question.kind === "permission" ? (
						<div className="flex gap-2">
							<Button
								size="sm"
								onClick={() => void respond(question.id, "allow")}
							>
								Consenti una volta
							</Button>
							<Button
								size="sm"
								variant="outline"
								onClick={() => void respond(question.id, "deny")}
							>
								Nega
							</Button>
						</div>
					) : (
						<>
							<div className="flex flex-wrap gap-1">
								{(question.request.options ?? []).map((o: any) => (
									<Button
										key={o.label}
										size="sm"
										variant="outline"
										onClick={() => void respond(question.id, o.label)}
									>
										{o.label}
									</Button>
								))}
							</div>
							<form
								className="flex gap-1"
								onSubmit={(e) => {
									e.preventDefault();
									if (answer.trim()) void respond(question.id, answer);
								}}
							>
								<input
									aria-label="Risposta all’agente"
									value={answer}
									onChange={(e) => setAnswer(e.target.value)}
									className="min-w-0 flex-1 rounded border border-border bg-background p-2"
								/>
								<Button size="sm" type="submit" disabled={!answer.trim()}>
									Rispondi
								</Button>
							</form>
						</>
					)}
				</div>
			)}
			<form
				className="space-y-2 border-t border-border p-3"
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<textarea
					aria-label="Messaggio a GPTCode"
					placeholder="Chiedi a GPTCode…"
					rows={3}
					className="w-full resize-none rounded border border-border bg-background p-2 text-xs outline-none focus:border-sky-400"
					value={prompt}
					onChange={(e) => setPrompt(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
							e.preventDefault();
							void send();
						}
					}}
				/>
				<div className="flex items-center justify-between gap-2">
					<label className="flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground">
						<input
							type="checkbox"
							checked={includeFile}
							onChange={(e) => setIncludeFile(e.target.checked)}
							disabled={!file}
						/>
						Includi file corrente
					</label>
					{busy ? (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() =>
								void runtime("chat.stop").catch((e) => setError(errorText(e)))
							}
						>
							<Square size={12} />
							Stop
						</Button>
					) : (
						<Button type="submit" size="sm" disabled={!ready || !prompt.trim()}>
							<Send size={12} />
							Invia
						</Button>
					)}
				</div>
			</form>
		</>
	);
}

function DebugPanel({ root, file, breakpoints, navigate, onPaused }: Props) {
	const [running, setRunning] = useState(false),
		[paused, setPaused] = useState(false),
		[busy, setBusy] = useState(false);
	const [frames, setFrames] = useState<any[]>([]),
		[selected, setSelected] = useState(0),
		[variables, setVariables] = useState<any[]>([]);
	const [output, setOutput] = useState(""),
		[error, setError] = useState(""),
		[expression, setExpression] = useState(""),
		[value, setValue] = useState("");
	const callback = useRef(onPaused);
	callback.current = onPaused;
	useEffect(() => {
		if (!root) return;
		let disposed = false;
		let unsubscribe: (() => void) | undefined;
		void subscribeRuntime((event) => {
			if (disposed) return;
			const data = event.payload;
			if (event.event === "debug.output")
				setOutput((previous) => (previous + data.text).slice(-100000));
			if (event.event === "debug.paused") {
				setPaused(true);
				setRunning(true);
				setFrames(data.frames);
				setSelected(0);
			}
			if (event.event === "debug.resumed") {
				setPaused(false);
				setFrames([]);
				setVariables([]);
				callback.current(null);
			}
			if (["debug.ended", "runtime.closed"].includes(event.event)) {
				setRunning(false);
				setPaused(false);
				setFrames([]);
				setVariables([]);
				callback.current(null);
			}
		}, root)
			.then((fn) => {
				if (disposed) fn();
				else unsubscribe = fn;
			})
			.catch((e) => setError(errorText(e)));
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [root]);
	useEffect(() => {
		const frame = frames[selected];
		if (!frame) return;
		let disposed = false;
		if (frame.url?.startsWith("file:")) {
			const path = pathFromUri(frame.url);
			callback.current(path, frame.location.lineNumber + 1);
			navigate(path, frame.location.lineNumber + 1);
		}
		const scope = frame.scopeChain.find((s: any) =>
			["local", "module", "script"].includes(s.type),
		);
		if (scope?.object?.objectId)
			void runtime("debug.variables", { objectId: scope.object.objectId })
				.then((result) => {
					if (!disposed) setVariables(result);
				})
				.catch((e) => {
					if (!disposed) setError(errorText(e));
				});
		return () => {
			disposed = true;
		};
	}, [frames, selected, navigate]);
	async function launch() {
		if (!file) return;
		if (file.dirty) {
			setError(
				"Salva il file prima di avviare il debug: verrà eseguito il codice su disco.",
			);
			return;
		}
		setBusy(true);
		setOutput("");
		setError("");
		try {
			await runtime("debug.start", {
				path: file.path,
				breakpoints: Object.entries(breakpoints).flatMap(([path, lines]) =>
					lines.map((line) => ({ path, line })),
				),
			});
			setRunning(true);
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}
	async function action(name: string) {
		setBusy(true);
		try {
			await runtime("debug.action", { action: name });
			setError("");
		} catch (e) {
			setError(errorText(e));
		} finally {
			setBusy(false);
		}
	}
	return (
		<div className="flex min-h-0 flex-1 flex-col text-xs">
			<div className="space-y-3 border-b border-border p-3">
				<p className="break-all text-muted-foreground">
					{file?.path ?? "Apri un file Node.js da eseguire"}
				</p>
				<div className="flex flex-wrap gap-1">
					<Button
						size="sm"
						disabled={!file || running || busy}
						onClick={() => void launch()}
					>
						<Play size={12} />
						Avvia
					</Button>
					<Button
						size="sm"
						variant="outline"
						title={paused ? "Continua" : "Pausa"}
						aria-label={paused ? "Continua" : "Pausa"}
						disabled={!running || busy}
						onClick={() => void action(paused ? "continue" : "pause")}
					>
						{paused ? <Play size={12} /> : <Pause size={12} />}
					</Button>
					<Button
						size="sm"
						variant="outline"
						title="Step over"
						aria-label="Step over"
						disabled={!paused || busy}
						onClick={() => void action("next")}
					>
						<StepForward size={12} />
					</Button>
					<Button
						size="sm"
						variant="outline"
						title="Step into"
						aria-label="Step into"
						disabled={!paused || busy}
						onClick={() => void action("into")}
					>
						<ArrowDownToLine size={12} />
					</Button>
					<Button
						size="sm"
						variant="outline"
						title="Step out"
						aria-label="Step out"
						disabled={!paused || busy}
						onClick={() => void action("out")}
					>
						<ArrowUpFromLine size={12} />
					</Button>
					<Button
						size="sm"
						variant="outline"
						title="Ferma debug"
						aria-label="Ferma debug"
						disabled={!running && !busy}
						onClick={() =>
							void runtime("debug.stop").catch((e) => setError(errorText(e)))
						}
					>
						<Square size={12} />
					</Button>
				</div>
				<p className="text-[10px] text-muted-foreground">
					{paused ? "In pausa" : running ? "In esecuzione" : "Pronto"} · Clicca
					nel margine dell’editor per aggiungere breakpoint. Avvia li applica
					alla nuova sessione.
				</p>
			</div>
			<div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
				{error && (
					<p role="alert" className="text-destructive">
						{error}
					</p>
				)}
				<section>
					<h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						Call stack
					</h2>
					{frames.map((frame, index) => (
						<button
							type="button"
							key={frame.callFrameId}
							onClick={() => setSelected(index)}
							className={`block w-full truncate rounded p-2 text-left ${selected === index ? "bg-muted" : "hover:bg-muted/40"}`}
						>
							{frame.functionName || "(programma)"} :
							{frame.location.lineNumber + 1}
						</button>
					))}
				</section>
				<section>
					<h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						Variabili
					</h2>
					{variables.map((variable) => (
						<div
							key={variable.name}
							className="flex gap-2 border-b border-border/40 py-1 font-mono text-[11px]"
						>
							<span className="text-sky-400">{variable.name}</span>
							<span className="select-text break-all">
								{String(variable.value)}
							</span>
						</div>
					))}
				</section>
				<form
					className="space-y-2"
					onSubmit={(e) => {
						e.preventDefault();
						const frame = frames[selected];
						if (!frame) return;
						void runtime("debug.evaluate", {
							frameId: frame.callFrameId,
							expression,
						})
							.then((result) => {
								setValue(JSON.stringify(result.value));
								setError("");
							})
							.catch((e) => setError(errorText(e)));
					}}
				>
					<label
						className="block text-[10px] uppercase tracking-widest text-muted-foreground"
						htmlFor="debug-expression"
					>
						Valuta senza effetti collaterali
					</label>
					<input
						id="debug-expression"
						disabled={!paused}
						value={expression}
						onChange={(e) => setExpression(e.target.value)}
						className="w-full rounded border border-border bg-background p-2 font-mono"
						placeholder="nomeVariabile"
					/>
					<Button
						type="submit"
						size="sm"
						variant="outline"
						disabled={!paused || !expression.trim()}
					>
						Valuta
					</Button>
					{value && (
						<pre className="select-text whitespace-pre-wrap">{value}</pre>
					)}
				</form>
				<section>
					<h2 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
						Output
					</h2>
					<pre className="select-text whitespace-pre-wrap break-words font-mono text-[11px]">
						{output || "Nessun output"}
					</pre>
				</section>
			</div>
		</div>
	);
}
