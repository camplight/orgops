# Graph Report - orgops  (2026-10-13)

## Corpus Check
- 297 files · ~179,534 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 8 file(s) not represented in the graph (top: (none) 5, .css 2, .example 1)

## Summary
- 2206 nodes · 4867 edges · 123 communities (113 shown, 10 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- UI Button Primitives
- Wrapper Harness Runtime
- User UI App Shell
- User UI Package Deps
- Spec and Lessons Docs
- Admin Dashboard Drawers
- Skill Scripts Shared
- RLM REPL Engine
- Drizzle Operators A
- Chat Screen
- API Core and Drizzle
- User UI Conversations
- Agent Memory Prompts
- Opscli Package Deps
- Admin UI API Client
- Channel Event Injection
- API Package Deps
- Agent Invite Auth
- Channel Events Context
- Events Tools
- RLM Tests
- Integration Auth
- DB Schema
- Runner Package Deps
- Runner Entrypoint Loop
- Opscli Components
- Architecture Concepts
- Event Routes
- Scenario Tests
- JSON Render Block
- Admin UI Native Deps
- Skills Routes
- Opscli CLI Parsing
- Opscli Browser Shortcuts
- Admin UI Config
- Tavily Crawl Skill
- Memory Tools
- Prompt Composer
- Admin UI Scripts
- Wrapped Runtime
- Agents Routes
- Secrets and Scoping
- LLM Package
- agent-runner/src/tools/shell.ts
- createAccessControl()
- loadBundledDocsText()
- lib/config.ts
- touchRunnerTokenLastUsed()
- RequestUser
- user-ui/src/api.ts
- fs.ts
- InstallComponent
- MAX_OUTPUT_CHARS
- isAgentSubscribed()
- createToolFunctions()
- registerCollabRoutes()
- admin-ui.ts
- bundle.ts
- runtime-state.ts
- apiJson()
- tools/agents.ts
- printDoctor()
- prereqs.ts
- db/package.json
- refreshCrossChannelFullMemory()
- intent-watchdog.ts
- package.json
- llm/package.json
- dev-all-clean.ts
- IntentWatchRecord
- ci-smoke.mjs
- AppLayout.tsx
- src/prompt.ts
- schemas/package.json
- skills/package.json
- tsconfig.base.json
- AgentsScreen.tsx
- PROGRESS_ENABLED
- OrgopsSecretInput.tsx
- devDependencies
- optionalDependencies
- rlm-process.ts
- asInt()
- entrypoint.sh
- events-scenario-tests/package.json
- api/tsconfig.json
- runner-bootstrap.ts
- user-ui/tsconfig.json
- devDependencies
- crypto/package.json
- admin-ui/tsconfig.json
- event-bus/package.json
- js-runtime/package.json
- start-runner-after-api.ts
- agent-runner/tsconfig.json
- opscli/tsconfig.json
- shouldRenderMarkdown()
- apps/api/src/app.test.ts (78 tests)
- overrides
- gcli/assets/ensure.ts
- dependencies
- scripts
- Focused API/auth/WebSocket suite: 3 file
- event-type-guard.ts
- crypto/tsconfig.json
- db/tsconfig.json
- event-bus/tsconfig.json
- events-scenario-tests/tsconfig.json
- js-runtime/tsconfig.json
- llm/tsconfig.json
- schemas/tsconfig.json
- skills/tsconfig.json
- allowScripts
- delete.ts
- list-keys.ts
- set.ts
- tailwind.config.ts
- ensure-playwright-python.sh
- install-lightpanda.sh

## God Nodes (most connected - your core abstractions)
1. `App()` - 78 edges
2. `createApp()` - 50 edges
3. `createTurnExecutor()` - 43 edges
4. `App()` - 32 edges
5. `ChatScreen()` - 30 edges
6. `Button()` - 29 edges
7. `Card()` - 28 edges
8. `Event` - 28 edges
9. `Input()` - 26 edges
10. `Agent` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Agent modes (CLASSIC, RLM_REPL, WRAPPED)` --semantically_similar_to--> `RLM_REPL mode (done(result), spawnSubagent)`  [INFERRED] [semantically similar]
  AGENTS.md → apps/agent-runner/README.md
- `createApp()` --indirect_call--> `getCoreEventShapes()`  [INFERRED]
  apps/api/src/app.ts → packages/schemas/src/event-shapes.ts
- `createApp()` --indirect_call--> `serializeEventShapes()`  [INFERRED]
  apps/api/src/app.ts → packages/schemas/src/event-shapes.ts
- `createApp()` --indirect_call--> `validateEventAgainstShapes()`  [INFERRED]
  apps/api/src/app.ts → packages/schemas/src/event-shapes.ts
- `createApp()` --indirect_call--> `listSkills()`  [INFERRED]
  apps/api/src/app.ts → packages/skills/src/index.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **OrgOps runtime components** — apps_api_readme_api, apps_agent_runner_readme_agent_runner, apps_admin_ui_readme_admin_ui, apps_user_ui_readme_user_ui, apps_opscli_readme_opscli [EXTRACTED 1.00]
- **OpsCLI CI and release pipeline** — github_workflows_opscli_smoke_workflow, github_workflows_release_main_workflow, changelog_release_notes_policy, apps_opscli_readme_opscli [INFERRED 0.85]
- **Wrapped agent invite, redeem and runner bootstrap** — docs_spec_agent_invites, docs_wrapped_agent_invites_bootstrap_flow, docs_spec_wrapped_agents, docs_spec_runner_auth, docs_wrapped_agent_invites_scoped_vs_global_token [EXTRACTED 0.90]
- **Skills using runner-injected secrets as env** — skills_tavily_skill_tavily_skill, skills_trello_cli_skill_trello_cli_skill, skills_slack_skill_slack_skill, docs_spec_secrets [INFERRED 0.85]

## Communities (123 total, 10 thin omitted)

### Community 0 - "UI Button Primitives"
Cohesion: 0.12
Nodes (36): Button(), ButtonProps, Variant, variantClasses, Card(), CardProps, Input(), Label() (+28 more)

### Community 1 - "Wrapper Harness Runtime"
Cohesion: 0.08
Nodes (47): CommandResult, commandWrapperHarness, ensureSidecarStarted(), ensureSourceCheckout(), extractPayloadTexts(), extractPayloadTextsFromJsonOutput(), filterWrappedSecretsEnv(), firstCompleteJsonObjects() (+39 more)

### Community 2 - "User UI App Shell"
Cohesion: 0.07
Nodes (48): agentVisibleToUserUi(), handlePopState(), loadShell(), canManageUserChannel(), CHANNEL_GROUPS, channelDisplayName(), ChannelGroupId, channelHasHumanParticipant() (+40 more)

### Community 3 - "User UI Package Deps"
Cohesion: 0.04
Nodes (47): dependencies, react, react-dom, react-markdown, recharts, remark-gfm, devDependencies, @types/react (+39 more)

### Community 4 - "Spec and Lessons Docs"
Cohesion: 0.05
Nodes (44): Lesson two instructions, OrgOps Implementation Spec, Agent invites and scoped runner tokens, Agent modes CLASSIC / RLM_REPL / WRAPPED, Agent runner loop, Channel visibility and sharing, Single image container runtime with HAProxy, Dynamic event shape validation (+36 more)

### Community 5 - "Admin Dashboard Drawers"
Cohesion: 0.09
Nodes (37): getApiHeaders(), AgentForm, DashboardDrawers(), DashboardDrawersProps, EventFilters, DashboardEventStats, toDashboardEventStats(), useOrgOpsData() (+29 more)

### Community 6 - "Skill Scripts Shared"
Cohesion: 0.09
Nodes (43): Args, emitOrgOpsEvent(), ensureOrgOpsChannelSubscription(), getAgent(), getEnvForAgent(), parseArgs(), printUsage(), requireString() (+35 more)

### Community 7 - "RLM REPL Engine"
Cohesion: 0.08
Nodes (37): bindSessionRuntime(), buildSystemMessage(), createBaseContext(), createSession(), DoneEventNormalizationResult, ensurePostingAgentParticipantInChannel(), evaluateInput(), extractCode() (+29 more)

### Community 8 - "Drizzle Operators A"
Cohesion: 0.09
Nodes (28): AccessControl, AccessDeps, AgentAccessRow, ChannelAccessRow, RunnerScope, AGENT_MEMORY_CONTEXT_MODES, AgentsDeps, CollabDeps (+20 more)

### Community 9 - "Chat Screen"
Cohesion: 0.09
Nodes (39): AgentContextUsage, AgentMemory, asObject(), ChatScreen(), ChatScreenProps, compactInlineText(), ContextRing(), createLocalAttachmentId() (+31 more)

### Community 10 - "API Core and Drizzle"
Cohesion: 0.10
Nodes (27): AppConfig, AppEnv, TestApp, AuthDeps, buildSessionCookie(), CookieSecureMode, getCookieSecureMode(), isRequestHttps() (+19 more)

### Community 11 - "User UI Conversations"
Cohesion: 0.10
Nodes (36): apiFetch(), getApiHeaders(), App(), handleAddParticipant(), handleAddShare(), handleComposerPaste(), handleCopyShareLink(), handleDeleteChannel() (+28 more)

### Community 12 - "Agent Memory Prompts"
Cohesion: 0.09
Nodes (35): buildSystemMemoryMessage(), getCrossFullMemoryRecord(), getCrossMemoryRecord(), getCrossRecentMemoryRecord(), contentForTelemetry(), executeTool(), buildFallbackMessageEvent(), buildProviderUsageTelemetry() (+27 more)

### Community 13 - "Opscli Package Deps"
Cohesion: 0.06
Nodes (37): dependencies, @orgops/llm, tar, zod, devDependencies, esbuild, postject, tsx (+29 more)

### Community 14 - "Admin UI API Client"
Cohesion: 0.10
Nodes (27): API_HEADERS, apiFetch(), apiJson(), App(), buildEventQueryParams(), ChatAttachment, ChatTarget, DEFAULT_EVENT_FILTERS (+19 more)

### Community 15 - "Channel Event Injection"
Cohesion: 0.11
Nodes (16): pullInjectedEventMessages(), PullInjectedEventsInput, roleForEvent(), createChannelLoopManager(), CreateChannelLoopManagerInput, WorkerState, getPayloadTargetAgentName(), shouldHandleEventForAgent() (+8 more)

### Community 16 - "API Package Deps"
Cohesion: 0.06
Nodes (31): dependencies, drizzle-orm, google-auth-library, hono, @hono/node-server, @hono/node-ws, @orgops/crypto, @orgops/db (+23 more)

### Community 17 - "Agent Invite Auth"
Cohesion: 0.13
Nodes (31): AgentInviteRow, findActiveInviteByToken(), findActiveRunnerTokenByToken(), generateAgentInviteToken(), generateRunnerScopedToken(), hashToken(), parseStringArraySafe(), RunnerTokenRow (+23 more)

### Community 18 - "Channel Events Context"
Cohesion: 0.13
Nodes (31): ApiFetch, listChannelEvents(), listChannelEventsAfter(), ApiFetch, buildChannelRecentDeltaSystemMessage(), ChannelMemoryMode, ChannelMemoryRecord, chunkEvents() (+23 more)

### Community 19 - "Events Tools"
Cohesion: 0.09
Nodes (33): channelCreateSchema, channelDeleteSchema, channelJoinSchema, channelLeaveSchema, channelMessagesSchema, channelParticipantMutationSchema, channelParticipantsSchema, channelsListSchema (+25 more)

### Community 20 - "RLM Tests"
Cohesion: 0.08
Nodes (22): __resetRlmSessionsForTests(), auditToolPayloadSchema, channelSchema, commandSchema, coreEventShapes, EventDraft, eventEnvelopeSchema, EventValidationIssue (+14 more)

### Community 21 - "Integration Auth"
Cohesion: 0.13
Nodes (28): findActiveIntegrationKey(), generateIntegrationToken(), hashIntegrationToken(), INTEGRATION_TOKEN_PREFIX, IntegrationKeyRow, parseBearerToken(), touchIntegrationKeyLastUsed(), EmbedConversationRow (+20 more)

### Community 22 - "DB Schema"
Cohesion: 0.06
Nodes (29): agentInvites, agents, channelMemoryFull, channelMemoryRecent, channels, channelShareLinks, channelSubscriptions, channelViewers (+21 more)

### Community 23 - "Runner Package Deps"
Cohesion: 0.07
Nodes (29): dependencies, models-dev-db, @orgops/js-runtime, @orgops/llm, @orgops/schemas, @orgops/skills, zod, devDependencies (+21 more)

### Community 24 - "Runner Entrypoint Loop"
Cohesion: 0.11
Nodes (25): clearAgentIntentWatch(), stopAllRlmChildren(), AGENT_INTENT_MAX_TIMEOUTS, AGENT_INTENT_TIMEOUT_MS, CHANNEL_FULL_MEMORY_INTERVAL_MS, CHANNEL_RECENT_MEMORY_INTERVAL_MS, channelLoopManager, CROSS_FULL_MEMORY_INTERVAL_MS (+17 more)

### Community 25 - "Opscli Components"
Cohesion: 0.15
Nodes (27): main(), resolveServiceComponents(), resolveTargetComponents(), checkHttpUp(), clearPid(), COMPONENT_START_COMMAND, COMPONENT_URL, ComponentStatus (+19 more)

### Community 26 - "Architecture Concepts"
Cohesion: 0.08
Nodes (28): Agent modes (CLASSIC, RLM_REPL, WRAPPED), API composition root (app.ts, deps objects), Hand-written SQL migrations, Dynamic event shape registry, Event flow (insertEvent single write path), Per-agent event receipts (at-least-once), Event routing filter (bookkeeping prefixes), OrgOps control plane overview (+20 more)

### Community 27 - "Event Routes"
Cohesion: 0.12
Nodes (16): EventsDeps, registerEventsRoutes(), createEventExportSqlite(), extractSensitiveCiphertext(), getMasterKeyOrThrow(), normalizeSensitiveMessagePayload(), serializeEventQueryFilters(), stringValue() (+8 more)

### Community 28 - "Scenario Tests"
Cohesion: 0.13
Nodes (27): apiFetch(), asNullableString(), canonicalDirectChannelName(), describeMatcher(), evaluateAssertions(), evaluateFileChecks(), EventMatcher, eventMatches() (+19 more)

### Community 29 - "JSON Render Block"
Cohesion: 0.14
Nodes (26): actionName(), actionProp(), ChartPoint, chartPoints(), childIds(), finiteNumber(), isSecretSetAction(), JsonRenderAction (+18 more)

### Community 30 - "Admin UI Native Deps"
Cohesion: 0.08
Nodes (23): lightningcss-darwin-arm64, lightningcss-linux-arm64-gnu, lightningcss-linux-x64-gnu, lightningcss-win32-x64-msvc, react, react-dom, react-markdown, remark-gfm (+15 more)

### Community 31 - "Skills Routes"
Cohesion: 0.13
Nodes (19): getEventShapes(), registerSkillsRoutes(), SkillsDeps, EventShapeDefinition, EVENT_SHAPES_FILENAMES, listSkills(), listSkillsFromRoots(), loadSkillEventShapes() (+11 more)

### Community 32 - "Opscli CLI Parsing"
Cohesion: 0.17
Nodes (19): parseChatArgs(), ParsedCommand, parseGlobalArgs(), printCliHelp(), runChat(), isAbortError(), normalizeToolOutputToModelShape(), normalizeToolResultForHistory() (+11 more)

### Community 33 - "Opscli Browser Shortcuts"
Cohesion: 0.19
Nodes (21): createUiShortcut(), createUserUiShortcut(), desktopDir(), isTruthyEnv(), openUrlInBrowser(), ShortcutTarget, formatComponents(), includesComponent() (+13 more)

### Community 34 - "Admin UI Config"
Cohesion: 0.17
Nodes (20): apiUrl(), configuredApiBase, configuredWsBase, deriveWsBaseFromApiBase(), embedApiOrigin(), isAbsoluteHttpUrl(), isAbsoluteWsUrl(), parseHttpUrl() (+12 more)

### Community 35 - "Tavily Crawl Skill"
Cohesion: 0.13
Nodes (15): args, stdout, tvlyArgs, res, args, stdout, tvlyArgs, ensureTvlyInstalled() (+7 more)

### Community 36 - "Memory Tools"
Cohesion: 0.15
Nodes (21): getChannelFullMemoryRecord(), getChannelMemoryRecord(), getChannelRecentMemoryRecord(), RECENT_MEMORY_WINDOW_MS, ChannelMemoryMode, channelMemorySchema, channelUpdateSchema, CrossMemoryMode (+13 more)

### Community 37 - "Prompt Composer"
Cohesion: 0.13
Nodes (20): ApiFetchFn, AttachmentImageData, buildHistoryTruncationMessage(), buildModelMessages(), buildToolResultToStartIndexMap(), contentCharLength(), estimateContextUsage(), estimateTokensForContent() (+12 more)

### Community 38 - "Admin UI Scripts"
Cohesion: 0.09
Nodes (22): scripts, admin-ui:build, admin-ui:dev, build, dev, dev:all, dev:all:clean, dev:all:no-api (+14 more)

### Community 39 - "Wrapped Runtime"
Cohesion: 0.19
Nodes (16): clearWrappedSetupCache(), ensureWrappedAgentReady(), extFromMime(), hydrateAttachmentPaths(), runWrappedAgentTurn(), sanitizeAttachmentName(), setupCache, stopAllWrappedRuntimes() (+8 more)

### Community 40 - "Agents Routes"
Cohesion: 0.13
Nodes (9): registerAgentsRoutes(), getAgentAllowOutsideWorkspace(), getAgentMemoryContextMode(), isWithinDirectory(), lifecycleChannelName(), normalizeAgentMode(), resolveAgentLifecycleChannelId(), resolveSafeWorkspaceTarget() (+1 more)

### Community 41 - "Secrets and Scoping"
Cohesion: 0.22
Nodes (17): ENV_SCOPE_TYPES, isHumanUser(), isRunnerUser(), isScopedRunner(), KNOWN_SCOPE_TYPES, normalizeScopeType(), parseScopeId(), registerSecretsRoutes() (+9 more)

### Community 42 - "LLM Package"
Cohesion: 0.16
Nodes (18): buildPromptArgs(), generate(), GenerateOptions, GenerateResult, isOpenAICompletionModel(), isOpenAIReasoningModel(), LlmTextPart, LlmToolContent (+10 more)

### Community 43 - "agent-runner/src/tools/shell.ts"
Cohesion: 0.16
Nodes (17): envSchema, execute(), formatZodIssues(), getShellLaunch(), ShellLaunch, splitShellArgs(), parseToolArgs(), processes (+9 more)

### Community 44 - "createAccessControl()"
Cohesion: 0.32
Nodes (19): createAccessControl(), canManageAgent(), canManageChannel(), canPostToChannel(), canViewAgent(), canViewChannel(), getAgent(), getChannel() (+11 more)

### Community 45 - "loadBundledDocsText()"
Cohesion: 0.22
Nodes (13): loadBundledDocsText(), AgentRuntimeState, askPasswordSchema, createAskPasswordTool(), createExitTool(), exitSchema, createOpsCliTools(), createGetBundledDocsTool() (+5 more)

### Community 46 - "lib/config.ts"
Cohesion: 0.16
Nodes (17): COMMAND_TIMEOUT_MS, DEFAULT_ANTHROPIC_MODEL_ID, DEFAULT_API_URL, DEFAULT_OPENAI_MODEL_ID, DEFAULT_OPENROUTER_MODEL_ID, DEFAULT_RUNNER_TOKEN, DOUBLE_SIGINT_WINDOW_MS, MAX_CONTEXT_CHARS (+9 more)

### Community 47 - "touchRunnerTokenLastUsed()"
Cohesion: 0.17
Nodes (12): touchRunnerTokenLastUsed(), createApp(), eventRowToApi(), getDefaultSoulPath(), insertEvent(), jsonResponse(), parseJson(), publishEvent() (+4 more)

### Community 48 - "RequestUser"
Cohesion: 0.18
Nodes (9): RequestUser, getDeferredWsDeliveryDelayMs(), registerWsRoutes(), shouldForwardWsPayload(), WsDeps, WsMessage, WsServerMessage, EventBus (+1 more)

### Community 49 - "user-ui/src/api.ts"
Cohesion: 0.21
Nodes (16): API_HEADERS, apiUrl(), configuredApiBase, configuredWsBase, deriveWsBaseFromApiBase(), isAbsoluteHttpUrl(), isAbsoluteWsUrl(), parseHttpUrl() (+8 more)

### Community 50 - "fs.ts"
Cohesion: 0.16
Nodes (14): execute(), formatZodIssues(), fsListSchema, fsMkdirSchema, fsMoveSchema, fsReadSchema, fsRmSchema, fsStatSchema (+6 more)

### Community 51 - "InstallComponent"
Cohesion: 0.28
Nodes (15): InstallComponent, USER_UI_URL, registerServiceAction(), resolveInstallDir(), unregisterServiceAction(), saveState(), COMPONENT_START_COMMAND, componentSlug() (+7 more)

### Community 52 - "MAX_OUTPUT_CHARS"
Cohesion: 0.20
Nodes (11): MAX_OUTPUT_CHARS, runShell(), CliOptions, ModelProvider, SessionMemory, ShellResult, TaskInterruptedError, mergeShellOutput() (+3 more)

### Community 53 - "isAgentSubscribed()"
Cohesion: 0.27
Nodes (16): isAgentSubscribed(), createRunnerApi(), apiFetch(), emitEvent(), emitStartupEvent(), ensureLifecycleChannel(), getChannelParticipationValidationError(), getChannelRecord() (+8 more)

### Community 54 - "createToolFunctions()"
Cohesion: 0.18
Nodes (12): createToolFunctions(), agentsToolDefs, eventsToolDefs, allToolDefs, createRunnerTools(), memoryToolDefs, shellToolDefs, CreateExecuteFn (+4 more)

### Community 55 - "registerCollabRoutes()"
Cohesion: 0.19
Nodes (11): registerCollabRoutes(), agentExists(), directChannelNameForParticipants(), directParticipantKeyForParticipants(), ensureDirectChannel(), findMissingParticipant(), findMissingViewer(), forbidScopedRunnerMutations() (+3 more)

### Community 56 - "admin-ui.ts"
Cohesion: 0.24
Nodes (12): ADMIN_UI_URL, AdminState, checkHttpOk(), getAdminUiStatus(), isAdminUiReachable(), loadAdminState(), processIsAlive(), resolveInstallDir() (+4 more)

### Community 57 - "bundle.ts"
Cohesion: 0.18
Nodes (14): ensureBundledAssetFile(), extractBundledOrgOps(), getRuntimeAssetPath(), getSeaModule(), loadBundledAssetText(), resolveDefaultExtractedRootPath(), RUNTIME_DIR, runtimeRequire (+6 more)

### Community 58 - "runtime-state.ts"
Cohesion: 0.18
Nodes (7): OpsCliState, STATE_DIR, STATE_PATH, INDEX_SOURCE, TOOLS_SOURCE, AGENT_SOURCE, AGENT_SOURCE

### Community 59 - "apiJson()"
Cohesion: 0.19
Nodes (16): apiJson(), adaptiveMessageBatchSize(), handleIncomingRealtimeEvent(), handleLoadOlderMessages(), handleMessagesScroll(), isMessagesPanelNearBottom(), loadMessageNotifications(), loadMessages() (+8 more)

### Community 60 - "tools/agents.ts"
Cohesion: 0.18
Nodes (14): agentModeSchema, agentsCreateSchema, agentsSearchSchema, agentsUpdateSchema, desiredStateSchema, execute(), formatZodIssues(), memoryContextModeSchema (+6 more)

### Community 61 - "printDoctor()"
Cohesion: 0.26
Nodes (14): printDoctor(), askProviderChoice(), ensureModelCredentials(), getAlternateProviders(), getDefaultModelIdForProvider(), getModelId(), getModelProvider(), getProviderApiKeyEnvKey() (+6 more)

### Community 62 - "prereqs.ts"
Cohesion: 0.16
Nodes (11): checkTool(), ensurePrerequisites(), formatInstallHint(), REQUIRED_TOOLS, ToolCheck, buildReport(), EnsureReport, report (+3 more)

### Community 63 - "db/package.json"
Cohesion: 0.13
Nodes (14): dependencies, better-sqlite3, drizzle-orm, devDependencies, @types/better-sqlite3, drizzle-orm, main, name (+6 more)

### Community 64 - "refreshCrossChannelFullMemory()"
Cohesion: 0.23
Nodes (10): refreshCrossChannelFullMemory(), refreshCrossChannelRecentMemory(), createMaintenanceLoop(), runAgentMaintenancePass(), schedule(), Dependencies, lifecycleChannelName(), shouldRunMemoryMaintenance() (+2 more)

### Community 65 - "intent-watchdog.ts"
Cohesion: 0.26
Nodes (11): asObject(), clampTimeoutMs(), collectDueIntentTimeouts(), hasActiveIntentFlag(), ingestIntentEvents(), IntentPayload, isAgentActionEvent(), isBookkeepingEvent() (+3 more)

### Community 66 - "package.json"
Cohesion: 0.14
Nodes (13): dependencies, cursor-agent, tsx, @types/node, typescript, vitest, name, private (+5 more)

### Community 67 - "llm/package.json"
Cohesion: 0.14
Nodes (13): dependencies, ai, @ai-sdk/anthropic, @ai-sdk/openai, main, name, scripts, lint (+5 more)

### Community 68 - "dev-all-clean.ts"
Cohesion: 0.32
Nodes (13): Agent, API_START_CMD, apiFetch(), assertOk(), cleanupRuntime(), isApiReachable(), main(), sleep() (+5 more)

### Community 69 - "IntentWatchRecord"
Cohesion: 0.22
Nodes (10): IntentWatchRecord, getErrorSummary(), readRunnerIdFromDisk(), RunnerApi, RunnerApiDeps, RunnerIdentityPayload, createSubject(), writeRunnerIdToDisk() (+2 more)

### Community 70 - "ci-smoke.mjs"
Cohesion: 0.19
Nodes (10): assertPath(), binaryPath, distDir, fail(), findBinaryPath(), installDir, repoRoot, run() (+2 more)

### Community 71 - "AppLayout.tsx"
Cohesion: 0.32
Nodes (8): AppLayout(), AppLayoutProps, PageHeader(), PageHeaderProps, NAV_ITEMS, Sidebar(), SidebarProps, Screen

### Community 72 - "src/prompt.ts"
Cohesion: 0.23
Nodes (7): buildRunnerGuidance(), formatCoreEventTypesSection(), formatRunnerHostInfoSection(), RunnerHostInfo, ParentMessage, RunEventPayload, EventTypeSummary

### Community 73 - "schemas/package.json"
Cohesion: 0.17
Nodes (11): dependencies, zod, zod-to-json-schema, zod, main, name, scripts, lint (+3 more)

### Community 74 - "skills/package.json"
Cohesion: 0.17
Nodes (11): dependencies, @orgops/schemas, yaml, @orgops/schemas, main, name, scripts, lint (+3 more)

### Community 75 - "tsconfig.base.json"
Cohesion: 0.17
Nodes (11): compilerOptions, esModuleInterop, lib, module, moduleResolution, noEmit, resolveJsonModule, skipLibCheck (+3 more)

### Community 76 - "AgentsScreen.tsx"
Cohesion: 0.27
Nodes (10): AgentForm, AgentsScreen(), AgentsScreenProps, DEFAULT_AGENT_FORM, DEFAULT_WRAPPED_CONFIG, formatAgentModelLabel(), parseOptionalPositiveIntInput(), parseWrappedConfigJson() (+2 more)

### Community 77 - "PROGRESS_ENABLED"
Cohesion: 0.22
Nodes (9): PROGRESS_ENABLED, SPINNER_ENABLED, ANSI, reportProgress(), rolePrefix(), SpinnerControls, startSpinner(), stylize() (+1 more)

### Community 78 - "OrgopsSecretInput.tsx"
Cohesion: 0.27
Nodes (9): OrgopsSecretInputProps, SubmitTone, hasSecretInputBlock(), parseAttributes(), parseSpec(), readAttr(), SecretInputMarkdownPart, SecretInputSpec (+1 more)

### Community 79 - "devDependencies"
Cohesion: 0.20
Nodes (10): devDependencies, autoprefixer, postcss, tailwindcss, @tailwindcss/postcss, @types/react, @types/react-dom, typescript (+2 more)

### Community 80 - "optionalDependencies"
Cohesion: 0.22
Nodes (9): optionalDependencies, lightningcss-darwin-arm64, lightningcss-linux-arm64-gnu, lightningcss-linux-x64-gnu, lightningcss-win32-x64-msvc, @rolldown/binding-darwin-arm64, @rolldown/binding-linux-arm64-gnu, @rolldown/binding-linux-x64-gnu (+1 more)

### Community 81 - "rlm-process.ts"
Cohesion: 0.31
Nodes (8): AgentChildState, childByAgent, childEntryPath(), createChild(), ensureChild(), RunEventResultMessage, runRlmEventInChild(), LlmMessage

### Community 82 - "asInt()"
Cohesion: 0.53
Nodes (9): asInt(), asNonEmptyString(), clampSummaryText(), registerMemoryRoutes(), mapChannelRecord(), mapCrossRecord(), parseBody(), registerChannel() (+1 more)

### Community 83 - "entrypoint.sh"
Cohesion: 0.39
Nodes (8): build_haproxy_config(), ENABLED, normalize_component(), on_signal(), entrypoint.sh script, shutdown_all(), start_process(), wait_for_local_api()

### Community 84 - "events-scenario-tests/package.json"
Cohesion: 0.22
Nodes (8): main, name, scripts, lint, run, run:countdown, type, version

### Community 85 - "api/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, baseUrl, paths, extends, include, ../../tsconfig.base.json, drizzle-orm

### Community 86 - "runner-bootstrap.ts"
Cohesion: 0.39
Nodes (7): fetchInviteConfig(), normalizeUrl(), readRunnerEnvConfig(), resolveRunnerBootstrap(), RunnerBootstrapConfig, RunnerBootstrapOptions, RunnerInviteResponse

### Community 87 - "user-ui/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, jsx, resolveJsonModule, types, extends, include, ../../tsconfig.base.json

### Community 88 - "devDependencies"
Cohesion: 0.25
Nodes (8): devDependencies, concurrently, dotenv-cli, tsx, @types/node, typescript, vitest, wait-on

### Community 89 - "crypto/package.json"
Cohesion: 0.25
Nodes (7): dependencies, main, name, scripts, lint, type, version

### Community 90 - "admin-ui/tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, jsx, types, extends, include, ../../tsconfig.base.json

### Community 91 - "event-bus/package.json"
Cohesion: 0.29
Nodes (6): main, name, scripts, lint, type, version

### Community 92 - "js-runtime/package.json"
Cohesion: 0.29
Nodes (6): main, name, scripts, lint, type, version

### Community 93 - "start-runner-after-api.ts"
Cohesion: 0.43
Nodes (6): isApiReady(), main(), pollIntervalMs, sleep(), waitForApiReady(), waitTimeoutMs

### Community 94 - "agent-runner/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 95 - "opscli/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 96 - "shouldRenderMarkdown()"
Cohesion: 0.47
Nodes (5): shouldRenderMarkdown(), hasJsonRenderBlock(), isJsonRenderInfo(), MarkdownPart, splitJsonRenderMarkdown()

### Community 97 - "apps/api/src/app.test.ts (78 tests)"
Cohesion: 0.40
Nodes (5): apps/api/src/app.test.ts (78 tests), apps/api/src/google-auth.test.ts (13 tests), Google team membership regression checks (test run screenshot), Vitest run: 3 files, 98 tests passed in 14.29s, apps/api/src/routes/ws.test.ts (7 tests)

### Community 98 - "overrides"
Cohesion: 0.33
Nodes (6): overrides, esbuild, sqlite3, tar, @tootallnate/once, undici

### Community 99 - "gcli/assets/ensure.ts"
Cohesion: 0.53
Nodes (5): buildReport(), EnsureReport, report, run(), safeConfigGet()

### Community 100 - "dependencies"
Cohesion: 0.40
Nodes (5): dependencies, react, react-dom, react-markdown, remark-gfm

### Community 101 - "scripts"
Cohesion: 0.40
Nodes (5): scripts, build, dev, lint, preview

### Community 102 - "Focused API/auth/WebSocket suite: 3 file"
Cohesion: 0.40
Nodes (5): Focused API/auth/WebSocket suite: 3 files, 96 tests passed, Full engine suite: 2 pre-existing macOS failures (shell_status, skills merge first-name-wins), apps/api/src/google-auth.test.ts (12 tests), Google Workspace authentication validation screenshot, API typecheck passed

### Community 104 - "event-type-guard.ts"
Cohesion: 0.67
Nodes (3): getReservedEventTypeError(), isReservedAgentRuntimeEventType(), RESERVED_AGENT_EVENT_PREFIXES

### Community 106 - "crypto/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 107 - "db/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 108 - "event-bus/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 109 - "events-scenario-tests/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 110 - "js-runtime/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 111 - "llm/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 112 - "schemas/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 113 - "skills/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

### Community 115 - "allowScripts"
Cohesion: 0.67
Nodes (3): allowScripts, better-sqlite3, esbuild

## Knowledge Gaps
- **111 isolated node(s):** `react`, `react-dom`, `react-markdown`, `remark-gfm`, `@tailwindcss/postcss` (+106 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 838 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `recharts` connect `User UI Package Deps` to `JSON Render Block`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `App()` (e.g. with `handlePopState()` and `handleShortcut()`) actually correct?**
  _`App()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `react`, `react-dom`, `react-markdown` to the rest of the system?**
  _111 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI Button Primitives` be split into smaller, more focused modules?**
  _Cohesion score 0.1187980433263452 - nodes in this community are weakly interconnected._
- **Why does `tar` connect `Opscli Package Deps` to `bundle.ts`, `Opscli Components`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Are the 15 inferred relationships involving `createApp()` (e.g. with `eventRowToApi()` and `getDefaultSoulPath()`) actually correct?**
  _`createApp()` has 15 INFERRED edges - model-reasoned connections that need verification._
- **Should `Wrapper Harness Runtime` be split into smaller, more focused modules?**
  _Cohesion score 0.0784313725490196 - nodes in this community are weakly interconnected._