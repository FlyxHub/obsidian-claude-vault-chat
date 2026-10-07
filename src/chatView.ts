import { FileSystemAdapter, ItemView, MarkdownRenderer, setIcon, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import type { PermissionResult, SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { ClaudeError, findClaude, runTurn, type Turn } from './claude';
import type ClaudeVaultChat from './main';
import { vaultRelative } from './vaultPath';

export const VIEW_TYPE = 'claude-vault-chat';

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const EDIT_TOOLS = new Set(['Edit', 'Write']);
const OPENABLE = /\.(md|canvas|base)$/i; // file types Obsidian opens itself

type Choice = 'once' | 'chat' | 'deny';

interface TextBlock {
	el: HTMLElement;
	text: string;
	timer?: number;
	seq: number;
}

export class ChatView extends ItemView {
	private collapsed = false;
	private headerEl?: HTMLElement;
	private toggleEl?: HTMLElement;
	private newChatEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendEl!: HTMLButtonElement;
	private turn?: Turn;
	private stopping = false;
	private textBlock?: TextBlock;
	private toolRows = new Map<string, HTMLElement>();
	private pendingPrompts = new Set<() => void>(); // cancel functions of open permission cards
	private vault = '';
	private editTargets = new Map<string, string>(); // tool_use id → vault-relative path of an Edit/Write
	private shownThisTurn = new Set<string>(); // open each edited file once per turn
	private errorShown = false; // a friendly error was shown this turn; skip the raw result error
	private resetsAt?: number; // usage-limit reset time (unix seconds) from the latest rate_limit_event

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: ClaudeVaultChat,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return 'Claude';
	}

	getIcon() {
		return 'bot';
	}

	private get chat() {
		return this.plugin.chat;
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('claude-chat');
		this.headerEl = this.contentEl.createDiv('claude-header');
		this.toggleEl = this.headerEl.createDiv('clickable-icon');
		this.toggleEl.onclick = () => this.setCollapsed(!this.collapsed);
		this.headerEl.createSpan({ cls: 'claude-title', text: 'Claude' });
		this.newChatEl = this.headerEl.createDiv({ cls: 'clickable-icon claude-new-chat', attr: { 'aria-label': 'New chat' } });
		setIcon(this.newChatEl, 'square-pen');
		this.newChatEl.onclick = () => this.newChat();

		this.contentEl.appendChild(this.chat.messagesEl);
		// Rendered [[wikilinks]] aren't clickable outside a note view; open them ourselves.
		this.registerDomEvent(this.contentEl, 'click', (e) => {
			const link = (e.target as HTMLElement).closest('a.internal-link');
			if (!link) return;
			e.preventDefault();
			void this.app.workspace.openLinkText(link.getAttr('data-href') ?? link.getText(), '', e.ctrlKey || e.metaKey);
		});

		const composer = this.contentEl.createDiv('claude-composer');
		this.inputEl = composer.createEl('textarea', { attr: { placeholder: 'Ask Claude about this vault…', rows: '3' } });
		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				void this.send();
			}
		});
		this.sendEl = composer.createEl('button');
		this.sendEl.onclick = () => (this.turn ? this.stop() : void this.send());
		this.setBusy(false);
		this.setCollapsed(this.collapsed);
	}

	async onClose() {
		this.stop(); // a closed pane shouldn't keep working unseen
		this.containerEl.closest('.workspace-tabs')?.removeClass('claude-collapsed');
	}

	getState() {
		return { collapsed: this.collapsed };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const collapsed = (state as { collapsed?: unknown } | null)?.collapsed;
		if (typeof collapsed === 'boolean') this.setCollapsed(collapsed);
		await super.setState(state, result);
	}

	isBusy() {
		return !!this.turn;
	}

	focusInput() {
		this.inputEl.focus();
	}

	// Obsidian has no public API to collapse a stacked sidebar group. Sidebar groups are
	// `flex: 1 0 0; height: 0` with `contain: strict` leaves, so they have no natural height:
	// pin the group to the measured height of its visible headers instead.
	setCollapsed(collapsed: boolean) {
		this.collapsed = collapsed;
		if (this.toggleEl) {
			setIcon(this.toggleEl, collapsed ? 'chevron-right' : 'chevron-down');
			this.toggleEl.setAttr('aria-label', collapsed ? 'Expand' : 'Collapse');
		}
		this.app.workspace.onLayoutReady(() => {
			const group = this.containerEl.closest<HTMLElement>('.workspace-tabs');
			if (!group) return;
			const strip = group.querySelector<HTMLElement>(':scope > .workspace-tab-header-container');
			const height = (strip?.offsetHeight ?? 0) + (this.headerEl?.offsetHeight ?? 0);
			// Hidden sidebar measures 0; keep the CSS fallback (one header) in that case.
			if (height > 0) group.style.setProperty('--claude-collapsed-height', `${height}px`);
			group.toggleClass('claude-collapsed', this.collapsed);
		});
		this.app.workspace.requestSaveLayout();
	}

	private newChat() {
		if (this.turn) return;
		const old = this.chat.messagesEl;
		this.plugin.resetChat();
		old.replaceWith(this.chat.messagesEl);
		this.toolRows.clear();
		this.focusInput();
	}

	private stop() {
		if (!this.turn || this.stopping) return;
		this.stopping = true;
		this.sendEl.disabled = true;
		this.sendEl.setText('Stopping…');
		this.turn.stop();
	}

	private async send() {
		const text = this.inputEl.value.trim();
		if (!text || this.turn) return;
		this.inputEl.value = '';
		this.addDiv('claude-msg claude-user', text);
		this.chat.messagesEl.scrollTop = this.chat.messagesEl.scrollHeight;

		const s = this.plugin.settings;
		const exe = findClaude(s.claudePath);
		const adapter = this.app.vault.adapter;
		if (!exe) {
			const msg = s.claudePath
				? `Claude Code can't be started from "${s.claudePath}". Point the Executable setting at claude.exe (not a .cmd shim), or clear it to auto-detect.`
				: 'Claude Code was not found. Install it from https://claude.com/claude-code, run `claude` once in a terminal to log in, or set its path in settings.';
			this.addError(msg, { settings: true });
			return;
		}
		if (!(adapter instanceof FileSystemAdapter)) {
			this.addError('This vault is not on the local file system.');
			return;
		}

		const chat = this.chat;
		const vault = adapter.getBasePath();
		this.vault = vault;
		this.shownThisTurn.clear();
		this.editTargets.clear();
		this.stopping = false;
		this.errorShown = false;
		this.turn = runTurn({
			prompt: text,
			cwd: vault,
			exe,
			resume: chat.sessionId,
			model: s.model || undefined,
			tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', ...(s.allowBash ? ['Bash'] : []), ...(s.allowWeb ? ['WebFetch', 'WebSearch'] : [])],
			protectedDirs: [this.app.vault.configDir, '.git', '.claude'],
			canUseTool: (tool, input, opts) => this.canUseTool(tool, input, opts.signal, vault),
			onMessage: (m) => {
				if (m.type === 'system' && m.subtype === 'init') chat.sessionId = m.session_id;
				this.onMessage(m);
			},
		});
		this.setBusy(true);
		try {
			await this.turn.done;
		} catch (e) {
			// Launch failures, crashes: show the SDK's message with Claude Code's stderr behind "Details".
			if (!this.stopping) this.addError(e instanceof Error ? e.message : String(e), { details: e instanceof ClaudeError ? e.details : '', settings: true });
		} finally {
			this.endText();
			for (const cancel of this.pendingPrompts) cancel();
			if (this.stopping) this.addDiv('claude-notice', 'Stopped.');
			this.turn = undefined;
			this.stopping = false;
			this.setBusy(false);
		}
	}

	// Only consulted for calls the CLI wants approved; the PreToolUse hook has already enforced the vault boundary.
	private async canUseTool(tool: string, input: Record<string, unknown>, signal: AbortSignal, vault: string): Promise<PermissionResult> {
		const allow: PermissionResult = { behavior: 'allow', updatedInput: input };
		const autoEdit = EDIT_TOOLS.has(tool) && this.plugin.settings.approvalMode === 'auto';
		if (READ_TOOLS.has(tool) || autoEdit || this.chat.allowedTools.has(tool)) return allow;
		const choice = await this.askPermission(tool, input, signal, vault);
		if (choice === 'chat') this.chat.allowedTools.add(tool);
		return choice === 'deny' ? { behavior: 'deny', message: 'The user declined this action.' } : allow;
	}

	private askPermission(tool: string, input: Record<string, unknown>, signal: AbortSignal, vault: string): Promise<Choice> {
		return new Promise((resolve) => {
			if (signal.aborted) return resolve('deny');
			let card!: HTMLElement;
			this.keepPinned(() => (card = this.chat.messagesEl.createDiv('claude-permission')));
			card.createDiv({ cls: 'claude-permission-title', text: permissionTitle(tool, input, vault) });
			renderPermissionDetails(card, tool, input);
			const buttons = card.createDiv('claude-permission-buttons');

			const finish = (choice: Choice, outcome: string) => {
				signal.removeEventListener('abort', cancel);
				this.pendingPrompts.delete(cancel);
				buttons.remove();
				card.addClass(choice === 'deny' ? 'is-denied' : 'is-allowed');
				card.createDiv({ cls: 'claude-permission-outcome', text: outcome });
				resolve(choice);
			};
			const cancel = () => finish('deny', 'Cancelled');
			signal.addEventListener('abort', cancel);
			this.pendingPrompts.add(cancel);

			buttons.createEl('button', { cls: 'mod-cta', text: 'Allow' }).onclick = () => finish('once', 'Allowed');
			buttons.createEl('button', { text: 'Allow for this chat' }).onclick = () => finish('chat', `Allowed ${tool} for this chat`);
			buttons.createEl('button', { text: 'Deny' }).onclick = () => finish('deny', 'Denied');
			card.scrollIntoView({ block: 'nearest' }); // needs attention even if the user scrolled up
		});
	}

	private onMessage(m: SDKMessage) {
		if ('parent_tool_use_id' in m && m.parent_tool_use_id) return; // subagent traffic
		if (m.type === 'stream_event') {
			const ev = m.event;
			if (ev.type === 'content_block_start' && ev.content_block.type === 'text') this.startText();
			else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') this.appendText(ev.delta.text);
			else if (ev.type === 'content_block_stop') this.endText();
		} else if (m.type === 'assistant') {
			for (const block of m.message.content) {
				if (block.type !== 'tool_use') continue;
				const input = block.input as Record<string, unknown>;
				this.addToolRow(block.id, block.name, input);
				if (EDIT_TOOLS.has(block.name)) this.trackEdit(block.id, input.file_path);
			}
		} else if (m.type === 'user' && Array.isArray(m.message.content)) {
			for (const block of m.message.content) {
				if (block.type !== 'tool_result') continue;
				this.finishToolRow(block.tool_use_id, !!block.is_error, block.content);
				void this.editFinished(block.tool_use_id, !!block.is_error);
			}
		}

		if (m.type === 'rate_limit_event') {
			this.resetsAt = m.rate_limit_info.resetsAt ?? this.resetsAt;
		} else if (m.type === 'assistant' && m.error && !this.errorShown) {
			// Failures arrive as a synthetic (non-streamed) assistant message carrying an error code.
			const raw = m.message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
			const { text, settings } = friendlyError(m.error, raw, this.resetsAt);
			this.addError(text, { details: text === raw ? '' : raw, settings });
		} else if (m.type === 'result' && m.is_error && !this.stopping && !this.errorShown) {
			const raw = m.subtype === 'success' ? m.result : m.errors.join('\n');
			if (m.subtype !== 'success' && m.startup_failure_reason === 'shell_tool_missing') {
				this.addError('Shell commands need Git for Windows (Git Bash). Install it, or turn off "Allow shell commands" in settings.', { details: raw, settings: true });
			} else if (m.subtype !== 'success' && m.startup_failure_reason === 'cli_version_too_old') {
				this.addError('Your Claude Code is too old for this plugin. Run `claude update` in a terminal.', { details: raw });
			} else {
				this.addError(raw);
			}
		}
	}

	private addError(text: string, opts: { details?: string; settings?: boolean } = {}) {
		this.errorShown = true;
		this.keepPinned(() => {
			const el = this.chat.messagesEl.createDiv('claude-error');
			el.createDiv({ text });
			if (opts.details) {
				const details = el.createEl('details');
				details.createEl('summary', { text: 'Details' });
				details.createEl('pre', { text: opts.details });
			}
			if (opts.settings) el.createEl('button', { text: 'Open settings' }).onclick = () => this.plugin.openSettings();
		});
	}

	// An existing note opens as soon as Claude starts editing it, so the change lands while you watch
	// (and you can see it while approving). Paths outside the vault resolve to undefined and are ignored.
	private trackEdit(id: string, filePath: unknown) {
		const rel = typeof filePath === 'string' ? vaultRelative(filePath, this.vault) : undefined;
		if (!rel || !OPENABLE.test(rel)) return;
		this.editTargets.set(id, rel);
		const file = this.app.vault.getFileByPath(rel);
		if (file) this.showEdited(file);
	}

	// A new file opens once its Write succeeded and the vault has picked it up.
	private async editFinished(id: string, isError: boolean) {
		const rel = this.editTargets.get(id);
		this.editTargets.delete(id);
		if (!rel || isError) return;
		const file = await this.waitForFile(rel);
		if (file) this.showEdited(file);
	}

	private showEdited(file: TFile) {
		if (this.shownThisTurn.has(file.path)) return;
		this.shownThisTurn.add(file.path);
		void this.plugin.showEditedFile(file);
	}

	private waitForFile(path: string, ms = 5000): Promise<TFile | null> {
		const existing = this.app.vault.getFileByPath(path);
		if (existing) return Promise.resolve(existing);
		return new Promise((resolve) => {
			const done = (file: TFile | null) => {
				this.app.vault.offref(ref);
				window.clearTimeout(timer);
				resolve(file);
			};
			const ref = this.app.vault.on('create', (f) => f instanceof TFile && f.path === path && done(f));
			const timer = window.setTimeout(() => done(null), ms);
		});
	}

	private startText() {
		this.endText();
		this.textBlock = { el: this.addDiv('claude-msg claude-assistant'), text: '', seq: 0 };
	}

	private appendText(text: string) {
		if (!this.textBlock) this.startText();
		const block = this.textBlock!;
		block.text += text;
		// Re-rendering markdown on every delta is wasteful; batch deltas into ~12 renders/sec.
		block.timer ??= window.setTimeout(() => void this.renderText(block), 80);
	}

	private endText() {
		if (!this.textBlock) return;
		void this.renderText(this.textBlock);
		this.textBlock = undefined;
	}

	private async renderText(block: TextBlock) {
		window.clearTimeout(block.timer);
		block.timer = undefined;
		const seq = ++block.seq;
		const tmp = createDiv();
		await MarkdownRenderer.render(this.app, block.text, tmp, '', this.chat.component);
		if (seq !== block.seq) return; // a newer render superseded this one
		this.keepPinned(() => block.el.replaceChildren(...Array.from(tmp.childNodes)));
	}

	private addToolRow(id: string, name: string, input: Record<string, unknown>) {
		this.keepPinned(() => {
			const row = this.chat.messagesEl.createEl('details', { cls: 'claude-tool' });
			row.createEl('summary', { text: describeTool(name, input) });
			row.createEl('pre', { text: JSON.stringify(input, null, 2) });
			this.toolRows.set(id, row);
		});
	}

	private finishToolRow(id: string, isError: boolean, content: unknown) {
		const row = this.toolRows.get(id);
		if (!row) return;
		this.toolRows.delete(id);
		row.addClass(isError ? 'is-error' : 'is-done');
		if (isError) row.createEl('pre', { cls: 'claude-tool-error', text: resultText(content).replace(/^PreToolUse:\w+ hook error: /, '') });
	}

	private addDiv(cls: string, text = '') {
		let el!: HTMLElement;
		this.keepPinned(() => (el = this.chat.messagesEl.createDiv({ cls, text })));
		return el;
	}

	// Follow new content only if the user is already at the bottom (they may have scrolled up to read).
	private keepPinned(update: () => void) {
		const el = this.chat.messagesEl;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		update();
		if (atBottom) el.scrollTop = el.scrollHeight;
	}

	private setBusy(busy: boolean) {
		this.sendEl.disabled = false;
		this.sendEl.setText(busy ? 'Stop' : 'Send');
		this.sendEl.toggleClass('mod-cta', !busy);
		this.sendEl.toggleClass('mod-warning', busy);
		this.newChatEl.toggleClass('is-disabled', busy);
	}
}

