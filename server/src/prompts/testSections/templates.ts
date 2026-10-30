export interface TestSectionTemplate {
  number: number;
  title: string;
  key: string;
  description: string;
  format: string;
}

export const TEST_SECTION_TEMPLATES: TestSectionTemplate[] = [
  {
    number: 1,
    title: 'Test Plan Information',
    key: 'test_plan_info',
    description: 'Metadata about this test plan document',
    format: `## 1. Test Plan Information

| Field | Value |
|-------|-------|
| Test Plan ID | TEST-{ID} |
| Title | {test plan title} |
| Related Requirement | {REQ-ID} |
| Related Architecture | {ARCH-ID} |
| Related Design | {DES-ID} |
| Author | AIDLC Test Agent |
| Status | Draft |
| Created Date | {date} |
| Last Updated | {date} |
| Version | 1.0 |`,
  },
  {
    number: 2,
    title: 'Test Strategy',
    key: 'test_strategy',
    description: 'Testing levels, approach, tools, environment, data strategy, entry/exit criteria',
    format: `## 2. Test Strategy

### Testing Levels
| Level | Approach | Framework/Tool | Coverage Target |
|-------|----------|---------------|----------------|
| Unit | Automated | {Jest / Pytest / etc.} | {target %} |
| Integration | Automated | {Supertest / etc.} | {target %} |
| End-to-End | Automated + Manual | {Cypress / Playwright / etc.} | {key flows} |
| Performance | Automated | {k6 / JMeter / Artillery} | {NFR targets} |
| Security | Automated + Manual | {OWASP ZAP / Burp Suite} | {OWASP Top 10} |

### Test Environment Requirements
| Environment | Purpose | Configuration |
|------------|---------|---------------|
| {env name} | {purpose} | {key config details} |

### Test Data Strategy
- **Unit Tests:** {mock / fixture / factory}
- **Integration Tests:** {seed database / test containers}
- **E2E Tests:** {production-like seed data}
- **Data Cleanup:** {strategy for test isolation}

### Entry & Exit Criteria
| Level | Entry Criteria | Exit Criteria |
|-------|---------------|---------------|
| Unit | Code compiles, dependencies available | {coverage target}% coverage, 0 failures |
| Integration | Unit tests pass, services running | All integration points verified |
| E2E | Integration tests pass, staging deployed | All critical flows pass |
| Performance | E2E pass, load test env ready | All NFR targets met |
| Security | Functional tests pass | OWASP Top 10 covered, no critical findings |`,
  },
  {
    number: 3,
    title: 'Unit Test Cases',
    key: 'unit_tests',
    description: 'Unit test cases for each component/module, with Given/When/Then format',
    format: `## 3. Unit Test Cases

### {Component/Module Name}

#### TC-U-001: {Test case title}
- **Component:** {module name}
- **Scenario:** {what is being tested}
- **Given:** {precondition}
- **When:** {action}
- **Then:** {expected result}
- **Priority:** {Critical / High / Medium / Low}
- **Requirement:** {FR-XXX}

#### TC-U-002: {Test case title — negative case}
- **Component:** {module name}
- **Scenario:** {error/edge case being tested}
- **Given:** {precondition}
- **When:** {invalid action}
- **Then:** {expected error handling}
- **Priority:** {priority}
- **Requirement:** {FR-XXX}

{Continue for all components — include happy path, edge cases, error cases, boundary values}
{Every functional requirement must have at least one unit test}`,
  },
  {
    number: 4,
    title: 'Integration Test Cases',
    key: 'integration_tests',
    description: 'Integration test cases for API contracts, database operations, external services',
    format: `## 4. Integration Test Cases

### {Integration Point Name}

#### TC-I-001: {Test case title}
- **Systems:** {which systems being tested together}
- **Scenario:** {what integration is being verified}
- **Given:** {precondition — services running, data seeded}
- **When:** {action — API call, message published}
- **Then:** {expected result — response, side effects}
- **Mock Requirements:** {what external services are mocked}
- **Priority:** {Critical / High / Medium / Low}
- **Requirement:** {FR-XXX}

{Cover: API contract validation, database CRUD, external service calls, message queue flows}
{Include both success and failure paths for each integration}`,
  },
  {
    number: 5,
    title: 'End-to-End Test Cases',
    key: 'e2e_tests',
    description: 'E2E test cases for complete user journeys',
    format: `## 5. End-to-End Test Cases

### {User Flow Name}

#### TC-E2E-001: {Test case title}
- **User Flow:** {which user journey from design}
- **Actor:** {user role}
- **Steps:**
  1. Navigate to {page/screen} — verify {expected state}
  2. {User action} — verify {expected response}
  3. {User action} — verify {expected response}
  4. {Final verification} — verify {end state}
- **Test Data:** {specific data needed}
- **Priority:** {Critical / High / Medium / Low}
- **Requirement:** {FR-XXX}

{Cover: complete user journeys, cross-component flows, error recovery paths}
{Include at least one E2E test per major user flow from design}`,
  },
  {
    number: 6,
    title: 'Performance Test Cases',
    key: 'performance_tests',
    description: 'Performance test cases mapped to NFR targets',
    format: `## 6. Performance Test Cases

### {Performance Area}

#### TC-P-001: {Test case title}
- **Metric:** {response time / throughput / concurrent users}
- **Target:** {from NFR — e.g., "API response < 200ms at P95"}
- **Test Type:** {Load Test / Stress Test / Soak Test / Spike Test}
- **Tool:** {k6 / JMeter / Artillery}
- **Scenario:**
  - Virtual Users: {count}
  - Ramp Up: {duration}
  - Steady State: {duration}
  - Test Data Volume: {size}
- **Pass Criteria:** {specific threshold}
- **Requirement:** {NFR-PERF-XXX}

{If no performance NFRs specified: "No performance requirements specified in requirement document — recommend adding before production release. The following are DEFAULT targets:"}`,
  },
  {
    number: 7,
    title: 'Security Test Cases',
    key: 'security_tests',
    description: 'Security test cases covering OWASP Top 10',
    format: `## 7. Security Test Cases

### OWASP Top 10 Coverage

#### TC-S-001: SQL Injection Prevention
- **Category:** A03:2021 — Injection
- **Scenario:** Attempt SQL injection via {input field}
- **Given:** Unauthenticated user on {endpoint}
- **When:** Submit payload: \`' OR 1=1 --\`
- **Then:** Request rejected with 400, no data leaked, attempt logged
- **Tool:** {OWASP ZAP / manual}
- **Requirement:** {NFR-SEC-XXX or "OWASP baseline"}

#### TC-S-002: Cross-Site Scripting (XSS)
- **Category:** A03:2021 — Injection
- **Scenario:** Attempt stored/reflected XSS via {input}
- **Given:** Authenticated user
- **When:** Submit payload: \`<script>alert('xss')</script>\`
- **Then:** Input sanitized, script not executed, no alert displayed
- **Tool:** {tool}

#### TC-S-003: Broken Authentication
- **Category:** A07:2021 — Identification and Authentication Failures
- **Scenario:** {expired token / brute force / credential stuffing}
- **Given/When/Then**
- **Tool:** {tool}

#### TC-S-004: Broken Access Control
- **Category:** A01:2021 — Broken Access Control
- **Scenario:** {horizontal/vertical privilege escalation}
- **Given:** User with role {role}
- **When:** Attempt to access {restricted resource}
- **Then:** 403 Forbidden returned
- **Tool:** {tool}

{Continue for: Sensitive Data Exposure, Security Misconfiguration, CSRF, etc.}
{Must cover all OWASP Top 10 categories}`,
  },
  {
    number: 8,
    title: 'Test Traceability Matrix',
    key: 'traceability_matrix',
    description: 'Complete mapping of requirements to test cases',
    format: `## 8. Test Traceability Matrix

### Requirements Coverage
| Requirement ID | Description | Test Case IDs | Test Level | Coverage Status |
|----------------|-------------|---------------|------------|-----------------|
| FR-001 | {title} | TC-U-001, TC-I-003, TC-E2E-001 | Unit, Integration, E2E | Covered |
| FR-002 | {title} | TC-U-005, TC-E2E-002 | Unit, E2E | Covered |
| NFR-PERF-01 | {title} | TC-P-001 | Performance | Covered |
| NFR-SEC-01 | {title} | TC-S-001, TC-S-002 | Security | Covered |

### Coverage Gaps
{List any requirements with NO test cases:}
- WARNING: {FR-XXX} has no test cases — add coverage before development
- WARNING: {NFR-XXX} has no test cases — add coverage before development

### Orphan Tests
{List any test cases with NO requirement link:}
- WARNING: {TC-XXX} is not linked to any requirement — verify necessity

### Coverage Summary
| Category | Total Requirements | Covered | Uncovered | Coverage % |
|----------|-------------------|---------|-----------|-----------|
| Functional | {count} | {count} | {count} | {%} |
| Non-Functional | {count} | {count} | {count} | {%} |
| Security (OWASP) | 10 | {count} | {count} | {%} |`,
  },
];
