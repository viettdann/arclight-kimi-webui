# Migration: Kimi SDK → Claude Agent SDK

`@moonshot-ai/kimi-agent-sdk@0.1.8` → `@anthropic-ai/claude-agent-sdk@0.3.158`.
Binary `claude` 2.1.158. Runtime `bun`. Single deployment, single server. Process chạy **non-root**.

## Locked decisions

- Drop DB hoàn toàn. Xoá migration cũ, regen từ schema mới. Không backfill.
- **Persistence single-source.** JSONL transcript của Claude = nguồn duy nhất. UI `Block[]` render ra *từ* transcript đó. Không có bảng message song song. Không de-sync.
- **Auth provider-switch.** Setting `CLAUDE_PROVIDER ∈ {oauth, api}`. `oauth` → inject `CLAUDE_CODE_OAUTH_TOKEN`. `api` → inject `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL`. Loại trừ lẫn nhau, không fallback.
- **Config dir relocate.** Set `CLAUDE_CONFIG_DIR` = thư mục app sở hữu. Mọi transcript/settings vào đó, tách khỏi `~/.claude` của host.
- **Config = key-value** (`app_settings`), khớp tên biến Claude.
- **Binary** assume luôn tồn tại; resolve qua `which claude` → `pathToClaudeCodeExecutable`.
- **System prompt = mặc định.** Chưa build preset.
- **Drop MCP `command`/stdio.** Giữ `/mcp` read-only (status). Không đụng `.mcp.json` ngoài.
- **Env whitelist.** Chỉ truyền `SAFE_ENV_KEYS` + biến auth + `CLAUDE_CONFIG_DIR`. `options.env` THAY THẾ `process.env` của subprocess → bắt buộc gồm `PATH`/`HOME`/...
- `settingSources: ["project"]`.
- `steer` không có tương đương SDK → bỏ. Thay bằng interrupt + gửi lại.
- **Approval = 3 mode** `ask` / `safe` / `bypass`. `bypass` = `bypassPermissions` + `allowDangerouslySkipPermissions`, yêu cầu chạy non-root. `AskUserQuestion` tới user ở mọi mode.

## Sự thật kỹ thuật (binary 2.1.158)

```js
configDir     = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude")
transcriptPath = join(configDir, "projects", TM(cwd), `${sessionId}.jsonl`)
subagentDir    = join(configDir, "projects", TM(cwd), sessionId, "subagents")

function TM(cwd) {                              // encoder cwd → tên folder
  const s = cwd.replace(/[^a-zA-Z0-9]/g, "-")  // MỌI non-alnum → "-", 1:1, không gộp dash
  return s.length <= 200 ? s : `${s.slice(0, 200)}-${hash6(cwd)}`  // MAX=200; quá → cắt 200 + "-" + hash 6 ký tự
}
```

- `unstable_v2_prompt` ĐÃ BỊ XOÁ. Title-gen dùng `query()` one-shot.
- SDK exports khả dụng: `query, startup, renameSession, listSessions, getSessionMessages, getSubagentMessages, listSubagents, forkSession, deleteSession, tagSession, getSessionInfo, importSessionToStore, createSdkMcpServer, tool, resolveSettings`.
- `Query` methods: `applyFlagSettings, getContextUsage, interrupt, mcpServerStatus, setModel, setPermissionMode, supportedCommands, rewindFiles`.

## Kiến trúc: Kimi → Claude

| Kimi | Claude |
|---|---|
| `createSession()` → `Session` | `query({prompt, options})` → `Query` (AsyncGenerator<SDKMessage>) |
| `session.prompt()` → `Turn` (async-iterable) | streaming-input: đẩy `SDKUserMessage` vào bridge; consume `query` |
| `turn.approve()` / `respondQuestion()` | `canUseTool` callback + `AskUserQuestion` tool |
| `turn.steer()` | (không có) → interrupt + message mới |
| `turn.interrupt()` | `query.interrupt()` |
| StreamEvent | `SDKMessage` (`assistant`/`stream_event`/`result`/`system`/...) |
| 3 file (wire/context/state.json) | 1 JSONL transcript |
| `kimiSessionId` | `sdkSessionId` (lấy từ `msg.session_id` ở message đầu) |

