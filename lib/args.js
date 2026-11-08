'use strict';

// Skill and agent ids become folder names, so only plain identifiers are accepted.
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function parseArgs(argv) {
	const opts = {
		agents: [],
		skills: [],
		global: false,
		yes: false,
		list: false,
		help: false,
		version: false,
	};
	const errors = [];

	// Reads the values after a flag: either "--agent a b c" or "--agent=a".
	const takeValues = (flag, inline, i, into) => {
		const values = inline !== undefined ? [inline] : [];
		if (inline === undefined) {
			while (i + 1 < argv.length && !argv[i + 1].startsWith('-')) values.push(argv[++i]);
		}
		if (values.length === 0) errors.push(`${flag} needs a value`);
		for (const value of values) {
			if (ID.test(value)) into.push(value);
			else errors.push(`${flag}: "${value}" is not a valid name`);
		}
		return i;
	};

	for (let i = 0; i < argv.length; i++) {
		const eq = argv[i].indexOf('=');
		const flag = eq > 0 && argv[i].startsWith('--') ? argv[i].slice(0, eq) : argv[i];
		const inline = flag !== argv[i] ? argv[i].slice(eq + 1) : undefined;

		switch (flag) {
			case '-a':
			case '--agent':
				i = takeValues(flag, inline, i, opts.agents);
				break;
			case '-s':
			case '--skill':
				i = takeValues(flag, inline, i, opts.skills);
				break;
			case '-g':
			case '--global':
				opts.global = true;
				break;
			case '-y':
			case '--yes':
				opts.yes = true;
				break;
			case '-l':
			case '--list':
				opts.list = true;
				break;
			case '-h':
			case '--help':
				opts.help = true;
				break;
			case '-v':
			case '--version':
				opts.version = true;
				break;
			default:
				errors.push(`Unknown option: ${argv[i]}`);
		}
	}

	return { opts, errors };
}

module.exports = { parseArgs };
