import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist", "node_modules", "test-results", "playwright-report", "playground/dist"] },
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
			"@typescript-eslint/no-floating-promises": "error",
			"no-restricted-globals": [
				"error",
				{ name: "document", message: "Use the host element's ownerDocument so popout windows work." },
				{ name: "window", message: "Use ownerDocument.defaultView so popout windows work." },
			],
		},
	},
	{
		files: ["test/**", "playground/**", "scripts/**", "*.config.*"],
		rules: { "no-restricted-globals": "off", "@typescript-eslint/no-unsafe-member-access": "off" },
	},
);