**Bảo toàn:** wire protocol (`shared/types.ts` `Block[]`/`WSMessage`/payloads), project/workspace/clone, auth/allowlist/git-credentials, ActiveSession registry, eventBuffer/seq, reconcile-on-startup. Migration thay *producer*, không đổi *hợp đồng client* (trừ bỏ `steer`).

---

## Phase 0 — Teardown

**Deps:** gỡ `@moonshot-ai/kimi-agent-sdk` khỏi `server/package.json`. `bun add @anthropic-ai/claude-agent-sdk@0.3.158` vào `server`.

**DB:** xoá `server/src/db/migrations/0000_genesis.sql` + `meta/`. Regen sau Phase 2.

**Xoá file** (Kimi-specific, không tái dùng):
- `server/src/services/kimi-session.ts`
- `server/src/services/restore-transforms.ts`
- `server/src/services/title.ts`, `title-generate.ts`
- `server/src/services/kimi-config/` (toàn bộ 13 file)
- `server/src/db/schema/kimi-config.ts`, `kimi-sessions.ts`
- `server/src/routes/kimi-config.ts`
- `shared/types/kimi-config.ts`
- client: `kimi-raw-toml-panel.tsx`, `kimi-background-panel.tsx`, `kimi-services-panel.tsx`, `kimi-hooks-panel.tsx`, `kimi-agent-panel.tsx`, `lib/harness-tags.ts`, `blocks/harness-tag-block.tsx`

**Giữ tới hết Phase 4** (nguồn cho `transcript-render`): `server/src/services/wire-events.ts`. Xoá sau khi `transcript-render.ts` hấp thụ `mapDisplayBlocks`, `contentPartsToText`, thuật toán subagent-nesting và indexing turn/step/part.

**Checkpoint:** typecheck sẽ đỏ (intentional) cho tới Phase 5/7 xong. Đây là điểm không-quay-lại của teardown.

---

## Phase 1 — Config (key-value) + env

**New `server/src/services/config.ts`** (port từ reference `services/config.ts`):
- Bảng `app_settings` (Phase 2). `getConfig(key)`: cache 60s → DB → `process.env` fallback. `seedAppSettings`, `loadStartupConfig`, `diffSettings`, `syncSettings`, `maskSecret`.
- `SEED_KEYS`:

| key | secret | default |
|---|---|---|
| `CLAUDE_PROVIDER` | no | `oauth` |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | — |
| `ANTHROPIC_BASE_URL` | no | — |
| `ANTHROPIC_AUTH_TOKEN` | yes | — |
| `ANTHROPIC_MODEL` | no | — |
| `DEFAULT_MODEL` | no | `claude-sonnet-4-6` |
| `WORKSPACE_ROOT` | no | (giữ giá trị hiện tại) |

`CLAUDE_CONFIG_DIR` không nằm trong app_settings — app tự dẫn xuất (vd `${DATA_DIR}/claude-config`), tạo dir lúc startup.

**New `server/src/services/agent/env.ts`** (mở rộng từ reference `lib/claude-env.ts`):

