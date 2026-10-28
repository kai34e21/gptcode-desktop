import { autocompletion } from "@codemirror/autocomplete";
import { type Diagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorView, hoverTooltip, ViewPlugin } from "@codemirror/view";
import {
	pathFromUri,
	runtime,
	sameFileUri,
	subscribeRuntime,
} from "@/lib/gptcode-runtime";

const versions = new Map<string, number>();
function position(view: EditorView, offset: number) {
	const line = view.state.doc.lineAt(offset);
	return { line: line.number - 1, character: offset - line.from };
}
function offset(view: EditorView, point: { line: number; character: number }) {
	const line = view.state.doc.line(
		Math.max(1, Math.min(view.state.doc.lines, point.line + 1)),
	);
	return Math.min(line.to, line.from + point.character);
}
export function languageSupport(
	path: string,
	navigate?: (path: string, line: number) => void,
	error?: (message: string) => void,
) {
	let lastText: string | undefined;
	let lastSend: Promise<unknown> = Promise.resolve();
	const timers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();
	const closed = new WeakSet<EditorView>();
	const send = async (view: EditorView) => {
		const text = view.state.doc.toString();
		if (lastText === text) return lastSend;
		lastText = text;
		const version = (versions.get(path) ?? 0) + 1;
		versions.set(path, version);
		lastSend = runtime("lsp.open", { path, text, version }).catch((e) => {
			lastText = undefined;
			throw e;
		});
		return lastSend;
	};
	return [
		EditorView.domEventHandlers({
			keydown(event, view) {
				if (event.key !== "F12" || !navigate) return false;
				event.preventDefault();
				const point = position(view, view.state.selection.main.head);
				void send(view)
					.then(() => runtime("lsp.definition", { path, ...point }))
					.then((result) => {
						const item = Array.isArray(result) ? result[0] : result;
						if (item)
							navigate(
								pathFromUri(item.uri ?? item.targetUri),
								(item.range ?? item.targetSelectionRange).start.line + 1,
							);
					})
					.catch((e) => error?.(String(e)));
				return true;
			},
		}),
		autocompletion({
			override: [
				async (context) => {
					const word = context.matchBefore(/[\w$]*/);
					if (
						!context.explicit &&
						!word?.text &&
						context.state.sliceDoc(context.pos - 1, context.pos) !== "."
					)
						return null;
					const version = context.state.doc;
					// The current view is supplied by CodeMirror completion contexts.
					const view = context.view;
					if (!view) return null;
					await send(view);
					const result = await runtime("lsp.completion", {
						path,
						...position(view, context.pos),
					});
					if (context.aborted || !view.state.doc.eq(version)) return null;
					const items = Array.isArray(result) ? result : (result?.items ?? []);
					return {
						from: word?.from ?? context.pos,
						options: items.slice(0, 150).map((item: any) => ({
							label: item.label,
							detail: item.detail,
							type:
								(
									{
										2: "method",
										3: "function",
										5: "property",
										6: "variable",
										7: "class",
										14: "keyword",
									} as Record<number, string>
								)[item.kind] ?? "variable",
							apply:
								item.insertTextFormat === 2
									? item.label
									: (item.textEdit?.newText ?? item.insertText ?? item.label),
						})),
						validFor: /^[\w$]*$/,
					};
				},
			],
		}),
		hoverTooltip(async (view, pos) => {
			const doc = view.state.doc;
			await send(view);
			const result = await runtime("lsp.hover", {
				path,
				...position(view, pos),
			});
			if (!result?.contents || !view.state.doc.eq(doc)) return null;
			const contents = Array.isArray(result.contents)
				? result.contents
				: [result.contents];
			return {
				pos,
				create() {
					const dom = document.createElement("pre");
					dom.className = "max-w-lg whitespace-pre-wrap p-3 text-xs";
					dom.textContent = contents
						.map((c: any) => (typeof c === "string" ? c : c.value))
						.join("\n");
					return { dom };
				},
			};
		}),
		ViewPlugin.define((view) => {
			let unsubscribe: (() => void) | undefined;
			void attach(view).then((fn) => {
				if (closed.has(view)) fn();
				else unsubscribe = fn;
			});
			return {
				update(update) {
					if (update.docChanged) schedule(view);
				},
				destroy() {
					closed.add(view);
					clearTimeout(timers.get(view));
					unsubscribe?.();
				},
			};
		}),
	];
	function schedule(view: EditorView) {
		clearTimeout(timers.get(view));
		timers.set(
			view,
			setTimeout(() => {
				void send(view).catch((e) => error?.(String(e)));
			}, 250),
		);
	}
	async function attach(view: EditorView): Promise<() => void> {
		schedule(view);
		return subscribeRuntime((event) => {
			if (
				event.event !== "lsp.diagnostics" ||
				!sameFileUri(event.payload.uri ?? "", path) ||
				closed.has(view)
			)
				return;
			if (
				event.payload.version !== undefined &&
				event.payload.version !== versions.get(path)
			)
				return;
			const diagnostics: Diagnostic[] = (event.payload.diagnostics ?? []).map(
				(d: any) => ({
					from: offset(view, d.range.start),
					to: offset(view, d.range.end),
					message: d.message,
					severity:
						d.severity === 1 ? "error" : d.severity === 2 ? "warning" : "info",
					source: "TypeScript",
				}),
			);
			view.dispatch(setDiagnostics(view.state, diagnostics));
		}).catch((e) => {
			error?.(String(e));
			return () => {};
		});
	}
}
