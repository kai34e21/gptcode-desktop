"use client";
import { Eye, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { runtime, subscribeRuntime } from "@/lib/gptcode-runtime";

export type PreviewState = {
	mode: "empty" | "static" | "local";
	url?: string | null;
	path?: string;
	proposed?: boolean;
	revision: number;
};
export default function PreviewPanel({
	root,
	currentPath,
	onClose,
	onState,
}: {
	root: string;
	currentPath?: string;
	onClose: () => void;
	onState?: (state: PreviewState) => void;
}) {
	const [state, setState] = useState<PreviewState>({
		mode: "empty",
		revision: 0,
	});
	const [url, setUrl] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	useEffect(() => {
		let disposed = false;
		let unsubscribe: (() => void) | undefined;
		void subscribeRuntime((event) => {
			if (!disposed && event.event === "preview.state") {
				const next = event.payload as PreviewState;
				setState(next);
				onState?.(next);
				setLoading(true);
				setError("");
			}
			if (!disposed && event.event === "preview.error")
				setError(event.payload.message);
		}, root)
			.then((fn) => {
				if (disposed) fn();
				else unsubscribe = fn;
			})
			.catch((e) => setError(String(e)));
		void runtime<PreviewState>("preview.state")
			.then((next) => {
				if (!disposed) setState(next);
			})
			.catch((e) => {
				if (!disposed) setError(String(e));
			});
		return () => {
			disposed = true;
			unsubscribe?.();
		};
	}, [root, onState]);
	async function openFile() {
		try {
			setState(
				await runtime<PreviewState>("preview.open", { path: currentPath }),
			);
			setError("");
		} catch (e) {
			setError(String(e));
		}
	}
	return (
		<section
			aria-label="Anteprima risultato"
			className="flex h-full min-h-0 flex-col bg-background"
		>
			<header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3 text-xs">
				<span className="flex items-center gap-2">
					<Eye size={13} />
					Anteprima{" "}
					{state.proposed && (
						<span className="text-sky-400">· proposta non salvata</span>
					)}
				</span>
				<div className="flex gap-1">
					<Button
						size="sm"
						variant="ghost"
						aria-label="Aggiorna anteprima"
						className="h-7"
						onClick={() =>
							void runtime("preview.refresh").catch((e) => setError(String(e)))
						}
					>
						<RefreshCw size={13} />
					</Button>
					<Button
						size="sm"
						variant="ghost"
						aria-label="Chiudi anteprima"
						className="h-7"
						onClick={onClose}
					>
						<X size={13} />
					</Button>
				</div>
			</header>
			<div className="space-y-2 border-b border-border p-2">
				<form
					className="flex gap-1"
					onSubmit={(event) => {
						event.preventDefault();
						void runtime<PreviewState>("preview.local", { url })
							.then((next) => {
								setState(next);
								setError("");
							})
							.catch((e) => setError(String(e)));
					}}
				>
					<input
						aria-label="URL locale anteprima"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						placeholder="http://localhost:5173"
						className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs"
					/>
					<Button
						type="submit"
						size="sm"
						variant="outline"
						className="h-7 text-xs"
						disabled={!url.trim()}
					>
						Collega
					</Button>
				</form>
				<div className="flex items-center justify-between gap-2">
					<span className="truncate text-[10px] text-muted-foreground">
						{state.mode === "local"
							? "Server locale · Vite / Next / altre app"
							: "HTML locale · aggiornamento automatico"}
					</span>
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[10px]"
						disabled={!currentPath || !/\.html?$/i.test(currentPath)}
						onClick={() => void openFile()}
					>
						File corrente
					</Button>
				</div>
			</div>
			{error && (
				<p role="alert" className="p-2 text-xs text-destructive">
					{error}
				</p>
			)}
			{state.url ? (
				<>
					<span aria-live="polite" className="sr-only">
						{loading ? "Caricamento anteprima" : "Anteprima caricata"}
					</span>
					<iframe
						key={
							state.mode === "local"
								? `local:${state.revision}`
								: `static:${state.proposed}`
						}
						title="Risultato generato"
						src={state.url}
						sandbox={
							state.mode === "static"
								? state.proposed
									? ""
									: "allow-scripts"
								: "allow-scripts allow-same-origin allow-forms"
						}
						referrerPolicy="no-referrer"
						className="min-h-0 w-full flex-1 border-0 bg-white"
						onLoad={() => setLoading(false)}
					/>
				</>
			) : (
				<div className="grid flex-1 place-items-center p-5 text-center text-xs leading-relaxed text-muted-foreground">
					L’HTML generato comparirà qui durante la scrittura. Per un’app con
					server di sviluppo, avvialo nel terminale e collega il suo URL locale.
				</div>
			)}
		</section>
	);
}