```ts
const SAFE_ENV_KEYS = ['PATH','HOME','USER','LANG','LC_ALL','TERM','SHELL',
  'TMPDIR','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME']

function pickSafeEnv(keys = SAFE_ENV_KEYS, src = process.env): Record<string,string> {
  /* copy các key trong `keys` có mặt trong src */
}

async function getClaudeCodePath(): Promise<string> {
  // Bun.spawn(['which','claude']) → trim stdout; throw nếu rỗng
}

// options.env THAY THẾ process.env của subprocess → phải gồm base
async function buildAgentEnv(): Promise<Record<string,string>> {
  const base = { ...pickSafeEnv(), CLAUDE_CONFIG_DIR: APP_CONFIG_DIR }
  const provider = await getConfig('CLAUDE_PROVIDER')
  if (provider === 'api') return { ...base,
    ANTHROPIC_BASE_URL:  await getConfig('ANTHROPIC_BASE_URL'),
    ANTHROPIC_AUTH_TOKEN: await getConfig('ANTHROPIC_AUTH_TOKEN'),
    ANTHROPIC_MODEL:     await getConfig('ANTHROPIC_MODEL') }
  return { ...base, CLAUDE_CODE_OAUTH_TOKEN: await getConfig('CLAUDE_CODE_OAUTH_TOKEN') }
  // loại bỏ key value rỗng trước khi return
}
```

**New `server/src/routes/config.ts`:** `GET /api/config` (masked) + `PATCH /api/config` (diff/sync) + `POST /api/config/test` (one-shot `query()` validate auth — port `test-connection` qua SDK).

**Checkpoint:** `buildAgentEnv()` trả đúng tập biến theo provider; `which claude` resolve; `APP_CONFIG_DIR` được tạo. oauth: `CLAUDE_CODE_OAUTH_TOKEN` env + `CLAUDE_CONFIG_DIR` rỗng (không file credentials) auth đủ.

---

## Phase 2 — DB schema (fresh)

**Giữ nguyên:** `auth.ts`, `allowlist.ts`, `git-credentials.ts`.

**New `server/src/db/schema/sessions.ts`** (thay `kimi-sessions.ts`):

```ts
export const sessions = pgTable('sessions', {
  id: uuid().primaryKey().defaultRandom(),
  userId: text().notNull().references(() => user.id, { onDelete: 'cascade' }),
  workDir: text().notNull(),
  projectName: varchar({ length: 255 }).notNull(),
  title: varchar({ length: 255 }),
  model: varchar({ length: 100 }),
  thinking: boolean().notNull().default(false),
  approvalMode: text().notNull().default('ask'),       // ask | safe | bypass (yoloMode gộp vào đây)
  sdkSessionId: varchar({ length: 100 }),              // ← kimiSessionId
  status: text().notNull().default('idle'),            // active | idle | error (reconcile)
  totalTokens: integer().notNull().default(0),
  totalCostUsd: numeric({ precision: 10, scale: 6 }).notNull().default('0'),  // NEW
  createdAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
  lastActiveAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
  pendingPrompt: text(),
  pendingEnqueuedAt: timestamp({ mode: 'date' }),
}, (t) => [index('sessions_user_idx').on(t.userId, t.lastActiveAt.desc())])
```

**New `server/src/db/schema/session-transcripts.ts`** (thay `kimi_session_files` 3-file → 1 JSONL):

```ts
export const sessionTranscripts = pgTable('session_transcripts', {
  sessionId: uuid().primaryKey().references(() => sessions.id, { onDelete: 'cascade' }),
  sdkSessionId: varchar({ length: 100 }),
  workspaceCwd: text().notNull(),
  content: text().notNull().default(''),   // raw JSONL — SINGLE SOURCE
  byteOffset: integer().notNull().default(0),
  subagents: jsonb(),                       // { [name]: { content, meta } }
  updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
})
```

**New `server/src/db/schema/app-settings.ts`** (thay `kimi_config` singleton):

```ts
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: text(),
  isSecret: boolean().notNull().default(false),
  updatedAt: timestamp({ mode: 'date' }).notNull().defaultNow(),
})
```

Cập nhật `schema/index.ts` exports. `bun run db:generate --name genesis` (wrapper bắt buộc `--name`) → `0000` mới.

**Checkpoint:** migration mới apply sạch trên DB trống. `sessions`/`session_transcripts`/`app_settings` tồn tại.

---

## Phase 3 — SDK core (`server/src/services/agent/`)

