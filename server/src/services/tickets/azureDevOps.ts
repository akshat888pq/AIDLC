import type { TicketProviderAdapter } from './adapter.js';
import type {
  TicketProject,
  Ticket,
  CreateTicketInput,
  CreatedTicket,
  TicketFilter,
} from '../../types/index.js';

const API_VERSION = '7.1';

function mapWorkItemType(type: string): Ticket['type'] {
  const lower = type.toLowerCase();
  if (lower.includes('epic')) return 'epic';
  if (lower.includes('feature')) return 'feature';
  if (lower.includes('user story') || lower.includes('story')) return 'story';
  if (lower.includes('bug')) return 'bug';
  return 'task';
}

function toAdoType(type: CreateTicketInput['type']): string {
  switch (type) {
    case 'epic': return 'Epic';
    case 'feature': return 'Feature';
    case 'story': return 'User Story';
    case 'task': return 'Task';
    case 'subtask': return 'Task';
  }
}

export class AzureDevOpsAdapter implements TicketProviderAdapter {
  name = 'azure-devops';
  private orgUrl: string;
  private token: string;

  constructor(orgUrl: string, token: string) {
    this.orgUrl = orgUrl.replace(/\/$/, '');
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.orgUrl}/${path}${path.includes('?') ? '&' : '?'}api-version=${API_VERSION}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json-patch+json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Azure DevOps API error (${res.status}): ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; org?: string }> {
    try {
      const profile = await fetch('https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1', {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (!profile.ok) return { ok: false };
      const data = await profile.json();
      const orgPart = this.orgUrl.split('/').pop() || this.orgUrl;
      return { ok: true, user: data.displayName || data.emailAddress, org: orgPart };
    } catch {
      return { ok: false };
    }
  }

  async getProjects(): Promise<TicketProject[]> {
    const data = await this.request('_apis/projects');
    return (data.value || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      url: `${this.orgUrl}/${p.name}`,
    }));
  }

  async getTickets(projectId: string, filters?: TicketFilter): Promise<Ticket[]> {
    let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectId}'`;

    if (filters?.type) {
      wiql += ` AND [System.WorkItemType] = '${toAdoType(filters.type as any)}'`;
    }
    if (filters?.status) {
      wiql += ` AND [System.State] = '${filters.status}'`;
    }
    if (filters?.assignee) {
      wiql += ` AND [System.AssignedTo] Contains '${filters.assignee}'`;
    }
    if (filters?.sprint) {
      wiql += ` AND [System.IterationPath] Under '${filters.sprint}'`;
    }
    wiql += ' ORDER BY [System.ChangedDate] DESC';

    const result = await this.request(`${projectId}/_apis/wit/wiql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: wiql }),
    });

    const ids = (result.workItems || []).slice(0, 100).map((w: any) => w.id);
    if (ids.length === 0) return [];

    const details = await this.request(
      `_apis/wit/workitems?ids=${ids.join(',')}&$expand=relations`
    );

    return (details.value || []).map((wi: any) => this.mapWorkItem(wi, projectId));
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    const wi = await this.request(`_apis/wit/workitems/${ticketId}?$expand=relations`);
    return this.mapWorkItem(wi);
  }

  async createTicket(ticket: CreateTicketInput): Promise<CreatedTicket> {
    const patches: any[] = [
      { op: 'add', path: '/fields/System.Title', value: ticket.title },
      { op: 'add', path: '/fields/System.Description', value: ticket.description },
      { op: 'add', path: '/fields/System.WorkItemType', value: toAdoType(ticket.type) },
    ];

    if (ticket.priority) {
      const prioMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };
      patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: prioMap[ticket.priority] || 3 });
    }
    if (ticket.acceptanceCriteria) {
      patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Common.AcceptanceCriteria', value: ticket.acceptanceCriteria });
    }
    if (ticket.storyPoints) {
      patches.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StoryPoints', value: ticket.storyPoints });
    }
    if (ticket.labels && ticket.labels.length > 0) {
      patches.push({ op: 'add', path: '/fields/System.Tags', value: ticket.labels.join('; ') });
    }

    const result = await this.request(`${ticket.projectId}/_apis/wit/workitems/$${toAdoType(ticket.type)}`, {
      method: 'POST',
      body: JSON.stringify(patches),
    });

    return {
      id: String(result.id),
      key: `ADO-${result.id}`,
      title: result.fields['System.Title'],
      type: ticket.type,
      url: result._links?.html?.href || `${this.orgUrl}/${ticket.projectId}/_workitems/edit/${result.id}`,
    };
  }

  async updateTicket(ticketId: string, updates: Partial<CreateTicketInput>): Promise<Ticket> {
    const patches: any[] = [];
    if (updates.title) patches.push({ op: 'replace', path: '/fields/System.Title', value: updates.title });
    if (updates.description) patches.push({ op: 'replace', path: '/fields/System.Description', value: updates.description });

    const result = await this.request(`_apis/wit/workitems/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(patches),
    });

    return this.mapWorkItem(result);
  }

  async searchTickets(query: string, projectId: string): Promise<Ticket[]> {
    const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${projectId}' AND ([System.Title] Contains '${query}' OR [System.Description] Contains '${query}') ORDER BY [System.ChangedDate] DESC`;

    const result = await this.request(`${projectId}/_apis/wit/wiql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: wiql }),
    });

    const ids = (result.workItems || []).slice(0, 50).map((w: any) => w.id);
    if (ids.length === 0) return [];

    const details = await this.request(`_apis/wit/workitems?ids=${ids.join(',')}`);
    return (details.value || []).map((wi: any) => this.mapWorkItem(wi, projectId));
  }

  async linkTickets(parentId: string, childId: string): Promise<void> {
    await this.request(`_apis/wit/workitems/${childId}`, {
      method: 'PATCH',
      body: JSON.stringify([
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: `${this.orgUrl}/_apis/wit/workitems/${parentId}`,
          },
        },
      ]),
    });
  }

  private mapWorkItem(wi: any, projectId?: string): Ticket {
    const f = wi.fields || {};
    const parentRel = (wi.relations || []).find((r: any) => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    return {
      id: String(wi.id),
      key: `ADO-${wi.id}`,
      title: f['System.Title'] || '',
      description: f['System.Description'] || '',
      type: mapWorkItemType(f['System.WorkItemType'] || 'Task'),
      status: f['System.State'] || 'New',
      priority: String(f['Microsoft.VSTS.Common.Priority'] || 3),
      assignee: f['System.AssignedTo']?.displayName,
      storyPoints: f['Microsoft.VSTS.Scheduling.StoryPoints'],
      acceptanceCriteria: f['Microsoft.VSTS.Common.AcceptanceCriteria'],
      labels: (f['System.Tags'] || '').split(';').map((t: string) => t.trim()).filter(Boolean),
      parentId: parentRel ? parentRel.url.split('/').pop() : undefined,
      url: wi._links?.html?.href || `${this.orgUrl}/${projectId || '_'}/_workitems/edit/${wi.id}`,
      createdAt: f['System.CreatedDate'],
      updatedAt: f['System.ChangedDate'],
    };
  }
}
