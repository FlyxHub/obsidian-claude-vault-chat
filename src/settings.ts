import { App, PluginSettingTab, Setting } from 'obsidian';
import type ClaudeVaultChat from './main';

export interface Settings {
	placed: boolean; // pane was placed under the File Explorer on first run
	approvalMode: 'ask' | 'auto';
	allowBash: boolean;
	allowWeb: boolean;
	autoOpen: 'off' | 'reuse' | 'new';
}

export const DEFAULT_SETTINGS: Settings = {
	placed: false,
	approvalMode: 'ask',
	allowBash: false,
	allowWeb: false,
	autoOpen: 'reuse',
};

export class ClaudeSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: ClaudeVaultChat,
	) {
		super(app, plugin);
	}

	display() {
		const { containerEl, plugin } = this;
		const s = plugin.settings;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Approval mode')
			.setDesc('Reading and searching notes never asks. Writes to .obsidian/, .git/ and .claude/, and anything outside the vault, are always blocked.')
			.addDropdown((d) =>
				d
					.addOptions({ ask: 'Ask before edits', auto: 'Auto-approve edits' })
					.setValue(s.approvalMode)
					.onChange(async (v) => {
						s.approvalMode = v as Settings['approvalMode'];
						await plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Open notes Claude edits')
			.setDesc('Shows each note as Claude edits or creates it, without moving your cursor out of the chat.')
			.addDropdown((d) =>
				d
					.addOptions({ off: 'Off', reuse: 'Reuse one tab', new: 'New tab each time' })
					.setValue(s.autoOpen)
					.onChange(async (v) => {
						s.autoOpen = v as Settings['autoOpen'];
						await plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setHeading().setName('Extra tools');
		new Setting(containerEl)
			.setName('Allow shell commands (Bash)')
			.setDesc('Always asks first, even with auto-approve. Commands are not confined to the vault.')
			.addToggle((t) =>
				t.setValue(s.allowBash).onChange(async (v) => {
					s.allowBash = v;
					await plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName('Allow web access')
			.setDesc('WebFetch and WebSearch. Always asks first.')
			.addToggle((t) =>
				t.setValue(s.allowWeb).onChange(async (v) => {
					s.allowWeb = v;
					await plugin.saveSettings();
				}),
			);
	}
}