### `message-bridge.ts` (port nguyên)
`createMessageBridge(sessionId)` → `{ iterable, push, close }`. `iterable: AsyncIterable<SDKUserMessage>` theo queue+resolve.
```ts
SDKUserMessage = { type:'user', message:{ role:'user', content }, parent_tool_use_id:null, session_id }
```

### `query-runner.ts` (build `query()` call)
```ts
const q = query({ prompt: bridge.iterable, options: {
  settingSources: ['project'],
  model, cwd: workDir, abortController,
  canUseTool: buildCanUseTool(sessionId),      // luôn truyền (cả bypass) — kênh nhận answer AskUserQuestion
  includePartialMessages: true,
  ...permissionOptions(approvalMode),          // xem bảng dưới
  pathToClaudeCodeExecutable: await getClaudeCodePath(),
  env: await buildAgentEnv(),
  toolConfig: { askUserQuestion: { previewFormat: 'html' } },
  ...(resume && { resume: sdkSessionId }),
  stderr: (line) => log.debug({ line }),
}})
```
Thinking: `thinking=true` → `thinking: { type: 'adaptive' }`; `thinking=false` → `thinking: { type: 'disabled' }`. (Model cũ không hỗ trợ adaptive → `{ type: 'enabled', budgetTokens: N }`.) `/effort` → `applyFlagSettings({ effortLevel })` với `'low'|'medium'|'high'|'xhigh'` (`Settings.effortLevel`); `'max'` chỉ đặt qua `options.effort` lúc tạo query. System prompt: **không truyền** (mặc định).

### Approval model (chốt)

`approvalMode ∈ { ask, safe, bypass }` (gộp `yoloMode`). `canUseTool` **luôn** truyền cho cả ba mode. `AskUserQuestion` là câu hỏi tới user, không phải permission → tới user ở mọi mode (answer inject qua `updatedInput`).

| approvalMode | SDK `permissionMode` | canUseTool |
|---|---|---|
| `ask` | `'default'` | hỏi mọi tool; `AskUserQuestion` → inject answer |
| `safe` | `'acceptEdits'` | SDK tự nhận file-edit; auto-allow read-only/safe (`approval-safe-tools.ts`), hỏi phần còn lại; `AskUserQuestion` → inject answer |
| `bypass` | `'bypassPermissions'` (+ `allowDangerouslySkipPermissions: true`) | bỏ qua mọi permission prompt; `AskUserQuestion` vẫn intercept → broadcast `question_request` → inject answer |

```ts
function permissionOptions(mode) {
  switch (mode) {
    case 'bypass': return { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true }
    case 'safe':   return { permissionMode: 'acceptEdits' }   // safe-list auto; tool khác hỏi
    default:       return { permissionMode: 'default' }       // ask
  }
}
```

`'auto'`/`'plan'`/`'dontAsk'` không vào enum người dùng. `bypassPermissions` yêu cầu chạy non-root (binary từ chối dưới root/sudo); không liên quan `bwrap` (xem Caveat). `safe` chỉ auto-accept file edit; tool non-edit vẫn vào `canUseTool` → safe-list áp được.

### `approval.ts` — `buildCanUseTool(sessionId)`
Truyền cho cả ba mode. `approval-safe-tools.ts` adapt sang parse `Bash.command`:
- `AskUserQuestion` (mọi mode, kể cả `bypass`) → broadcast `question_request` (wire), await `question-answer:${requestId}` → return `{ behavior:'allow', updatedInput:{ ...input, answers, annotations }, decisionClassification:'user_temporary' }`.
- `safe` → allow nếu read-only/safe (shell read-only / `Read`/`Glob`/`Grep`/`WebFetch`...), else hỏi; file-edit do SDK tự nhận.
- `ask` → broadcast `approval_request` (kèm `command` nếu Bash), await `approve:${requestId}` → allow/deny.
- `bypass` → `bypassPermissions` bỏ qua `canUseTool` cho tool thường; chỉ `AskUserQuestion` còn intercept để lấy answer.
- `drainPendingRequests()`: unblock mọi promise đang chờ khi teardown (CRITICAL — tránh treo).

