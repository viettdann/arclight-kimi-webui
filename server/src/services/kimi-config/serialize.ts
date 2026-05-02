import type { KimiConfigRow, ProviderType } from 'shared/types/kimi-config';

export const REDACT_TYPES: ProviderType[] = ['kimi', 'openai_legacy', 'openai_responses'];

export function shouldRedactSecrets(type: ProviderType): boolean {
  return REDACT_TYPES.includes(type);
}

export function escapeToml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fmtStr(value: string): string {
  return `"${escapeToml(value)}"`;
}

function fmtBool(value: boolean): string {
  return value ? 'true' : 'false';
}

function fmtNum(value: number): string {
  return String(value);
}

function fmtStrArr(values: string[]): string {
  return `[${values.map(fmtStr).join(', ')}]`;
}

function writeScalarLines(row: KimiConfigRow): string[] {
  const d = row.defaults;
  return [
    `model = ${fmtStr(d.model)}`,
    `thinking = ${fmtBool(d.thinking)}`,
    `yolo = ${fmtBool(d.yolo)}`,
    `plan_mode = ${fmtBool(d.planMode)}`,
    `editor = ${fmtStr(d.editor)}`,
    `theme = ${fmtStr(d.theme)}`,
    `show_thinking_stream = ${fmtBool(d.showThinkingStream)}`,
    `skip_afk_prompt_injection = ${fmtBool(d.skipAfkPromptInjection)}`,
    `merge_all_available_skills = ${fmtBool(d.mergeAllAvailableSkills)}`,
    `extra_skill_dirs = ${fmtStrArr(d.extraSkillDirs)}`,
    `telemetry = ${fmtBool(d.telemetry)}`,
  ];
}

function writeModels(row: KimiConfigRow): string[] {
  const lines: string[] = [];
  const ids = Object.keys(row.models).sort();
  for (const id of ids) {
    const m = row.models[id];
    if (m === undefined) continue;
    if (lines.length > 0) lines.push('');
    lines.push(`[models.${id}]`);
    lines.push(`provider = ${fmtStr(m.provider)}`);
    lines.push(`model = ${fmtStr(m.model)}`);
    lines.push(`max_context_size = ${fmtNum(m.maxContextSize)}`);
    lines.push(`capabilities = ${fmtStrArr(m.capabilities)}`);
    if (m.displayName !== undefined) {
      lines.push(`display_name = ${fmtStr(m.displayName)}`);
    }
  }
  return lines;
}

