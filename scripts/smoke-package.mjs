import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "tasknotes-calendar-package-"));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
function npm(args, cwd) {
	return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
		cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
	});
}
function node(file) {
	execFileSync(process.execPath, [file], { cwd: temp, stdio: "inherit" });
}
try {
	const [packed] = JSON.parse(npm(["pack", "--json", "--pack-destination", temp], root));
	assert(packed.size < 250_000, "Unexpected tarball growth (limit 250 KB)");
	for (const { path } of packed.files) {
		assert(/^(dist\/|package.json$|README.md$|LICENSE$|CHANGELOG.md$)/.test(path), "Unexpected packed file: " + path);
		assert(!path.endsWith(".map"), "Source maps should not ship: " + path);
	}
	console.log("Tarball:", packed.size, "bytes packed;", packed.unpackedSize, "bytes unpacked");
	writeFileSync(join(temp, "package.json"), JSON.stringify({ name: "calendar-consumer", private: true, type: "module" }));
	// Prove DOM and core entry points do not need the optional React peer.
	npm(["install", "--ignore-scripts", "--omit=optional", "--no-audit", "--no-fund", join(temp, packed.filename)], temp);
	const checks = `
		if (typeof calendar.Calendar !== "function" || typeof calendar.basesLayoutOptions !== "function") throw new Error("Missing DOM/adapter exports");
		if (core.formatDay(core.parseDay("2026-10-21")) !== "2026-10-21") throw new Error("Broken core export");
	`;
	writeFileSync(join(temp, "esm.mjs"), `
		import * as calendar from "@tasknotes/calendar";
		import * as core from "@tasknotes/calendar/core";
		import { readFileSync } from "node:fs";
		${checks}
		if (!readFileSync(new URL(import.meta.resolve("@tasknotes/calendar/calendar.css")), "utf8").includes("--tnc-theme-bg")) throw new Error("Missing ESM CSS path");
	`);
	writeFileSync(join(temp, "cjs.cjs"), `
		const calendar = require("@tasknotes/calendar");
		const core = require("@tasknotes/calendar/core");
		${checks}
		if (!require("node:fs").readFileSync(require.resolve("@tasknotes/calendar/calendar.css"), "utf8").includes(".tnc")) throw new Error("Missing CJS CSS path");
	`);
	node("esm.mjs");
	node("cjs.cjs");
	// Pin consumer tooling to the library's tested versions.
	npm(["install", "--ignore-scripts", "--no-audit", "--no-fund",
		"react@" + manifest.devDependencies.react.replace(/^\^/, ""),
		"@types/react@" + manifest.devDependencies["@types/react"].replace(/^\^/, ""),
		"typescript@" + manifest.devDependencies.typescript.replace(/^\^/, "")], temp);
	writeFileSync(join(temp, "react.mjs"), 'import { TaskCalendar } from "@tasknotes/calendar/react"; if (typeof TaskCalendar !== "function") throw new Error("Missing React ESM export");');
	writeFileSync(join(temp, "react.cjs"), 'if (typeof require("@tasknotes/calendar/react").TaskCalendar !== "function") throw new Error("Missing React CJS export");');
	node("react.mjs");
	node("react.cjs");
	const consumer = `
		import { Calendar, basesLayoutOptions, type CalendarItem } from "@tasknotes/calendar";
		import { parseDay, formatDay } from "@tasknotes/calendar/core";
		import { TaskCalendar, type TaskCalendarProps } from "@tasknotes/calendar/react";
		const items: CalendarItem<{ project: string }>[] = [{ id: "a", title: formatDay(parseDay("2026-10-21")!), start: "2026-10-21", data: { project: "release" } }];
		const calendar = new Calendar(document.createElement("div"), basesLayoutOptions({ calendarView: "timeGridWeek" }), items);
		calendar.setOptions({ itemContent: ({ item }) => item.data?.project });
		const props: TaskCalendarProps<{ project: string }> = { items, view: "month" };
		TaskCalendar(props);
	`;
	writeFileSync(join(temp, "consumer.mts"), consumer);
	writeFileSync(join(temp, "consumer.cts"), consumer);
	execFileSync(process.execPath, [join(temp, "node_modules/typescript/bin/tsc"),
		"--strict", "--noEmit", "--target", "ES2022", "--module", "NodeNext",
		"--moduleResolution", "NodeNext", "--lib", "ES2022,DOM,DOM.Iterable",
		"consumer.mts", "consumer.cts"], { cwd: temp, stdio: "inherit" });
	console.log("Installed package: ESM, CJS, CSS, optional React and strict NodeNext types passed.");
} finally {
	rmSync(temp, { recursive: true, force: true });
}
