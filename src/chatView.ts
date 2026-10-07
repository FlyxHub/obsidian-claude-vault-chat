import { ItemView, setIcon, ViewStateResult } from 'obsidian';

export const VIEW_TYPE = 'claude-vault-chat';

export class ChatView extends ItemView {
	private collapsed = false;
	private headerEl?: HTMLElement;
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
		this.headerEl = this.contentEl.createDiv('claude-header');
		this.toggleEl = this.headerEl.createDiv('clickable-icon');
		this.toggleEl.onclick = () => this.setCollapsed(!this.collapsed);
		this.headerEl.createSpan({ cls: 'claude-title', text: 'Claude' });
		this.contentEl.createDiv({ cls: 'claude-body', text: 'Chat arrives in milestone 2.' });
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
}
