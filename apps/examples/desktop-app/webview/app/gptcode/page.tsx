"use client";

import dynamic from "next/dynamic";

const Workbench = dynamic(() => import("@/components/gptcode/workbench"), {
	ssr: false,
	loading: () => (
		<div className="grid h-screen place-items-center">
			Avvio GPTCode Desktop…
		</div>
	),
});

export default function GPTCodePage() {
	return <Workbench />;
}
