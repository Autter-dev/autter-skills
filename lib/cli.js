'use strict';

const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const pkg = require('../package.json');
const { GROUPS, NEXT_STEP } = require('./config.js');
const { parseArgs } = require('./args.js');
const { agentTable, detectAgents, resolveTargets, UNIVERSAL_ID, UNIVERSAL_LABEL } = require('./agents.js');
const { availableSkills, installSkills } = require('./install.js');
const { makeUi } = require('./ui.js');

const HELP = `Usage: npx @autter/skills [options]

Installs Autter's agent skills for the coding agents on this machine.

Options:
  -a, --agent <id...>   Install for these agents (default: the ones detected)
  -s, --skill <name...> Install only these skills (default: all)
  -g, --global          Install for your user account instead of this project
  -y, --yes             Don't ask questions
  -l, --list            Show the skills and exit
  -v, --version         Print the version
  -h, --help            Show this help

Examples:
  npx @autter/skills
  npx @autter/skills --agent claude-code cursor
  npx @autter/skills --skill otel-node-style --global`;

function ask(question) {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		});
		rl.on('close', () => resolve(''));
	});
}

function banner(ui) {
	ui.write();
	ui.write(`  ${ui.paint.accent(ui.paint.bold('autter'))} ${ui.paint.bold('skills')} ${ui.paint.dim(`v${pkg.version}`)}`);
	ui.write();
}

// Shows the groups, limited to `names`; skills not in the catalog go under "Other".
function groupedRows(names) {
	const wanted = new Set(names);
	const rows = [];
	const grouped = new Set();
	for (const group of GROUPS) {
		const inGroup = group.skills.filter(([name]) => wanted.has(name));
		for (const [name] of group.skills) grouped.add(name);
		if (inGroup.length > 0) rows.push({ title: group.title, skills: inGroup });
	}
	const other = names.filter((name) => !grouped.has(name)).map((name) => [name, '']);
	if (other.length > 0) rows.push({ title: 'Other', skills: other });
	return rows;
}

function printCatalog(ui, names) {
	for (const row of groupedRows(names)) {
		ui.write(`  ${ui.paint.bold(row.title)}`);
		for (const [name, blurb] of row.skills) ui.write(`    ${name.padEnd(22)} ${ui.paint.dim(blurb)}`);
		ui.write();
	}
}

function showPath(dir, global) {
	if (global) {
		const home = os.homedir();
		return dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir;
	}
	return `./${path.relative(process.cwd(), dir).split(path.sep).join('/')}`;
}

function printSummary(ui, { names, targets, global }) {
	ui.write(`  ${ui.paint.green('✓')} ${ui.paint.bold(`Installed ${names.length} skill${names.length === 1 ? '' : 's'}`)}`);
	ui.write();
	for (const row of groupedRows(names)) {
		ui.write(`    ${ui.paint.bold(row.title.padEnd(16))}${ui.paint.dim(row.skills.map(([name]) => name).join(' · '))}`);
	}
	ui.write();
	for (const target of targets) {
		ui.write(`    ${ui.paint.dim(showPath(target.dir, global).padEnd(24))}${target.labels.join(', ')}`);
	}
	ui.write();
	ui.write(`  ${NEXT_STEP}`);
	ui.write();
}

async function chooseAgents(ui, opts, interactive) {
	if (opts.agents.length > 0) return opts.agents;

	const found = detectAgents();
	if (found.length > 0) {
		if (!interactive) return found.map((agent) => agent.id);
		const names = found.map((agent) => agent.label).join(', ');
		const answer = await ask(`  Install for ${ui.paint.bold(names)}? ${ui.paint.dim('[Y/n]')} `);
		if (answer === '' || /^y/i.test(answer)) return found.map((agent) => agent.id);
	} else if (!interactive) {
		ui.write(`  ${ui.paint.dim('No known agent folders found; using the shared .agents/skills folder.')}`);
		ui.write();
		return [UNIVERSAL_ID];
	}

	const choices = agentTable();
	ui.write();
	choices.forEach((agent, i) => ui.write(`    ${String(i + 1).padStart(2)}  ${agent.label}`));
	ui.write(`     0  ${UNIVERSAL_LABEL}`);
	const answer = await ask(`\n  Which agents? ${ui.paint.dim('numbers separated by commas, Enter for 0')} `);
	const picked = answer
		.split(/[\s,]+/)
		.map((n) => parseInt(n, 10))
		.filter((n) => n >= 1 && n <= choices.length)
		.map((n) => choices[n - 1].id);
	ui.write();
	return picked.length > 0 ? [...new Set(picked)] : [UNIVERSAL_ID];
}

function fail(ui, lines) {
	for (const line of lines) ui.write(`  ${ui.paint.red('✗')} ${line}`);
	ui.write();
	return 1;
}

async function main(argv) {
	const ui = makeUi();
	const { opts, errors } = parseArgs(argv);

	if (errors.length > 0) {
		fail(ui, [...errors, 'Run with --help for usage.']);
		return 2;
	}
	if (opts.version) {
		ui.write(pkg.version);
		return 0;
	}
	if (opts.help) {
		ui.write(HELP);
		return 0;
	}

	banner(ui);
	const available = availableSkills();
	const names = opts.skills.length > 0 ? [...new Set(opts.skills)] : available;
	const missing = names.filter((name) => !available.includes(name));
	if (missing.length > 0) {
		return fail(ui, [`No such skill: ${missing.join(', ')}`, `Available: ${available.join(', ')}`]);
	}
	if (opts.list) {
		printCatalog(ui, available);
		return 0;
	}

	const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !opts.yes;
	const agents = await chooseAgents(ui, opts, interactive);
	const { targets, unknown } = resolveTargets(agents, { global: opts.global });
	if (unknown.length > 0) {
		return fail(ui, [
			`Unknown agent: ${unknown.join(', ')}`,
			`Known: ${[...agentTable().map((agent) => agent.id), UNIVERSAL_ID].join(', ')}`,
			'For other agents run: npx skills add Autter-dev/autter-skills',
		]);
	}

	const result = installSkills({ names, targets });
	if (!result.ok) return fail(ui, [`Could not write to ${result.dir}`, result.message]);

	printSummary(ui, { names, targets, global: opts.global });
	return 0;
}

module.exports = { main };
