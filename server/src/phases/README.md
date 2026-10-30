# The phase engine

One implementation of the AIDLC workflow, driven by a config per phase.

```
import / upload → analyze → ≤2 question cycles → human approval
                → section-by-section generation → finalize → deliverables → hand off
```

Everything in that line is generic. What differs between phases — the prompts, the
sections, the deliverables, the question budget — lives in a `PhaseConfig`.

## Layout

| File | What it holds |
|---|---|
| `phaseConfig.ts` | The `PhaseConfig` contract, and the descriptor the browser gets (prompts never leave the server) |
| `registry.ts` | `PHASE_ORDER` and the register/lookup functions |
| `index.ts` | Registers every phase. Importing this module is what makes a phase exist |
| `<phase>.config.ts` | One phase's prompts, sections and deliverables |
| `engine/index.ts` | The workflow itself: start, analyze, questions, approval, sections, finalize, proceed |
| `engine/prompts.ts` | Generic prompt construction (JSON contract, cycle rules, section framing) |
| `engine/phaseState.ts` | A phase's working state (the current question round) |
| `engine/phaseDocStore.ts` | A phase's section document |
| `deliverables.ts` | Handlers for the artifacts a phase declares |

Routes: `server/src/routes/phaseEngine.ts` → `/api/phase/:phaseId/:sessionId/...`
plus the Agent Hub at `/api/phases`.

## Adding a phase

1. Write `design.config.ts` — question prompt, section templates, section prompt,
   approval prompt, deliverables, `outputFileName`, `docIdPrefix`.
2. Register it in `index.ts` (and make sure its id is in `PHASE_ORDER`).
3. Drop `comingSoon: true`.

That is the whole exercise. Routes, UI, the Second Brain, the question budget, the
approval gate, progress tracking and the hand-off all work already.

Register a handler in `deliverables.ts` for each deliverable id the config declares —
a declared deliverable with no handler answers 501 rather than failing quietly.

## On-disk layout

```
projects/<sessionId>/
├── context/                     requirement phase brain (the original path)
├── reports/                     requirement phase reports (the original path)
├── phase-progress.json          which phases are started / finished
└── phases/
    ├── requirement/
    │   └── second-brain.md      read-only mirror of context/
    └── architecture/
        ├── second-brain.{md,json}
        ├── state.json           the current question round
        ├── doc.json             the section document
        ├── architecture.md      the finalized output
        ├── deliverables.json
        └── reports/             generated workbooks
```

One project owns one session id, and that session hosts every phase. The transition
endpoint returns `nextSessionId` for callers that don't need to know that.

## Two rules worth keeping

**The requirement phase is delegated, not reimplemented.** For `requirement` the
engine calls the same services the legacy routes call — `analyzeDocuments`,
`generateUnderstandingSummary`, `getSectionPrompt`, `requirementStore`. Both entry
points therefore read and write the same files, and a project can move between them
mid-flight. Don't fork that path: fix it in the shared service.

**Question budgets are enforced on the server.** The model is never trusted to
respect its own cycle limit, and a question already answered in this phase *or any
earlier one* is dropped before the user sees it (`enforceQuestionBudget`).
