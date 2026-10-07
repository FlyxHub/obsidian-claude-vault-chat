import { FileSystemAdapter, ItemView, MarkdownRenderer, setIcon, ViewStateResult } from 'obsidian';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { findClaude, runTurn, type Turn } from './claude';

export const VIEW_TYPE = 'claude-vault-chat';

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
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendEl!: HTMLButtonElement;
	private stickToBottom = true;
	private turn?: Turn;
	private textBlock?: TextBlock;
	private toolRows = new Map<string, HTMLElement>();

	getViewType() {
		return VIEW_TYPE;
	}

	getDisplayText() {
		return 'Claude';
	}

	getIcon() {
		return 'bot';
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass('claude-chat');
		this.headerEl = this.contentEl.createDiv('claude-header');
		this.toggleEl = this.headerEl.createDiv('clickable-icon');
		this.toggleEl.onclick = () => this.setCollapsed(!this.collapsed);
		this.headerEl.createSpan({ cls: 'claude-title', text: 'Claude' });

		this.messagesEl = this.contentEl.createDiv('claude-messages');
		this.messagesEl.onscroll = () => {
			const el = this.messagesEl;
			this.stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
		};
		// Rendered [[wikilinks]] aren't clickable outside a note view; open them ourselves.
		this.registerDomEvent(this.messagesEl, 'click', (e) => {
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
		this.sendEl = composer.createEl('button', { cls: 'mod-cta', text: 'Send' });
		this.sendEl.onclick = () => void this.send();
		this.setCollapsed(this.collapsed);
	}

	async onClose() {
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

	private async send() {
		const text = this.inputEl.value.trim();
		if (!text || this.turn) return;
		this.inputEl.value = '';
		this.stickToBottom = true;
		this.addDiv('claude-msg claude-user', text);

		const exe = findClaude();
		if (!exe) return this.addError('Claude Code was not found. Install it from https://claude.com/claude-code and run `claude` once to log in.');
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) return this.addError('This vault is not on the local file system.');

		this.setBusy(true);
		try {
			this.turn = runTurn({ prompt: text, cwd: adapter.getBasePath(), exe, onMessage: (m) => this.onMessage(m) });
			await this.turn.done;
		} catch (e) {
			this.addError(e instanceof Error ? e.message : String(e));
		} finally {
			this.endText();
			this.turn = undefined;
			this.setBusy(false);
		}
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
				if (block.type === 'tool_use') this.addToolRow(block.id, block.name, block.input as Record<string, unknown>);
			}
		} else if (m.type === 'user' && Array.isArray(m.message.content)) {
			for (const block of m.message.content) {
				if (block.type === 'tool_result') this.finishToolRow(block.tool_use_id, !!block.is_error, block.content);
			}
		} else if (m.type === 'result' && m.is_error) {
			this.addError(m.subtype === 'success' ? m.result : m.errors.join('\n'));
		}
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
		await MarkdownRenderer.render(this.app, block.text, tmp, '', this);
		if (seq !== block.seq) return; // a newer render superseded this one
		block.el.replaceChildren(...Array.from(tmp.childNodes));
		this.scrollToBottom();
	}

	private addToolRow(id: string, name: string, input: Record<string, unknown>) {
		const row = this.messagesEl.createEl('details', { cls: 'claude-tool' });
		row.createEl('summary', { text: describeTool(name, input) });
		row.createEl('pre', { text: JSON.stringify(input, null, 2) });
		this.toolRows.set(id, row);
		this.scrollToBottom();
	}

	private finishToolRow(id: string, isError: boolean, content: unknown) {
		const row = this.toolRows.get(id);
		if (!row) return;
		this.toolRows.delete(id);
		row.addClass(isError ? 'is-error' : 'is-done');
		if (isError) row.createEl('pre', { cls: 'claude-tool-error', text: resultText(content) });
	}

	private addError(text: string) {
		this.addDiv('claude-error', text);
	}

	private addDiv(cls: string, text = '') {
		const el = this.messagesEl.createDiv({ cls, text });
		this.scrollToBottom();
		return el;
	}

	private scrollToBottom() {
		if (this.stickToBottom) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private setBusy(busy: boolean) {
		this.sendEl.disabled = busy;
		this.sendEl.setText(busy ? 'Working…' : 'Send');
		this.contentEl.toggleClass('is-busy', busy);
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

function resultText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content.map((c: { type?: string; text?: string }) => (c.type === 'text' ? c.text : '')).join('\n');
}
