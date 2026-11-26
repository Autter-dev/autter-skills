'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
	MCP_URL,
	MCP_DOCS_URL,
	MCP_SERVER_NAME,
	MCP_ENTRIES,
	MCP_FILES,
	MCP_AGENT_LABELS,
} = require('./config.js');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The config files this install can write: one per chosen agent that has a
// known project-level MCP file. Other agents are never written.
function writableConfigs(agentIds) {
	const seen = new Set();
	const out = [];
	for (const id of agentIds) {
		if (!MCP_FILES[id] || seen.has(id)) continue;
		seen.add(id);
		out.push({ agent: id, label: MCP_AGENT_LABELS[id], file: MCP_FILES[id], entry: MCP_ENTRIES[id] });
	}
	return out;
}

// The JSON a user can paste into a config file by hand.
function snippetFor(agentId) {
	return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: MCP_ENTRIES[agentId] } });
}

// Lines telling the user how to add the server themselves, only for the chosen agents.
function manualInstructions(agentIds) {
	const lines = [];
	if (agentIds.includes('claude-code')) lines.push(`Claude Code: claude mcp add --transport http ${MCP_SERVER_NAME} ${MCP_URL}`);
	if (agentIds.includes('cursor')) lines.push(`Cursor: add ${snippetFor('cursor')} to ${MCP_FILES.cursor}`);
	if (agentIds.length === 0 || agentIds.some((id) => !MCP_FILES[id])) {
		lines.push(`Other agents: add the MCP server ${MCP_URL} (${MCP_DOCS_URL})`);
	}
	return lines;
}

// Pure merge. `text` is the current file content, or null when the file is missing.
// Returns { status: 'added', text } | { status: 'present' } | { status: 'invalid', message }.
function mergeConfig(text, entry) {
	if (text === null) {
		return { status: 'added', text: `${JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: entry } }, null, 2)}\n` };
	}
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		return { status: 'invalid', message: 'not valid JSON' };
	}
	if (!isPlainObject(data)) return { status: 'invalid', message: 'top level is not an object' };
	if (data.mcpServers !== undefined && !isPlainObject(data.mcpServers)) {
		return { status: 'invalid', message: 'mcpServers is not an object' };
	}
	if (data.mcpServers && Object.prototype.hasOwnProperty.call(data.mcpServers, MCP_SERVER_NAME)) {
		return { status: 'present' };
	}
	data.mcpServers = { ...(data.mcpServers || {}), [MCP_SERVER_NAME]: entry };
	return { status: 'added', text: `${JSON.stringify(data, null, 2)}\n` };
}

// Writes the MCP config for each chosen agent that has one, in a project folder.
// Never writes anything when `global` is true. Returns [{ file, agent, status, message? }].
function writeMcpConfigs({ agents, global = false, cwd = process.cwd() }) {
	if (global) return [];
	const results = [];
	for (const cfg of writableConfigs(agents)) {
		const abs = path.join(cwd, ...cfg.file.split('/'));
		const base = { file: cfg.file, agent: cfg.agent };
		try {
			let current = null;
			try {
				current = fs.readFileSync(abs, 'utf8');
			} catch (err) {
				if (err.code !== 'ENOENT') throw err;
			}
			const merged = mergeConfig(current, cfg.entry);
			if (merged.status !== 'added') {
				results.push({ ...base, ...merged });
				continue;
			}
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, merged.text);
			results.push({ ...base, status: 'added' });
		} catch (err) {
			results.push({ ...base, status: 'error', message: err.message });
		}
	}
	return results;
}

module.exports = { writableConfigs, snippetFor, manualInstructions, mergeConfig, writeMcpConfigs };
