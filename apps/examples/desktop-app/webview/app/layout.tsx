import type { Metadata } from "next";
import { DesktopErrorTelemetry } from "@/components/desktop-error-telemetry";
import { NativeShell } from "@/components/native-shell";
import { Toaster } from "@/components/ui/toaster";
import { APP_FONT_SIZE_BOOTSTRAP_SCRIPT } from "@/lib/app-font-size";
import { HUB_THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
	title:
		process.env.NEXT_PUBLIC_GPTCODE_DESKTOP === "1"
			? "GPTCode Desktop"
			: "Cline",
	description:
		process.env.NEXT_PUBLIC_GPTCODE_DESKTOP === "1"
			? "Editor e agente GPTCode."
			: "Build software with Cline.",
	icons: {
		icon: [
			{
				url: "/32x32.png",
				media: "(prefers-color-scheme: light)",
			},
			{
				url: "/32x32.png",
				media: "(prefers-color-scheme: dark)",
			},
			{
				url: "/icon.svg",
				type: "image/svg+xml",
			},
		],
		apple: "/icon.png",
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			className="dark h-full"
			data-cline-hub-theme="dark"
			lang="en"
			suppressHydrationWarning
		>
			<head>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static bootstrap must run before the first paint
					dangerouslySetInnerHTML={{
						__html: APP_FONT_SIZE_BOOTSTRAP_SCRIPT,
					}}
					id="cline-app-font-size-bootstrap"
				/>
				<script
					// biome-ignore lint/security/noDangerouslySetInnerHtml: static bootstrap must run before the first paint
					dangerouslySetInnerHTML={{ __html: HUB_THEME_BOOTSTRAP_SCRIPT }}
					id="cline-hub-theme-bootstrap"
				/>
			</head>
			<body className="h-full min-h-screen font-sans antialiased">
				{process.env.NEXT_PUBLIC_GPTCODE_DESKTOP !== "1" && (
					<DesktopErrorTelemetry />
				)}
				<NativeShell />
				{children}
				<Toaster />
			</body>
		</html>
	);
}
