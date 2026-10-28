// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Workbench from "./workbench";

const mock = vi.hoisted(() => ({ invoke: vi.fn(), conflict: false }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("@/lib/native-platform", () => ({ isTauriAvailable: () => true }));
vi.mock("@/lib/terminal-sessions", () => ({
	createTerminalTab: vi.fn(),
	killTerminalTab: vi.fn(),
	listTerminalTabs: () => [],
}));
vi.mock("@/components/terminal-panel", () => ({ TerminalPanel: () => null }));
vi.mock("./services-panel", () => ({ default: () => null }));
vi.mock("@/lib/gptcode-runtime", () => ({
	runtime: async () => ({ drafts: [], files: [] }),
	subscribeRuntime: async () => () => {},
}));
vi.mock("@/components/ui/resizable", () => ({
	ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ResizablePanel: ({ children }: { children: ReactNode }) => (
		<div>{children}</div>
	),
	ResizableHandle: () => null,
}));
vi.mock("@/components/views/chat/highlighted-code", () => ({
	CodeDiff: () => null,
}));
vi.mock("next/dynamic", () => ({
	default:
		() =>
		(props: {
			value: string;
			onChange: (s: string) => void;
			onSave: () => void;
		}) => (
			<button
				type="button"
				data-editor
				onClick={() => props.onChange("modifica\n")}
			>
				{props.value}
			</button>
		),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		value: () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {},
		}),
	});
	mock.conflict = false;
	mock.invoke.mockReset().mockImplementation(async (command: string) => {
		if (command === "gptcode_workspace") return "D:\\project";
		if (command === "gptcode_entries")
			return [
				{ name: "main.ts", path: "D:\\project\\main.ts", directory: false },
			];
		if (command === "gptcode_read") return "prima\r\n";
		if (command === "gptcode_save" && mock.conflict)
			throw Error("CONFLICT: file modificato dall’agente");
		return null;
	});
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root.render(<Workbench />));
});
afterEach(async () => {
	await act(async () => root.unmount());
	host.remove();
});
async function click(button: Element | null) {
	if (!button) throw Error("Pulsante mancante");
	await act(async () => {
		(button as HTMLElement).click();
	});
}
function button(text: string) {
	return (
		[...host.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === text,
		) ?? null
	);
}

it("preserva CRLF e salva il buffer con il contenuto originale come controllo di concorrenza", async () => {
	await click(button("main.ts"));
	await click(host.querySelector("[data-editor]"));
	await click(button("Salva"));
	expect(mock.invoke).toHaveBeenCalledWith("gptcode_save", {
		path: "D:\\project\\main.ts",
		expected: "prima\r\n",
		content: "modifica\r\n",
	});
	expect(button("Salva")?.hasAttribute("disabled")).toBe(true);
});

it("mantiene le modifiche nell’editor quando l’agente cambia il file su disco", async () => {
	mock.conflict = true;
	await click(button("main.ts"));
	await click(host.querySelector("[data-editor]"));
	await click(button("Salva"));
	expect(host.querySelector('[role="alert"]')?.textContent).toContain(
		"CONFLICT",
	);
	expect(host.querySelector("[data-editor]")?.textContent).toBe("modifica\n");
	expect(button("Salva")?.hasAttribute("disabled")).toBe(false);
});

it("non perde il testo digitato mentre una rilettura dal disco è in corso", async () => {
	await click(button("main.ts"));
	let finish: (text: string) => void = () => {
		throw Error("Lettura non iniziata");
	};
	mock.invoke.mockImplementationOnce(
		() =>
			new Promise<string>((resolve) => {
				finish = resolve;
			}),
	);
	await click(button("Ricarica"));
	await click(host.querySelector("[data-editor]"));
	await act(async () => {
		finish("disco aggiornato\n");
	});
	expect(host.querySelector("[data-editor]")?.textContent).toBe("modifica\n");
	expect(host.querySelector('[role="alert"]')?.textContent).toContain(
		"conservate",
	);
});
