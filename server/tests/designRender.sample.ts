/**
 * Renders a representative design model to JPG so the renderer can be checked by
 * eye without an LLM or a project on disk:
 *
 *   npx tsx tests/designRender.sample.ts <outDir>
 */
import path from 'path';
import { renderDesignImages } from '../src/services/designRender.js';
import { DEFAULT_TOKENS, type DesignModel } from '../src/services/designModel.js';

const nav = ['Dashboard', 'Inspections', 'Sites', 'Reports', 'Settings'];

const model: DesignModel = {
  packageId: 'DES-PKG-001',
  projectName: 'SiteSafe Inspections',
  sourceHash: 'sample',
  generatedAt: new Date().toISOString(),
  designSystem: { name: 'ShadCN/ui + Tailwind CSS', rationale: 'Architecture fixes React 18 + Tailwind (ADR-002)' },
  platforms: 'Responsive web — desktop and tablet primary, mobile for field inspectors',
  accessibility: 'WCAG 2.2 AA; ADA compliance required',
  responsiveStrategy: 'Desktop-first; 1280px+ / 768–1279px / <768px',
  darkMode: 'Optional toggle',
  navigationStyle: 'Sidebar on desktop, bottom tabs on mobile',
  tokens: { ...DEFAULT_TOKENS, primary: '#0f766e', accent: '#f97316', defaulted: ['accent'] },
  screens: [
    {
      id: 'SCR-001',
      name: 'Login',
      route: '/login',
      module: 'Auth',
      purpose: 'Sign in with your company account',
      requirements: ['FR-010'],
      components: ['Card', 'Input', 'Button'],
      apiCalls: ['POST /api/auth/login'],
      personas: ['All users'],
      authRequired: 'No',
      needsHiFi: false,
      needsClientReview: false,
      shell: 'centered',
      navItems: [],
      primaryActions: [],
      regions: [
        { kind: 'form', label: '', items: ['Email *', 'Password *'], actions: ['Sign in', 'Forgot password?'] },
      ],
    },
    {
      id: 'SCR-002',
      name: 'Dashboard',
      route: '/dashboard',
      module: 'Dashboard',
      purpose: 'Overview of inspections across all sites',
      requirements: ['FR-001', 'FR-002'],
      components: ['Card', 'Table', 'DropdownMenu'],
      apiCalls: ['GET /api/inspections'],
      personas: ['P-01 Sarah'],
      authRequired: 'Yes',
      needsHiFi: true,
      needsClientReview: true,
      shell: 'sidebar',
      navItems: nav,
      primaryActions: ['New Inspection', 'Export'],
      regions: [
        { kind: 'stats', label: 'Key metrics', items: ['Total inspections: 128', 'Open: 23', 'Overdue: 4', 'Completed this week: 17'], actions: [], columns: 4 },
        { kind: 'filters', label: '', items: ['Search inspections', 'Site', 'Status', 'Inspector'], actions: [] },
        { kind: 'table', label: 'Recent inspections', items: ['Inspection ID', 'Site', 'Inspector', 'Status', 'Due date', 'Actions'], actions: [] },
        { kind: 'chart', label: 'Inspections per week', items: ['Completed', 'Scheduled'], actions: [] },
      ],
    },
    {
      id: 'SCR-003',
      name: 'Inspection Detail',
      route: '/inspections/:id',
      module: 'Inspections',
      purpose: 'Everything recorded for one inspection',
      requirements: ['FR-004'],
      components: ['Tabs', 'Card', 'Badge'],
      apiCalls: ['GET /api/inspections/:id'],
      personas: ['P-01 Sarah'],
      authRequired: 'Yes',
      needsHiFi: false,
      needsClientReview: false,
      shell: 'sidebar',
      navItems: nav,
      primaryActions: ['Edit'],
      regions: [
        { kind: 'tabs', label: '', items: ['Overview', 'Checklist', 'Photos', 'History'], actions: [] },
        { kind: 'detail', label: 'Inspection', items: ['Site: North Depot', 'Inspector: Sarah Chen', 'Scheduled: 14 Mar 2026', 'Status: In progress'], actions: [] },
        { kind: 'cards', label: 'Photos', items: ['Loading bay', 'Fire exit', 'Roof access'], actions: ['View'] },
        { kind: 'list', label: 'Activity', items: ['Sarah Chen added 3 photos', 'Marcus Reid assigned the inspection', 'Checklist created'], actions: [] },
      ],
    },
  ],
  components: [],
  decisions: [],
  userFlows: [],
};

const outDir = path.resolve(process.argv[2] ?? 'design-render-sample');
const images = await renderDesignImages(model, outDir);
for (const img of images) console.log(`${img.file}  ${img.width}x${img.height}`);