### `commands.ts` — slash interceptor (port)
Chặn trước khi đẩy bridge: `/status` (`getContextUsage`), `/rename` (DB title + `title_update`), `/files`, `/effort` (`applyFlagSettings`), `/mcp` (`mcpServerStatus`, read-only). Output = ephemeral (broadcast + buffer, **không persist** — không phải nội dung hội thoại).

### `slash-commands-cache.ts` (REWRITE — query() probe, bỏ Kimi `ProtocolClient`)
Giữ cache `Map` keyed theo `workDir` + đường `cacheOnly` (snapshot đọc không spawn). Warm-init: spin một `query()` ngắn (bridge rỗng, `persistSession:false`, không push prompt), đợi `system` `init`, đọc `query.supportedCommands()`, rồi `abortController.abort()` + `bridge.close()`. Live session đẩy `supportedCommands()` từ `system init` vào cache (Phase 5). `clearSlashCommandsCache()` giữ nguyên.

### `title.ts` — query() one-shot (KHÔNG `unstable_v2_prompt`)
```ts
const q = query({ prompt: `${TITLE_PROMPT}\n---\n${firstUserMsg}`, options: {
  model: 'claude-haiku-4-5-20251001', pathToClaudeCodeExecutable, env: await buildAgentEnv(),
  permissionMode: 'dontAsk', allowedTools: [], disallowedTools: ['*'],
  settingSources: [], persistSession: false,  // ephemeral, không ghi transcript
}})
let title = ''
for await (const m of q) if (m.type === 'result' && m.subtype === 'success') title = m.result.trim()
// title lưu DB (sessions.title). renameSession() KHÔNG cần — title single-source ở DB.
```

**Checkpoint:** một `query()` chạy được với env isolated, `canUseTool` chặn/cho đúng theo `approvalMode`, title-gen trả chuỗi.

---

## Phase 4 — Persistence single-source

### `transcript-store.ts` (port + sửa encoder)
Path dựng theo `CLAUDE_CONFIG_DIR` (app-dir, đã set ở env):
```ts
const PROJECTS = join(APP_CONFIG_DIR, 'projects')
const MAX = 200   // binary: encoded > 200 → slice(0,200)+'-'+hash6 (tránh kích hoạt)
function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')   // 1:1, giữ [A-Za-z0-9], ký tự khác → '-', không gộp dash
}
const transcriptPath = (cwd, id) => join(PROJECTS, encodeCwd(cwd), `${id}.jsonl`)
const subagentDir    = (cwd, id) => join(PROJECTS, encodeCwd(cwd), id, 'subagents')
```

**Encoder parity.** `encodeCwd` thay 1:1 (giữ độ dài) → encoded ≤ 200 ⟺ đường dẫn thô `workDir` ≤ 200. `workDir = WORKSPACE_ROOT / slug(email) / projectName`; `projectName` cap 60 (`slugifyProjectName`). Giữ `WORKSPACE_ROOT` ngắn → không kích hoạt nhánh cắt+hash → `encodeCwd` khớp binary cho resume/restore.

- `appendTranscript(sessionId, sdkSessionId, cwd)`: đọc file từ `byteOffset` → SQL append `content = content || $delta`, cập nhật `byteOffset`. Nếu file nhỏ hơn offset (truncate/fork) → full re-backup.
- `backupSubagents(...)`: `subagents/*.jsonl` + `*.meta.json` → JSONB.
- `restoreTranscript(sessionId)`: ghi `content` + subagents trở lại đĩa TRƯỚC khi resume. `mkdir -p` dir trước.
- READ fallback: glob `${PROJECTS}/*/${sdkSessionId}.jsonl` (UUID toàn cục); WRITE/restore dùng `encodeCwd(cwd)`.

