import { expect, it } from "vitest";
import { pathFromUri, sameFileUri } from "./gptcode-runtime";

it("riconosce gli URI Windows del language server con drive codificato", () => {
	expect(
		sameFileUri("file:///c%3A/Project/main.ts", "C:\\Project\\main.ts"),
	).toBe(true);
	expect(
		sameFileUri(
			"file:///C:/Project/space%20name.ts",
			"c:\\Project\\space name.ts",
		),
	).toBe(true);
	expect(sameFileUri("file:///C:/Other/main.ts", "C:\\Project\\main.ts")).toBe(
		false,
	);
});
it("preserva i percorsi UNC e la distinzione maiuscole/minuscole POSIX", () => {
	expect(pathFromUri("file://server/share/main.ts")).toBe(
		"\\\\server\\share\\main.ts",
	);
	expect(sameFileUri("file:///project/A.ts", "/project/a.ts")).toBe(false);
});
