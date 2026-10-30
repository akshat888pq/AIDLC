export interface SectionTemplate {
  number: number;
  title: string;
  key: string;
  description: string;
  format: string;
}

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    number: 1,
    title: 'Requirement Information',
    key: 'requirement_info',
    description: 'Metadata about this requirement document',
    format: `## 1. Requirement Information

| Field | Value |
|-------|-------|
| Requirement ID | REQ-{ID} |
| Title | {project title} |
| Owner | {business owner or project lead} |
| Product / System | {product or system name} |
| Priority | {P1-Critical / P2-High / P3-Medium / P4-Low} |
| Status | Draft |
| Created Date | {date} |
| Last Updated | {date} |
| Version | 1.0 |`,
  },
  {
    number: 2,
    title: 'Business Problem',
    key: 'business_problem',
    description: 'The business problem or pain point this requirement addresses',
    format: `## 2. Business Problem

{2-4 paragraphs describing:}
- What is the current pain point or gap?
- Who is affected and how?
- What is the business impact of NOT solving this? (quantify if possible)
- Any relevant market/competitive context`,
  },
  {
    number: 3,
    title: 'Business Objective',
    key: 'business_objective',
    description: 'What the project aims to achieve in measurable terms',
    format: `## 3. Business Objective

{State the primary business objective in 1-2 sentences}

### Success Metrics
| Metric | Current State | Target State | Measurement Method |
|--------|--------------|--------------|-------------------|
| {metric 1} | {current} | {target} | {how measured} |
| {metric 2} | {current} | {target} | {how measured} |`,
  },
  {
    number: 4,
    title: 'Current Process',
    key: 'current_process',
    description: 'How things work today (as-is state)',
    format: `## 4. Current Process (As-Is)

{Describe the current process step by step}

### Process Steps
1. {Step 1}
2. {Step 2}
3. {Step 3}

### Pain Points in Current Process
- {Pain point 1}
- {Pain point 2}

### Current Tools / Systems
- {Tool/System 1}: {purpose}
- {Tool/System 2}: {purpose}`,
  },
  {
    number: 5,
    title: 'Proposed Process',
    key: 'proposed_process',
    description: 'How things will work after implementation (to-be state)',
    format: `## 5. Proposed Process (To-Be)

{Describe the proposed process step by step}

### Process Steps
1. {Step 1}
2. {Step 2}
3. {Step 3}

### Key Changes from Current Process
- {Change 1}: {impact}
- {Change 2}: {impact}

### New Tools / Systems
- {Tool/System 1}: {purpose}`,
  },
  {
    number: 6,
    title: 'Functional Requirements',
    key: 'functional_requirements',
    description: 'Specific functional capabilities the system must provide',
    format: `## 6. Functional Requirements

### FR-001: {Requirement Title}
- **Description:** {Detailed description}
- **User Story:** As a {role}, I want to {action} so that {benefit}
- **Priority:** {Must Have / Should Have / Could Have / Won't Have}
- **Source:** {Document name or Q&A reference}

### FR-002: {Requirement Title}
- **Description:** {Detailed description}
- **User Story:** As a {role}, I want to {action} so that {benefit}
- **Priority:** {Must Have / Should Have / Could Have / Won't Have}
- **Source:** {Document name or Q&A reference}

{Continue for all functional requirements identified}`,
  },
  {
    number: 7,
    title: 'Non-Functional Requirements',
    key: 'nonfunctional_requirements',
    description: 'Performance, security, availability, scalability, and compliance requirements',
    format: `## 7. Non-Functional Requirements

### 7.1 Performance
- {Response time requirements}
- {Throughput requirements}
- {Concurrent user requirements}

### 7.2 Security
- {Authentication requirements}
- {Authorization requirements}
- {Data encryption requirements}
- {Compliance standards (SOC2, GDPR, HIPAA, etc.)}

### 7.3 Availability
- {Uptime SLA requirement}
- {Disaster recovery requirements}
- {Backup requirements}

### 7.4 Scalability
- {Expected growth}
- {Horizontal/vertical scaling needs}

### 7.5 Compliance
- {Regulatory requirements}
- {Audit requirements}
- {Data residency requirements}`,
  },
  {
    number: 8,
    title: 'Data Requirements',
    key: 'data_requirements',
    description: 'Data sources, classification, ownership, and handling rules',
    format: `## 8. Data Requirements

### Data Sources
| Source | Type | Volume | Frequency | Owner |
|--------|------|--------|-----------|-------|
| {source 1} | {type} | {volume} | {frequency} | {owner} |

### Data Classification
- **Public:** {list}
- **Internal:** {list}
- **Confidential:** {list}
- **Restricted:** {list}

### Data Retention
- {Retention policy}
- {Archival requirements}
- {Deletion requirements}`,
  },
  {
    number: 9,
    title: 'AI Requirements',
    key: 'ai_requirements',
    description: 'AI/ML capabilities, model requirements, and human-in-the-loop needs',
    format: `## 9. AI Requirements

### Is AI Required?
{Yes/No — with justification}

### AI Capability
- **Purpose:** {What the AI component does}
- **Type:** {Classification / Generation / Prediction / Recommendation / Other}
- **Model:** {Specific model or model type requirements}

### Human-in-the-Loop
- {Where human oversight is required}
- {Approval workflows needed}
- {Escalation criteria}

### Expected Behavior
- **Input:** {What the AI receives}
- **Output:** {What the AI produces}
- **Accuracy Target:** {Expected accuracy/quality metrics}
- **Fallback:** {What happens when AI confidence is low}`,
  },
  {
    number: 10,
    title: 'Acceptance Criteria',
    key: 'acceptance_criteria',
    description: 'Testable criteria in Given/When/Then format',
    format: `## 10. Acceptance Criteria

### AC-001: {Criteria Title}
- **Given** {precondition}
- **When** {action}
- **Then** {expected result}

### AC-002: {Criteria Title}
- **Given** {precondition}
- **When** {action}
- **Then** {expected result}

{Continue for all acceptance criteria — each functional requirement should have at least one AC}`,
  },
  {
    number: 11,
    title: 'Dependencies',
    key: 'dependencies',
    description: 'External and internal dependencies',
    format: `## 11. Dependencies

### Internal Dependencies
| Dependency | Team/System | Impact if Delayed | Status |
|-----------|-------------|-------------------|--------|
| {dep 1} | {team} | {impact} | {status} |

### External Dependencies
| Dependency | Vendor/Partner | Impact if Delayed | Status |
|-----------|---------------|-------------------|--------|
| {dep 1} | {vendor} | {impact} | {status} |`,
  },
  {
    number: 12,
    title: 'Assumptions',
    key: 'assumptions',
    description: 'Assumptions made during requirements gathering',
    format: `## 12. Assumptions

| # | Assumption | Impact if Wrong | Validated By | Status |
|---|-----------|----------------|-------------|--------|
| A-001 | {assumption} | {impact} | {who validates} | {Confirmed/Unconfirmed} |
| A-002 | {assumption} | {impact} | {who validates} | {Confirmed/Unconfirmed} |`,
  },
  {
    number: 13,
    title: 'Risks',
    key: 'risks',
    description: 'Identified risks with mitigation strategies',
    format: `## 13. Risks

| # | Risk | Probability | Impact | Mitigation Strategy | Owner |
|---|------|------------|--------|-------------------|-------|
| R-001 | {risk} | {High/Medium/Low} | {High/Medium/Low} | {mitigation} | {owner} |
| R-002 | {risk} | {High/Medium/Low} | {High/Medium/Low} | {mitigation} | {owner} |`,
  },
  {
    number: 14,
    title: 'Open Questions',
    key: 'open_questions',
    description: 'Questions that remain unanswered after the Q&A process',
    format: `## 14. Open Questions

| # | Question | Assigned To | Due Date | Status |
|---|---------|-------------|----------|--------|
| OQ-001 | {question} | {person/role} | {date} | {Open/Resolved} |

_Note: This section should ideally be empty if the Q&A process was thorough. Any items here represent gaps that must be resolved before development begins._`,
  },
  {
    number: 15,
    title: 'Traceability',
    key: 'traceability',
    description: 'Links to related artifacts: architecture, design, test cases, tickets',
    format: `## 15. Traceability

### Source Documents
| Document | Type | Reference |
|----------|------|-----------|
| {doc name} | {SOW/Requirements/Meeting Notes} | {file reference} |

### Linked Tickets
| Ticket ID | Title | Type | URL |
|-----------|-------|------|-----|
| {ticket ID} | {title} | {Epic/Story/Task} | {URL} |

### Related Artifacts
| Artifact | Status | Reference |
|----------|--------|-----------|
| Architecture Document | {Not Started/In Progress/Complete} | {link} |
| Design Document | {Not Started/In Progress/Complete} | {link} |
| Test Plan | {Not Started/In Progress/Complete} | {link} |
| Release Plan | {Not Started/In Progress/Complete} | {link} |`,
  },
];