function describeTool(name: string, input: Record<string, unknown>): string {
	const file = String(input.file_path ?? input.notebook_path ?? '').split(/[\\/]/).pop();
	switch (name) {
		case 'Read':
			return `Reading ${file}`;
		case 'Edit':
			return `Editing ${file}`;
		case 'Write':
			return `Writing ${file}`;
		case 'Glob':
			return `Finding files: ${input.pattern}`;
		case 'Grep':
			return `Searching for "${input.pattern}"`;
		case 'Bash':
			return `Running: ${input.command}`;
		case 'WebFetch':
			return `Fetching ${input.url}`;
		case 'WebSearch':
			return `Searching the web: ${input.query}`;
		default:
			return name;
	}
}

function friendlyError(code: SDKAssistantMessageError, raw: string, resetsAt?: number): { text: string; settings?: boolean } {
	switch (code) {
		case 'authentication_failed':
			return { text: 'Claude Code is not logged in. Open a terminal, run `claude`, and use /login. Then send your message again.' };
		case 'rate_limit':
			return { text: `You've reached your Claude usage limit.${resetsAt ? ` It resets ${formatReset(resetsAt)}.` : ''}` };
		case 'billing_error':
			return { text: "There's a billing problem with your Claude account. Check your plan on claude.ai." };
		case 'overloaded':
		case 'server_error':
			return { text: 'Claude is temporarily unavailable. Try again in a moment.' };
		case 'model_not_found':
			return { text: "The selected model isn't available to your account. Choose another model in settings.", settings: true };
		default:
			return { text: raw || `Claude Code reported an error (${code}).` };
	}
}

