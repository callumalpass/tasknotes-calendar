import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const entries = {
	index: "src/index.ts",
	core: "src/core/index.ts",
	react: "src/react/index.tsx",
};

await build({
	entryPoints: entries,
	outdir: "dist/esm",
	bundle: true,
	splitting: true,
	format: "esm",
	target: "es2022",
	platform: "neutral",
	sourcemap: true,
	external: ["react", "react-dom", "react/jsx-runtime"],
	jsx: "automatic",
	logLevel: "warning",
});

// The stylesheet ships as one file so hosts can import or inline it.
mkdirSync("dist", { recursive: true });
const css = readFileSync("src/dom/calendar.css", "utf8");
writeFileSync("dist/calendar.css", css);
