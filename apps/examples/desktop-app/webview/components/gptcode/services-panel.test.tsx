// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ServicesPanel from "./services-panel";

const mock = vi.hoisted(() => ({
	runtime: vi.fn(),
	listeners: [] as Array<
		(event: { event: string; payload: Record<string, unknown> }) => void
	>,
}));
vi.mock("@/lib/gptcode-runtime", () => ({
	runtime: mock.runtime,
	subscribeRuntime: async (
		callback: (event: {
			event: string;
			payload: Record<string, unknown>;
		}) => void,
	) => {
		mock.listeners.push(callback);
		return () => {};
	},
	pathFromUri: (uri: string) => uri.replace("file:///", ""),
}));
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	HTMLElement.prototype.scrollIntoView = vi.fn();
	mock.listeners.length = 0;
	mock.runtime.mockReset();
	mock.runtime.mockImplementation(async (method: string) =>
		method === "chat.status"
			? { model: "fixture/test", models: [], busy: false, requests: [] }
			: method === "chat.history"
				? []
				: {},
	);
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () =>
		root.render(
			<ServicesPanel
				root="D:\\project"
				file={{
					path: "D:\\project\\test.mjs",
					text: "const n = 1;",
					dirty: true,
				}}
				breakpoints={{}}
				navigate={vi.fn()}
				onPaused={vi.fn()}
			/>,
		),
	);
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});
async function click(text: string) {
	const button = [...host.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === text,
	);
	if (!button) throw Error(`Pulsante assente: ${text}`);
	await act(async () => button.click());
}
async function event(name: string, payload: Record<string, unknown>) {
	await act(async () => {
		for (const callback of mock.listeners) callback({ event: name, payload });
	});
}

it("non invia prompt o approvazioni automaticamente e richiede il click per ogni permesso", async () => {
	expect(
		mock.runtime.mock.calls.some((call) =>
			["chat.send", "chat.answer"].includes(call[0]),
		),
	).toBe(false);
	await event("chat.request", {
		id: "permission-1",
		kind: "permission",
		request: { name: "Write", args: { file_path: "test.txt" } },
	});
	expect(host.textContent).toContain("Permesso: Write");
	expect(
		mock.runtime.mock.calls.some((call) => call[0] === "chat.answer"),
	).toBe(false);
	await click("Consenti una volta");
	expect(mock.runtime).toHaveBeenCalledWith("chat.answer", {
		id: "permission-1",
		answer: "allow",
	});
});

it("aggiorna lo streaming grafico e mostra l'errore del motore", async () => {
	await event("chat.text", { text: "Prima " });
	await event("chat.text", { text: "risposta" });
	expect(host.textContent).toContain("Prima risposta");
	await event("chat.error", { message: "Provider non disponibile" });
	expect(host.querySelector('[role="alert"]')?.textContent).toBe(
		"Provider non disponibile",
	);
});

it("rifiuta di avviare il debugger su modifiche non salvate", async () => {
	await click("Debug Node");
	await click("Avvia");
	expect(host.textContent).toContain("Salva il file prima di avviare il debug");
	expect(
		mock.runtime.mock.calls.some((call) => call[0] === "debug.start"),
	).toBe(false);
});