function formatReset(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.toDateString() === new Date().toDateString()
		? `at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
		: `on ${d.toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' })}`;
}

function permissionTitle(tool: string, input: Record<string, unknown>, vault: string): string {
	const target = String(input.file_path ?? '');
	const file = vaultRelative(target, vault) ?? target;
	switch (tool) {
		case 'Edit':
			return `Edit ${file}?`;
		case 'Write':
			return `${fs.existsSync(path.resolve(vault, target)) ? 'Overwrite' : 'Create'} ${file}?`;
		case 'Bash':
			return 'Run a shell command?';
		case 'WebFetch':
			return `Fetch ${input.url}?`;
		case 'WebSearch':
			return `Search the web for "${input.query}"?`;
		default:
			return `Use ${tool}?`;
	}
}

function renderPermissionDetails(el: HTMLElement, tool: string, input: Record<string, unknown>) {
	if (tool === 'Edit') {
		el.createEl('pre', { cls: 'claude-diff-del', text: String(input.old_string ?? '') });
		el.createEl('pre', { cls: 'claude-diff-add', text: String(input.new_string ?? '') });
		if (input.replace_all) el.createDiv({ cls: 'claude-permission-note', text: 'Replaces every occurrence.' });
	} else if (tool === 'Write') {
		el.createEl('pre', { text: String(input.content ?? '') });
	} else if (tool === 'Bash') {
		el.createEl('pre', { text: String(input.command ?? '') });
		if (input.description) el.createDiv({ cls: 'claude-permission-note', text: String(input.description) });
	} else if (tool !== 'WebFetch' && tool !== 'WebSearch') {
		el.createEl('pre', { text: JSON.stringify(input, null, 2) });
	}
}

function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content.map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text : '')).join('\n');
}