### `transcript-render.ts` (NEW — JSONL → `Block[]`)
Thay `wireEventsToBlocks`. **Tái dùng từ `wire-events.ts`** (giữ tới hết Phase 4): `mapDisplayBlocks` (shell/diff → `DisplayBlock[]`), `contentPartsToText`, thuật toán subagent-nesting (`subagentBlocksByParent`, đệ quy theo `parent_tool_use_id`), suy `turnIdx/stepIdx/partIdx` tuần tự. Viết mới **chỉ** front-end parse: dòng JSONL → cấu trúc trung gian (thay parser Kimi-wire `parseWireFromBytes`). Đọc từng dòng `content` trong DB (**không cần đĩa**) → `Block[]` đúng `shared/types.ts`:
- line `type:'assistant'` → `text`/`thinking`/`tool_call` blocks.
- line `type:'user'` (tool_result) → `tool_result` block + `displayBlocks` qua `mapDisplayBlocks`.
- line `type:'user'` (prompt người dùng) → `user` block.
- subagent transcript (từ `subagents` JSONB) → lồng vào `subagent` block theo `parent_tool_use_id`.
- Chốt: tự parse từ `content` (không dùng `getSessionMessages` — nó cần file trên đĩa; mirror-DB parse thẳng `content`).

Xoá `wire-events.ts` sau khi các phần trên đã chuyển vào `transcript-render.ts`.

### `snapshot.ts` (REWRITE)
`buildSnapshot(sessionId)`:
- `blocks` = `renderTranscript(transcript.content)` (thay vì replay wire).
- `totalTokens`, `totalCostUsd`, `title`, `pendingPrompt`, `thinking`, `approvalMode`, `slashCommands` ← từ `sessions` row + cache.
- `live` ← từ ActiveSession registry (turnInProgress + idx hiện tại).

**Quy tắc single-source:** chỉ `transcript.content` là nguồn nội dung hội thoại. Delta WS lúc đang chạy chỉ là live-typing (ephemeral). Output slash-command, status, error transient → broadcast + buffer, KHÔNG ghi transcript. Reload → render lại từ transcript; transient biến mất (chấp nhận được).

**Checkpoint:** tạo session, chạy 1 turn, `appendTranscript` đồng bộ DB; reload → `renderTranscript` dựng lại đúng hội thoại; restore→resume nối tiếp được.

---

## Phase 5 — WS layer + output-consumer

### `output-consumer.ts` (NEW — `SDKMessage` → wire events hiện có)
`consumeQueryOutput(query, sessionId, session)`: `for await (msg of query)`. Message đầu → bắt `msg.session_id` → `updateSdkSessionId`. Map sang wire (`shared/types.ts`) — **giữ nguyên tên event**:

| SDKMessage | wire emit |
|---|---|
| `assistant` (text block) | `text_delta` (hoặc gộp) |
| `assistant` (thinking) | `thinking_delta` |
| `assistant` (tool_use) | `tool_call` |
| `stream_event` `content_block_delta` text | `text_delta` (partIdx) |
| `stream_event` thinking delta | `thinking_delta` |
| `stream_event` `input_json_delta` | `tool_call_delta` |
| tool_result (qua user msg / progress) | `tool_result` |
| subagent frames | `subagent_event` |
| `system` `init` | `slash_commands` (`query.supportedCommands()`) + lưu cache; set live state |
| `system` `compact_boundary` | `compaction_begin`/`compaction_end` |
| `result` | `turn_end` (+ usage→`status_update`); `appendTranscript` fire-and-forget; trigger title nếu chưa có |
| error iteration | `error` (phân loại timeout/process_died/api_error/user_abort) |

`turn_begin`/`step_begin`/`step_interrupted`: phát từ vòng đời turn trong session-manager (không từ SDKMessage trực tiếp).

### `ws/events.ts` (REWRITE)
Xoá `translateStreamEvent` (Kimi). Giữ helper broadcast/buffer/seq. Logic dịch chuyển vào `output-consumer.ts`.

