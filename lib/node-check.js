'use strict';

// Deliberately plain ES5: this file must load on any Node, so the version
// check can run and explain itself before anything newer is required.

var MIN_MAJOR = 18;

function nodeMajor(version) {
	var match = /^v?(\d+)/.exec(String(version));
	return match ? parseInt(match[1], 10) : 0;
}

function isSupported(version) {
	return nodeMajor(version) >= MIN_MAJOR;
}

function unsupportedMessage(version) {
	return (
		'\nautter skills needs Node ' + MIN_MAJOR + ' or newer. You are on Node ' + String(version).replace(/^v/, '') + '.\n\n' +
		'  Upgrade at https://nodejs.org (or with nvm: nvm install ' + MIN_MAJOR + '),\n' +
		'  then run the same command again.\n\n'
	);
}

module.exports = {
	MIN_MAJOR: MIN_MAJOR,
	nodeMajor: nodeMajor,
	isSupported: isSupported,
	unsupportedMessage: unsupportedMessage,
};