function writeProvider(row: KimiConfigRow, redactSecrets: boolean): string[] {
  const p = row.provider;
  const lines: string[] = [`[providers.${p.name}]`];
  lines.push(`base_url = ${fmtStr(p.baseUrl)}`);

  const shouldRedact = redactSecrets && REDACT_TYPES.includes(p.type);
  lines.push(`api_key = ${shouldRedact ? '""' : fmtStr(p.apiKey)}`);

  if (Object.keys(p.env).length > 0) {
    lines.push(`[providers.${p.name}.env]`);
    for (const [k, v] of Object.entries(p.env).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${k} = ${fmtStr(v)}`);
    }
  }

  if (Object.keys(p.customHeaders).length > 0) {
    lines.push(`[providers.${p.name}.custom_headers]`);
    for (const [k, v] of Object.entries(p.customHeaders).sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`${k} = ${fmtStr(v)}`);
    }
  }

  return lines;
}

function writeLoopControl(row: KimiConfigRow): string[] {
  const l = row.loopControl;
  return [
    '[loop_control]',
    `max_steps_per_turn = ${fmtNum(l.maxStepsPerTurn)}`,
    `max_retries_per_step = ${fmtNum(l.maxRetriesPerStep)}`,
    `max_ralph_iterations = ${fmtNum(l.maxRalphIterations)}`,
    `reserved_context_size = ${fmtNum(l.reservedContextSize)}`,
    `compaction_trigger_ratio = ${fmtNum(l.compactionTriggerRatio)}`,
  ];
}

function writeBackground(row: KimiConfigRow): string[] {
  const b = row.background;
  return [
    '[background]',
    `max_running_tasks = ${fmtNum(b.maxRunningTasks)}`,
    `read_max_bytes = ${fmtNum(b.readMaxBytes)}`,
    `notification_tail_lines = ${fmtNum(b.notificationTailLines)}`,
    `notification_tail_chars = ${fmtNum(b.notificationTailChars)}`,
    `wait_poll_interval_ms = ${fmtNum(b.waitPollIntervalMs)}`,
    `worker_heartbeat_interval_ms = ${fmtNum(b.workerHeartbeatIntervalMs)}`,
    `worker_stale_after_ms = ${fmtNum(b.workerStaleAfterMs)}`,
    `kill_grace_period_ms = ${fmtNum(b.killGracePeriodMs)}`,
    `keep_alive_on_exit = ${fmtBool(b.keepAliveOnExit)}`,
    `agent_task_timeout_s = ${fmtNum(b.agentTaskTimeoutS)}`,
    `print_wait_ceiling_s = ${fmtNum(b.printWaitCeilingS)}`,
  ];
}

function writeNotifications(row: KimiConfigRow): string[] {
  return [
    '[notifications]',
    `claim_stale_after_ms = ${fmtNum(row.notifications.claimStaleAfterMs)}`,
  ];
}

function writeServices(row: KimiConfigRow): string[] {
  const lines: string[] = [];
  if (row.services.search) {
    const s = row.services.search;
    lines.push('[services.moonshot_search]');
    lines.push(`base_url = ${fmtStr(s.baseUrl)}`);
    lines.push(`api_key = ${fmtStr(s.apiKey)}`);
    if (s.customHeaders) {
      lines.push('[services.moonshot_search.custom_headers]');
      for (const [k, v] of Object.entries(s.customHeaders).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${k} = ${fmtStr(v)}`);
      }
    }
  }
  if (row.services.fetch) {
    const f = row.services.fetch;
    if (lines.length > 0) lines.push('');
    lines.push('[services.moonshot_fetch]');
    lines.push(`base_url = ${fmtStr(f.baseUrl)}`);
    lines.push(`api_key = ${fmtStr(f.apiKey)}`);
    if (f.customHeaders) {
      lines.push('[services.moonshot_fetch.custom_headers]');
      for (const [k, v] of Object.entries(f.customHeaders).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${k} = ${fmtStr(v)}`);
      }
    }
  }
  return lines;
}

function writeMcpClient(row: KimiConfigRow): string[] {
  return ['[mcp.client]', `tool_call_timeout_ms = ${fmtNum(row.mcpClient.toolCallTimeoutMs)}`];
}

function writeHooks(row: KimiConfigRow): string[] {
  const lines: string[] = [];
  for (const h of row.hooks) {
    if (lines.length > 0) lines.push('');
    lines.push('[[hooks]]');
    lines.push(`event = ${fmtStr(h.event)}`);
    lines.push(`command = ${fmtStr(h.command)}`);
    if (h.matcher !== undefined) {
      lines.push(`matcher = ${fmtStr(h.matcher)}`);
    }
    if (h.timeout !== undefined) {
      lines.push(`timeout = ${fmtNum(h.timeout)}`);
    }
  }
  return lines;
}

export function renderToml(row: KimiConfigRow, opts?: { redactSecrets?: boolean }): string {
  const redactSecrets = opts?.redactSecrets ?? false;
  const sections: string[][] = [];

  sections.push(writeScalarLines(row));
  sections.push(writeModels(row));
  sections.push(writeProvider(row, redactSecrets));
  sections.push(writeLoopControl(row));
  sections.push(writeBackground(row));
  sections.push(writeNotifications(row));

  const servicesLines = writeServices(row);
  if (servicesLines.length > 0) {
    sections.push(servicesLines);
  }

  sections.push(writeMcpClient(row));

  const hooksLines = writeHooks(row);
  if (hooksLines.length > 0) {
    sections.push(hooksLines);
  }

  let result = '';
  for (let i = 0; i < sections.length; i++) {
    if (i > 0) result += '\n';
    const sec = sections[i];
    if (sec) result += sec.join('\n');
  }

  if (row.extraTomlOverride && row.extraTomlOverride.length > 0) {
    result += `\n\n${row.extraTomlOverride}`;
  }

  result += '\n';
  return result;
}
