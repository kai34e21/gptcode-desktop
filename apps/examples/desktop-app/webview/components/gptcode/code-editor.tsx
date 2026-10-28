"use client";

import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { Decoration, EditorView, GutterMarker, gutter } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { useEffect, useMemo, useRef } from "react";
import { languageSupport } from "./language-support";

const EMPTY: number[] = [];
class BreakpointMarker extends GutterMarker {
	toDOM() {
		const node = document.createElement("span");
		node.textContent = "●";
		node.style.color = "#f87171";
		node.title = "Breakpoint";
		return node;
	}
}
const marker = new BreakpointMarker();

export default function CodeEditor({
	path,
	value,
	onChange,
	onSave,
	breakpoints = EMPTY,
	pausedLine = 0,
	jumpLine = 0,
	onNavigate,
	onBreakpoint,
	onServiceError,
	readOnly = false,
	followTail = false,
}: {
	path: string;
	value: string;
	onChange: (text: string) => void;
	onSave: () => void;
	breakpoints?: number[];
	pausedLine?: number;
	jumpLine?: number;
	onNavigate?: (path: string, line: number) => void;
	onBreakpoint?: (line: number) => void;
	onServiceError?: (message: string) => void;
	readOnly?: boolean;
	followTail?: boolean;
}) {
	const viewRef = useRef<EditorView | null>(null);
	useEffect(() => {
		const view = viewRef.current;
		if (view && followTail && view.state.doc.toString() === value)
			view.dispatch({
				effects: EditorView.scrollIntoView(view.state.doc.length, { y: "end" }),
			});
	}, [value, followTail]);
	useEffect(() => {
		const view = viewRef.current;
		if (view && jumpLine > 0) {
			const line = view.state.doc.line(
				Math.min(jumpLine, view.state.doc.lines),
			);
			view.dispatch({
				selection: { anchor: line.from },
				effects: EditorView.scrollIntoView(line.from, { y: "center" }),
			});
		}
	}, [jumpLine]);
	const extensions = useMemo(() => {
		const ext = path.split(".").pop()?.toLowerCase();
		if (
			["js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts"].includes(ext ?? "")
		)
			return [
				javascript({
					jsx: true,
					typescript: ["ts", "tsx", "mts", "cts"].includes(ext ?? ""),
				}),
				...(readOnly ? [] : languageSupport(path, onNavigate, onServiceError)),
			];
		if (ext === "json") return [json()];
		if (ext === "py") return [python()];
		if (ext === "rs") return [rust()];
		if (ext === "css") return [css()];
		if (ext === "html") return [html()];
		if (ext === "md") return [markdown()];
		return [];
	}, [path, onNavigate, onServiceError, readOnly]);
	const debugExtensions = useMemo(
		() => [
			gutter({
				renderEmptyElements: true,
				class: "gptcode-breakpoints",
				initialSpacer: () => marker,
				lineMarker(view, line) {
					return breakpoints.includes(view.state.doc.lineAt(line.from).number)
						? marker
						: null;
				},
				domEventHandlers: {
					mousedown(view, line) {
						onBreakpoint?.(view.state.doc.lineAt(line.from).number);
						return true;
					},
				},
			}),
			EditorView.decorations.compute(["doc"], (state) =>
				pausedLine > 0 && pausedLine <= state.doc.lines
					? Decoration.set([
							Decoration.line({
								attributes: { style: "background:rgba(56,189,248,.14)" },
							}).range(state.doc.line(pausedLine).from),
						])
					: Decoration.none,
			),
		],
		[breakpoints, pausedLine, onBreakpoint],
	);
	return (
		<div
			className="h-full min-h-0"
			onKeyDownCapture={(e) => {
				if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
					e.preventDefault();
					e.stopPropagation();
					onSave();
				}
			}}
		>
			<CodeMirror
				aria-label={`Editor ${path}`}
				value={value}
				readOnly={readOnly}
				editable={!readOnly}
				height="100%"
				theme="dark"
				extensions={[...extensions, ...debugExtensions]}
				onCreateEditor={(view) => {
					viewRef.current = view;
				}}
				onChange={onChange}
				indentWithTab
				className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto"
				basicSetup={{
					lineNumbers: true,
					foldGutter: true,
					highlightActiveLine: true,
					autocompletion: true,
					searchKeymap: true,
					history: true,
				}}
			/>
		</div>
	);
}
