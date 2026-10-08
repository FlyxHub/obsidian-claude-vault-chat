// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { withSkillNote } from './skills.ts';

const commands: SlashCommand[] = [
	{ name: 'humanizer:humanizer', description: '', argumentHint: '', aliases: ['humanizer'] },
	{ name: 'docx', description: '', argumentHint: '' },
];

test('skills named mid-message get a note; aliases resolve to the full name', () => {
	const out = withSkillNote('Write a page with /humanizer, then /docx.', commands);
	assert.match(out, /^Write a page with \/humanizer, then \/docx\.\n\n/);
	assert.match(out, /humanizer:humanizer, docx\. Load each one/);
});

test('a skill at the start, unknown names and paths are left alone', () => {
	for (const text of ['/docx make a doc', 'see /usr/bin and/or /nothing', 'no skills here']) {
		assert.equal(withSkillNote(text, commands), text);
	}
});
