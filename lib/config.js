'use strict';

// Every top-level skill folder in this repo must appear here exactly once;
// test/catalog.test.js fails when a folder is missing, so the summary never
// drifts from the repo.
const GROUPS = [
	{
		title: 'Runtime setup',
		skills: [
			['autter-runtime-setup', 'Instrument a repo with Autter Runtime'],
			['autter-runtime-errors', 'Audit error coverage and propose codes'],
			['autter-runtime-logs', 'Debug failed requests from local records'],
		],
	},
	{
		title: 'Language guides',
		skills: [
			['otel-node-style', 'Node.js and Next.js'],
			['otel-edge-style', 'Edge and fetch-only runtimes'],
			['otel-browser-style', 'Browser apps and source maps'],
			['otel-python-style', 'Python'],
			['otel-go-rust-style', 'Go and Rust'],
			['otel-generic-style', 'Any other backend language'],
		],
	},
	{
		title: 'Repo context',
		skills: [
			['autter-repo-context', 'Memory, wiki and production lessons before coding'],
			['restructure-codebase', 'Whole-codebase structural refactor (run on demand)'],
		],
	},
];

// The Autter MCP server. Only the URL goes into agent config files; no key,
// header or token is ever written (the agent signs in through OAuth).
const MCP_URL = 'https://api.autter.dev/mcp';
const MCP_DOCS_URL = 'https://autter.dev/docs/guides/mcp-setup';
const MCP_SERVER_NAME = 'autter';

// Entry shape per agent. Claude Code's `claude mcp add --scope project
// --transport http` writes `type` and `url`; Cursor's remote servers take `url` only.
const MCP_ENTRIES = {
	'claude-code': { type: 'http', url: MCP_URL },
	cursor: { url: MCP_URL },
};

// Project-relative config file per agent.
const MCP_FILES = {
	'claude-code': '.mcp.json',
	cursor: '.cursor/mcp.json',
};

const MCP_AGENT_LABELS = { 'claude-code': 'Claude Code', cursor: 'Cursor' };

const PROMPT = 'Use the Autter skills to set up Runtime for this project.';

const NEXT_STEPS_MCP = [
	'Next: open your agent and sign in to Autter when it shows Authenticate.',
	`Then tell it: "${PROMPT}"`,
];
const NEXT_STEP_NO_MCP = `Tell your agent: "${PROMPT}"`;

module.exports = {
	GROUPS,
	MCP_URL,
	MCP_DOCS_URL,
	MCP_SERVER_NAME,
	MCP_ENTRIES,
	MCP_FILES,
	MCP_AGENT_LABELS,
	PROMPT,
	NEXT_STEPS_MCP,
	NEXT_STEP_NO_MCP,
};
