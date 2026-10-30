/**
 * The eight sections of the UX/UI Design Package.
 *
 * They follow the UX team's own process (Naveen Bhatia / Sanjay Sharma): personas →
 * information architecture → user flows → lo-fi wireframes → design system → screen
 * definitions a developer can build from without a Figma file → traceability.
 *
 * `fileName` is where each approved section is also written on its own when the
 * package is finalized, so a designer can open "wireframes.md" without scrolling
 * through the whole package.
 */

export interface UxDesignSectionTemplate {
  number: number;
  key: string;
  title: string;
  description: string;
  fileName: string;
  format: string;
}

export const UX_DESIGN_SECTION_TEMPLATES: UxDesignSectionTemplate[] = [
  {
    number: 1,
    key: 'design_package_overview',
    title: 'Design Package Overview',
    fileName: 'design-package-overview.md',
    description:
      'Package metadata, linked requirement and architecture ids, target platforms, chosen design system and why, accessibility standard, key design decisions and architectural constraints on the design.',
    format: `## 1. Design Package Overview

| Field | Value |
|-------|-------|
| Package ID | {DES-PKG-00n} |
| Project | {project name} |
| Linked Requirement | {REQ-00n} |
| Linked Architecture | {ARCH-00n} |
| Owner | UX/UI Designer (Sanjay Sharma) + Frontend Lead |
| Status | Draft |
| Created Date | {date} |
| Version | 1.0 |

### Target Platforms
| Platform | In Scope | Primary Breakpoints | Notes |
|----------|----------|---------------------|-------|
| Web (desktop) | {Yes/No} | {1280px+} | {…} |
| Web (tablet) | {Yes/No} | {768–1279px} | {…} |
| Web (mobile) | {Yes/No} | {<768px} | {…} |
| Native mobile | {Yes/No} | {—} | {…} |

### Design System
- **Chosen:** {e.g. ShadCN/ui on Tailwind CSS 3}
- **Why:** {tie it to the architecture's frontend stack — ARCH section / ADR id}
- **Alternatives considered:** {…}

### Accessibility Standard
- **Target:** {WCAG 2.2 AA}
- **ADA compliance required:** {Yes/No — source}

### Key Design Decisions (from Q&A)
| # | Decision | Source (Q&A / requirement / architecture) |
|---|----------|-------------------------------------------|
| D-01 | {decision} | {source} |

### Design Constraints from Architecture
| Constraint | Source | Effect on the design |
|------------|--------|----------------------|
| {e.g. must work offline} | {ARCH-001 §x} | {e.g. optimistic UI + sync status indicator on every form} |`,
  },
  {
    number: 2,
    key: 'user_personas',
    title: 'User Personas',
    fileName: 'user-personas.md',
    description:
      '2–4 personas, each traced to a stakeholder or user type named in requirement.md: goals, frustrations, tech savviness, device, context of use, key tasks.',
    format: `## 2. User Personas

### P-01: {Name} — {Role}
| Attribute | Detail |
|-----------|--------|
| Traces to | {stakeholder / user type in REQ-00n §x} |
| Tech savviness | {Beginner / Intermediate / Expert} |
| Primary device | {Desktop / Tablet / Mobile} |
| Context of use | {Office / Field / Both} |

**Goals**
- {goal}

**Frustrations**
- {pain point}

**Key tasks** (from functional requirements)
| Task | Requirement |
|------|-------------|
| {task} | {FR-00n} |

{repeat for each persona — 2 to 4 personas total}

### Persona Coverage
| Persona | Stakeholder in requirement | Primary screens |
|---------|----------------------------|-----------------|
| P-01 {Name} | {stakeholder} | {SCR ids — filled after IA} |`,
  },
  {
    number: 3,
    key: 'information_architecture',
    title: 'Information Architecture',
    fileName: 'information-architecture.md',
    description:
      'Every screen grouped by module, the navigation structure, the page hierarchy tree, breadcrumbs, and a Mermaid navigation map. Every screen traces to an FR; FRs with no screen are flagged.',
    format: `## 3. Information Architecture

### 3.1 Screen Inventory
| Screen ID | Screen | Module | Route | Purpose | Parent | Requirement |
|-----------|--------|--------|-------|---------|--------|-------------|
| SCR-001 | {Login} | {Auth} | {/login} | {purpose} | {—} | {FR-00n} |

### 3.2 Navigation Structure
- **Primary navigation (always visible):** {items, in order}
- **Secondary navigation (within sections):** {section → items}
- **Footer navigation:** {items}
- **Navigation pattern:** {sidebar / top nav / bottom tabs / hybrid} — {why}

### 3.3 Page Hierarchy
\`\`\`
Home
├── {Module}
│   ├── {Screen}
│   └── {Screen}
└── Auth
    ├── Login
    └── Forgot Password
\`\`\`

### 3.4 Breadcrumbs
| Screen | Breadcrumb |
|--------|-----------|
| SCR-00n {Screen} | {Home › Module › Screen} |

### 3.5 Navigation Map
\`\`\`mermaid
flowchart LR
  subgraph auth["Auth"]
    scr001["SCR-001 Login"]
  end
  subgraph main["Dashboard"]
    scr002["SCR-002 Dashboard"]
  end
  scr001 -->|"Sign in"| scr002
\`\`\`

### 3.6 Requirement Coverage Gaps
| Requirement | Gap |
|-------------|-----|
| {FR-00n} | {No screen — reason, or "None — every FR has a screen"} |`,
  },
  {
    number: 4,
    key: 'user_flows',
    title: 'User Flows',
    fileName: 'user-flows.md',
    description:
      'The 5–7 most critical user journeys: trigger, step-by-step what the user sees / does / what the system does, error paths, success state, and one Mermaid flowchart per flow.',
    format: `## 4. User Flows

### UF-001: {Flow name}
| Field | Value |
|-------|-------|
| Persona | {P-0n Name} |
| Requirement | {FR-00n, FR-00n} |
| Trigger | {User clicks "Sign Up"} |
| Start screen | {SCR-00n} |
| End screen | {SCR-00n} |

**Steps**
1. **User sees:** {screen + what is on it}
2. **User fills:** {fields}
3. **User clicks:** {"Button label"}
4. **System:** {what happens}
5. **User sees:** {result screen}

**Error paths**
- {Invalid email} → {inline error "Enter a valid email"}

**Success state:** {where the user lands and what they see}

\`\`\`mermaid
flowchart TD
  start(["User clicks Sign Up"]) --> s1["SCR-003 Registration form"]
  s1 --> d1{"Input valid?"}
  d1 -->|"Yes"| s2["Account created"]
  d1 -->|"No"| e1["Inline error shown"]
  e1 --> s1
  s2 --> done(["Lands on SCR-002 Dashboard"])
  classDef happy fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef error fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  class start,s1,s2,done happy
  class e1 error
\`\`\`

{repeat for UF-002 … UF-00n — 5 to 7 flows}`,
  },
  {
    number: 5,
    key: 'wireframes',
    title: 'Wireframes (Lo-Fi)',
    fileName: 'wireframes.md',
    description:
      'A text-based lo-fi wireframe for EVERY screen in the IA: box-drawn layout, components, interactions, responsive behaviour and per-screen accessibility notes.',
    format: `## 5. Wireframes (Lo-Fi)

#### SCR-00n: {Screen name}
- **URL:** {/route}
- **Purpose:** {one line}
- **Requirement:** {FR-00n}

**Layout**
\`\`\`
┌─────────────────────────────────────────────┐
│ HEADER                                      │
│ [Logo]  [Nav 1] [Nav 2] [Nav 3]  [Profile ▼]│
├─────────────────────────────────────────────┤
│ STATS ROW (4 cards)                         │
│ [Label: value] [Label: value] ...           │
├─────────────────────────────────────────────┤
│ MAIN CONTENT                                │
│ [Table: Col A | Col B | Col C]              │
│ [Pagination: < 1 2 3 >]                     │
└─────────────────────────────────────────────┘
\`\`\`

**Components**
- {Region}: {component, placement, behaviour}

**Interactions**
- {Click X} → {navigates to / opens / submits}

**Responsive**
- Desktop (1280px+): {…}
- Tablet (768–1279px): {…}
- Mobile (<768px): {…}

**Accessibility**
- {specific to THIS screen: landmarks, table headers, focus order, announcements}

---

{repeat for EVERY screen in the Section 3 inventory, in SCR id order}`,
  },
  {
    number: 6,
    key: 'design_system',
    title: 'Design System Specification',
    fileName: 'design-system.md',
    description:
      'Concrete tokens (hex colours, font sizes, spacing, radii, shadows) and ShadCN-compatible component specs with variants, sizes and states. Actual values only, mapped to Tailwind classes.',
    format: `## 6. Design System Specification

**Base system:** {ShadCN/ui + Tailwind CSS} — {rationale}
**Units rule:** spacing and sizing in rem (1rem = 16px); layout via flex/grid — no absolute positioning.

### 6.1 Colour Palette
| Token | Hex | Tailwind / CSS variable | Usage |
|-------|-----|-------------------------|-------|
| primary | #4361ee | --primary | Primary actions, active nav |
| primary-foreground | #ffffff | --primary-foreground | Text on primary |
| secondary | {#hex} | --secondary | … |
| accent | {#hex} | --accent | … |
| success | #22c55e | … | … |
| warning | #f59e0b | … | … |
| error | #ef4444 | --destructive | … |
| info | #3b82f6 | … | … |
| background-page | #f8fafc | --background | … |
| background-card | #ffffff | --card | … |
| background-input | #f1f5f9 | --input | … |
| border | #e2e8f0 | --border | … |
| text-primary | #0f172a | --foreground | … |
| text-secondary | #475569 | … | … |
| text-muted | #94a3b8 | --muted-foreground | … |
| text-disabled | #cbd5e1 | … | … |

**Dark mode:** {required / optional / not required} — {dark token table if required}
**Contrast check:** {text-primary on background-page = x.x:1 (AA ✓) …}

### 6.2 Typography
| Style | Font | Size (px / rem) | Weight | Line height | Tailwind |
|-------|------|-----------------|--------|-------------|----------|
| h1 | {Inter} | 36 / 2.25 | 700 | 1.25 | text-4xl font-bold leading-tight |
| h2 | … | 30 / 1.875 | 600 | 1.25 | text-3xl font-semibold |
| h3 | … | 24 / 1.5 | 600 | 1.25 | text-2xl |
| h4 | … | 20 / 1.25 | 600 | 1.5 | text-xl |
| body | … | 16 / 1 | 400 | 1.5 | text-base |
| small | … | 14 / 0.875 | 400 | 1.5 | text-sm |
| caption | … | 12 / 0.75 | 500 | 1.5 | text-xs |

### 6.3 Spacing Scale
| Token | px | rem | Tailwind |
|-------|----|-----|----------|
| 1 | 4 | 0.25 | p-1 / gap-1 |
| … | … | … | … |
| 16 | 64 | 4 | p-16 |

### 6.4 Border Radius
| Token | px | Tailwind |
|-------|----|----------|
| sm | 4 | rounded-sm |
| … | … | … |

### 6.5 Shadows
| Token | Value | Tailwind |
|-------|-------|----------|
| sm | 0 1px 2px rgba(0,0,0,0.05) | shadow-sm |

### 6.6 Breakpoints
| Name | Min width | Tailwind |
|------|-----------|----------|
| mobile | 0 | (default) |
| tablet | 768px | md: |
| desktop | 1280px | xl: |

### 6.7 Component Specifications
#### Button (ShadCN \`Button\`)
| Variant | Background | Text | Border | Hover | Use |
|---------|------------|------|--------|-------|-----|
| default | … | … | … | … | … |
| destructive / outline / secondary / ghost / link | … | … | … | … | … |

| Size | Height | Padding x | Font |
|------|--------|-----------|------|
| sm / md / lg / icon | … | … | … |

States: focus ring {2px #hex, offset 2px}, disabled {opacity 0.5, cursor not-allowed}.

{Then the same level of detail for: Input, Card, Table, Dialog/Modal, Toast, Tabs, Dropdown, Badge, Avatar — plus any custom component the screens need, marked "custom".}`,
  },
  {
    number: 7,
    key: 'screen_definitions',
    title: 'Screen Definitions (Developer-Ready)',
    fileName: 'screen-definitions.md',
    description:
      'For EVERY screen: route, auth, layout grid, design-system components, API endpoints from the architecture, loading / empty / error states, validation, navigation, responsive rules and accessibility.',
    format: `## 7. Screen Definitions (Developer-Ready)

#### SCR-00n: {Screen name}
| Field | Value |
|-------|-------|
| Route | {/route} |
| Auth required | {Yes — role(s) / No} |
| Requirement | {FR-00n, FR-00n} |
| Persona(s) | {P-0n} |
| Layout | {Sidebar + main content, 12-column grid, max-w-7xl} |

**Components (design system)**
| Component | Source | Props / variant | Purpose |
|-----------|--------|-----------------|---------|
| {StatsCard ×4} | {ShadCN Card} | {…} | {…} |

**Data sources (from architecture)**
| Call | Populates | Architecture ref |
|------|-----------|------------------|
| {GET /api/projects} | {DataTable} | {ARCH-00n component / API} |

**States**
- **Loading:** {skeletons for …}
- **Empty:** {message + CTA}
- **Error:** {toast + retry}

**Form validation** (if applicable)
| Field | Rules | Error message |
|-------|-------|---------------|

**Navigation**
- {action} → {route}

**Responsive**
- 1280px+: {…}
- 768–1279px: {…}
- <768px: {…}

**Accessibility**
- Tab order: {…}
- ARIA: {…}
- {skip link / focus trap / live region as relevant}

---

{repeat for EVERY screen in the Section 3 inventory}`,
  },
  {
    number: 8,
    key: 'design_traceability',
    title: 'Design Traceability',
    fileName: 'design-traceability.md',
    description:
      'Screen ↔ requirement ↔ architecture component ↔ user flow ↔ persona matrix, the four coverage checks, and the open items for Hi-Fi, client review and developer decisions.',
    format: `## 8. Design Traceability

### 8.1 Traceability Matrix
| Screen | Requirement | Architecture Component | User Flow | Persona |
|--------|-------------|------------------------|-----------|---------|
| SCR-001 {Login} | {FR-010} | {Auth Service} | {UF-001} | {All users} |

### 8.2 Coverage Checks
| Check | Result | Details |
|-------|--------|---------|
| Every FR has at least one screen | {✅ Pass / ⚠ Gap} | {FR ids without a screen} |
| Every screen links to at least one FR | {✅ / ⚠ Scope creep} | {screen ids} |
| Every user flow starts and ends at a defined screen | {✅ / ⚠} | {…} |
| Every persona has at least one flow | {✅ / ⚠} | {…} |

### 8.3 Open Items
**Needs Sanjay's Figma Hi-Fi treatment**
- {SCR ids + why}

**Needs client review before development**
- {SCR ids + what to confirm}

**Design decisions deferred to the developer**
- {decision + constraint the developer must respect}`,
  },
];
