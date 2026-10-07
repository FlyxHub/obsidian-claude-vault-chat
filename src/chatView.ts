import { FileSystemAdapter, ItemView, MarkdownRenderer, Menu, Notice, setIcon, TFile, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import type { PermissionResult, SDKAssistantMessageError, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import fs from 'fs';
import path from 'path';
import { ClaudeError, errorText, findClaude, runTurn, type Turn } from './claude';
import type ClaudeVaultChat from './main';
import type { Settings } from './settings';
import { vaultRelative } from './vaultPath';

export const VIEW_TYPE = 'claude-vault-chat';

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep']);
const EDIT_TOOLS = new Set(['Edit', 'Write']);
const OPENABLE = /\.(md|canvas|base)$/i; // file types Obsidian opens itself
const APPROVAL_MODES: Record<Settings['approvalMode'], string> = { ask: 'Ask before edits', auto: 'Auto-approve edits' };

type Choice = 'once' | 'chat' | 'deny';

interface TextBlock {
	el: HTMLElement;
	text: string;
	timer?: number;
	seq: number;
}

export class ChatView extends ItemView {
	// Field names must not shadow ItemView's undocumented internals (headerEl, titleEl, iconEl, ...):
	// a class field declaration resets them to undefined after super(), and Obsidian's own
	// view loading then crashes before onOpen runs.
	private collapsed = false;
	private barEl?: HTMLElement;
	private toggleEl?: HTMLElement;
	private chatTitleEl!: HTMLElement;
	private newChatEl!: HTMLElement;
	private greetingEl!: HTMLElement;
	private promptEl!: HTMLTextAreaElement;
	private modeEl!: HTMLElement;
	private modelEl!: HTMLElement;
	private sendEl!: HTMLButtonElement;
	private turn?: Turn;
	private turnEl?: HTMLElement; // everything Claude produced for the current message
	private turnText: string[] = []; // finished text blocks of the current turn, for Copy
	private stopping = false;
	private textBlock?: TextBlock;
	private toolRows = new Map<string, { row: HTMLElement; done: string }>();
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
		return 'claude-spark';
	}

	private get chat() {
		return this.plugin.chat;
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('claude-chat');
		this.barEl = this.contentEl.createDiv('claude-header');
		this.toggleEl = this.barEl.createDiv('clickable-icon');
		this.toggleEl.onclick = () => this.setCollapsed(!this.collapsed);
		this.chatTitleEl = this.barEl.createDiv('claude-title');
		this.newChatEl = this.barEl.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': 'New chat' } });
		setIcon(this.newChatEl, 'square-pen');
		this.newChatEl.onclick = () => this.newChat();

		this.contentEl.appendChild(this.chat.messagesEl);
		// Shown instead of the (empty) message list, like Claude's home screen.
		const empty = this.contentEl.createDiv('claude-empty');
		empty.createSpan({ cls: 'claude-empty-mark', text: '✻︎', attr: { 'aria-hidden': 'true' } });
		this.greetingEl = empty.createSpan('claude-greeting');

		// Rendered [[wikilinks]] aren't clickable outside a note view; open them ourselves.
		this.registerDomEvent(this.contentEl, 'click', (e) => {
			const link = (e.target as HTMLElement).closest('a.internal-link');
			if (!link) return;
			e.preventDefault();
			void this.app.workspace.openLinkText(link.getAttr('data-href') ?? link.getText(), '', e.ctrlKey || e.metaKey);
		});

		const card = this.contentEl.createDiv('claude-composer').createDiv('claude-input-card');
		card.onclick = (e) => !(e.target as HTMLElement).closest('button') && this.promptEl.focus();
		this.promptEl = card.createEl('textarea', { attr: { rows: '1', 'aria-label': 'Message Claude' } });
		this.promptEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
				e.preventDefault();
				void this.send();
			}
		});
		this.promptEl.addEventListener('input', () => this.refreshComposer());
		const bar = card.createDiv('claude-input-bar');
		this.modeEl = this.chip(bar, 'claude-mode-chip', (e) => this.showModeMenu(e));
		this.modelEl = this.chip(bar, 'claude-model-chip', (e) => this.showModelMenu(e));
		this.sendEl = bar.createEl('button', { cls: 'claude-send' });
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
		this.promptEl.focus();
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
			const height = (strip?.offsetHeight ?? 0) + (this.barEl?.offsetHeight ?? 0);
			// Hidden sidebar measures 0; keep the CSS fallback (one header) in that case.
			if (height > 0) group.style.setProperty('--claude-collapsed-height', `${height}px`);
			group.toggleClass('claude-collapsed', this.collapsed);
		});
		this.app.workspace.requestSaveLayout();
	}

	/** Re-reads title, settings-backed chips, placeholder and send state. */
	refreshComposer() {
		if (!this.promptEl) return; // not opened yet (settings saves refresh every chat view)
		const s = this.plugin.settings;
		this.chatTitleEl.setText(this.chat.title ?? 'New chat');
		const hour = new Date().getHours();
		this.greetingEl.setText(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
		this.promptEl.placeholder = this.chat.messagesEl.childElementCount ? 'Reply to Claude…' : 'How can I help you today?';
		this.chipLabel(this.modeEl, APPROVAL_MODES[s.approvalMode]);
		this.chipLabel(this.modelEl, s.models.find((m) => m.value === s.model)?.displayName ?? (s.model || 'Default'));
		this.sendEl.toggleClass('is-empty', !this.turn && !this.promptEl.value.trim());
		// Grow with the text, like Claude's composer, up to a cap.
		this.promptEl.style.height = 'auto';
		this.promptEl.style.height = `${Math.min(this.promptEl.scrollHeight, 240)}px`;
	}

	private chip(parent: HTMLElement, cls: string, onClick: (e: MouseEvent) => void) {
		const el = parent.createEl('button', { cls: `claude-chip ${cls}` });
		el.createSpan('claude-chip-label');
		setIcon(el.createSpan('claude-chip-chevron'), 'chevron-down');
		el.onclick = onClick;
		return el;
	}

	private chipLabel(chip: HTMLElement, text: string) {
		chip.querySelector('.claude-chip-label')?.setText(text);
		chip.setAttr('aria-label', text);
	}

	private showModeMenu(e: MouseEvent) {
		const s = this.plugin.settings;
		const menu = new Menu();
		for (const [mode, title] of Object.entries(APPROVAL_MODES) as [Settings['approvalMode'], string][]) {
			menu.addItem((i) =>
				i
					.setTitle(title)
					.setChecked(s.approvalMode === mode)
					.onClick(async () => {
						s.approvalMode = mode;
						await this.plugin.saveSettings();
					}),
			);
		}
		menu.showAtMouseEvent(e);
	}

	private showModelMenu(e: MouseEvent) {
		const s = this.plugin.settings;
		const pick = async (model: string) => {
			s.model = model;
			await this.plugin.saveSettings();
		};
		const menu = new Menu();
		menu.addItem((i) => i.setTitle('Default').setChecked(!s.model).onClick(() => pick('')));
		for (const m of s.models) {
			if (m.value !== 'default') menu.addItem((i) => i.setTitle(m.displayName).setChecked(s.model === m.value).onClick(() => pick(m.value)));
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(s.models.length ? 'Refresh model list' : 'Load available models')
				.setIcon('refresh-cw')
				.onClick(async () => new Notice(await this.plugin.checkConnection())),
		);
		menu.showAtMouseEvent(e);
	}

	private newChat() {
		if (this.turn) return;
		const old = this.chat.messagesEl;
		this.plugin.resetChat();
		old.replaceWith(this.chat.messagesEl);
		this.toolRows.clear();
		this.turnEl = undefined;
		this.refreshComposer();
		this.focusInput();
	}

	private stop() {
		if (!this.turn || this.stopping) return;
		this.stopping = true;
		this.sendEl.addClass('is-stopping');
		this.turn.stop();
	}

	private async send() {
		const text = this.promptEl.value.trim();
		if (!text || this.turn) return;
		const chat = this.chat;
		this.promptEl.value = '';
		chat.title ??= text.split('\n')[0];
		chat.messagesEl.createDiv({ cls: 'claude-user', text });
		this.turnEl = chat.messagesEl.createDiv('claude-turn');
		this.turnText = [];
		this.errorShown = false;
		chat.messagesEl.scrollTop = chat.messagesEl.scrollHeight;

		const s = this.plugin.settings;
		const exe = findClaude(s.claudePath);
		if (!exe) {
			if (s.claudePath) this.addError(`Claude Code can't be started from "${s.claudePath}". Point the Executable setting at claude.exe (not a .cmd shim), or clear it to auto-detect.`, { settings: true });
			else this.addError('Claude Code was not found. Install it from https://claude.com/claude-code, run `claude` once in a terminal to log in, or set its path in settings.', { settings: true });
			this.finishTurn();
			this.refreshComposer();
			return;
		}

		const vault = (this.app.vault.adapter as FileSystemAdapter).getBasePath(); // desktop-only plugin
		this.vault = vault;
		this.shownThisTurn.clear();
		this.editTargets.clear();
		this.stopping = false;
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
		this.setWorking('Thinking…');
		try {
			await this.turn.done;
		} catch (e) {
			// Launch failures, crashes: show the SDK's message with Claude Code's stderr behind "Details".
			if (!this.stopping) this.addError(errorText(e), { details: e instanceof ClaudeError ? e.details : '', settings: true });
		} finally {
			this.endText();
			for (const cancel of this.pendingPrompts) cancel();
			if (this.stopping) this.append('claude-notice', 'Stopped');
			this.turn = undefined;
			this.stopping = false;
			this.finishTurn();
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
			const card = this.append('claude-permission');
			card.createDiv({ cls: 'claude-permission-title', text: permissionTitle(tool, input, vault) });
			renderPermissionDetails(card, tool, input);
			const buttons = card.createDiv('claude-permission-buttons');
			this.setWorking('Waiting for your approval');

			const finish = (choice: Choice, outcome: string) => {
				signal.removeEventListener('abort', cancel);
				this.pendingPrompts.delete(cancel);
				buttons.remove();
				card.addClass('is-decided', choice === 'deny' ? 'is-denied' : 'is-allowed');
				const result = card.createDiv('claude-permission-outcome');
				setIcon(result.createSpan(), choice === 'deny' ? 'x' : 'check');
				result.createSpan({ text: outcome });
				if (this.turn) this.setWorking('Thinking…');
				resolve(choice);
			};
			const cancel = () => finish('deny', 'Cancelled');
			signal.addEventListener('abort', cancel);
			this.pendingPrompts.add(cancel);

			const button = (text: string, cls: string, onClick: () => void) => (buttons.createEl('button', { cls: `claude-btn ${cls}`, text }).onclick = onClick);
			button('Allow once', 'mod-primary', () => finish('once', 'Allowed'));
			button('Allow for this chat', '', () => finish('chat', `Allowed ${tool} for this chat`));
			button('Deny', 'mod-quiet', () => finish('deny', 'Denied'));
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
			const text = friendlyError(m.error, raw, this.resetsAt);
			this.addError(text, { details: text === raw ? '' : raw });
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
		const el = this.append('claude-error');
		el.createDiv({ text });
		if (opts.details) {
			const details = el.createEl('details');
			details.createEl('summary', { text: 'Details' });
			details.createEl('pre', { text: opts.details });
		}
		if (opts.settings) el.createEl('button', { cls: 'claude-btn', text: 'Open settings' }).onclick = () => this.plugin.openSettings();
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

	private waitForFile(path: string): Promise<TFile | null> {
		const existing = this.app.vault.getFileByPath(path);
		if (existing) return Promise.resolve(existing);
		return new Promise((resolve) => {
			const done = (file: TFile | null) => {
				this.app.vault.offref(ref);
				window.clearTimeout(timer);
				resolve(file);
			};
			const ref = this.app.vault.on('create', (f) => f instanceof TFile && f.path === path && done(f));
			const timer = window.setTimeout(() => done(null), 5000);
		});
	}

	private startText() {
		this.endText();
		this.textBlock = { el: this.append('claude-reply markdown-rendered'), text: '', seq: 0 };
		this.spark().addClass('is-quiet'); // the streaming text shows progress; keep just the spark
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
		if (this.textBlock.text.trim()) this.turnText.push(this.textBlock.text);
		void this.renderText(this.textBlock);
		this.textBlock = undefined;
		this.spark().removeClass('is-quiet');
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
		const [icon, running, done] = describeTool(name, input);
		const row = this.append('claude-tool is-running');
		const details = row.createEl('details');
		const summary = details.createEl('summary');
		setIcon(summary.createSpan('claude-tool-icon'), icon);
		summary.createSpan({ cls: 'claude-tool-label', text: running });
		setIcon(summary.createSpan('claude-tool-chevron'), 'chevron-right');
		details.createEl('pre', { text: JSON.stringify(input, null, 2) });
		this.toolRows.set(id, { row, done });
	}

	private finishToolRow(id: string, isError: boolean, content: unknown) {
		const tool = this.toolRows.get(id);
		if (!tool) return;
		this.toolRows.delete(id);
		tool.row.removeClass('is-running');
		tool.row.querySelector('.claude-tool-label')?.setText(tool.done);
		if (!isError) return;
		tool.row.addClass('is-error');
		tool.row.createDiv({ cls: 'claude-tool-reason', text: resultText(content).replace(/^PreToolUse:\w+ hook error: /, '') });
	}

	/** Adds an element to the current turn, keeping the working spark below it. */
	private append(cls: string, text = '') {
		let el!: HTMLElement;
		this.keepPinned(() => {
			const parent = this.turnEl ?? this.chat.messagesEl;
			el = parent.createDiv({ cls, text });
			if (this.turn) parent.appendChild(this.spark());
		});
		return el;
	}

	// One spark per chat: it animates at the bottom of the turn while Claude works,
	// then rests under the latest reply, like Claude Desktop's mark.
	private spark() {
		return (
			this.chat.messagesEl.querySelector<HTMLElement>('.claude-spark') ??
			createDiv('claude-spark', (el) => {
				el.createSpan({ cls: 'claude-spark-glyph', attr: { 'aria-hidden': 'true' } });
				el.createSpan('claude-spark-label');
			})
		);
	}

	private setWorking(label: string) {
		const spark = this.spark();
		spark.addClass('is-working');
		spark.querySelector('.claude-spark-label')?.setText(label);
		this.keepPinned(() => this.turnEl?.appendChild(spark));
	}

	private finishTurn() {
		const turn = this.turnEl;
		if (!turn) return;
		const footer = turn.createDiv('claude-turn-footer');
		const spark = this.spark();
		spark.removeClass('is-working', 'is-quiet');
		footer.appendChild(spark);
		const text = this.turnText.join('\n\n');
		if (text) {
			const copy = footer.createEl('button', { cls: 'clickable-icon claude-copy', attr: { 'aria-label': 'Copy' } });
			setIcon(copy, 'copy');
			copy.onclick = async () => {
				await navigator.clipboard.writeText(text);
				setIcon(copy, 'check');
				window.setTimeout(() => setIcon(copy, 'copy'), 1500);
			};
		}
		this.turnEl = undefined;
	}

	// Follow new content only if the user is already at the bottom (they may have scrolled up to read).
	private keepPinned(update: () => void) {
		const el = this.chat.messagesEl;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		update();
		if (atBottom) el.scrollTop = el.scrollHeight;
	}

	private setBusy(busy: boolean) {
		this.sendEl.toggleClass('is-stop', busy);
		this.sendEl.removeClass('is-stopping');
		this.sendEl.setAttr('aria-label', busy ? 'Stop' : 'Send');
		setIcon(this.sendEl, busy ? 'square' : 'arrow-up');
		this.newChatEl.toggleClass('is-disabled', busy);
		this.refreshComposer();
	}
}

/** [icon, label while running, label when done] for a tool call. */
function describeTool(name: string, input: Record<string, unknown>): [string, string, string] {
	const file = String(input.file_path ?? '').split(/[\\/]/).pop();
	const tools: Record<string, [string, string, string, unknown]> = {
		Read: ['file-text', 'Reading', 'Read', file],
		Edit: ['pencil', 'Editing', 'Edited', file],
		Write: ['file-plus', 'Writing', 'Wrote', file],
		Glob: ['folder-search', 'Finding', 'Found', input.pattern],
		Grep: ['text-search', 'Searching for', 'Searched for', `“${input.pattern}”`],
		Bash: ['terminal', 'Running', 'Ran', input.description ?? 'a command'],
		WebFetch: ['globe', 'Fetching', 'Fetched', input.url],
		WebSearch: ['search', 'Searching the web for', 'Searched the web for', `“${input.query}”`],
	};
	const [icon, running, done, subject] = tools[name] ?? ['wrench', name, name, ''];
	return [icon, `${running} ${subject}`.trim(), `${done} ${subject}`.trim()];
}

function friendlyError(code: SDKAssistantMessageError, raw: string, resetsAt?: number): string {
	switch (code) {
		case 'authentication_failed':
			return 'Claude Code is not logged in. Open a terminal, run `claude`, and use /login. Then send your message again.';
		case 'rate_limit':
			return `You've reached your Claude usage limit.${resetsAt ? ` It resets ${formatReset(resetsAt)}.` : ''}`;
		case 'billing_error':
			return "There's a billing problem with your Claude account. Check your plan on claude.ai.";
		case 'overloaded':
		case 'server_error':
			return 'Claude is temporarily unavailable. Try again in a moment.';
		case 'model_not_found':
			return "The selected model isn't available to your account. Choose another one from the model menu below the message box.";
		default:
			return raw || `Claude Code reported an error (${code}).`;
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
			return `Allow Claude to edit ${file}?`;
		case 'Write':
			return `Allow Claude to ${fs.existsSync(path.resolve(vault, target)) ? 'overwrite' : 'create'} ${file}?`;
		case 'Bash':
			return 'Allow Claude to run a command?';
		case 'WebFetch':
			return `Allow Claude to fetch ${input.url}?`;
		case 'WebSearch':
			return `Allow Claude to search the web for “${input.query}”?`;
		default:
			return `Allow Claude to use ${tool}?`;
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
