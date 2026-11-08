'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The agents people most often use. `project` is the skills folder inside a
// repository, `global` the one in the user's home. Detection is "the agent's
// config folder exists". Several agents read the shared `.agents/skills`
// folder, so they end up in one install target.
// Anything not listed can still be installed with `npx skills add Autter-dev/autter-skills`.
function agentTable(env = process.env, home = os.homedir()) {
	const configHome = (env.XDG_CONFIG_HOME || '').trim() || path.join(home, '.config');
	const claudeHome = (env.CLAUDE_CONFIG_DIR || '').trim() || path.join(home, '.claude');
	const codexHome = (env.CODEX_HOME || '').trim() || path.join(home, '.codex');
	const shared = '.agents/skills';
	return [
		{ id: 'claude-code', label: 'Claude Code', detect: claudeHome, project: '.claude/skills', global: path.join(claudeHome, 'skills') },
		{ id: 'codex', label: 'Codex', detect: codexHome, project: shared, global: path.join(codexHome, 'skills') },
		{ id: 'cursor', label: 'Cursor', detect: path.join(home, '.cursor'), project: shared, global: path.join(home, '.cursor', 'skills') },
		{ id: 'gemini-cli', label: 'Gemini CLI', detect: path.join(home, '.gemini'), project: shared, global: path.join(home, '.gemini', 'skills') },
		{ id: 'github-copilot', label: 'GitHub Copilot', detect: path.join(home, '.copilot'), project: shared, global: path.join(home, '.copilot', 'skills') },
		{ id: 'opencode', label: 'OpenCode', detect: path.join(configHome, 'opencode'), project: shared, global: path.join(configHome, 'opencode', 'skills') },
		{ id: 'amp', label: 'Amp', detect: path.join(configHome, 'amp'), project: shared, global: path.join(configHome, 'agents', 'skills') },
		{ id: 'cline', label: 'Cline', detect: path.join(home, '.cline'), project: shared, global: path.join(home, '.agents', 'skills') },
		{ id: 'windsurf', label: 'Windsurf', detect: path.join(home, '.codeium', 'windsurf'), project: '.windsurf/skills', global: path.join(home, '.codeium', 'windsurf', 'skills') },
		{ id: 'goose', label: 'Goose', detect: path.join(configHome, 'goose'), project: '.goose/skills', global: path.join(configHome, 'goose', 'skills') },
		{ id: 'roo', label: 'Roo Code', detect: path.join(home, '.roo'), project: '.roo/skills', global: path.join(home, '.roo', 'skills') },
		{ id: 'kiro-cli', label: 'Kiro', detect: path.join(home, '.kiro'), project: '.kiro/skills', global: path.join(home, '.kiro', 'skills') },
	];
}

// Writes only to the shared folder that most agents read.
const UNIVERSAL_ID = 'universal';
const UNIVERSAL_LABEL = 'Any agent that reads .agents/skills';

function detectAgents(env = process.env, home = os.homedir()) {
	return agentTable(env, home).filter((agent) => fs.existsSync(agent.detect));
}

// Turns agent ids into install folders, merging agents that share one.
// Returns { targets: [{ dir, labels }], unknown: [ids] }.
function resolveTargets(ids, { global = false, cwd = process.cwd(), env = process.env, home = os.homedir() } = {}) {
	const table = agentTable(env, home);
	const byDir = new Map();
	const unknown = [];
	for (const id of ids) {
		let label;
		let dir;
		if (id === UNIVERSAL_ID) {
			label = UNIVERSAL_LABEL;
			dir = global ? path.join(home, '.agents', 'skills') : path.join(cwd, '.agents', 'skills');
		} else {
			const agent = table.find((entry) => entry.id === id);
			if (!agent) {
				unknown.push(id);
				continue;
			}
			label = agent.label;
			dir = global ? agent.global : path.join(cwd, agent.project);
		}
		if (!byDir.has(dir)) byDir.set(dir, []);
		if (!byDir.get(dir).includes(label)) byDir.get(dir).push(label);
	}
	return { targets: [...byDir].map(([dir, labels]) => ({ dir, labels })), unknown };
}

module.exports = { agentTable, detectAgents, resolveTargets, UNIVERSAL_ID, UNIVERSAL_LABEL };
