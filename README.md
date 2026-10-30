# AIDLC — Document Intake Agent

A full-stack application where users upload project documents (SOW, requirements, meeting notes, etc.) and an AI agent reads everything, presents its understanding, and asks clarifying questions before proceeding.

## Tech Stack

- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript
- **LLM:** Google Gemini (gemini-1.5-flash) with swappable adapter pattern
- **File Parsing:** pdf-parse (PDF), mammoth (DOCX), xlsx (Excel), native (TXT/MD)

## Quick Start

```bash
cd AIDLC
npm install
```

Copy `.env.example` to `.env` and add your Gemini API key:

```bash
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your_key_here
```

Run both client and server:

```bash
npm run dev
```

- Client: http://localhost:5173
- Server: http://localhost:3001

## Core Flow

1. **Upload** — Drag and drop PDF, DOCX, XLSX, CSV, MD, or TXT files
2. **Analysis** — AI reads all documents and produces a structured understanding
3. **Understanding** — Review the agent's analysis with confidence scores
4. **Q&A** — Answer clarifying questions interactively or via downloadable markdown
5. **Refined** — Re-analyze with answers incorporated; repeat until confidence is high

## LLM Adapter Pattern

The LLM layer is abstracted behind an `LLMAdapter` interface. Currently implemented:

- **GeminiAdapter** — fully functional (set `GEMINI_API_KEY`)
- **OpenAIAdapter** — stub (set `OPENAI_API_KEY`)
- **ClaudeAdapter** — stub (set `ANTHROPIC_API_KEY`)

The system auto-selects the first configured adapter.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/upload/:sessionId` | Upload files (multipart) |
| GET | `/api/upload/:sessionId/files` | List uploaded files |
| POST | `/api/analyze/:sessionId` | Trigger AI analysis |
| GET | `/api/analyze/:sessionId` | Get latest analysis |
| GET | `/api/questions/:sessionId` | Get questions |
| POST | `/api/questions/:sessionId/answer` | Answer a question |
| POST | `/api/questions/:sessionId/skip` | Skip a question |
| POST | `/api/questions/:sessionId/import-answers` | Import answers from markdown |
| GET | `/api/export/:sessionId/questions` | Download questions as .md |
| GET | `/api/export/:sessionId/understanding` | Download understanding as .md |
| POST | `/api/chat/:sessionId` | Send chat message |

## UX/UI Design Package phase

The phase after Architecture and before Developer Handoff, run by the phase engine from
`server/src/phases/design.config.ts` (UX/UI Designer + Frontend Lead). It follows the UX
team's process, written as markdown a developer can build from without a Figma file.

- **Import:** `requirement.md` **and** `architecture.md`, both phases' Second Brains, their
  confirmed facts, and the Epic & User Stories.
- **Q&A:** UX/UI questions only (platform, design system, brand, accessibility, density,
  dark mode, i18n, navigation): 8 max in cycle 1, 3 in cycle 2. Screens the requirements
  already imply are listed, not asked about.
- **8 sections,** each approved on its own: Overview · Personas · Information Architecture ·
  User Flows · Wireframes · Design System · Screen Definitions · Traceability.
- **Diagrams:** the navigation map and user flows are taken from the approved sections 3 and 4,
  and the component hierarchy is generated. Each is approved separately; a JPG is saved on approval.
- **Deliverables:** `design-inventory.xlsx` (Screen Inventory / Component Library / Design
  Decisions) and **JPG screen designs**. For every screen these are a lo-fi wireframe, a hi-fi
  desktop mockup (1440px) and a hi-fi mobile mockup (390px), plus a style-guide sheet, all
  bundled as a .zip. The server renders them with `sharp` from the approved wireframes and
  design tokens, so no browser is needed.
- **Git:** "Commit to Git" on the export step commits the whole phase folder in one commit
  (text and binary files). This works for every engine phase.

Output: `server/projects/<sessionId>/phases/design/`, which holds `design-package.md`, one
`.md` per section, `second-brain.md/.json`, `diagrams/*.mmd|.jpg`, `images/wireframes/*.jpg`,
`images/hifi/*.jpg`, `images/design-system.jpg` and `reports/design-inventory.xlsx`.

Checks with no LLM calls: `npm run test:design --workspace=server` (end-to-end with a
scripted model) and `npm run render:sample --workspace=server -- <outDir>` (renders sample JPGs).
