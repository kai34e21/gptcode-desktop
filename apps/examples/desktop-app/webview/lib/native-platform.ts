export function isTauriAvailable(): boolean {
	return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
export function isMacPlatform(): boolean {
	return (
		typeof navigator !== "undefined" &&
		/mac/i.test(navigator.platform || navigator.userAgent)
	);
}
