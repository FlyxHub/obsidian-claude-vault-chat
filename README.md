# Claude Vault Chat

Claude Vault Chat is an Obsidian plugin that adds a Claude chat to your sidebar. It runs on the
[Claude Code](https://claude.com/claude-code) installation on your computer and uses the account
that you sign in to Claude Code with. Claude can read, search, create, and edit the notes in your
vault, and the plugin opens each note that Claude edits so that you can watch the change happen.

The plugin doesn't ask for an API key and never reads Claude Code's credentials. Claude Code
handles sign-in, and the plugin starts it for each message.

> **Note:** Claude Vault Chat is an independent project. It isn't made by, endorsed by, or
> affiliated with Anthropic. Claude and Claude Code are trademarks of Anthropic.

## Features

- **Chat in your sidebar.** The chat opens below the File Explorer and works like a conversation
  in the Claude Desktop app. Replies stream in as Claude writes them.
- **Works with your notes.** Claude reads, searches, creates, and edits Markdown notes. Links to
  notes in Claude's replies are clickable.
- **Asks before it edits.** Before Claude changes a note, a card shows the change and asks you to
  allow it once, allow it for the rest of the chat, or deny it.
- **Opens what Claude edits.** The note that Claude is editing opens in a tab, and your cursor
  stays in the chat.
- **Looks things up for you.** Optionally, Claude can use the connectors on your Claude account,
  such as Jira or Google Drive, and the skills and plugins that you use with Claude. Type `/` in
  the message box to pick a skill.
- **Stays inside your vault.** Claude can't read or change files outside the vault, and it can't
  change your Obsidian configuration folder, `.git/`, or `.claude/`.
- **Matches your theme.** The chat uses your Obsidian theme's colors and fonts.

## How it works

When you send a message, the plugin starts Claude Code through the
[Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/overview), with your vault as the
working folder. Claude Code sends your message, and the content of any notes that Claude reads, to
Anthropic and returns Claude's reply. The plugin checks every file that Claude tries to use and
blocks anything outside the vault.

## Before you begin

To use Claude Vault Chat, you need the following:

- Obsidian 1.7.2 or later, on desktop. The plugin doesn't run in Obsidian for mobile.
- A Claude Pro, Max, Team, or Enterprise plan, or an Anthropic Console account. The free Claude
  plan doesn't include Claude Code. Messages that you send in the chat count toward your plan's
  usage limits.
- Claude Code, installed and signed in. The next section shows how.
- Optional: on Windows, [Git for Windows](https://git-scm.com/downloads/win), if you want to let
  Claude run shell commands.

> **Note:** Claude Vault Chat is developed and tested on Windows 11. It's built to work on macOS
> and Linux, but it hasn't been tested there yet.

## Install Claude Code

If you already use Claude Code in a terminal, skip to [Install the plugin](#install-the-plugin).

1. Open a terminal:

   - **Windows:** open **PowerShell**.
   - **macOS:** open **Terminal**.
   - **Linux:** open your terminal app.

1. Run the installer for your operating system.

   On Windows, in PowerShell:

   ```powershell
   irm https://claude.ai/install.ps1 | iex
   ```

   On macOS, Linux, or WSL:

   ```bash
   curl -fsSL https://claude.ai/install.sh | bash
   ```

   For other ways to install Claude Code, such as Homebrew or WinGet, see
   [Set up Claude Code](https://code.claude.com/docs/en/setup).

1. Open a new terminal window, and then check that Claude Code is installed:

   ```bash
   claude --version
   ```

   The command prints a version number, such as `2.1.284 (Claude Code)`.

1. Start Claude Code:

   ```bash
   claude
   ```

1. Follow the prompts in your browser to sign in with your Claude account. After you sign in, you
   can close the terminal.

## Install the plugin

You can install Claude Vault Chat from Obsidian's community plugin directory, or with the BRAT
plugin.

### Install from the community plugin directory

1. In Obsidian, open **Settings > Community plugins**.
1. If you see **Turn on community plugins**, click it.
1. Click **Browse**, and then search for **Claude Vault Chat**.
1. Click **Claude Vault Chat**, and then click **Install**.
1. Click **Enable**.

Obsidian notifies you when an update is available. To update the plugin, open **Settings >
Community plugins**, and then click **Check for updates**.

If **Claude Vault Chat** doesn't appear in the directory, install it with BRAT instead.

### Install with BRAT

BRAT installs plugins directly from their GitHub repository and keeps them up to date.

1. In Obsidian, open **Settings > Community plugins**.
1. If you see **Turn on community plugins**, click it.
1. Click **Browse**, search for **BRAT**, and then install and enable it.
1. Open the command palette (<kbd>Ctrl</kbd>+<kbd>P</kbd>, or <kbd>Cmd</kbd>+<kbd>P</kbd> on
   macOS), and run **BRAT: Add a beta plugin for testing**.
1. Enter `FlyxHub/obsidian-claude-vault-chat`, and then click **Add Plugin**.
1. In **Settings > Community plugins**, turn on **Claude Vault Chat**.

## Set up the plugin

After you turn on the plugin, the **Claude** pane appears in the left sidebar, below the File
Explorer.

1. Open **Settings > Claude Vault Chat**.
1. Click **Test connection**.

   If the plugin finds Claude Code and you're signed in, the result looks like the following:

   ```text
   ✓ 2.1.284 (Claude Code) · logged in with Claude Pro
   ```

   The test doesn't send a message to Claude, so it doesn't use any of your plan's usage.

1. Optional: in **Model**, select the Claude model to use. **Default** uses the model that Claude
   Code chooses for your account.

If the test reports that Claude Code isn't found, see [Troubleshooting](#troubleshooting).

## Use the chat

### Send a message

1. Click the message box at the bottom of the **Claude** pane.
1. Enter your message. For example:

   ```text
   Summarize [[Project plan]] in three bullet points
   ```

1. Press <kbd>Enter</kbd> to send. To add a line break instead, press
   <kbd>Shift</kbd>+<kbd>Enter</kbd>.

While Claude works, the send button changes to a stop button. To stop the reply, click the stop
button. The chat keeps the conversation, so you can send another message after you stop a reply.

Each message continues the same conversation until you start a new chat. To start a new chat, click
the pen icon at the top of the pane.

> **Note:** A conversation lasts until you start a new chat or restart Obsidian. The plugin doesn't
> restore a conversation after Obsidian restarts.

### Approve edits

Before Claude creates or changes a note, a card appears in the chat. For edits to existing notes,
the card shows the old text in red and the new text in green. Choose one of the following:

- **Allow once:** allows this change.
- **Allow for this chat:** allows this kind of change, such as editing notes, until you start a new
  chat.
- **Deny:** blocks the change. Claude sees that you denied it and continues.

To let Claude edit without asking, open the menu on the left side below the message box, and then
select **Auto-approve edits**. Auto-approve applies only to notes inside your vault. Claude still
can't change files outside the vault or in protected folders.

### Choose a model

To change the model for your next message, open the menu on the right side below the message box,
and then select a model. The first time that you open the menu, select **Load available models** to
load the models that your account can use.

### Watch Claude's edits

When Claude edits a note, the note opens in a tab in the main area of Obsidian. Your cursor stays in
the chat, so you can keep typing. To change this behavior, see [Settings](#settings).

To have the File Explorer expand folders and scroll to the note that Claude opened, click
**Auto-reveal current file** at the top of the File Explorer.

### Arrange the pane

- To collapse the pane to its title bar, click the arrow at the top left of the pane. To expand the
  pane, click the arrow again.
- To give the chat more room, open the command palette and run **Claude Vault Chat: Move chat to
  right sidebar**.
- To bring the pane back after you close it, click the Claude icon in the left ribbon, or run
  **Claude Vault Chat: Open or focus chat**.

### Use connectors

Connectors let Claude look things up in other services, such as Jira, Google Drive, or Gmail, while
it works on your notes. The plugin can use the connectors on your Claude account and the MCP servers
that you added to Claude Code.

1. Add the connector to your Claude account at
   [claude.ai/settings/connectors](https://claude.ai/settings/connectors), and sign in to the
   service there.
1. In **Settings > Claude Vault Chat**, turn on **Connectors**.
1. Ask Claude to use the service. For example:

   ```text
   Find the open Jira issues about onboarding and list them in [[Onboarding]]
   ```

Claude asks before each connector action, such as a search. To let Claude repeat an action without
asking, click **Allow for this chat**.

To turn a single connector off or on, click the plug button below the message box, and then select
the connector. The number on the button shows how many connectors are on. If a connector shows
**sign in**, you need to sign in to that service:

- For a connector from your Claude account, click it to open your connector settings on claude.ai.
- For an MCP server that you added to Claude Code, run `claude` in a terminal, and then use `/mcp`.

After you add or remove a connector, click the plug button, and then select **Refresh**.

### Use skills and plugins

Skills give Claude instructions and tools for specific tasks, such as creating a Word document. The
plugin can use the skills that you turned on at claude.ai, and the skills and plugins that you
installed in Claude Code.

1. In **Settings > Claude Vault Chat**, turn on **Skills and plugins**.
1. In the message box, type `/`. A list of your skills appears.
1. To choose a skill, click it, or select it with the arrow keys and press <kbd>Enter</kbd>.
1. Add your request after the skill name, and then send the message. For example:

   ```text
   /docx Turn [[Project plan]] into a Word document
   ```

Claude can also choose a skill on its own when your request matches what the skill does.

Skills use the same tools and approvals as the rest of the chat. A skill that runs scripts needs
**Allow shell commands**, and Claude asks before each command.

### Give Claude instructions for your vault

To give Claude standing instructions for a vault, create a note named `CLAUDE.md` in the vault's top
folder. For example, you can describe how you organize notes, which tags you use, or how you like
notes to be formatted. Claude reads `CLAUDE.md` when a chat starts. To apply changes to the file,
start a new chat.

## Settings

To change these settings, open **Settings > Claude Vault Chat**.

| Setting | Default | Description |
| --- | --- | --- |
| **Executable** | Empty | The path to the Claude Code program. Leave it empty to find Claude Code automatically. **Test connection** checks the path and your sign-in. |
| **Model** | **Default** | The Claude model for new messages. This setting is also in the menu below the message box. |
| **Approval mode** | **Ask before edits** | Whether Claude asks before it creates or edits notes. This setting is also in the menu below the message box. |
| **Allow shell commands (Bash)** | Off | Lets Claude run shell commands. Claude always asks first. On Windows, this setting requires Git for Windows. |
| **Allow web access** | Off | Lets Claude fetch web pages and search the web. Claude always asks first. |
| **Connectors** | Off | Lets Claude use the connectors on your Claude account and the MCP servers that you added to Claude Code. Claude always asks first. To turn single connectors off, use the plug button below the message box. |
| **Skills and plugins** | Off | Loads your Claude Code skills and plugins, and the skills that you turned on at claude.ai. Type `/` in the message box to use one. |
| **Open notes Claude edits** | **Reuse one tab** | How edited notes open: in one tab that the plugin reuses, in a new tab each time, or not at all. |

## Security and privacy

### What Claude can access

- **Your vault, and nothing else.** The plugin checks every file that Claude tries to read, search,
  or change. It follows shortcuts and symbolic links to their real location, and it blocks any path
  outside the vault.
- **Protected folders.** Claude can read but never change your Obsidian configuration folder
  (`.obsidian/` by default), `.git/`, and `.claude/`.
- **Edits need your approval.** By default, Claude asks before it creates or changes a note.
- **Shell commands, web access, and connectors are off.** When you turn them on, Claude asks before
  each use.

> **Caution:** Shell commands aren't limited to your vault. A shell command can read or change any
> file that your user account can access. Turn on **Allow shell commands** only if you need it, and
> review each command before you allow it.

### Shared and downloaded vaults

The plugin doesn't load Claude Code settings from a vault's `.claude/settings.json` file, or MCP
servers from its `.mcp.json` file. These files can run commands and change where Claude Code
connects, so loading them from a vault that someone else made would be unsafe. The plugin reads only the vault's `CLAUDE.md` file, as
plain text instructions.

A `CLAUDE.md` file can still ask Claude to do things. If you open a vault that someone else made,
read its `CLAUDE.md` file before you chat in that vault, and keep **Approval mode** set to **Ask
before edits**.

### Your Claude Code configuration

By default, the plugin doesn't use your personal Claude Code settings, hooks, skills, plugins, or
MCP servers, including connectors from your Claude account. Each chat uses only the tools that the
plugin turns on. Two settings change this:

- **Connectors** loads the connectors on your Claude account, the MCP servers that you added to
  Claude Code, and the MCP servers that come with your Claude Code plugins. You sign in to each
  service through claude.ai or Claude Code. The plugin never sees those sign-ins.
- **Skills and plugins** loads your user-level Claude Code configuration (`~/.claude/`), including
  your settings, skills, plugins, and your plugins' hooks. Hooks run commands on your computer, as
  they do when you use Claude Code in a terminal, and they aren't limited to your vault. Turn on
  this setting only if you trust the plugins that you installed.

With either setting on, the plugin's own rules still apply:

- Every tool call goes through the vault check and your approval settings.
- Permission rules in your Claude Code settings or in a skill can't skip the approval cards.
- Skills can't run shell commands automatically when they load.
- A vault's own `.claude/` folder and `.mcp.json` file are never loaded.

### Data and storage

- **What's sent to Anthropic:** your messages, the content of notes that Claude reads or edits, and
  your vault's `CLAUDE.md` file. Claude Code sends this data under the terms of your Claude account.
- **What's sent to connected services:** when Claude uses a connector, the request goes to that
  service, and it can include text from your notes. Check each request before you allow it.
- **What's stored on your computer:** Claude Code saves a transcript of each conversation in your
  Claude Code configuration folder (`~/.claude/projects/`). The plugin stores its settings in your
  vault, in `.obsidian/plugins/claude-vault-chat/data.json`. The settings don't include any
  credentials.
- **What the plugin collects:** nothing. The plugin doesn't make network requests of its own and
  doesn't collect usage data.

## Troubleshooting

When a message fails, the chat explains what went wrong. To see Claude Code's own output, click
**Details**. To go to the plugin settings, click **Open settings**.

**Claude Code was not found.**
Obsidian doesn't always find the same programs as your terminal. In **Settings > Claude Vault Chat
\> Executable**, enter the full path to Claude Code. To find the path, run one of the following
commands in a terminal:

- Windows (PowerShell): `(Get-Command claude).Source`
- macOS and Linux: `which claude`

On Windows, enter the path to `claude.exe`. Paths that end in `.cmd` or `.ps1` don't work.

**Claude Code is not logged in.**
In a terminal, run `claude` and follow the prompts to sign in. Then send your message again.

**You've reached your Claude usage limit.**
The message shows when your limit resets. For details about your limits, see your plan on
[claude.ai](https://claude.ai).

**The selected model isn't available.**
Open the model menu below the message box, and select another model or **Default**.

**Shell commands need Git for Windows.**
Install [Git for Windows](https://git-scm.com/downloads/win), or turn off **Allow shell commands**.

**Typing `/` doesn't show any skills.**
Turn on **Skills and plugins** in the settings. The plugin loads your skills in the background
after Obsidian starts, which can take a few seconds. To load them again, click **Test connection**
in the settings.

**A connector is missing from the plug menu.**
Check that the connector is on your Claude account at
[claude.ai/settings/connectors](https://claude.ai/settings/connectors). Then click the plug button
and select **Refresh**.

**The Claude pane is missing.**
Click the Claude icon in the left ribbon, or open the command palette and run **Claude Vault Chat:
Open or focus chat**.

## Uninstall the plugin

1. In Obsidian, open **Settings > Community plugins**.
1. Next to **Claude Vault Chat**, click **Uninstall**.

Claude Code keeps the conversation transcripts in `~/.claude/projects/`. To remove them, delete the
folder for your vault in that location.

## Develop the plugin

### Build from source

To build the plugin, you need [Node.js](https://nodejs.org) 24 or later.

1. Clone the repository and install its dependencies:

   ```bash
   git clone https://github.com/FlyxHub/obsidian-claude-vault-chat.git
   cd obsidian-claude-vault-chat
   npm install
   ```

1. Build the plugin:

   ```bash
   npm run build
   ```

   The build checks the TypeScript types and writes `main.js` to the repository folder.

The repository has the following scripts:

| Command | Description |
| --- | --- |
| `npm run dev` | Rebuilds `main.js` each time that a source file changes. |
| `npm run build` | Checks types and creates a production build. |
| `npm test` | Runs the vault-boundary tests. |

### Test in a separate vault

To avoid changing your own notes while you develop, use a separate test vault. Link the vault's
plugin folder to your repository folder so that each build is available in the vault.

On Windows, in PowerShell:

```powershell
New-Item -ItemType Junction -Path "TEST_VAULT\.obsidian\plugins\claude-vault-chat" -Target "REPO_FOLDER"
```

On macOS and Linux:

```bash
ln -s "REPO_FOLDER" "TEST_VAULT/.obsidian/plugins/claude-vault-chat"
```

Replace the following:

- `TEST_VAULT`: the path to your test vault.
- `REPO_FOLDER`: the path to your clone of this repository.

After each build, turn the plugin off and on in Obsidian to load the new version.

### Project structure

| File | Contents |
| --- | --- |
| `src/main.ts` | The plugin: commands, pane placement, opening edited notes, and the connection check. |
| `src/chatView.ts` | The chat pane: messages, streaming, tool activity, approvals, and errors. |
| `src/claude.ts` | Starts Claude Code for each message and enforces the vault boundary. |
| `src/vaultPath.ts` | The checks that keep Claude inside the vault. |
| `src/settings.ts` | The settings tab. |
| `styles.css` | The chat pane's styles, based on your theme's colors. |
| `esbuild.config.mjs` | The build, including fixes that let the Claude Agent SDK run inside Obsidian. |

The Claude Agent SDK is built for Node.js, and three parts of it don't work in Obsidian's app
window. `esbuild.config.mjs` changes those parts when it builds the plugin. If an SDK update moves
them, the build fails with a message that names the change, so that a broken plugin isn't released.

### Release a new version

1. Update the version number in `manifest.json` and `package.json`, and add the new version to
   `versions.json` with the minimum Obsidian version that it supports.
1. Commit the change, and then create and push a tag with the same version number:

   ```bash
   git tag 1.0.1
   git push origin 1.0.1
   ```

   The tag must match the version in `manifest.json` exactly, without a `v` prefix.

1. On GitHub, open the release draft that the **Release** workflow created, review it, and then
   publish it.

## License

For license terms, see the [LICENSE](LICENSE) file.

The `main.js` file in each release includes the
[Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), which is
© Anthropic PBC. The SDK isn't covered by this project's license. Its use is subject to
[Anthropic's legal agreements](https://code.claude.com/docs/en/legal-and-compliance).
