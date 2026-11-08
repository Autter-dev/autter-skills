'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { availableSkills, installSkills } = require('../lib/install.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'autter-skills-install-'));

test('finds every skill folder shipped in the package', () => {
	const skills = availableSkills();
	assert.ok(skills.includes('otel-node-style'));
	assert.ok(skills.every((name) => fs.existsSync(path.join(__dirname, '..', name, 'SKILL.md'))));
});

test('copies whole skill folders, including nested files', () => {
	const dir = path.join(tmp(), '.agents/skills');
	const result = installSkills({ names: ['otel-node-style'], targets: [{ dir, labels: ['x'] }] });
	assert.equal(result.ok, true);
	assert.ok(fs.existsSync(path.join(dir, 'otel-node-style/SKILL.md')));
	assert.ok(fs.existsSync(path.join(dir, 'otel-node-style/references/error-catalog.md')));
});

test('reinstalling replaces the old copy and drops files that no longer exist', () => {
	const dir = path.join(tmp(), 'skills');
	const targets = [{ dir, labels: ['x'] }];
	installSkills({ names: ['otel-edge-style'], targets });
	const stale = path.join(dir, 'otel-edge-style/stale.md');
	fs.writeFileSync(stale, 'old');
	assert.equal(installSkills({ names: ['otel-edge-style'], targets }).ok, true);
	assert.equal(fs.existsSync(stale), false);
});

test('reports the folder it could not write to', () => {
	const blocker = path.join(tmp(), 'file');
	fs.writeFileSync(blocker, '');
	const result = installSkills({ names: ['otel-edge-style'], targets: [{ dir: path.join(blocker, 'skills'), labels: ['x'] }] });
	assert.equal(result.ok, false);
	assert.match(result.dir, /skills$/);
});
