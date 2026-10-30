export interface DesignSectionTemplate {
  number: number;
  title: string;
  key: string;
  description: string;
  format: string;
}

export const DESIGN_SECTION_TEMPLATES: DesignSectionTemplate[] = [
  {
    number: 1,
    title: 'Design Information',
    key: 'design_info',
    description: 'Metadata about this design document',
    format: `## 1. Design Information

| Field | Value |
|-------|-------|
| Design ID | DES-{ID} |
| Title | {design title} |
| Related Requirement | {REQ-ID} |
| Related Architecture | {ARCH-ID} |
| Author | AIDLC Design Agent |
| Status | Draft |
| Created Date | {date} |
| Last Updated | {date} |
| Version | 1.0 |`,
  },
  {
    number: 2,
    title: 'Design Overview',
    key: 'design_overview',
    description: 'Summary of the solution design, approach, and principles',
    format: `## 2. Design Overview

### Solution Summary
{2-3 paragraphs summarizing the solution design approach}

### Design Methodology
{Design approach: Domain-Driven Design / Clean Architecture / MVC / etc.}

### Key Design Principles
| Principle | How Applied |
|-----------|-------------|
| {SOLID / DRY / KISS / Separation of Concerns / etc.} | {how this principle is applied in this design} |`,
  },
  {
    number: 3,
    title: 'UI/UX Design',
    key: 'ui_ux_design',
    description: 'Screen inventory, user flows, wireframe descriptions, accessibility',
    format: `## 3. UI/UX Design

### Screen Inventory
| Screen | Purpose | Route/Path | Auth Required |
|--------|---------|-----------|---------------|
| {screen 1} | {purpose} | {/path} | {Yes/No — which role} |

### User Flows
#### Flow 1: {Flow Name}
1. User navigates to {screen}
2. User {action}
3. System {response}
4. User {action}
5. System {response — success/error}

### Wireframe Descriptions
#### {Screen Name}
- **Layout:** {describe layout: header, sidebar, main content, footer}
- **Key Elements:** {list interactive elements: buttons, forms, tables}
- **States:** {loading, empty, error, populated}

### Responsive Design
- **Breakpoints:** {mobile, tablet, desktop sizes}
- **Approach:** {mobile-first / desktop-first}

### Accessibility
- **WCAG Level:** {A / AA / AAA}
- **Key Considerations:** {keyboard navigation, screen readers, color contrast, ARIA labels}

_If no frontend: "No UI component — backend/API only system"_`,
  },
  {
    number: 4,
    title: 'API Design',
    key: 'api_design',
    description: 'API style, endpoint catalog with schemas, versioning, error format',
    format: `## 4. API Design

### API Style
{REST / GraphQL / gRPC — with rationale}

### API Versioning
{URL path versioning (/v1/) / Header versioning / Query param — with rationale}

### Endpoint Catalog

#### {Endpoint Group 1}

##### POST /api/{resource}
- **Purpose:** {what this endpoint does}
- **Auth:** {required role}
- **Rate Limit:** {requests/minute}
- **Request Body:**
\`\`\`json
{
  "field1": "string (required) — description",
  "field2": "number (optional) — description"
}
\`\`\`
- **Response (200):**
\`\`\`json
{
  "id": "string — resource ID",
  "field1": "string",
  "createdAt": "ISO 8601 datetime"
}
\`\`\`
- **Error Responses:** 400 (validation), 401 (unauthorized), 409 (conflict)
- **Requirement Trace:** {FR-XXX}

### Standard Error Response Format
\`\`\`json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable message",
    "details": []
  }
}
\`\`\``,
  },
  {
    number: 5,
    title: 'Database Design',
    key: 'database_design',
    description: 'Database engine, entity descriptions, indexes, migrations, seed data',
    format: `## 5. Database Design

### Database Engine
{From architecture: e.g., PostgreSQL 15 on Amazon RDS}

### Entity Descriptions

#### {Entity 1: e.g., Users}
| Field | Type | Constraints | Description |
|-------|------|------------|-------------|
| id | UUID | PK, NOT NULL | Primary key |
| email | VARCHAR(255) | UNIQUE, NOT NULL | User email |
| {field} | {type} | {constraints} | {description} |

**Indexes:**
| Index Name | Fields | Type | Justification |
|-----------|--------|------|---------------|
| idx_{table}_{field} | {fields} | {B-tree/GIN/etc.} | {why needed} |

### Migration Strategy
- **Tool:** {Knex / Prisma Migrate / Flyway / etc.}
- **Approach:** {forward-only / reversible}
- **Naming:** {timestamp-based / sequential}

### Seed Data
| Entity | Records Needed | Purpose |
|--------|---------------|---------|
| {entity} | {count} | {dev/test/demo} |`,
  },
  {
    number: 6,
    title: 'Component/Module Design',
    key: 'component_design',
    description: 'Detailed design for each major component from architecture',
    format: `## 6. Component/Module Design

### {Component 1 Name}

**Responsibility:** {single responsibility}
**Technology:** {specific tech: e.g., Express.js middleware}

**Public Interface:**
\`\`\`
method1(param: Type): ReturnType — description
method2(param: Type): ReturnType — description
\`\`\`

**Dependencies:**
- {Dependency 1}: {what for}
- {Dependency 2}: {what for}

**Internal Logic Flow:**
1. Receive {input}
2. Validate {rules}
3. {Business logic step}
4. {Database/external call}
5. Return {output}

**Configuration:**
| Config Key | Type | Default | Description |
|-----------|------|---------|-------------|
| {key} | {type} | {default} | {description} |

{Repeat for each major component from architecture}`,
  },
  {
    number: 7,
    title: 'Integration Design',
    key: 'integration_design',
    description: 'Detailed design for each external integration',
    format: `## 7. Integration Design

### {Integration 1 Name}

**Method:** {REST API / Webhook / Message Queue / File Transfer}
**Direction:** {Inbound / Outbound / Bidirectional}
**Data Format:** {JSON / XML / CSV / Protobuf}

**Auth Mechanism:**
- Type: {API Key / OAuth 2.0 / mTLS}
- Credentials Storage: {secrets manager reference}

**Error Handling:**
- Retry Strategy: {exponential backoff, max 3 retries}
- Circuit Breaker: {threshold: 5 failures in 60s, recovery: 30s}
- Fallback: {what happens when integration is down}
- Dead Letter Queue: {where failed messages go}

**Sequence:**
1. {System A} sends {request/message}
2. {System B} validates {what}
3. {System B} responds with {response}
4. {System A} processes {response}
5. On failure: {error path}

{Repeat for each integration from architecture}`,
  },
  {
    number: 8,
    title: 'Security Design',
    key: 'security_design',
    description: 'Authentication implementation, authorization rules, validation, CORS, audit logging',
    format: `## 8. Security Design

### Authentication Implementation
- **Provider:** {Auth0 / Cognito / custom — from architecture}
- **Flow:** {Authorization Code / Client Credentials / etc.}
- **Token Format:** {JWT — claims: sub, email, roles, exp}
- **Token Lifetime:** {access: 15min, refresh: 7days}
- **Storage:** {httpOnly cookie / secure localStorage}

### Authorization Rules
| Endpoint | Admin | User | Guest | Notes |
|----------|-------|------|-------|-------|
| {endpoint} | {✓/✗} | {✓/✗} | {✓/✗} | {special rules} |

### Input Validation
| Input | Validation Rules |
|-------|-----------------|
| Email | RFC 5322 format, max 255 chars, lowercase normalized |
| {field} | {rules} |

### Data Sanitization
- **HTML:** {DOMPurify / bleach — strip all tags except allowed list}
- **SQL:** {parameterized queries only — no string concatenation}
- **Path:** {reject ../traversal, whitelist allowed characters}

### CORS Configuration
- **Allowed Origins:** {list}
- **Allowed Methods:** {list}
- **Credentials:** {true/false}

### Rate Limiting
| Endpoint Group | Limit | Window | Key |
|---------------|-------|--------|-----|
| {group} | {N requests} | {per minute} | {IP / user / API key} |

### Audit Logging
| Event | Logged Fields | Level |
|-------|--------------|-------|
| {login attempt} | {user, IP, success/fail, timestamp} | {info/warn} |`,
  },
  {
    number: 9,
    title: 'Error Handling & Logging',
    key: 'error_handling_logging',
    description: 'Error classification, logging strategy, monitoring, health checks',
    format: `## 9. Error Handling & Logging Design

### Error Classification
| Category | HTTP Status | Error Code Pattern | Example |
|----------|------------|-------------------|---------|
| Validation | 400 | VALIDATION_* | VALIDATION_REQUIRED_FIELD |
| Authentication | 401 | AUTH_* | AUTH_TOKEN_EXPIRED |
| Authorization | 403 | AUTHZ_* | AUTHZ_INSUFFICIENT_ROLE |
| Not Found | 404 | NOT_FOUND_* | NOT_FOUND_USER |
| Business Logic | 422 | BIZ_* | BIZ_DUPLICATE_EMAIL |
| System | 500 | SYS_* | SYS_DATABASE_UNAVAILABLE |
| External | 502 | EXT_* | EXT_PAYMENT_GATEWAY_TIMEOUT |

### Logging Strategy
| Level | When to Use | Example |
|-------|-------------|---------|
| DEBUG | Development troubleshooting | Request/response bodies (sanitized) |
| INFO | Normal operations | Request received, user action completed |
| WARN | Recoverable issues | Rate limit approaching, retry attempt |
| ERROR | Failures requiring attention | Unhandled exception, external service down |

### Log Format
\`\`\`json
{
  "timestamp": "ISO 8601",
  "level": "INFO",
  "service": "service-name",
  "traceId": "correlation-id",
  "message": "description",
  "context": {}
}
\`\`\`

### Monitoring & Alerts
| Alert | Condition | Severity | Action |
|-------|----------|----------|--------|
| {alert name} | {threshold} | {P1/P2/P3} | {who to notify, what to do} |

### Health Check Endpoint
- **Path:** GET /health
- **Response:** { status: "ok", version: "1.0.0", uptime: 12345, dependencies: { db: "ok", cache: "ok" } }`,
  },
  {
    number: 10,
    title: 'Design Traceability',
    key: 'design_traceability',
    description: 'Mapping design decisions to requirements and architecture, open questions',
    format: `## 10. Design Traceability

### Requirement-to-Design Mapping
| Requirement | Design Component | Design Section | Status |
|------------|-----------------|---------------|--------|
| FR-001 | {API endpoint / UI screen / module} | {section #} | Designed |
| FR-002 | {component} | {section #} | Designed |

### Architecture-to-Design Mapping
| Architecture Component | Design Implementation | Technology |
|-----------------------|----------------------|-----------|
| {component from arch} | {how designed in detail} | {specific tech} |

### Open Design Questions
| # | Question | Impact | Assigned To |
|---|---------|--------|-------------|
| DQ-001 | {question needing resolution} | {what's blocked} | {who can answer} |

### Design Assumptions
| # | Assumption | Impact if Wrong |
|---|-----------|----------------|
| DA-001 | {assumption made during design} | {consequence} |`,
  },
];
