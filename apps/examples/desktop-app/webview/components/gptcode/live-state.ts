export type LiveDraft = {
	callId: string;
	path: string;
	name: string;
	before: string | null;
	after: string;
	phase: "streaming" | "approval" | "saved" | "denied" | "error" | "cancelled";
	version: number;
};
export type EditorBuffer = {
	path: string;
	base: string;
	text: string;
	saving: boolean;
	agentBase?: string;
	external?: string | null;
	deleted?: boolean;
};
export type FileChange = {
	path: string;
	text: string | null;
	deleted: boolean;
	source: string;
	before?: string | null;
	version: number;
};
export function applyDiskChange(
	buffers: EditorBuffer[],
	event: FileChange,
): EditorBuffer[] {
	const found = buffers.some((buffer) => buffer.path === event.path);
	if (!found)
		return ["agent", "activity"].includes(event.source) && event.text !== null
			? [
					...buffers,
					{
						path: event.path,
						text: event.text,
						base: event.text,
						agentBase:
							event.source === "agent" ? (event.before ?? "") : undefined,
						saving: false,
					},
				]
			: buffers;
	return buffers.map((buffer) => {
		if (buffer.path !== event.path || buffer.saving) return buffer;
		if (buffer.text !== buffer.base) return { ...buffer, external: event.text };
		if (event.text === null) return { ...buffer, deleted: true };
		if (buffer.text === event.text && buffer.base === event.text)
			return { ...buffer, deleted: false };
		return {
			...buffer,
			text: event.text,
			base: event.text,
			agentBase: buffer.agentBase ?? event.before ?? buffer.base,
			external: undefined,
			deleted: false,
		};
	});
}
export function applyDraft(
	buffers: EditorBuffer[],
	draft: LiveDraft,
): EditorBuffer[] {
	if (buffers.some((buffer) => buffer.path === draft.path)) return buffers;
	return [
		...buffers,
		{
			path: draft.path,
			text: draft.before ?? "",
			base: draft.before ?? "",
			saving: false,
			deleted: draft.before === null,
		},
	];
}
export const phaseLabel: Record<LiveDraft["phase"], string> = {
	streaming: "Codice in arrivo",
	approval: "Proposta · in attesa",
	saved: "Salvato",
	denied: "Permesso negato",
	error: "Scrittura fallita",
	cancelled: "Proposta interrotta",
};
