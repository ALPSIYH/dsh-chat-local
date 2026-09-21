# dsh-chat-local

[中文](README.md) · **English**

Multi-agent collaboration in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), with persistent identities, user-defined personas, and memories grounded in each agent's own experience.

Build a team, start separate conversations for different topics, and let members hand off work, submit results, and request review. An agent can recall material it has actually seen across conversations and execution sessions. Other members' private experiences do not automatically become shared memory.

## Features

| Feature | What it does |
| --- | --- |
| Teams and conversations | Reuse members and default settings while keeping each conversation's messages, work ledger, and permissions separate. |
| Agent interaction | Consult members in order or address them with `@` mentions. Agents can pass work to one another within bounded turn budgets. |
| Work ledger | Track owners, evidence, progress, and submissions, with acceptance recorded by the designated reviewer. |
| Persona Markdown | Define each agent's personality, communication preferences, and working habits, with version history and conflict handling. |
| Personal long-term memory | Build memory from material actually delivered or read, and from the agent's own output, retaining references to its sources. |
| Memory maintenance | Deduplicate repeated material, reduce older material's default recall priority, and support pinning and reversible suppression. |
| Execution and permissions | Run members through real DSH sessions, using the host's models, tools, sandbox, and approval settings. |

## Getting started

The interface currently uses Chinese labels. The steps below retain those labels so you can find the corresponding controls.

### 1. Install

The verified DSH version is `0.1.5-rc.2`. Install [dsh-bridge](https://github.com/baixianger/dsh-bridge) first; it handles waking local sessions and delivering messages.

```sh
dsh plugin --profile web add github:ALPSIYH/dsh-chat-local
```

Restart `dsh web` after installation, then select **群聊** (Group chat) in the sidebar. Before upgrading an existing installation, back up the complete data directory as described in [Operations](docs/operations.md).

### 2. Configure agents

Open **群聊 → Agent** to create or edit members. Names, roles, and models belong to their work configuration. The **人格** (Persona) editor describes preferences that persist across tasks.

The initial persona is an **inactive template awaiting configuration**. For example:

```md
## Working habits
Start with one testable approach, state the key assumptions, then implement it.
Revise conclusions when new evidence arrives and explain which premise changed.

## Communication preferences
Lead with the conclusion. Distinguish confirmed facts, inferences, and open questions.
```

Saved settings apply to subsequent turns. Personas are not rewritten automatically and do not grant additional execution permissions.

### 3. Create a group and start a conversation

Create a group, choose its members, and start a conversation for a topic. Use the team defaults or adjust the participants, working directory, and permissions for that conversation.

With automatic collaboration enabled (**自動協作** or **自动协作**, depending on the view), ordinary messages consult members in order. Use `@alias` to direct a handoff. The ledger at the top tracks ownership, submissions, and acceptance. Saving member or team settings alone does not start a model call.

See the [User guide](docs/guide.md) for the full workflow.

## How memory follows an agent

```text
Persistent agent identity
├── Persona: user-maintained PERSONA.md
├── Experiences: material actually received, read, or authored
├── Beliefs: evidence-backed interpretations the agent can revise
└── Appraisals: the agent's sourced judgments about other agents
```

Each wake-up receives a length-limited memory summary. Agents can use `chat_recall` to retrieve more. Room-level counts of messages, deliveries, and reviews are maintained separately to help inspect collaboration.

Automatic consolidation currently means **deduplication that preserves source text and provenance**. Forgetting affects retrieval through decay or reversible suppression; the original logs remain. Model-generated semantic consolidation and automatic personality evolution are not implemented, and stable personality in real models has not been demonstrated. See [Memory lifecycle](docs/memory-lifecycle.md).

## Before you use it

- **Permissions affect real sessions.** Workspace-write and full-access settings may remain active after leaving group chat. Members sharing a working directory also operate on the same files. See [Permissions and shared sessions](docs/guide.md#權限與共享會話).
- **Data is stored locally.** The default directory is `~/.dsh/dsh-chat-local/`, and the current state format is v17. Rolling back to an incompatible older version also requires restoring data compatible with that version.
- **Memory has visibility and capacity limits.** Unreceived material, native history from before the plugin was mounted, and non-text content do not automatically become memories. Capacity limits can prevent new writes; unlimited history is not guaranteed.
- **The local management API does not authenticate callers.** Private-memory isolation in agent tools does not protect against programs with access to local files or the management API. Logs and persona files are not encrypted.
- **Traceability does not establish truth.** Logs support provenance and integrity checks, but models can still reason incorrectly. Passing tests or producing consistent short-term replies does not demonstrate a complete simulation of a person.

## Documentation

Chinese remains the default documentation language. The detailed guides linked below are currently in Chinese.

| Task | Read |
| --- | --- |
| Build teams, start conversations, hand off work, and set permissions | [User guide](docs/guide.md) |
| Configure consolidation, decay, pinning, and beliefs | [Memory lifecycle](docs/memory-lifecycle.md) |
| Upgrade, back up, check health, and recover data | [Operations](docs/operations.md) |
| Understand data flow, storage, and implementation boundaries | [Agent memory architecture](docs/agent-memory-architecture.md) · [Storage capacity and cold logs](docs/storage-capacity.md) |
| Design memory comparisons or personality experiments | [Experiments and evaluation](docs/experiments.md) · [Longitudinal personality trials](docs/persona-longitudinal.md) |
| Maintain the project or inspect its history | [Maintainer guide](CONTEXT.md) · [Changelog](CHANGELOG.md) · [Documentation index](docs/README.md) |

## Development

```sh
npm ci
npm run check
```

Run `npm run build` after changing the shared text or work protocols. `check` validates generated content, syntax, and regression tests. To test native DSH integration, set `DSH_MODULES_DIR` to the `node_modules` directory inside the DSH installation. See the [Maintainer guide](CONTEXT.md) for details.

Use `scripts/verify-event-log.mjs` for offline log verification. Follow [Operations](docs/operations.md) and work on a data copy taken after writes have stopped.

[MIT License](LICENSE)
