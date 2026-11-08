'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isSupported, nodeMajor, unsupportedMessage } = require('../lib/node-check.js');

test('accepts Node 18 and newer', () => {
	for (const v of ['18.0.0', '18.20.8', 'v20.11.1', '22.20.0', '26.11.0']) assert.equal(isSupported(v), true, v);
});

test('rejects anything older than 18', () => {
	for (const v of ['0.10.48', '12.22.12', '16.20.2', '17.9.1', '', 'nonsense']) assert.equal(isSupported(v), false, v);
});

test('parses the major from versions with or without a leading v', () => {
	assert.equal(nodeMajor('v18.1.0'), 18);
	assert.equal(nodeMajor('20.12.0'), 20);
});

test('the message names the running version and what to do', () => {
	const message = unsupportedMessage('16.20.2');
	assert.match(message, /needs Node 18 or newer/);
	assert.match(message, /Node 16\.20\.2/);
	assert.match(message, /nodejs\.org/);
});
