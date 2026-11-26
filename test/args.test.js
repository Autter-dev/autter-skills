'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/args.js');

test('collects several agents and skills after one flag', () => {
	const { opts, errors } = parseArgs(['--agent', 'claude-code', 'cursor', '-s', 'otel-node-style', '-g', '-y']);
	assert.deepEqual(errors, []);
	assert.deepEqual(opts.agents, ['claude-code', 'cursor']);
	assert.deepEqual(opts.skills, ['otel-node-style']);
	assert.equal(opts.global, true);
	assert.equal(opts.yes, true);
});

test('accepts --flag=value', () => {
	const { opts } = parseArgs(['--agent=codex', '--skill=otel-edge-style']);
	assert.deepEqual(opts.agents, ['codex']);
	assert.deepEqual(opts.skills, ['otel-edge-style']);
});

test('rejects unknown flags and names that are not plain identifiers', () => {
	const { errors } = parseArgs(['--nope', '--agent', 'a;rm -rf /', '--skill']);
	assert.equal(errors.length, 3);
	assert.match(errors[0], /Unknown option: --nope/);
});

test('parses --mcp and --no-mcp', () => {
	assert.equal(parseArgs(['--mcp']).opts.mcp, true);
	assert.equal(parseArgs(['--no-mcp']).opts.noMcp, true);
	const none = parseArgs([]);
	assert.equal(none.opts.mcp, false);
	assert.equal(none.opts.noMcp, false);
});

test('--mcp with --no-mcp is an error', () => {
	const { errors } = parseArgs(['--mcp', '--no-mcp']);
	assert.deepEqual(errors, ["--mcp and --no-mcp can't be used together"]);
});
