import { App, PluginSettingTab, Setting } from 'obsidian';
import { findClaude } from './claude';
import type ClaudeVaultChat from './main';

export interface Settings {
	placed: boolean; // pane was placed under the File Explorer on first run
	claudePath: string; // '' = auto-detect
	model: string; // '' = Claude Code's default
	models: { value: string; displayName: string }[]; // cached by "Test connection"
	approvalMode: 'ask' | 'auto';
	allowBash: boolean;
	allowWeb: boolean;
	autoOpen: 'off' | 'reuse' | 'new';
}

export const DEFAULT_SETTINGS: Settings = {
	placed: false,
	claudePath: '',
	model: '',
	models: [],
	approvalMode: 'ask',
	allowBash: false,
	allowWeb: false,
	autoOpen: 'reuse',
};

export class ClaudeSettingTab extends PluginSettingTab {
	private status = ''; // last "Test connection" result, kept across re-renders

	constructor(
		app: App,
		private plugin: ClaudeVaultChat,
	) {
		super(app, plugin);
	}

	display() {
		const { containerEl, plugin } = this;
		const s = plugin.settings;
		const save = () => plugin.saveSettings();
		containerEl.empty();

		new Setting(containerEl).setHeading().setName('Claude Code');
		const detected = findClaude();
		new Setting(containerEl)
			.setName('Executable')
			.setDesc(`Path to claude.exe. Leave empty to auto-detect (${detected ? `found ${detected}` : 'not found'}).`)
			.addText((t) =>
				t
					.setPlaceholder(detected ?? 'C:\\Users\\you\\.local\\bin\\claude.exe')
					.setValue(s.claudePath)
					.onChange(async (v) => {
						s.claudePath = v.trim().replace(/^"(.*)"$/, '$1'); // Explorer's "Copy as path" adds quotes
						await save();
					}),
			)
			.addButton((b) => b.setButtonText('Test connection').onClick(() => this.test(b.buttonEl)));
		if (this.status) containerEl.createDiv({ cls: 'claude-test-status setting-item-description', text: this.status });

		new Setting(containerEl)
			.setName('Model')
			.setDesc(s.models.length ? 'Used from the next message on.' : 'Run "Test connection" to load the models your account can use.')
			.addDropdown((d) => {
				d.addOption('', 'Default');
				for (const m of s.models) if (m.value !== 'default') d.addOption(m.value, m.displayName);
				if (s.model && !s.models.some((m) => m.value === s.model)) d.addOption(s.model, s.model);
				d.setValue(s.model).onChange(async (v) => {
					s.model = v;
					await save();
				});
			});

		new Setting(containerEl).setHeading().setName('Permissions');
		new Setting(containerEl)
			.setName('Approval mode')
			.setDesc('Reading and searching notes never asks. Writes to .obsidian/, .git/ and .claude/, and anything outside the vault, are always blocked.')
			.addDropdown((d) =>
				d
					.addOptions({ ask: 'Ask before edits', auto: 'Auto-approve edits' })
					.setValue(s.approvalMode)
					.onChange(async (v) => {
						s.approvalMode = v as Settings['approvalMode'];
						await save();
					}),
			);
		new Setting(containerEl)
			.setName('Allow shell commands (Bash)')
			.setDesc('Always asks first, even with auto-approve. Commands are not confined to the vault. Needs Git for Windows.')
			.addToggle((t) =>
				t.setValue(s.allowBash).onChange(async (v) => {
					s.allowBash = v;
					await save();
				}),
			);
		new Setting(containerEl)
			.setName('Allow web access')
			.setDesc('WebFetch and WebSearch. Always asks first.')
			.addToggle((t) =>
				t.setValue(s.allowWeb).onChange(async (v) => {
					s.allowWeb = v;
					await save();
				}),
			);

		new Setting(containerEl).setHeading().setName('Notes');
		new Setting(containerEl)
			.setName('Open notes Claude edits')
			.setDesc('Shows each note as Claude edits or creates it, without moving your cursor out of the chat.')
			.addDropdown((d) =>
				d
					.addOptions({ off: 'Off', reuse: 'Reuse one tab', new: 'New tab each time' })
					.setValue(s.autoOpen)
					.onChange(async (v) => {
						s.autoOpen = v as Settings['autoOpen'];
						await save();
					}),
			);
	}

	private async test(button: HTMLButtonElement) {
		button.disabled = true;
		button.setText('Testing…');
		this.status = await this.plugin.checkConnection();
		this.display();
	}
}
