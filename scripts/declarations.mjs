// Emit explicit relative extensions for strict NodeNext consumers in both formats.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve("dist/types");
function visit(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) visit(path);
		else if (entry.name.endsWith(".d.ts")) {
			const source = readFileSync(path, "utf8");
			for (const [extension, output] of [[".js", path], [".cjs", path.replace(/\.d\.ts$/, ".d.cts")]]) {
				const content = source.replace(/(from\s+|import\s*\()(["'])(\.[^"']+)\2/g, (match, prefix, quote, specifier) => {
					const target = resolve(dirname(path), specifier);
					const module = existsSync(target + ".d.ts") ? specifier : specifier + "/index";
					if (!existsSync(resolve(dirname(path), module) + ".d.ts")) throw new Error("Missing declaration: " + module);
					return prefix + quote + module + extension + quote;
				});
				writeFileSync(output, content);
			}
		}
	}
}
visit(root);
