#!/usr/bin/env node
'use strict';

// Plain ES5 on purpose: check the Node version before loading anything modern.
var nodeCheck = require('../lib/node-check.js');

if (!nodeCheck.isSupported(process.versions.node)) {
	process.stderr.write(nodeCheck.unsupportedMessage(process.versions.node));
	process.exit(1);
}

require('../lib/cli.js')
	.main(process.argv.slice(2))
	.then(function (code) {
		process.exit(code);
	});
