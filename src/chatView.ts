import { ItemView, setIcon, ViewStateResult } from 'obsidian';

export const VIEW_TYPE = 'claude-vault-chat';

export class ChatView extends ItemView {
	private collapsed = false;
	private toggleEl?: HTMLElement;

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
		const header = this.contentEl.createDiv('claude-header');
		this.toggleEl = header.createDiv('clickable-icon');
		this.toggleEl.onclick = () => this.setCollapsed(!this.collapsed);
		header.createSpan({ cls: 'claude-title', text: 'Claude' });
		this.contentEl.createDiv({ cls: 'claude-body', text: 'Chat arrives in milestone 2.' });
		this.setCollapsed(this.collapsed);
	}

	getState() {
		return { collapsed: this.collapsed };
	}

	async setState(state: unknown, result: ViewStateResult) {
		const collapsed = (state as { collapsed?: unknown } | null)?.collapsed;
		if (typeof collapsed === 'boolean') this.setCollapsed(collapsed);
		await super.setState(state, result);
	}

	// Obsidian has no public API to collapse a stacked sidebar group, so shrink our
	// tab group to its headers with a CSS class; the neighbouring group takes the space.
	private setCollapsed(collapsed: boolean) {
		this.collapsed = collapsed;
		if (this.toggleEl) {
			setIcon(this.toggleEl, collapsed ? 'chevron-right' : 'chevron-down');
			this.toggleEl.setAttr('aria-label', collapsed ? 'Expand' : 'Collapse');
		}
		this.app.workspace.onLayoutReady(() => {
			this.containerEl.closest('.workspace-tabs')?.toggleClass('claude-collapsed', this.collapsed);
		});
		this.app.workspace.requestSaveLayout();
	}
}
