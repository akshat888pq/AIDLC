export interface ReleaseSectionTemplate {
  number: number;
  title: string;
  key: string;
  description: string;
  format: string;
}

export const RELEASE_SECTION_TEMPLATES: ReleaseSectionTemplate[] = [
  {
    number: 1,
    title: 'Release Information',
    key: 'release_info',
    description: 'Metadata about this release notes document',
    format: `## 1. Release Information

| Field | Value |
|-------|-------|
| Release Notes ID | REL-{ID} |
| Title | {release title} |
| Related Requirement | {REQ-ID} |
| Related Architecture | {ARCH-ID} |
| Related Design | {DES-ID} |
| Related Test Plan | {TEST-ID} |
| Author | AIDLC Release Agent |
| Status | Draft |
| Created Date | {date} |
| Last Updated | {date} |
| Version | 1.0 |
| Release Type | {Major / Minor / Patch / Hotfix} |`,
  },
  {
    number: 2,
    title: 'Release Overview',
    key: 'release_overview',
    description: 'Executive summary of the release, target audience, key highlights',
    format: `## 2. Release Overview

### Executive Summary
{2-3 paragraphs: what this release delivers, who it's for, why it matters}

### Target Audience
| Audience | What They Care About |
|----------|---------------------|
| End Users | {user-facing changes} |
| Developers | {API changes, integration points} |
| Operations | {infrastructure, monitoring, deployment changes} |
| Stakeholders | {business impact, KPIs} |

### Key Highlights
- **{Highlight 1}:** {one-line description}
- **{Highlight 2}:** {one-line description}
- **{Highlight 3}:** {one-line description}`,
  },
  {
    number: 3,
    title: 'Features & Changes',
    key: 'features_changes',
    description: 'Detailed list of new features, enhancements, bug fixes, and breaking changes',
    format: `## 3. Features & Changes

### New Features
| ID | Feature | Description | Requirement |
|----|---------|-------------|-------------|
| FEAT-001 | {feature name} | {user-facing description} | {FR-XXX} |

### Enhancements
| ID | Enhancement | Description | Requirement |
|----|------------|-------------|-------------|
| ENH-001 | {enhancement name} | {what improved and how} | {FR-XXX} |

### Bug Fixes
| ID | Fix | Description | Root Cause |
|----|-----|-------------|------------|
| FIX-001 | {fix title} | {what was fixed} | {what caused it} |

### Breaking Changes
| ID | Change | Migration Steps | Affected Components |
|----|--------|----------------|-------------------|
| BREAK-001 | {what changed} | {step-by-step migration} | {list of affected areas} |

_If no breaking changes: "No breaking changes in this release."_

### Deprecations
| Item | Deprecated In | Removal Target | Alternative |
|------|--------------|---------------|-------------|
| {deprecated item} | {this version} | {target version} | {what to use instead} |

_If no deprecations: "No deprecations in this release."_`,
  },
  {
    number: 4,
    title: 'Deployment & Configuration',
    key: 'deployment_config',
    description: 'Deployment steps, environment variables, database migrations, rollback plan',
    format: `## 4. Deployment & Configuration

### Pre-Deployment Checklist
- [ ] {prerequisite 1 — e.g., database backup completed}
- [ ] {prerequisite 2 — e.g., feature flags configured}
- [ ] {prerequisite 3 — e.g., third-party API keys updated}

### Deployment Steps
1. {Step 1 — e.g., run database migrations}
2. {Step 2 — e.g., deploy backend services}
3. {Step 3 — e.g., deploy frontend}
4. {Step 4 — e.g., verify health checks}
5. {Step 5 — e.g., enable feature flags}

### Environment Variables
| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| {VAR_NAME} | {Yes/No} | {default} | {what it controls} |

_If no new env vars: "No new environment variables in this release."_

### Database Migrations
| Migration | Type | Reversible | Description |
|-----------|------|-----------|-------------|
| {migration name} | {DDL/DML} | {Yes/No} | {what it does} |

_If no migrations: "No database migrations in this release."_

### Rollback Plan
1. {Rollback step 1}
2. {Rollback step 2}
3. {Rollback step 3}
- **Rollback Time Estimate:** {minutes}
- **Data Loss Risk:** {None / Minimal / Significant — details}`,
  },
  {
    number: 5,
    title: 'Known Issues & Limitations',
    key: 'known_issues',
    description: 'Known issues, workarounds, and scope limitations',
    format: `## 5. Known Issues & Limitations

### Known Issues
| ID | Issue | Severity | Workaround | Fix Target |
|----|-------|----------|-----------|-----------|
| KI-001 | {issue description} | {Critical/High/Medium/Low} | {workaround if any} | {next version or date} |

_If no known issues: "No known issues at time of release."_

### Scope Limitations
| Limitation | Reason | Future Plan |
|-----------|--------|------------|
| {what's not included} | {why — descoped / deferred / dependency} | {when it's planned} |

### Compatibility Notes
| Component | Minimum Version | Tested Version | Notes |
|-----------|----------------|---------------|-------|
| {browser / OS / API / etc.} | {min version} | {tested version} | {any special notes} |`,
  },
  {
    number: 6,
    title: 'Release Traceability',
    key: 'release_traceability',
    description: 'Complete mapping from requirements through architecture, design, and tests to this release',
    format: `## 6. Release Traceability

### End-to-End Traceability
| Requirement | Architecture | Design | Test Cases | Release Item | Status |
|------------|-------------|--------|-----------|-------------|--------|
| FR-001 | {arch component} | {design section} | {TC-U-001, TC-E2E-001} | {FEAT-001} | Delivered |
| FR-002 | {arch component} | {design section} | {TC-U-002} | {ENH-001} | Delivered |
| NFR-001 | {arch component} | {design section} | {TC-P-001} | {verified} | Verified |

### Coverage Summary
| Category | Total | Delivered | Deferred | Coverage |
|----------|-------|-----------|----------|---------|
| Functional Requirements | {count} | {count} | {count} | {%} |
| Non-Functional Requirements | {count} | {count} | {count} | {%} |
| Test Cases Passed | {count} | {count} | {count} | {%} |

### Approval Sign-Off
| Role | Name | Status | Date |
|------|------|--------|------|
| Product Owner | {name or TBD} | Pending | |
| Tech Lead | {name or TBD} | Pending | |
| QA Lead | {name or TBD} | Pending | |`,
  },
];