### `ws/handlers.ts` (ADAPT — giữ message types, bỏ steer)
9 handler → 8 (bỏ `steer_input`):
- `create_session` → tạo DB row + `createMessageBridge` + `query()` + `consumeQueryOutput`; broadcast `session_created`.
- `send_message` → rate-limit + slash intercept; áp `thinking/approvalMode` (nếu đổi: `setPermissionMode`/`setModel` hoặc tạo query mới); `bridge.push`.
- `approve_tool` → resolve `approve:${requestId}`.
- `answer_question` → resolve `question-answer:${requestId}` (`answers` + `annotations`).
- `interrupt_turn` → `query.interrupt()`.
- `subscribe` → snapshot + replay buffer từ `lastSeq` + `replay_done`.
- `resume_session` → `restoreTranscript` TRƯỚC → `query({resume})` → consume.
- `adopt_project` → giữ nguyên (project logic).

### `session-manager.ts` (ADAPT registry) + `session-lifecycle.ts`
ActiveSession giữ thêm `query`, `abortController`, `bridge`, pending maps. Không giới hạn số session/user, không idle-reaper. Teardown (`teardownActiveSession` + `unregister`) gọi `drainPendingRequests` + `abortController.abort()` + `bridge.close()`.

**Checkpoint:** end-to-end qua WS — tạo/gửi/approve/answer/interrupt/resume chạy; client cũ (chưa sửa) vẫn nhận đúng event trừ steer.

---

## Phase 6 — Reconcile / startup (`reconcile.ts` ADAPT)

Single-server, in-memory WS state mất khi restart → khi khởi động:
- `markAllActiveAsIdle()`: `sessions.status = 'idle'` cho mọi row (SDK state không sống qua restart).
- Clone cleanup: giữ `cleanupInterruptedClones` (quét marker `.cloning-*` trong thư mục mỗi user, xoá thư mục clone dở + marker).
- Transcript: không cần catch-up chủ động (mirror chạy theo turn). Restore lười khi `resume_session`.
- `loadStartupConfig()` (Phase 1): nạp + seed `app_settings`; tạo `APP_CONFIG_DIR`.
- Encoder self-test: assert `len(WORKSPACE_ROOT) + maxSlugLen + MAX_PROJECT_NAME_LEN + 2 ≤ 200`; vi phạm → fail-fast (chặn nhánh cắt+hash của binary, giữ parity — xem Phase 4).
- Zombie cleanup không áp dụng (không spawn daemon claude nền).

**Checkpoint:** restart server → mọi session `idle`, resume vẫn được; không treo.

---

## Phase 7 — Client

### Settings panels
- **Xoá:** raw-toml, background, services, hooks, agent panels (Phase 0).
- **`provider-panel.tsx` REWRITE:** radio `CLAUDE_PROVIDER` (oauth | api). `oauth` → field `CLAUDE_CODE_OAUTH_TOKEN`. `api` → `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_MODEL`. Nút "Test connection" → `POST /api/config/test`.
- **`models-panel.tsx` REWRITE:** `DEFAULT_MODEL` chọn từ `claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5-20251001`.
- **`kimi-defaults-panel.tsx` → `defaults-panel.tsx`:** default approvalMode/thinking.
- **`kimi-section.tsx`** → rename + trỏ panel mới.
- `api/kimi-config.ts` + `lib/kimi-config-store.ts` → `api/config.ts` + `lib/config-store.ts` (key-value).

### Timeline adapters (`adapter-registry.ts` + adapters)
Remap tên tool Kimi → Claude. Giữ cấu trúc adapter:

| adapter | Claude tools |
|---|---|
| file-adapters | `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` |
| shell-adapter | `Bash`, `BashOutput`, `KillShell` |
| web-adapters | `WebSearch`, `WebFetch` |
| task-adapters | `Task` (subagent), `TodoWrite` |
| think-adapter | thinking blocks |
| approval-adapter | `approval_request`/`question_request` (giữ) |
| todo-adapter | `TodoWrite` items |
| fallback-adapter | tool lạ |

