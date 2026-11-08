'use strict';

// Brand accent. One constant so the colour is easy to change.
const ACCENT = '36';

function makeUi(stream = process.stdout, env = process.env) {
	const color =
		env.NO_COLOR === undefined && (env.FORCE_COLOR !== undefined ? env.FORCE_COLOR !== '0' : Boolean(stream.isTTY));
	const wrap = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : String(text));
	const paint = {
		accent: wrap(ACCENT),
		bold: wrap('1'),
		dim: wrap('2'),
		green: wrap('32'),
		yellow: wrap('33'),
		red: wrap('31'),
	};
	const write = (text = '') => stream.write(`${text}\n`);

	return { paint, write };
}

module.exports = { makeUi };
