import {
	query,
	type AccountInfo,
	type CanUseTool,
	type ModelInfo,
	type Options,
	type SDKMessage,
	type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { execFile, execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { denyReason } from './vaultPath';

const SYSTEM_APPEND = `You are running as a chat panel inside Obsidian. The working directory is the root of the user's Obsidian vault, and its Markdown files are the user's notes.
- Refer to notes as [[wikilinks]] (vault-relative path, no .md extension) so the user can click them.
- Follow the vault's existing conventions (frontmatter, tags, folders) when creating or editing notes.
- You can only access files inside the vault, and you cannot modify .obsidian/, .git/ or .claude/.`;

/** An error with optional raw output (stderr) to show behind a "Details" toggle. */
export class ClaudeError extends Error {
	constructor(
		message: string,
		public details = '',
	) {
		super(message);
	}
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// npm's .cmd/.bat/.ps1 shims can't be spawned without a shell (Node refuses since CVE-2024-27980).
const isShim = (p: string) => process.platform === 'win32' && /\.(cmd|bat|ps1)$|[\\/]claude$/i.test(p);

/**
 * The configured path if set (and usable), else auto-detect. Obsidian often lacks the shell PATH,
 * so check the native installer's location before asking `where`/`which`.
 */
export function findClaude(configured = ''): string | undefined {
	if (configured) return fs.existsSync(configured) && !isShim(configured) ? configured : undefined;
	const native = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
	if (fs.existsSync(native)) return native;
	try {
		const out = execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
		return out.split(/\r?\n/).find((p) => p && fs.existsSync(p) && !isShim(p));
	} catch {
		return undefined; // not on PATH
	}
}

// How every session launches Claude Code from inside Obsidian.
function launchOptions(exe: string, cwd: string, abort: AbortController, onStderr: (text: string) => void): Options {
	return {
		abortController: abort,
		pathToClaudeCodeExecutable: exe,
		cwd,
		settingSources: ['project'], // the vault's CLAUDE.md + .claude/settings.json; nothing from ~/.claude
		strictMcpConfig: true, // no MCP servers, including claude.ai connectors
		spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
			// Node's spawn() rejects the renderer's DOM AbortSignal, so kill on abort ourselves.
			const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
			child.stderr.on('data', (d) => onStderr(String(d)));
			signal.addEventListener('abort', () => child.kill(), { once: true });
			return child;
		},
	};
}

export interface ConnectionInfo {
	version: string;
	account: AccountInfo;
	models: ModelInfo[];
}

/** Starts Claude Code and reads its login and model list. No model call, so it costs no usage. */
export async function testConnection(exe: string, cwd: string): Promise<ConnectionInfo> {
	const version = await new Promise<string>((resolve, reject) =>
		execFile(exe, ['--version'], { windowsHide: true, timeout: 15000 }, (err, out) => (err ? reject(err) : resolve(String(out).trim()))),
	);
	let stderr = '';
	let endInput!: () => void;
	const inputDone = new Promise<void>((resolve) => (endInput = resolve));
	const abort = new AbortController();
	// An open prompt stream that sends nothing: the CLI starts and answers the initialize request.
	const q = query({
		prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
			await inputDone;
		})(),
		options: { ...launchOptions(exe, cwd, abort, (d) => (stderr += d)), tools: [] },
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const init = await Promise.race([
			q.initializationResult(),
			new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error('Timed out waiting for Claude Code to start.')), 20000))),
		]);
		return { version, account: init.account, models: init.models };
	} catch (e) {
		abort.abort();
		throw new ClaudeError(errorText(e), stderr.trim());
	} finally {
		clearTimeout(timer);
		endInput();
		void (async () => {
			for await (const _ of q); // drain so the process can exit
		})().catch(() => {});
	}
}

/** Human-readable login, or undefined when Claude Code isn't logged in. */
export function describeLogin(a: AccountInfo): string | undefined {
	if (a.apiKeySource && a.apiKeySource !== 'none') return `API key (${a.apiKeySource})`;
	if (a.subscriptionType || a.email) return [a.subscriptionType ?? a.email, a.organization].filter(Boolean).join(' · ');
	if (a.apiProvider && a.apiProvider !== 'firstParty') return a.apiProvider; // Bedrock/Vertex/etc.: can't tell, assume configured
	return undefined;
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
	model?: string;
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
			...launchOptions(o.exe, o.cwd, abort, (d) => (stderr = (stderr + d).slice(-4000))),
			resume: o.resume,
			model: o.model,
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
									reason = `Blocked: could not verify the path (${errorText(e)}).`;
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
			if (!errorResult) throw new ClaudeError(errorText(e), stderr.trim());
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
