import { addIcon, Component, FileSystemAdapter, FileView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { ChatView, VIEW_TYPE } from './chatView';
import { describeLogin, findClaude, testConnection } from './claude';
import { ClaudeSettingTab, DEFAULT_SETTINGS, type Settings } from './settings';

// Our own eight-spoke asterisk (echoing the ✻ glyph in the chat), not Anthropic's logo.
const SPARK_ICON = '<path d="M50 12v76M12 50h76M23 23l54 54M77 23L23 77" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round"/>';

// The conversation lives on the plugin, not the pane, so moving or reopening the pane keeps it.
export interface ChatState {
	sessionId?: string;
	title?: string; // first line of the first message
	messagesEl: HTMLElement;
	component: Component; // owns rendered markdown children; unloaded on New Chat
	allowedTools: Set<string>; // "Allow for this chat"
}

export default class ClaudeVaultChat extends Plugin {
	settings: Settings = { ...DEFAULT_SETTINGS };
	chat!: ChatState;
	private editLeaf?: WorkspaceLeaf; // the dedicated tab for autoOpen: 'reuse'

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.addSettingTab(new ClaudeSettingTab(this.app, this));
		this.resetChat();
		addIcon('claude-spark', SPARK_ICON);
		this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.addRibbonIcon('claude-spark', 'Open Claude', () => this.openChat());
		this.addCommand({ id: 'open', name: 'Open or focus chat', callback: () => this.openChat() });
		this.addCommand({ id: 'move-to-right-sidebar', name: 'Move chat to right sidebar', callback: () => this.moveToRight() });

		// Place the pane once, on first run; after that Obsidian's saved layout remembers where it is.
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.placed) return;
			await this.openChat();
			this.settings.placed = true;
			await this.saveSettings();
		});
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// The composer's approval-mode and model menus mirror these settings.
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ChatView) leaf.view.refreshComposer();
	}

	/** Starts Claude Code to check its login and refresh the model list; returns a one-line status. */
	async checkConnection(): Promise<string> {
		const s = this.settings;
		const exe = findClaude(s.claudePath);
		if (!exe) {
			return s.claudePath
				? `✗ Not usable: ${s.claudePath}. Point this at claude.exe (not a .cmd shim).`
				: '✗ Claude Code not found. Install it from https://claude.com/claude-code, or enter the path to claude.exe.';
		}
		const adapter = this.app.vault.adapter;
		try {
			const info = await testConnection(exe, adapter instanceof FileSystemAdapter ? adapter.getBasePath() : process.cwd());
			s.models = info.models.map(({ value, displayName }) => ({ value, displayName }));
			await this.saveSettings();
			const login = describeLogin(info.account);
			return login ? `✓ ${info.version} · logged in with ${login}` : `✗ ${info.version} found, but not logged in. Open a terminal, run \`claude\`, and use /login.`;
		} catch (e) {
			return `✗ Could not start Claude Code: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	// app.setting isn't in the public API, but it's the only way to open a plugin's settings tab.
	openSettings() {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	resetChat() {
		if (this.chat) this.removeChild(this.chat.component);
		this.chat = { messagesEl: createDiv('claude-messages'), component: this.addChild(new Component()), allowedTools: new Set() };
	}

	// Show a note Claude is editing without taking keyboard focus from wherever the user is typing.
	async showEditedFile(file: TFile) {
		const mode = this.settings.autoOpen;
		if (mode === 'off') return;
		const { workspace } = this.app;
		let leaf = mode === 'reuse' ? this.editLeaf : undefined;
		let alive = false;
		workspace.iterateRootLeaves((l) => (alive ||= l === leaf));
		if (!leaf || !alive) leaf = workspace.getLeaf('tab'); // 'tab' always lands in the main area
		if (mode === 'reuse') this.editLeaf = leaf;

		const focused = activeDocument.activeElement as HTMLElement | null;
		if (!(leaf.view instanceof FileView && leaf.view.file === file)) await leaf.openFile(file, { active: false });
		await workspace.revealLeaf(leaf);
		// Make it the active file (without focus) so the File Explorer highlights it, and reveals it
		// in collapsed folders when the explorer's own "auto-reveal current file" toggle is on.
		workspace.setActiveLeaf(leaf, { focus: false });
		focused?.focus();
	}

	async openChat() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			const explorer = workspace.getLeavesOfType('file-explorer')[0];
			leaf = explorer
				? workspace.createLeafBySplit(explorer, 'horizontal')
				: (workspace.getLeftLeaf(true) ?? workspace.getLeaf('tab'));
			await leaf.setViewState({ type: VIEW_TYPE });
		}
		await workspace.revealLeaf(leaf);
		if (leaf.view instanceof ChatView) {
			leaf.view.setCollapsed(false);
			leaf.view.focusInput();
		}
	}

	async moveToRight() {
		const { workspace } = this.app;
		const current = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (current?.view instanceof ChatView && current.view.isBusy()) {
			new Notice('Stop Claude before moving the chat.');
			return;
		}
		if (current?.getRoot() === workspace.rightSplit) return workspace.revealLeaf(current);
		workspace.detachLeavesOfType(VIEW_TYPE);
		// Own group (split), like on the left, so the header/collapse behave the same.
		const leaf = workspace.getRightLeaf(true) ?? workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE });
		await workspace.revealLeaf(leaf);
	}
}
