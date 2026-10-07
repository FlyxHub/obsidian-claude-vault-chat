import { query, type CanUseTool, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { denyReason } from './vaultPath';

const SYSTEM_APPEND = `You are running as a chat panel inside Obsidian. The working directory is the root of the user's Obsidian vault, and its Markdown files are the user's notes.
- Refer to notes as [[wikilinks]] (vault-relative path, no .md extension) so the user can click them.
- Follow the vault's existing conventions (frontmatter, tags, folders) when creating or editing notes.
- You can only access files inside the vault, and you cannot modify .obsidian/, .git/ or .claude/.`;

// Obsidian often lacks the shell PATH, so check the native installer's location first.
// npm's .cmd / extensionless shims can't be spawned without a shell, so on Windows only a real .exe counts.
export function findClaude(): string | undefined {
	const win = process.platform === 'win32';
	const native = path.join(os.homedir(), '.local', 'bin', win ? 'claude.exe' : 'claude');
	if (fs.existsSync(native)) return native;
	try {
		const out = execFileSync(win ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
		return out.split(/\r?\n/).find((p) => p && fs.existsSync(p) && (!win || p.toLowerCase().endsWith('.exe')));
	} catch {
		return undefined; // not on PATH
	}
}

export interface Turn {
	done: Promise<void>;
	stop(): void;
}

export function runTurn(o: {
	prompt: string;
	cwd: string;
	exe: string;
	resume?: string;
	tools: string[];
	protectedDirs: string[]; // vault-relative folders Claude may read but never write
	canUseTool: CanUseTool;
	onMessage: (m: SDKMessage) => void;
}): Turn {
	let endInput!: () => void;
	const inputDone = new Promise<void>((resolve) => (endInput = resolve));
	// Keep stdin open until the turn's result arrives so interrupt() can still reach the CLI.
	async function* prompt(): AsyncGenerator<SDKUserMessage> {
		yield { type: 'user', message: { role: 'user', content: o.prompt }, parent_tool_use_id: null, origin: { kind: 'human' } };
		await inputDone;
	}

	let stderr = '';
	const abort = new AbortController();
	const q = query({
		prompt: prompt(),
		options: {
			abortController: abort,
			pathToClaudeCodeExecutable: o.exe,
			cwd: o.cwd,
			resume: o.resume,
			settingSources: ['project'], // the vault's CLAUDE.md + .claude/settings.json; nothing from ~/.claude
			strictMcpConfig: true, // no MCP servers, including claude.ai connectors
			// No allowedTools: a bare entry approves the tool everywhere, bypassing canUseTool.
			// Reads inside the cwd (the vault) are auto-allowed by 'default' mode anyway.
			tools: o.tools,
			permissionMode: 'default',
			canUseTool: o.canUseTool,
			// The vault boundary. PreToolUse runs for every tool call, including ones the permission
			// system auto-allows without consulting canUseTool. Fails closed if the check throws.
			hooks: {
				PreToolUse: [
					{
						hooks: [
							async (input) => {
								if (input.hook_event_name !== 'PreToolUse') return {};
								let reason: string | undefined;
								try {
									reason = denyReason(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, o.cwd, o.protectedDirs);
								} catch (e) {
									reason = `Blocked: could not verify the path (${e instanceof Error ? e.message : String(e)}).`;
								}
								if (!reason) return {};
								return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
							},
						],
					},
				],
			},
			includePartialMessages: true,
			systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
			spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
				// Node's spawn() rejects the renderer's DOM AbortSignal, so kill on abort ourselves.
				const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
				child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)));
				signal.addEventListener('abort', () => child.kill(), { once: true });
				return child;
			},
		},
	});

	const done = (async () => {
		let errorResult = false;
		try {
			for await (const m of q) {
				if (m.type === 'result') {
					errorResult = m.is_error;
					endInput();
				}
				o.onMessage(m);
			}
		} catch (e) {
			// The SDK throws after an error result; that result message already carried the details.
			if (!errorResult) throw new Error(`${e instanceof Error ? e.message : String(e)}${stderr ? `\n\n${stderr.trim()}` : ''}`);
		} finally {
			endInput();
		}
	})();

	let hardStop: ReturnType<typeof setTimeout> | undefined;
	void done.catch(() => {}).finally(() => clearTimeout(hardStop));
	return {
		done,
		// Graceful interrupt keeps the session resumable; kill the process if the CLI doesn't stop.
		stop: () => {
			hardStop ??= setTimeout(() => abort.abort(), 5000);
			q.interrupt().catch(() => abort.abort());
		},
	};
}