Thêm adapter cho `AskUserQuestion` (render options + preview html) và `Glob`/`Grep`.

### Composer / store
- `chat-input.tsx`: selector `approvalMode` 3 trị — `ask` / `safe` (Safe · pre-approved tools) / `bypass` (Bypass · YOLO); giữ `thinking`; model list đổi sang Claude. Bỏ UI steer, bỏ toggle `yoloMode` riêng.
- `chat-store.ts`, `chat-view.tsx`: bỏ xử lý `steer_input`/`steer` block; còn lại giữ (wire không đổi).

### Shared
- `shared/types.ts`: `APPROVAL_MODES = ['ask','safe','bypass'] as const`; bỏ `yoloMode` khỏi `CreateSessionPayload`/`SendMessagePayload`/`SnapshotPayload`/`SessionListItem`; bỏ `'steer_input'` (cả 2 chiều) khỏi `WSMessageType` + `SteerInputPayload` + `steer` khỏi `Block`; sửa comment `TurnEndStatus` (bỏ tham chiếu Kimi); thêm `totalCostUsd` nếu hiển thị; `kimiSessionId`→`sdkSessionId`.
- `shared/types/kimi-config.ts` → `shared/types/config.ts` (DTO key-value).

**Checkpoint:** UI build sạch; tạo session từ UI, thấy stream/approve/question/title; settings provider-switch lưu được.

---

## Phase 8 — Verify

- `bun run typecheck` (toàn monorepo) sạch.
- `bunx biome check` sạch.
- `bun --filter server test` (isolated runner) — viết lại test cho: `buildAgentEnv` (provider switch + whitelist), `encodeCwd`/transcript path, `transcript-render` (JSONL→blocks), `canUseTool` (3 tier), config diff/sync. Mỗi file 1 process (giữ isolation invariant).
- Smoke: `claude` qua `which`; oauth + api provider; resume sau restart; interrupt giữa turn; `bypass` (`bypassPermissions`) chạy non-root, sandbox off, không cần `bwrap`; `AskUserQuestion` vẫn tới user dưới `bypass`.

---

## Caveat / ghi nhận

- **`bypass` = `bypassPermissions` + `allowDangerouslySkipPermissions: true`** — chỉ hợp lệ khi **non-root** (binary từ chối `bypassPermissions` dưới root/sudo). `bypassPermissions` không kéo theo `bwrap`.
- **`bwrap`/`socat` không cần ở chế độ non-root + sandbox off.** `bwrap` chỉ bị đòi khi: (a) chạy `root` → bật subprocess env-scrubbing (cần `bwrap`; tắt bằng `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=0`), hoặc (b) bật sandbox feature trong settings (cần `bwrap` + `socat` cho network proxy). App non-root + không bật sandbox → không cần, không truyền `IS_SANDBOX`/`CLAUDE_CODE_BUBBLEWRAP`.
- **Cài sẵn `bwrap` + `socat` ở runtime stage** (cạnh các apt package sẵn có), **sandbox vẫn off** — dự phòng: lỡ env-scrubbing bị ép về sau không crash, và bật sandbox không phải build lại image. Cô lập chéo-user trong container là follow-up bảo mật riêng (cần write/network allowlist), không thuộc migration.
- **steer** mid-turn: không có tương đương → interrupt + gửi message mới.
- MCP `command`/stdio: bỏ build; `/mcp` chỉ đọc status.
- 3-file Kimi session granularity → 1 JSONL (đơn giản hơn, không mất gì với resume).

## Chưa build (mode SDK còn lại)

`permissionMode` còn `'plan'` (read-only planning), `'dontAsk'` (không hỏi, deny nếu chưa pre-approve), `'auto'` (model-classifier). Không đưa vào enum người dùng bây giờ; thêm sau nếu cần.
