'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { GROUPS } = require('../lib/config.js');

const root = path.join(__dirname, '..');
const repoSkills = fs
	.readdirSync(root, { withFileTypes: true })
	.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
	.map((entry) => entry.name)
	.sort();
const listed = GROUPS.flatMap((group) => group.skills.map(([name]) => name)).sort();

test('every skill folder in the repo is in the install summary, once', () => {
	assert.deepEqual(listed, repoSkills);
});

test('every listed skill has a one-line description', () => {
	for (const group of GROUPS) for (const [name, blurb] of group.skills) assert.ok(blurb.length > 0, name);
});
