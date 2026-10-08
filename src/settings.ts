import { App, PluginSettingTab, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { findClaude } from './claude';
import type VaultSidekick from './main';

export interface Settings {
	placed: boolean; // pane was placed under the File Explorer on first run
	claudePath: string; // '' = auto-detect
	model: string; // '' = Claude Code's default
	models: { value: string; displayName: string }[]; // cached by "Test connection"
	approvalMode: 'ask' | 'auto';
	allowBash: boolean;
	allowWeb: boolean;
	connectors: boolean;
	disabledConnectors: string[]; // switched off from the composer's connector menu
	skills: boolean;
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
	connectors: true,
	disabledConnectors: [],
	skills: true,
	autoOpen: 'reuse',
};

export class ClaudeSettingTab extends PluginSettingTab {
	private status = ''; // last "Test connection" result, kept across re-renders

	constructor(
		app: App,
		private plugin: VaultSidekick,
	) {
		super(app, plugin);
	}

	async setControlValue(key: string, value: unknown) {
		Object.assign(this.plugin.settings, { [key]: value });
		await this.plugin.saveSettings(); // also refreshes the composer chips that mirror these settings
		// Both change what Claude Code loads, so reload the connector list and the / menu.
		if (key === 'connectors' || key === 'skills') void this.plugin.checkConnection();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = this.plugin.settings;
		const models: Record<string, string> = { '': 'Default' };
		for (const m of s.models) if (m.value !== 'default') models[m.value] = m.displayName;
		if (s.model && !(s.model in models)) models[s.model] = s.model;
		const toggle = (key: keyof Settings, name: string, desc: string): SettingDefinition => ({ name, desc, control: { type: 'toggle', key } });

		return [
			{
				type: 'group',
				heading: 'Claude Code',
				items: [
					{
						name: 'Executable',
						desc: 'Path to claude.exe. Leave empty to auto-detect.',
						// Detection can shell out to `where`, so it runs when the tab is shown, not when it's indexed for search.
						render: (setting) => {
							const detected = findClaude();
							setting
								.setDesc(
									createFragment((f) => {
										f.appendText(`Path to claude.exe. Leave empty to auto-detect (${detected ? `found ${detected}` : 'not found'}).`);
										if (this.status) f.createDiv({ text: this.status });
									}),
								)
								.addText((t) =>
									t
										.setPlaceholder(detected ?? 'C:\\Users\\you\\.local\\bin\\claude.exe')
										.setValue(s.claudePath)
										.onChange((v) => void this.setControlValue('claudePath', v.trim().replace(/^"(.*)"$/, '$1'))), // Explorer's "Copy as path" adds quotes
								)
								.addButton((b) =>
									b.setButtonText('Test connection').onClick(async () => {
										b.setDisabled(true).setButtonText('Testing…');
										this.status = await this.plugin.checkConnection();
										this.update(); // re-renders with the result and the refreshed model list
									}),
								);
						},
					},
					{
						name: 'Model',
						desc: s.models.length ? 'Used from the next message on.' : 'Run "Test connection" to load the models your account can use.',
						control: { type: 'dropdown', key: 'model', options: models },
					},
				],
			},
			{
				type: 'group',
				heading: 'Permissions',
				items: [
					{
						name: 'Approval mode',
						desc: `Reading and searching notes never asks. Writes to ${this.app.vault.configDir}/, .git/ and .claude/, and anything outside the vault, are always blocked.`,
						control: { type: 'dropdown', key: 'approvalMode', options: { ask: 'Ask before edits', auto: 'Auto-approve edits' } },
					},
					toggle('allowBash', 'Allow shell commands (Bash)', 'Always asks first, even with auto-approve. Commands are not confined to the vault. Needs Git for Windows.'),
					toggle('allowWeb', 'Allow web access', 'WebFetch and WebSearch. Always asks first.'),
				],
			},
			{
				type: 'group',
				heading: 'Connectors and skills',
				items: [
					toggle(
						'connectors',
						'Connectors',
						'Lets Claude use the connectors on your Claude account (manage them at claude.ai, under Settings > Connectors) and MCP servers you added to Claude Code. Always asks first. Switch single connectors off with the plug button below the message box.',
					),
					toggle(
						'skills',
						'Skills and plugins',
						"Loads your Claude Code user setup (~/.claude): your skills and plugins, and the skills you turned on at claude.ai. Type / in the message box to use one. Plugin hooks run as they do in Claude Code. The vault's own .claude/ folder is never loaded.",
					),
				],
			},
			{
				type: 'group',
				heading: 'Notes',
				items: [
					{
						name: 'Open notes Claude edits',
						desc: 'Shows each note as Claude edits or creates it, without moving your cursor out of the chat.',
						control: { type: 'dropdown', key: 'autoOpen', options: { off: 'Off', reuse: 'Reuse one tab', new: 'New tab each time' } },
					},
				],
			},
		];
	}
}
