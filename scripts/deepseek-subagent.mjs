#!/usr/bin/env node
/**
 * Cross-platform DeepSeek Subagent Dispatcher (macOS / Windows / Linux)
 * 
 * Invokes DeepSeek subagents for Test Author, Implementer (Coder), or Auditor roles.
 * Prefers the local DeepSeek Harness (`dsh`) CLI if available; falls back to DeepSeek API.
 * 
 * Usage:
 *   node scripts/deepseek-subagent.mjs --role implementer --task "Implement AC-1" --allowlist "packages/core/foo.ts"
 *   node scripts/deepseek-subagent.mjs --role tester --spec "docs/handoffs/task-1/spec.md"
 *   node scripts/deepseek-subagent.mjs --role auditor --task-dir "docs/handoffs/task-1"
 *   node scripts/deepseek-subagent.mjs --prompt "Arbitrary prompt for DeepSeek"
 */

import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    role: 'implementer', // implementer | tester | auditor | generic
    prompt: '',
    spec: '',
    task: '',
    allowlist: '',
    taskDir: '',
    model: 'deepseek-chat', // deepseek-chat (V3) or deepseek-reasoner (R1)
    permission: 'danger-full-access',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--role' && i + 1 < args.length) options.role = args[++i].toLowerCase();
    else if (arg === '--prompt' && i + 1 < args.length) options.prompt = args[++i];
    else if (arg === '--spec' && i + 1 < args.length) options.spec = args[++i];
    else if (arg === '--task' && i + 1 < args.length) options.task = args[++i];
    else if (arg === '--allowlist' && i + 1 < args.length) options.allowlist = args[++i];
    else if (arg === '--task-dir' && i + 1 < args.length) options.taskDir = args[++i];
    else if (arg === '--model' && i + 1 < args.length) options.model = args[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`DeepSeek Subagent Runner
Options:
  --role <implementer|tester|auditor|generic>  Subagent role (default: implementer)
  --prompt <string>                            Direct prompt for subagent
  --task <string>                              Task description
  --spec <file>                                Path to spec file
  --allowlist <files>                          Comma-separated allowlisted files
  --task-dir <dir>                             Handoff directory (e.g., docs/handoffs/<task>)
  --model <model>                              DeepSeek model (default: deepseek-chat)
`);
      process.exit(0);
    }
  }

  return options;
}

function resolveDshBinary() {
  // Check PATH first
  try {
    const cmd = process.platform === 'win32' ? 'where dsh' : 'which dsh';
    const found = execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found) return found.split('\n')[0].trim();
  } catch {}

  // Check known macOS app bundle location
  if (process.platform === 'darwin') {
    const macAppDsh = '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
    if (fs.existsSync(macAppDsh)) return macAppDsh;
  }

  // Check Windows common AppData / local paths
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const winDsh = path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
    if (fs.existsSync(winDsh)) return winDsh;
  }

  return null;
}

function getDeepSeekApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;

  // Check ~/.dsh/.credentials.yaml
  try {
    const credPath = path.join(os.homedir(), '.dsh', '.credentials.yaml');
    if (fs.existsSync(credPath)) {
      const content = fs.readFileSync(credPath, 'utf-8');
      const match = content.match(/DEEPSEEK_API_KEY:\s*([^\r\n]+)/);
      if (match && match[1]) return match[1].trim();
    }
  } catch {}

  return null;
}

function buildRolePrompt(options) {
  let specContent = '';
  if (options.spec && fs.existsSync(options.spec)) {
    specContent = `\n\n### Task Spec (${options.spec}):\n` + fs.readFileSync(options.spec, 'utf-8');
  }

  let instructions = '';

  switch (options.role) {
    case 'tester':
    case 'test-author':
      instructions = `You are the Test Author subagent operating under the Multi-Agent Orchestration Protocol.
Your responsibility:
1. Read the specification and write clean, failing tests under tests/** verifying every acceptance criterion.
2. DO NOT write or modify application/production implementation code.
3. Tests must be written to fail for the expected assertion failure, not syntax or import errors.
4. Run tests to confirm failure if needed.

${options.task ? `Task: ${options.task}` : ''}
${specContent}
${options.prompt ? `Additional instructions:\n${options.prompt}` : ''}`;
      break;

    case 'coder':
    case 'implementer':
      instructions = `You are the Implementer (Coder) subagent operating under the Multi-Agent Orchestration Protocol.
Your responsibility:
1. Write minimal code to pass the failing tests according to the spec.
2. You are strictly restricted to the allowlisted files: ${options.allowlist || '(as specified in the task handoff)'}.
3. DO NOT modify any test files or spec files.
4. If a test looks wrong or contradictory, report the blocker immediately rather than changing tests.

${options.task ? `Task: ${options.task}` : ''}
${options.allowlist ? `Allowed Files:\n${options.allowlist}` : ''}
${specContent}
${options.prompt ? `Additional instructions:\n${options.prompt}` : ''}`;
      break;

    case 'auditor':
      instructions = `You are the Auditor (Reviewer) subagent operating under the Multi-Agent Orchestration Protocol.
Your responsibility:
1. Run the test suite, typecheck, lint, and build commands.
2. Produce a short summary of the check results.
3. Write or update audit.md in ${options.taskDir || 'docs/handoffs/<task>/audit.md'}.
4. DO NOT edit application source code. Report any failures for escalation.

${options.task ? `Task: ${options.task}` : ''}
${options.prompt ? `Additional instructions:\n${options.prompt}` : ''}`;
      break;

    default:
      instructions = `${options.prompt || options.task}`;
      if (specContent) instructions += specContent;
      break;
  }

  return instructions;
}

async function runViaApi(prompt, apiKey, model) {
  console.log(`[DeepSeek Subagent] Invoking API (${model})...`);
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert specialist software engineering subagent operating in a multi-agent orchestration architecture.',
        },
        { role: 'user', content: prompt },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '';
  console.log(reply);
}

function runViaDsh(dshBin, prompt) {
  console.log(`[DeepSeek Subagent] Invoking DeepSeek Harness (${dshBin})...`);
  const env = {
    ...process.env,
    DSH_PERMISSION_MODE: process.env.DSH_PERMISSION_MODE || 'danger-full-access',
  };

  const proc = spawn(dshBin, ['headless', prompt], {
    stdio: 'inherit',
    env,
    cwd: process.cwd(),
  });

  proc.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  const options = parseArgs();
  const prompt = buildRolePrompt(options);

  const dshBin = resolveDshBinary();
  const apiKey = getDeepSeekApiKey();

  if (dshBin) {
    runViaDsh(dshBin, prompt);
  } else if (apiKey) {
    await runViaApi(prompt, apiKey, options.model);
  } else {
    console.error('Error: Neither DeepSeek Harness (`dsh`) CLI nor DEEPSEEK_API_KEY could be located.');
    console.error('Ensure DeepSeek Harness is installed or set DEEPSEEK_API_KEY in your environment.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[DeepSeek Subagent] Error:', err.message);
  process.exit(1);
});
