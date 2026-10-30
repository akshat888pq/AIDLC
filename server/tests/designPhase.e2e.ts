/**
 * End-to-end check of the UX/UI Design Package phase, with a scripted LLM.
 *
 *   npx tsx tests/designPhase.e2e.ts
 *
 * Seeds an approved requirement + architecture into a throwaway projects folder,
 * then drives the phase engine exactly as the routes do: import → analyze → answer →
 * approval → 8 sections → diagram set → finalize → Excel + JPG deliverables.
 * No network calls; exits non-zero on the first failed check.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import assert from 'assert/strict';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aidlc-design-e2e-'));
process.chdir(workDir); // every store resolves its folder from cwd at import time
process.env.GEMINI_API_KEY = 'test-key';

const SESSION = 'e2e-session';
const prompts: string[] = [];

// ── Seed the two upstream phases ───────────────────────────────────────────────

const REQUIREMENT_MD = `# SiteSafe — Requirements Analysis
REQ-001
## 5. Functional Requirements
- FR-001 Inspectors log in with company SSO
- FR-002 Dashboard shows open, overdue and completed inspections
- FR-003 Inspectors record checklist results with photos
- FR-004 Managers export monthly reports
## Stakeholders
- Field inspectors (tablet, on site)
- Safety managers (desktop, office)`;

const ARCHITECTURE_MD = `# SiteSafe — Architecture Design
ARCH-001
## Frontend
React 18 + Vite + Tailwind CSS (ADR-002). Offline-capable PWA for inspectors.
## APIs
GET /api/inspections, POST /api/inspections/:id/results, GET /api/reports`;

function write(rel: string, content: unknown) {
  const fp = path.join(workDir, 'projects', SESSION, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

const now = new Date().toISOString();
const baseBrain = {
  sessionId: SESSION,
  projectName: 'SiteSafe',
  createdAt: now,
  lastUpdated: now,
  sourceDocuments: [],
  documentUnderstanding: '',
  confidenceScore: 90,
  cycleCount: 2,
  qna: [
    { cycle: 1, questionId: 'Q1', question: 'Who are the users?', category: 'stakeholder', priority: 'critical', answer: 'Field inspectors and safety managers', answeredAt: now },
  ],
  confirmedFacts: ['Users are field inspectors and safety managers'],
  assumptions: [],
  openItems: [],
  humanInputs: [],
  approval: { status: 'approved', approvedAt: now },
};

write('context/second-brain.json', {
  ...baseBrain,
  phaseId: 'requirement',
  generatedStories: {
    epic: { title: 'Site inspections', description: 'Digital inspections', businessValue: 'Safety', acceptanceCriteria: ['Works offline'] },
    stories: [
      { id: 'US-001', title: 'Log in', userStory: 'As an inspector…', storyPoints: 3, priority: 'High', component: 'Auth', labels: [], acceptanceCriteria: ['SSO'] },
      { id: 'US-002', title: 'See dashboard', userStory: 'As a manager…', storyPoints: 5, priority: 'High', component: 'Dashboard', labels: [], acceptanceCriteria: ['Counts'] },
    ],
    generatedAt: now,
    totalStoryPoints: 8,
  },
});
write('phases/requirement/requirement.md', REQUIREMENT_MD);
write('phases/architecture/second-brain.json', {
  ...baseBrain,
  phaseId: 'architecture',
  confirmedFacts: ['Frontend is React 18 + Tailwind CSS'],
});
write('phases/architecture/architecture.md', ARCHITECTURE_MD);
write('phases/architecture/doc.json', {
  id: 'ARCH-001', sessionId: SESSION, phaseId: 'architecture', projectName: 'SiteSafe', generatedDate: '2026-09-01',
  status: 'finalized', sourceDocuments: [], linkedTickets: [], confidenceScore: 90, sections: [], createdAt: now, updatedAt: now,
});

// ── Scripted LLM ───────────────────────────────────────────────────────────────

const SCREENS = [
  ['SCR-001', 'Login', '/login', 'Auth', 'FR-001'],
  ['SCR-002', 'Dashboard', '/dashboard', 'Dashboard', 'FR-002'],
  ['SCR-003', 'Inspection Checklist', '/inspections/:id', 'Inspections', 'FR-003'],
  ['SCR-004', 'Reports', '/reports', 'Reports', 'FR-004'],
];

function sectionMarkdown(n: number): string {
  switch (n) {
    case 3:
      return `## 3. Information Architecture
| Screen ID | Screen | Module | Route | Purpose | Parent | Requirement |
|---|---|---|---|---|---|---|
${SCREENS.map(([id, name, route, mod, fr]) => `| ${id} | ${name} | ${mod} | ${route} | … | — | ${fr} |`).join('\n')}

### 3.5 Navigation Map
\`\`\`mermaid
flowchart LR
  subgraph auth["Auth"]
    scr001["SCR-001 Login"]
  end
  scr002["SCR-002 Dashboard"]
  scr001 -->|"Sign in"| scr002
\`\`\``;
    case 4:
      return `## 4. User Flows
### UF-001: Sign in
\`\`\`mermaid
flowchart TD
  a(["Open app"]) --> b["SCR-001 Login"]
  b --> c(["SCR-002 Dashboard"])
\`\`\`
### UF-002: Complete an inspection
Steps without a diagram — the builder must draw this one.`;
    case 5:
    case 7:
      return `## ${n}. ${n === 5 ? 'Wireframes (Lo-Fi)' : 'Screen Definitions (Developer-Ready)'}
${SCREENS.map(([id, name]) => `#### ${id}: ${name}\nLayout for ${name}.`).join('\n\n')}`;
    case 6:
      return `## 6. Design System Specification
| Token | Hex |
|---|---|
| primary | #0f766e |`;
    default:
      return `## ${n}. Section ${n}\nContent for section ${n}.`;
  }
}

async function fakeAnalyze(system: string, content: string): Promise<string> {
  prompts.push(system);
  if (system.includes('Senior UX/UI Designer working in the AIDLC')) {
    return JSON.stringify({
      projectName: 'SiteSafe',
      understanding: { projectOverview: 'Inspection app UI', scope: { inScope: ['Screen: Dashboard — FR-002'], outOfScope: [], unclear: ['Brand colour'] } },
      confidenceScore: 62,
      questions: Array.from({ length: 10 }, (_, i) => ({
        id: `Q${i + 1}`,
        category: 'other',
        question: `Design question number ${i + 1} about accessibility level ${i}?`,
        context: 'ctx',
        priority: i < 9 ? 'critical' : 'important',
        answerType: 'text',
      })),
    });
  }
  if (system.includes('design question-and-answer phase is COMPLETE')) {
    return JSON.stringify({ projectOverview: 'Responsive web UI', confirmedFacts: ['ShadCN/ui'], assumptions: [], openItems: [], readyToGenerate: true, confidenceScore: 88 });
  }
  const section = system.match(/You are generating SECTION (\d+)/);
  if (section) return sectionMarkdown(Number(section[1]));
  if (system.includes('extracting a structured inventory from a UX/UI design')) {
    return JSON.stringify({
      designSystem: { name: 'ShadCN/ui + Tailwind CSS', rationale: 'ADR-002' },
      platforms: 'Responsive web', accessibility: 'WCAG 2.2 AA', responsiveStrategy: 'Desktop-first',
      darkMode: 'Optional', navigationStyle: 'Sidebar',
      tokens: { primary: '#0f766e', secondary: 'not-a-colour', headingFont: 'Inter', bodyFont: 'Inter', radius: 8 },
      screens: SCREENS.map(([id, name, route, module, fr]) => ({
        id, name, route, module, purpose: `${name} screen`, requirements: [fr],
        components: ['Card', 'Button', 'StatsCard x4 (ShadCN Card)'], apiCalls: ['GET /api/inspections'],
        personas: ['P-01'], authRequired: 'Yes', needsHiFi: id === 'SCR-002', needsClientReview: false,
      })),
      components: [{ component: 'Card', variants: 'default', source: 'ShadCN' }, { component: 'Button', variants: 'default, outline', source: 'ShadCN' }],
      decisions: [{ decision: 'Design system', options: 'ShadCN, MUI', chosen: 'ShadCN/ui', rationale: 'React + Tailwind', impact: 'Use shadcn CLI' }],
      userFlows: [{ id: 'UF-001', name: 'Sign in', persona: 'All', startScreen: 'SCR-001', endScreen: 'SCR-002' }],
    });
  }
  if (system.includes('converting approved text wireframes')) {
    const ids = (system.match(/SCREENS REQUESTED: (.*)/)?.[1] ?? '').split(', ');
    return JSON.stringify({
      screens: ids.map((id) => ({
        id,
        shell: id === 'SCR-001' ? 'centered' : 'sidebar',
        navItems: ['Dashboard', 'Inspections', 'Reports'],
        primaryActions: id === 'SCR-002' ? ['New Inspection'] : [],
        regions: id === 'SCR-001'
          ? [{ kind: 'form', label: '', items: ['Email *', 'Password *'], actions: ['Sign in'] }]
          : [
              { kind: 'stats', label: 'Metrics', items: ['Open: 23', 'Overdue: 4'], actions: [] },
              { kind: 'table', label: 'Inspections', items: ['ID', 'Site', 'Status', 'Due date'], actions: [] },
              { kind: 'bogus-kind', label: 'dropped', items: [], actions: [] },
            ],
      })),
    });
  }
  if (system.includes('COMPONENT HIERARCHY') || system.includes('Draw ONE user flow')) {
    return 'Here you go:\n```mermaid\nflowchart TD\n  app["App"] --> shell["AppShell"]\n```';
  }
  throw new Error(`Unscripted prompt: ${system.slice(0, 120)}`);
}

// ── Drive the phase ────────────────────────────────────────────────────────────

const { GeminiAdapter } = await import('../src/services/llm/gemini.js');
GeminiAdapter.prototype.analyze = fakeAnalyze;

const engine = await import('../src/phases/engine/index.js');
const { getPhase } = await import('../src/phases/index.js');
const { buildDiagramSet, approveSetDiagram, getDiagramSet } = await import('../src/phases/diagramSets.js');
const { generateDeliverable } = await import('../src/phases/deliverables.js');
const { listPackageFiles } = await import('../src/phases/packageFiles.js');
const brain = await import('../src/services/secondBrain.js');
const { getLLM } = await import('../src/state.js');

let checks = 0;
function check(label: string, fn: () => void) {
  fn();
  checks++;
  console.log(`  ✓ ${label}`);
}

const config = getPhase('design')!;
check('design phase is registered and buildable', () => {
  assert.equal(config.name, 'UX/UI Design Package');
  assert.equal(config.comingSoon, undefined);
  assert.equal(config.sections.length, 8);
  assert.equal(engine.projectPhaseProgress(SESSION).find((p) => p.phaseId === 'handoff')?.lockedReason, 'Coming soon');
});

const imported = engine.startPhase(SESSION, 'design')!;
check('import carries requirement.md, architecture.md, stories and both phases\' facts', () => {
  const input = brain.readBrain(SESSION, 'design')!.inputFromPreviousPhase!;
  assert.equal(input.fromPhaseId, 'architecture');
  assert.match(input.previousPhaseDocument!, /ARCH-001/);
  assert.equal(input.earlierPhaseDocuments?.[0].phaseId, 'requirement');
  assert.match(input.earlierPhaseDocuments![0].markdown, /FR-004/);
  assert.equal(imported.storyCount, 2);
  assert.ok(imported.confirmedFacts.includes('Frontend is React 18 + Tailwind CSS'));
  assert.ok(imported.confirmedFacts.some((f) => f.startsWith('[Requirement]')));
});

const analysis = await engine.analyzePhase(SESSION, 'design');
check('round-1 questions are capped at 8 and the prompt carries both documents', () => {
  assert.equal(analysis.questions.length, 8);
  const prompt = prompts[prompts.length - 1];
  assert.match(prompt, /Senior UX\/UI Designer/);
  assert.match(prompt, /SECOND BRAIN — REQUIREMENTS ANALYSIS PHASE/);
});

engine.answerPhaseQuestions(SESSION, 'design', analysis.questions.map((q) => ({ questionId: q.id, answer: 'WCAG 2.2 AA' })));
await engine.generatePhaseApprovalSummary(SESSION, 'design', { force: true });
engine.approvePhaseUnderstanding(SESSION, 'design', 'Sanjay: keep the teal brand colour');
engine.initPhaseSections(SESSION, 'design');

for (let n = 1; n <= 8; n++) {
  await engine.generatePhaseSection(SESSION, 'design', n, n === 5 ? 'Sanjay: show the table as cards on mobile' : undefined);
  engine.approvePhaseSection(SESSION, 'design', n);
}
check('section prompts include requirement.md and the per-section design instruction', () => {
  const wireframePrompt = prompts.find((p) => p.includes('You are generating SECTION 5'))!;
  assert.match(wireframePrompt, /APPROVED REQUIREMENTS ANALYSIS DOCUMENT/);
  assert.match(wireframePrompt, /FR-004/);
  assert.match(wireframePrompt, /EVERY screen in the Section 3 inventory/);
  assert.match(prompts.find((p) => p.includes('You are generating SECTION 1'))!, /DES-PKG-001/);
});
check('reviewer feedback is recorded in the Second Brain', () => {
  const md = brain.readMarkdown(SESSION, 'design')!;
  assert.match(md, /Reviewer Trail/);
  assert.match(md, /show the table as cards on mobile/);
});

const set = await buildDiagramSet(SESSION, 'design', getLLM()!);
check('diagram set: nav map + flows extracted, missing flow + hierarchy generated', () => {
  const byKey = Object.fromEntries(set.map((d) => [d.key, d]));
  assert.equal(byKey['navigation-map'].origin, 'extracted');
  assert.equal(byKey['user-flow-01-sign-in'].origin, 'extracted');
  assert.equal(byKey['user-flow-02-complete-an-inspection'].origin, 'generated');
  assert.equal(byKey['component-hierarchy'].origin, 'generated');
  assert.equal(set.length, 4);
});
for (const d of set) approveSetDiagram(SESSION, 'design', d.key!);
const rebuilt = await buildDiagramSet(SESSION, 'design', getLLM()!);
check('rebuilding keeps approval of unchanged extracted diagrams', () => {
  assert.equal(rebuilt.find((d) => d.key === 'navigation-map')!.status, 'approved');
});
for (const d of getDiagramSet(SESSION, 'design')) approveSetDiagram(SESSION, 'design', d.key!);

const finalized = engine.finalizePhase(SESSION, 'design');
const designDir = path.join(workDir, 'projects', SESSION, 'phases', 'design');
check('finalize writes design-package.md with diagrams, and one file per section', () => {
  assert.equal(finalized.documentId, 'DES-PKG-001');
  assert.match(finalized.markdown, /## 9\. Design Diagrams/);
  for (const f of ['design-package.md', 'design-package-overview.md', 'user-personas.md', 'information-architecture.md', 'user-flows.md', 'wireframes.md', 'design-system.md', 'screen-definitions.md', 'design-traceability.md', 'second-brain.md', 'second-brain.json']) {
    assert.ok(fs.existsSync(path.join(designDir, f)), `missing ${f}`);
  }
  assert.ok(fs.existsSync(path.join(designDir, 'diagrams', 'navigation-map.mmd')));
  assert.equal(engine.phaseStatus(SESSION, 'design').diagram.status, 'approved');
});

const inventory = await generateDeliverable(SESSION, config, 'design-inventory', getLLM()!);
check('design-inventory.xlsx has 3 sheets and computed component usage', () => {
  assert.ok(inventory.fileAvailable);
  assert.ok(inventory.downloadUrl?.endsWith('/deliverables/design-inventory/download'));
  const model = JSON.parse(fs.readFileSync(path.join(designDir, 'design-model.json'), 'utf-8'));
  const card = model.components.find((c: any) => c.component === 'Card');
  assert.equal(card.usageCount, 8); // "Card" + "StatsCard x4 (ShadCN Card)" on 4 screens
  assert.ok(model.tokens.defaulted.includes('secondary'));
  assert.equal(model.screens[1].regions.length, 2); // the bogus region kind was dropped
});
const XLSX = (await import('xlsx')).default;
check('workbook sheet names match the spec', () => {
  const wb = XLSX.readFile(path.join(designDir, 'reports', 'design-inventory.xlsx'));
  assert.deepEqual(wb.SheetNames, ['Screen Inventory', 'Component Library', 'Design Decisions']);
});

const images = await generateDeliverable(SESSION, config, 'design-images', getLLM()!);
check('design-images renders 3 JPGs per screen + style guide, zipped', () => {
  const rendered = images.payload.images as { file: string }[];
  assert.equal(rendered.length, SCREENS.length * 3 + 1);
  for (const img of rendered) {
    const buf = fs.readFileSync(path.join(designDir, 'images', img.file));
    assert.deepEqual([...buf.subarray(0, 3)], [0xff, 0xd8, 0xff], `${img.file} is not a JPEG`);
  }
  const zip = fs.readFileSync(path.join(designDir, 'images', 'DES-PKG-001-screen-designs.zip'));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.match(brain.readMarkdown(SESSION, 'design')!, /### Screen Inventory[\s\S]*SCR-002 Dashboard[\s\S]*needs Hi-Fi/);
});

check('git package lists documents, images and xlsx but not working files or the zip', () => {
  const files = listPackageFiles(SESSION, config).map((f) => f.path);
  assert.ok(files.includes('wireframes.md'));
  assert.ok(files.includes('images/hifi/SCR-002-dashboard-mobile.jpg'));
  assert.ok(files.includes('reports/design-inventory.xlsx'));
  assert.ok(!files.includes('doc.json') && !files.some((f) => f.endsWith('.zip')));
});

check('proceed is offered to Developer Handoff, which is not buildable yet', () => {
  assert.throws(() => engine.proceedToNextPhase(SESSION, 'design'), /Developer Handoff Package phase is not available yet/);
});

console.log(`\n${checks} checks passed. Output left in ${designDir}`);
