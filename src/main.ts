import { Plugin } from 'obsidian';
import { ChatView, VIEW_TYPE } from './chatView';

interface PluginData {
	placed: boolean;
}

export default class ClaudeVaultChat extends Plugin {
	data: PluginData = { placed: false };

	async onload() {
		this.data = Object.assign({ placed: false }, await this.loadData());
		this.registerView(VIEW_TYPE, (leaf) => new ChatView(leaf));
		this.addRibbonIcon('bot', 'Open Claude', () => this.openChat());
		this.addCommand({ id: 'open', name: 'Open or focus chat', callback: () => this.openChat() });
		this.addCommand({ id: 'move-to-right-sidebar', name: 'Move chat to right sidebar', callback: () => this.moveToRight() });

		// Place the pane once, on first run; after that Obsidian's saved layout remembers where it is.
		this.app.workspace.onLayoutReady(async () => {
			if (this.data.placed) return;
			await this.openChat();
			this.data.placed = true;
			await this.saveData(this.data);
		});
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
		if (leaf.view instanceof ChatView) leaf.view.setCollapsed(false);
	}

	async moveToRight() {
		const { workspace } = this.app;
		const current = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (current?.getRoot() === workspace.rightSplit) return workspace.revealLeaf(current);
		workspace.detachLeavesOfType(VIEW_TYPE);
		// Own group (split), like on the left, so the header/collapse behave the same.
		const leaf = workspace.getRightLeaf(true) ?? workspace.getLeaf('tab');
		await leaf.setViewState({ type: VIEW_TYPE });
		await workspace.revealLeaf(leaf);
	}
}
