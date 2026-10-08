import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';

/**
 * Claude Code expands a /skill only at the very start of a message. For skills named later on
 * ("Write a page with /humanizer"), add a note asking Claude to load them with its Skill tool.
 */
export function withSkillNote(text: string, commands: SlashCommand[]): string {
	const names = new Set<string>();
	for (const m of text.matchAll(/(?:^|\s)\/([\w:-]+)/g)) {
		if (m.index === 0) continue; // at the start: Claude Code expands it itself
		const token = m[1]!.toLowerCase();
		const c = commands.find((c) => c.name.toLowerCase() === token || c.aliases?.some((a) => a.toLowerCase() === token));
		if (c) names.add(c.name);
	}
	if (!names.size) return text;
	return `${text}\n\n(The user picked these skills for this message: ${[...names].join(', ')}. Load each one with the Skill tool before you respond.)`;
}
