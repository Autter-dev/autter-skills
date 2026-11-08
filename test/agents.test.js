'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detectAgents } = require('../lib/agents.js');

function fakeHome(dirs) {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'autter-skills-home-'));
	for (const dir of dirs) fs.mkdirSync(path.join(home, dir), { recursive: true });
	return home;
}

test('detects agents by their home folders', () => {
	const home = fakeHome(['.claude', '.cursor']);
	assert.deepEqual(detectAgents({}, home).map((a) => a.id), ['claude-code', 'cursor']);
});

test('detects nothing in an empty home', () => {
	assert.deepEqual(detectAgents({}, fakeHome([])), []);
});

test('honours CODEX_HOME and CLAUDE_CONFIG_DIR', () => {
	const home = fakeHome(['elsewhere/codex', 'elsewhere/claude']);
	const env = { CODEX_HOME: path.join(home, 'elsewhere/codex'), CLAUDE_CONFIG_DIR: path.join(home, 'elsewhere/claude') };
	assert.deepEqual(detectAgents(env, home).map((a) => a.id), ['claude-code', 'codex']);
});

test('merges agents that share a folder and splits the ones that do not', () => {
	const home = fakeHome([]);
	const cwd = path.join(home, 'repo');
	const { targets, unknown } = require('../lib/agents.js').resolveTargets(['claude-code', 'cursor', 'codex'], { cwd, env: {}, home });
	assert.deepEqual(unknown, []);
	assert.deepEqual(targets, [
		{ dir: path.join(cwd, '.claude/skills'), labels: ['Claude Code'] },
		{ dir: path.join(cwd, '.agents/skills'), labels: ['Cursor', 'Codex'] },
	]);
});

test('global installs use each agent home folder', () => {
	const home = fakeHome([]);
	const { targets } = require('../lib/agents.js').resolveTargets(['claude-code', 'universal'], { global: true, env: {}, home });
	assert.deepEqual(targets.map((t) => t.dir), [path.join(home, '.claude/skills'), path.join(home, '.agents/skills')]);
});

test('reports ids it does not know', () => {
	const { unknown } = require('../lib/agents.js').resolveTargets(['nope'], { env: {}, home: fakeHome([]) });
	assert.deepEqual(unknown, ['nope']);
});
