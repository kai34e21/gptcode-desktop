import { expect, it } from "vitest";
import {
	applyDiskChange,
	applyDraft,
	type EditorBuffer,
	type LiveDraft,
} from "./live-state";

const draft: LiveDraft = {
	callId: "w",
	path: "D:\\p\\index.html",
	before: null,
	after: "<h1>Live",
	name: "Write",
	phase: "streaming",
	version: 1,
};
it("una proposta non diventa mai un buffer salvato prima della scrittura", () => {
	const buffers = applyDraft([], draft);
	expect(buffers[0].text).toBe("");
	expect(buffers[0].base).toBe("");
	expect(buffers[0].deleted).toBe(true);
	const saved = applyDiskChange(buffers, {
		path: draft.path,
		text: "<h1>Live</h1>",
		source: "agent",
		deleted: false,
		version: 2,
	});
	expect(saved[0].text).toBe("<h1>Live</h1>");
	expect(saved[0].agentBase).toBe("");
});
it("gli aggiornamenti esterni conservano le modifiche non salvate", () => {
	const buffer: EditorBuffer = {
		path: draft.path,
		base: "prima",
		text: "mio codice",
		saving: false,
	};
	const updated = applyDiskChange([buffer], {
		path: draft.path,
		text: "codice agente",
		source: "agent",
		deleted: false,
		version: 3,
	});
	expect(updated[0]).toMatchObject({
		text: "mio codice",
		base: "prima",
		external: "codice agente",
	});
});
it("aggiorna i buffer puliti e protegge il salvataggio in corso e le cancellazioni", () => {
	const buffer: EditorBuffer = {
		path: draft.path,
		base: "prima",
		text: "prima",
		saving: false,
	};
	expect(
		applyDiskChange([buffer], {
			path: draft.path,
			text: "dopo",
			source: "disk",
			deleted: false,
			version: 1,
		})[0],
	).toMatchObject({ text: "dopo", base: "dopo", agentBase: "prima" });
	expect(
		applyDiskChange([{ ...buffer, saving: true }], {
			path: draft.path,
			text: "dopo",
			source: "disk",
			deleted: false,
			version: 1,
		})[0].text,
	).toBe("prima");
	expect(
		applyDiskChange([buffer], {
			path: draft.path,
			text: null,
			source: "disk",
			deleted: true,
			version: 2,
		})[0],
	).toMatchObject({ text: "prima", deleted: true });
});
