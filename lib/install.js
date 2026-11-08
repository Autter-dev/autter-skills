'use strict';

const fs = require('node:fs');
const path = require('node:path');

// The skills ship inside this package, one folder each with a SKILL.md, so the
// install needs no network, no second tool and no particular Node version
// beyond this package's own.
const PACKAGE_ROOT = path.join(__dirname, '..');

function availableSkills(root = PACKAGE_ROOT) {
	return fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(root, entry.name, 'SKILL.md')))
		.map((entry) => entry.name)
		.sort();
}

// Copies each skill into each target folder, replacing an older copy so files
// removed from a skill do not linger. Returns the first failure, if any.
function installSkills({ names, targets, root = PACKAGE_ROOT }) {
	for (const target of targets) {
		try {
			fs.mkdirSync(target.dir, { recursive: true });
			for (const name of names) {
				const dest = path.join(target.dir, name);
				fs.rmSync(dest, { recursive: true, force: true });
				fs.cpSync(path.join(root, name), dest, { recursive: true });
			}
		} catch (err) {
			return { ok: false, dir: target.dir, message: err.message };
		}
	}
	return { ok: true };
}

module.exports = { PACKAGE_ROOT, availableSkills, installSkills };
