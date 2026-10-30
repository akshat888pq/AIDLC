export interface ArchSectionTemplate {
  number: number;
  title: string;
  key: string;
  description: string;
  format: string;
}

export const ARCH_SECTION_TEMPLATES: ArchSectionTemplate[] = [
  {
    number: 1,
    title: 'Architecture Information',
    key: 'architecture_info',
    description: 'Metadata about this architecture document',
    format: `## 1. Architecture Information

| Field | Value |
|-------|-------|
| Architecture ID | ARCH-{ID} |
| Title | {architecture title} |
| Related Requirement | {REQ-ID} |
| Author | AIDLC Architecture Agent |
| Status | Draft |
| Created Date | {date} |
| Last Updated | {date} |
| Version | 1.0 |`,
  },
  {
    number: 2,
    title: 'Architecture Overview',
    key: 'architecture_overview',
    description: 'High-level summary of the solution architecture',
    format: `## 2. Architecture Overview

### Solution Summary
{2-3 paragraphs summarizing the overall architecture approach}

### Architecture Style
{Monolithic / Microservices / Serverless / Event-Driven / Hybrid — with rationale}

### Key Architectural Decisions
| Decision | Rationale | Requirement Trace |
|----------|-----------|------------------|
| {decision 1} | {why} | {FR/NFR reference} |
| {decision 2} | {why} | {FR/NFR reference} |`,
  },
  {
    number: 3,
    title: 'System Context',
    key: 'system_context',
    description: 'External systems, users, actors, and system boundaries',
    format: `## 3. System Context

### External Systems & Integrations
| System | Purpose | Direction | Protocol |
|--------|---------|-----------|----------|
| {system 1} | {purpose} | {Inbound/Outbound/Bidirectional} | {REST/gRPC/etc.} |

### Users & Actors
| Actor | Role | Interaction |
|-------|------|-------------|
| {actor 1} | {role} | {how they interact with the system} |

### System Boundaries
**Inside the system:**
- {component/capability 1}
- {component/capability 2}

**Outside the system (external dependencies):**
- {external system 1}
- {external system 2}`,
  },
  {
    number: 4,
    title: 'Component Architecture',
    key: 'component_architecture',
    description: 'Major components/services, their responsibilities, and interactions',
    format: `## 4. Component Architecture

### Component Overview
| Component | Responsibility | Type | Requirement Trace |
|-----------|---------------|------|------------------|
| {component 1} | {what it does} | {Service/Library/Module} | {FR/NFR reference} |

### Component Interactions
{Describe how components communicate: synchronous vs asynchronous, protocols, data flow}

### Component Details

#### {Component 1 Name}
- **Responsibility:** {single responsibility description}
- **Interfaces:** {APIs it exposes}
- **Dependencies:** {other components it depends on}
- **Technology:** {specific tech used}`,
  },
  {
    number: 5,
    title: 'Data Architecture',
    key: 'data_architecture',
    description: 'Data stores, models, data flow, and governance',
    format: `## 5. Data Architecture

### Data Stores
| Store | Type | Technology | Purpose | Requirement Trace |
|-------|------|------------|---------|------------------|
| {store 1} | {Relational/NoSQL/Cache/Queue/Object} | {specific tech} | {purpose} | {FR/NFR ref} |

### Key Data Models
{Describe key entities and their relationships}

### Data Flow
1. {Step 1: data enters from...}
2. {Step 2: data is processed by...}
3. {Step 3: data is stored in...}
4. {Step 4: data is served to...}

### Data Ownership & Governance
| Data Domain | Owner | Classification | Retention |
|-------------|-------|---------------|-----------|
| {domain 1} | {team/service} | {Public/Internal/Confidential/Restricted} | {retention period} |`,
  },
  {
    number: 6,
    title: 'Integration Architecture',
    key: 'integration_architecture',
    description: 'APIs, message queues, third-party integrations, auth flows',
    format: `## 6. Integration Architecture

### APIs
| Endpoint | Method | Purpose | Auth | Requirement Trace |
|----------|--------|---------|------|------------------|
| {endpoint 1} | {GET/POST/etc.} | {purpose} | {auth method} | {FR ref} |

### Message Queues / Event Bus
| Topic/Queue | Producer | Consumer | Pattern | Purpose |
|-------------|----------|----------|---------|---------|
| {topic 1} | {service} | {service} | {Pub-Sub/Queue} | {purpose} |

### Third-Party Integrations
| Service | Purpose | Protocol | SLA |
|---------|---------|----------|-----|
| {service 1} | {purpose} | {REST/SDK/etc.} | {availability/latency} |

### Authentication & Authorization Flows
{Describe the auth flow: login → token → validation → authorization}`,
  },
  {
    number: 7,
    title: 'Infrastructure Architecture',
    key: 'infrastructure_architecture',
    description: 'Cloud provider, compute, networking, storage, CI/CD',
    format: `## 7. Infrastructure Architecture

### Cloud Provider & Region
{Provider: AWS / Azure / GCP — Region(s) and rationale}

### Compute
| Service | Technology | Purpose | Scaling |
|---------|-----------|---------|---------|
| {service 1} | {EC2/ECS/Lambda/etc.} | {purpose} | {auto-scaling policy} |

### Networking
- **VPC/VNet:** {configuration}
- **Load Balancer:** {type and purpose}
- **CDN:** {if applicable}
- **DNS:** {configuration}

### Storage & Databases
| Service | Technology | Purpose | Backup |
|---------|-----------|---------|--------|
| {service 1} | {RDS/DynamoDB/S3/etc.} | {purpose} | {backup strategy} |

### CI/CD Pipeline
1. {Step 1: Developer pushes code...}
2. {Step 2: CI runs tests...}
3. {Step 3: Build artifact...}
4. {Step 4: Deploy to staging...}
5. {Step 5: Deploy to production...}`,
  },
  {
    number: 8,
    title: 'Security Architecture',
    key: 'security_architecture',
    description: 'Authentication, authorization, encryption, compliance, secret management',
    format: `## 8. Security Architecture

### Authentication
- **Mechanism:** {OAuth 2.0 / SSO / MFA / etc.}
- **Provider:** {Auth0 / Cognito / Azure AD / etc.}
- **Token Strategy:** {JWT / Session / etc.}

### Authorization
- **Model:** {RBAC / ABAC / Policy-based}
- **Roles:** {List of roles and permissions}

### Data Encryption
- **At Rest:** {AES-256 / KMS / etc.}
- **In Transit:** {TLS 1.3 / mTLS}
- **Key Management:** {KMS / Vault / etc.}

### Network Security
- **Firewall:** {WAF / Security Groups / etc.}
- **DDoS Protection:** {Shield / CloudFlare / etc.}

### Compliance Mapping
| Compliance Requirement | Architecture Control | Status |
|-----------------------|---------------------|--------|
| {req from NFR section} | {how architecture addresses it} | {Addressed/Gap} |

### Secret Management
- **Tool:** {HashiCorp Vault / AWS Secrets Manager / etc.}
- **Rotation Policy:** {rotation schedule}`,
  },
  {
    number: 9,
    title: 'NFR Mapping',
    key: 'nfr_mapping',
    description: 'How each non-functional requirement is addressed by the architecture',
    format: `## 9. Non-Functional Requirements Mapping

### Performance
| NFR | Architecture Approach | Target | Measurement |
|-----|----------------------|--------|-------------|
| {NFR from requirement} | {how architecture addresses it} | {target metric} | {how measured} |

### Scalability
- **Approach:** {Horizontal / Vertical / Auto-scaling}
- **Strategy:** {describe scaling strategy}

### Availability & Resilience
- **Target SLA:** {e.g., 99.9%}
- **Redundancy:** {multi-AZ / multi-region}
- **Failover:** {active-active / active-passive}
- **Disaster Recovery:** {RPO/RTO targets}

### Monitoring & Observability
| Signal | Tool | Purpose |
|--------|------|---------|
| Logs | {tool} | {purpose} |
| Metrics | {tool} | {purpose} |
| Traces | {tool} | {purpose} |
| Alerts | {tool} | {purpose} |`,
  },
  {
    number: 10,
    title: 'Technology Stack',
    key: 'technology_stack',
    description: 'Complete technology choices with rationale',
    format: `## 10. Technology Stack

### Frontend
| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| {tech 1} | {purpose} | {why this choice} |

### Backend
| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| {tech 1} | {purpose} | {why this choice} |

### Database
| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| {tech 1} | {purpose} | {why this choice} |

### DevOps & Infrastructure
| Technology | Purpose | Rationale |
|-----------|---------|-----------|
| {tech 1} | {purpose} | {why this choice} |

### Third-Party Services
| Service | Purpose | Rationale | Cost Tier |
|---------|---------|-----------|-----------|
| {service 1} | {purpose} | {why this choice} | {estimated tier} |`,
  },
  {
    number: 11,
    title: 'Risks & Mitigations',
    key: 'risks_mitigations',
    description: 'Technical risks, mitigation strategies, trade-offs, and assumptions',
    format: `## 11. Architecture Risks & Mitigations

### Technical Risks
| # | Risk | Probability | Impact | Mitigation | Owner |
|---|------|------------|--------|------------|-------|
| AR-001 | {risk} | {High/Medium/Low} | {High/Medium/Low} | {mitigation strategy} | {owner} |

### Architecture Debt & Trade-offs
| Trade-off | Chosen Approach | Alternative | Rationale |
|-----------|----------------|-------------|-----------|
| {trade-off 1} | {what we chose} | {what we rejected} | {why} |

### Assumptions
| # | Assumption | Impact if Wrong |
|---|-----------|----------------|
| AA-001 | {assumption} | {impact} |`,
  },
  {
    number: 12,
    title: 'Architecture Decision Records',
    key: 'adrs',
    description: 'Key architecture decisions documented as ADRs',
    format: `## 12. Architecture Decision Records (ADRs)

### ADR-001: {Decision Title}
- **Status:** Proposed
- **Context:** {Why this decision was needed}
- **Decision:** {What was decided}
- **Consequences:** {What follows from this decision — positive and negative}

### ADR-002: {Decision Title}
- **Status:** Proposed
- **Context:** {Why this decision was needed}
- **Decision:** {What was decided}
- **Consequences:** {What follows from this decision — positive and negative}

{Generate 3-5 ADRs covering the most significant architecture choices}`,
  },
  {
    number: 13,
    title: 'Traceability',
    key: 'traceability',
    description: 'Links to source requirement and downstream artifacts',
    format: `## 13. Traceability

### Source Requirement
| Field | Value |
|-------|-------|
| Requirement ID | {REQ-ID} |
| Requirement Title | {title} |
| Requirement Status | Finalized |

### Downstream Artifacts
| Artifact | Status | Reference |
|----------|--------|-----------|
| Design Document | Not Started | {to be generated} |
| Test Plan | Not Started | {to be generated} |
| Release Plan | Not Started | {to be generated} |

### Requirement-to-Architecture Trace
| Requirement | Architecture Component | Section |
|------------|----------------------|---------|
| {FR/NFR reference} | {architecture component/decision} | {section number} |`,
  },
];
