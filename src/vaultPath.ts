import fs from 'fs';
import os from 'os';
import path from 'path';

const WRITE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);
const fold = (s: string) => (process.platform === 'win32' ? s.toLowerCase() : s);

// Resolve symlinks/junctions on the longest existing prefix, so a link inside the vault
// (or a not-yet-created file under one) can't point outside it.
function realResolve(p: string): string {
	const tail: string[] = [];
	for (let head = p; ; ) {
		try {
			return path.join(fs.realpathSync.native(head), ...tail);
		} catch {
			const parent = path.dirname(head);
			if (parent === head) return p;
			tail.unshift(path.basename(head));
			head = parent;
		}
	}
}

/** Vault-relative '/'-separated path for an absolute or vault-relative path; undefined if outside the vault. */
export function vaultRelative(p: string, vault: string): string | undefined {
	// Claude Code expands a leading ~ itself, so treat it as home rather than a folder named "~".
	const expanded = /^~(?:[\\/]|$)/.test(p) ? path.join(os.homedir(), p.slice(1)) : p;
	const rel = path.relative(realResolve(path.resolve(vault)), realResolve(path.resolve(vault, expanded)));
	if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return undefined; // isAbsolute: other drive
	return rel.split(path.sep).join('/');
}

/** Why this tool call must be blocked, or undefined if it stays inside the vault's allowed area. */
export function denyReason(tool: string, input: Record<string, unknown>, vault: string, protectedDirs: string[]): string | undefined {
	const target = input.file_path ?? input.notebook_path ?? input.path; // Glob/Grep path is optional (defaults to the vault)
	if (typeof target === 'string') {
		const rel = vaultRelative(target, vault);
		if (rel === undefined) return `Blocked: ${target} is outside the vault.`;
		const dir = protectedDirs.find((d) => fold(rel) === fold(d) || fold(rel).startsWith(`${fold(d)}/`));
		if (dir && WRITE_TOOLS.has(tool)) return `Blocked: Claude may not modify files in ${dir}/.`;
	}
	// Glob patterns are paths too (Grep's `pattern` is a regex, its `glob` is a path filter).
	const globs = [tool === 'Glob' ? input.pattern : undefined, input.glob].filter((g): g is string => typeof g === 'string');
	if (globs.some((g) => path.isAbsolute(g) || /^[a-zA-Z]:|^~/.test(g) || g.split(/[\\/]/).includes('..'))) {
		return 'Blocked: search patterns must stay inside the vault.';
	}
	return undefined;
}
