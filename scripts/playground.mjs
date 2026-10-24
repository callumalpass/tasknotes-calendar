// Serves the playground with live rebuilds: `npm run playground [-- --port 4187 --host 0.0.0.0]`.
import { context } from "esbuild";

const arg = (name, fallback) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > 0 ? process.argv[i + 1] : (process.env[`PLAYGROUND_${name.toUpperCase()}`] ?? fallback);
};
const port = Number(arg("port", "4187"));
const host = arg("host", "127.0.0.1");

const ctx = await context({
	entryPoints: { main: "playground/main.ts", calendar: "src/dom/calendar.css" },
	outdir: "playground/dist",
	bundle: true,
	format: "esm",
	sourcemap: true,
	target: "es2022",
	logLevel: "info",
});
await ctx.watch();
const { port: actual } = await ctx.serve({ servedir: "playground", port, host });
console.log(`playground: http://${host}:${actual}/`);
