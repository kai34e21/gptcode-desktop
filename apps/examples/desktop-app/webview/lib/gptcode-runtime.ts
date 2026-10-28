import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type RuntimeEvent = {
	event: string;
	payload: Record<string, any>;
	root?: string;
};
export function runtime<T = any>(
	method: string,
	data: Record<string, unknown> = {},
): Promise<T> {
	return invoke<T>("gptcode_runtime", { method, data });
}
export function subscribeRuntime(
	callback: (event: RuntimeEvent) => void,
	root?: string,
) {
	return listen<RuntimeEvent>("gptcode-runtime-event", (event) => {
		if (
			root &&
			event.payload.root &&
			root.toLowerCase() !== event.payload.root.toLowerCase()
		)
			return;
		callback(event.payload);
	});
}
export function fileUri(path: string) {
	const normalized = path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
	return normalized.startsWith("/")
		? `file://${normalized.split("/").map(encodeURIComponent).join("/")}`
		: `file:///${normalized
				.split("/")
				.map((part, i) => (i ? encodeURIComponent(part) : part))
				.join("/")}`;
}
export function pathFromUri(uri: string) {
	const url = new URL(uri);
	if (url.protocol !== "file:")
		throw Error("Il server non ha restituito un percorso locale");
	const path = decodeURIComponent(url.pathname);
	if (url.hostname && url.hostname !== "localhost")
		return `\\\\${url.hostname}${path.replace(/\//g, "\\")}`;
	return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, "\\") : path;
}
export function sameFileUri(uri: string, path: string): boolean {
	const normalize = (value: string) => {
		const text = value.replace(/\\/g, "/");
		return /^[A-Za-z]:\//.test(text) || text.startsWith("//")
			? text.toLowerCase()
			: text;
	};
	try {
		return normalize(pathFromUri(uri)) === normalize(path);
	} catch {
		return false;
	}
}
