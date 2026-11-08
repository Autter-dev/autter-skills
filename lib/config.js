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

const NEXT_STEP = 'Tell your agent: "use the skills to install Autter Runtime in this project."';

module.exports = { GROUPS, NEXT_STEP };
