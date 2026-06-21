const fs = require('fs');
const path = require('path');

const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const root = input.cwd || process.cwd();

function output(value) {
  process.stdout.write(JSON.stringify(value));
}

function deny(reason) {
  output({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

function predictionSection(text) {
  const match = text.match(/^## (?:预测|Prediction)(?:[^a-zA-Z]|$)[\s\S]*?(?=^## (?!预测(?:[^a-zA-Z]|$)|Prediction(?:[^a-zA-Z]|$))|(?![\s\S]))/m);
  return match ? match[0] : '';
}

function predictionFiles(patch) {
  return [...patch.matchAll(/^\*\*\* (?:Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
}

function isPredictionFile(file) {
  return /(^|\/)predictions\/.+\.md$/i.test(file.replace(/\\/g, '/'));
}

function immutability() {
  if (process.env.CHEAT_BYPASS_IMMUTABILITY === '1') return output({});

  const tool = input.tool_name;
  const toolInput = input.tool_input || {};
  if (tool === 'apply_patch') {
    const patch = toolInput.patch || toolInput.input || '';
    for (const file of predictionFiles(patch)) {
      if (!isPredictionFile(file)) continue;
      const absolute = path.resolve(root, file);
      if (!fs.existsSync(absolute)) continue;
      const locked = predictionSection(fs.readFileSync(absolute, 'utf8'));
      const changed = patch.split(/\r?\n/).some((line) =>
        /^[ +-]/.test(line) && line.length > 1 && locked.includes(line.slice(1))
      );
      if (changed || patch.includes(`*** Delete File: ${file}`)) {
        return deny(`Prediction section is immutable: ${file}. Append to ## 复盘 or create *_redo.md.`);
      }
    }
    return output({});
  }

  const file = toolInput.file_path || toolInput.path;
  if (!file || !isPredictionFile(file)) return output({});
  const absolute = path.resolve(root, file);
  if (!fs.existsSync(absolute)) return output({});
  if (tool === 'Write') return deny(`Existing prediction file is immutable: ${file}. Use Edit on ## 复盘.`);
  if (tool === 'Edit' && predictionSection(fs.readFileSync(absolute, 'utf8')).includes(toolInput.old_string || '\0')) {
    return deny(`Prediction section is immutable: ${file}. Append to ## 复盘 or create *_redo.md.`);
  }
  output({});
}

function sessionStart() {
  const statePath = path.join(root, '.cheat-state.json');
  if (!fs.existsSync(statePath)) return output({});
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const candidatesPath = path.join(root, 'candidates.md');
  const candidates = fs.existsSync(candidatesPath)
    ? [...fs.readFileSync(candidatesPath, 'utf8').matchAll(/^### (.+)$/gm)].slice(0, 3).map((m) => m[1]).join(' / ')
    : '';
  const context = [
    '[cheat-on-content / SessionStart]',
    `Buffer: ${(state.shoots || []).length}`,
    `待复盘: ${(state.pending_retros || []).length}`,
    `候选 top 3: ${candidates || '(空)'}`,
    `校准样本: ${state.calibration_samples || 0} | rubric: ${state.rubric_version || 'v0'}`,
  ].join('\n');
  output({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } });
}

function logEvent() {
  if (!fs.existsSync(path.join(root, '.cheat-state.json'))) return output({});
  const logDir = path.join(root, '.cheat-cache');
  fs.mkdirSync(logDir, { recursive: true });
  const event = {
    ts: new Date().toISOString(),
    event: input.hook_event_name || 'unknown',
    tool: input.tool_name || null,
    file: input.tool_input?.file_path || null,
    success: input.tool_response?.success ?? null,
    prompt_present: typeof input.prompt === 'string',
    prompt_chars: input.prompt?.length || 0,
  };
  fs.appendFileSync(path.join(logDir, 'usage.jsonl'), `${JSON.stringify(event)}\n`);
  output({ suppressOutput: true });
}

({ immutability, 'session-start': sessionStart, log: logEvent }[process.argv[2]] || (() => output({})))();
