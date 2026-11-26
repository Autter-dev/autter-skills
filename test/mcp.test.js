'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeConfig, writeMcpConfigs, manualInstructions, writableConfigs } = require('../lib/mcp.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'autter-skills-mcp-'));
const read = (cwd, file) => fs.readFileSync(path.join(cwd, file), 'utf8');
const URL = 'https://api.autter.dev/mcp';

test('creates both files with the exact shapes', () => {
	const cwd = tmp();
	const results = writeMcpConfigs({ agents: ['claude-code', 'cursor'], cwd });
	assert.deepEqual(results.map((r) => [r.file, r.agent, r.status]), [
		['.mcp.json', 'claude-code', 'added'],
		['.cursor/mcp.json', 'cursor', 'added'],
	]);
	assert.equal(read(cwd, '.mcp.json'), `${JSON.stringify({ mcpServers: { autter: { type: 'http', url: URL } } }, null, 2)}\n`);
	assert.equal(read(cwd, '.cursor/mcp.json'), `${JSON.stringify({ mcpServers: { autter: { url: URL } } }, null, 2)}\n`);
});

test('merges into an existing file and keeps other servers and keys', () => {
	const cwd = tmp();
	const original = { other: { keep: [1, 2] }, mcpServers: { github: { type: 'http', url: 'https://example.com/mcp' } } };
	fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify(original));
	const [result] = writeMcpConfigs({ agents: ['claude-code'], cwd });
	assert.equal(result.status, 'added');
	assert.deepEqual(JSON.parse(read(cwd, '.mcp.json')), {
		other: { keep: [1, 2] },
		mcpServers: { github: original.mcpServers.github, autter: { type: 'http', url: URL } },
	});
	assert.ok(read(cwd, '.mcp.json').endsWith('\n'));
});

test('a second run is idempotent and leaves the bytes alone', () => {
	const cwd = tmp();
	writeMcpConfigs({ agents: ['claude-code', 'cursor'], cwd });
	const before = [read(cwd, '.mcp.json'), read(cwd, '.cursor/mcp.json')];
	const results = writeMcpConfigs({ agents: ['claude-code', 'cursor'], cwd });
	assert.deepEqual(results.map((r) => r.status), ['present', 'present']);
	assert.deepEqual([read(cwd, '.mcp.json'), read(cwd, '.cursor/mcp.json')], before);
});

test('an existing autter entry with a different url is left untouched', () => {
	const cwd = tmp();
	const text = '{"mcpServers":{"autter":{"url":"https://example.com/other"}}}';
	fs.writeFileSync(path.join(cwd, '.mcp.json'), text);
	const [result] = writeMcpConfigs({ agents: ['claude-code'], cwd });
	assert.equal(result.status, 'present');
	assert.equal(read(cwd, '.mcp.json'), text);
});

test('invalid JSON is reported and the file is not changed', () => {
	const cwd = tmp();
	const text = '{ "mcpServers": ';
	fs.writeFileSync(path.join(cwd, '.mcp.json'), text);
	const [result] = writeMcpConfigs({ agents: ['claude-code'], cwd });
	assert.equal(result.status, 'invalid');
	assert.equal(read(cwd, '.mcp.json'), text);
});

test('a top level that is not an object, or mcpServers that is not an object, is invalid', () => {
	for (const text of ['[]', '"x"', 'null', '{"mcpServers":[]}', '{"mcpServers":"x"}', '{"mcpServers":null}']) {
		const cwd = tmp();
		fs.writeFileSync(path.join(cwd, '.mcp.json'), text);
		const [result] = writeMcpConfigs({ agents: ['claude-code'], cwd });
		assert.equal(result.status, 'invalid', text);
		assert.equal(read(cwd, '.mcp.json'), text);
	}
});

test('global writes nothing', () => {
	const cwd = tmp();
	assert.deepEqual(writeMcpConfigs({ agents: ['claude-code', 'cursor'], global: true, cwd }), []);
	assert.deepEqual(fs.readdirSync(cwd), []);
});

test('only the configs for the chosen agents are written', () => {
	const cwd = tmp();
	const results = writeMcpConfigs({ agents: ['cursor', 'codex', 'universal'], cwd });
	assert.deepEqual(results.map((r) => r.file), ['.cursor/mcp.json']);
	assert.equal(fs.existsSync(path.join(cwd, '.mcp.json')), false);
	assert.deepEqual(writableConfigs(['codex']), []);
});

test('mergeConfig never writes a secret field', () => {
	const merged = mergeConfig(null, { type: 'http', url: URL });
	assert.doesNotMatch(merged.text, /header|token|key|authorization/i);
});

test('manual instructions cover only the chosen agents', () => {
	assert.deepEqual(manualInstructions(['claude-code']), [`Claude Code: claude mcp add --transport http autter ${URL}`]);
	assert.deepEqual(manualInstructions(['cursor']), [`Cursor: add {"mcpServers":{"autter":{"url":"${URL}"}}} to .cursor/mcp.json`]);
	assert.deepEqual(manualInstructions(['codex']), [`Other agents: add the MCP server ${URL} (https://docs.autter.dev/guides/mcp-setup)`]);
	assert.equal(manualInstructions(['claude-code', 'codex']).length, 2);
});
