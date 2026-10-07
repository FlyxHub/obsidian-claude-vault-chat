import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import process from 'process';
import { builtinModules } from 'node:module';

const prod = process.argv[2] === 'production';

// The Agent SDK targets plain Node. Patch the spots that break in Obsidian's Electron
// renderer; fail the build if an SDK update moves them, rather than ship a broken bundle.
const sdkRendererPatches = {
	name: 'sdk-renderer-patches',
	setup(build) {
		build.onLoad({ filter: /claude-agent-sdk[\\/]sdk\.mjs$/ }, async (args) => {
			let code = await fs.readFile(args.path, 'utf8');
			const patch = (pattern, replacement) => {
				const next = code.replace(pattern, replacement);
				if (next === code) throw new Error(`SDK patch no longer applies: ${pattern}`);
				code = next;
			};
			// Renderer setTimeout returns a number, which has no .unref().
			patch(/\.unref\(\)/g, '.unref?.()');
			// Node's setMaxListeners throws on the renderer's DOM AbortSignal; the limit is only a leak-warning threshold.
			patch(
				/import\{setMaxListeners as ([\w$]+)\}from"events"/,
				'import{setMaxListeners as __sml}from"events";const $1=(...a)=>{try{__sml(...a)}catch{}}',
			);
			return { contents: code, loader: 'js' };
		});
	},
};

const context = await esbuild.context({
	entryPoints: ['src/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/autocomplete',
		'@codemirror/collab',
		'@codemirror/commands',
		'@codemirror/language',
		'@codemirror/lint',
		'@codemirror/search',
		'@codemirror/state',
		'@codemirror/view',
		'@lezer/common',
		'@lezer/highlight',
		'@lezer/lr',
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	// The SDK calls createRequire(import.meta.url) at load time (only to require 'fs'); CJS has no import.meta.
	define: { 'import.meta.url': '__importMetaUrl' },
	banner: {
		js: 'var __importMetaUrl = require("url").pathToFileURL(typeof __filename === "string" ? __filename : process.execPath).href;',
	},
	plugins: [sdkRendererPatches],
	format: 'cjs',
	target: 'es2022',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
