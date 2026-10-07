# Claude Vault Chat

A personal Obsidian plugin that puts a Claude chat in the sidebar, powered by the Claude Code you already have installed and logged in. Claude can read, search, create and edit notes in the current vault, and each note it edits opens so you can watch the change land.

It drives your local `claude.exe` through the [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview). Login is entirely Claude Code's job: the plugin has no API key field and never reads Claude's credential files.

## Requirements

- Obsidian 1.7.2 or later, desktop only (developed on 1.14.4, Windows 11).
- [Claude Code](https://claude.com/claude-code), installed and logged in: run `claude` in a terminal and use `/login` once.
- Git for Windows, only if you turn on shell commands.

## Install

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json` and `styles.css` into `<your vault>/.obsidian/plugins/claude-vault-chat/`, then enable **Claude Vault Chat** under Settings → Community plugins. Open **Settings → Claude Vault Chat** and click **Test connection** to check that Claude Code is found and logged in.

## Using it

- **The pane** opens on first run in the left sidebar, stacked under the File Explorer. The chevron in its header collapses it to a single row. Drag the divider above it to resize.
- **Commands** (Ctrl+P): *Open or focus chat* (also the ribbon's bot icon) and *Move chat to right sidebar*. To move it back, close the pane and click the ribbon icon.
- **Chatting:** the pane works like a Claude Desktop chat, in your Obsidian theme's colors (only the send button and the ✻ spark keep Claude's clay). Enter sends and Shift+Enter adds a new line. While Claude works, the send button becomes **Stop**, which interrupts the reply and keeps the conversation. The pen icon in the header starts a **New chat**. A conversation lasts until New chat. It isn't restored after restarting Obsidian.
- **Below the message box:** the left menu switches the approval mode, and the right menu picks the model. Choose *Load available models* the first time. Copy a reply with the icon under it.
- **Tool activity** shows as compact rows, such as "Reading Onboarding.md". Click a row to see the details. `[[Links]]` in replies are clickable.
- **Approvals:** before an edit, an inline card offers **Allow once**, **Allow for this chat** (that tool, until New chat) or **Deny**. Edit cards show the old text in red and the new text in green.
- **Auto-open:** the note Claude is editing opens in one reused tab, and your cursor stays in the chat. To have the File Explorer expand folders and scroll to that note, turn on the explorer's own **Auto-reveal current file** button in its header.

## Settings

| Setting | Default | Notes |
| --- | --- | --- |
| Executable | auto-detect | Path to `claude.exe`. Auto-detect checks `~\.local\bin\claude.exe`, then `where claude`. `.cmd` shims can't be used. **Test connection** shows the version, login and models, without using any of your usage. |
| Model | Default | Also in the menu below the message box. The list comes from Test connection. Takes effect from the next message. |
| Approval mode | Ask before edits | Also in the menu below the message box. *Auto-approve edits* skips the cards for Edit/Write. The vault boundary still applies. |
| Allow shell commands (Bash) | Off | Always asks, even with auto-approve. |
| Allow web access | Off | WebFetch and WebSearch. Always asks. |
| Open notes Claude edits | Reuse one tab | Or *New tab each time*, or *Off*. |

## Security model

- **Vault boundary.** Claude's working directory is the vault root. A `PreToolUse` hook checks every file tool call, including ones Claude Code would otherwise approve on its own, and blocks it if:
  - the path resolves outside the vault, after following symlinks and junctions and expanding `~`;
  - a Glob/Grep pattern escapes the vault (`..` or an absolute path);
  - it writes into `.obsidian/` (the vault's config folder), `.git/` or `.claude/`.

  If the check itself fails, the call is blocked. The logic is in `src/vaultPath.ts`, with tests in `src/vaultPath.test.ts`.
- **Why `.claude/` is protected.** The plugin loads the vault's `.claude/settings.json`, and that file can define hooks that run commands. If Claude could write it, Claude could escape the vault.
- **Shell commands are not confined.** The hook can't tell what a shell command will touch. That's why Bash is off by default and always asks when on.
- **Configuration isolation.**
  - Each session loads only the vault's `CLAUDE.md` and `.claude/settings.json`.
  - Your global `~/.claude` settings, hooks, plugins and MCP servers are not loaded, and neither are your claude.ai connectors.
  - Hooks and permission rules you put in the vault's `.claude/settings.json` *do* apply. An allow rule there can skip the approval card, but it can't get past the vault boundary.

## Troubleshooting

When something fails, the chat shows a plain-language message. Use **Details** to see Claude Code's raw output and **Open settings** to jump to the settings.

- **Claude Code was not found.** Install it, or set **Executable** to the full path of `claude.exe`. Obsidian often doesn't see your terminal's PATH, so a path that works in the terminal may still need setting here.
- **Not logged in.** Run `claude` in a terminal and use `/login`. Then try again, or click Test connection.
- **Usage limit reached.** The message shows when your limit resets.
- **Shell commands need Git for Windows.** Install Git for Windows, or turn off *Allow shell commands*.
- **Model isn't available.** Pick another model, or *Default*, in settings.

## Development

```bash
npm install
npm run dev      # rebuild main.js on change
npm run build    # typecheck + production build
npm test         # vault-boundary tests (Node 24 runs the TypeScript directly)
```

For development, link the plugin folder of a **separate test vault** to this repo instead of copying files (PowerShell):

```powershell
New-Item -ItemType Junction -Path "<test vault>\.obsidian\plugins\claude-vault-chat" -Target "<this repo>"
```

After a build, turn the plugin off and on in Obsidian to reload it.

**How it fits together**
- `src/claude.ts` launches each message as one Claude Code process that resumes the session. Each message takes a few seconds to start.
- `src/chatView.ts` is the chat pane: streaming, tool rows, approvals, errors and auto-open.
- `src/main.ts` holds the plugin, commands and pane placement. `src/settings.ts` is the settings tab.

**SDK patches.** The Agent SDK targets plain Node, and three spots break in Obsidian's Electron window. `esbuild.config.mjs` patches them at build time, and the build fails loudly if an SDK update moves them:
- `import.meta.url` (used when the SDK loads);
- `.unref()` on browser timers;
- `setMaxListeners` called with a browser AbortSignal.

`src/claude.ts` also uses a custom process spawn, because Node's `spawn()` rejects the browser AbortSignal. After updating `@anthropic-ai/claude-agent-sdk`, run `npm run build` and fix any patch it reports.
