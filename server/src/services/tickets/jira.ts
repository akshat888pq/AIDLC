import type { TicketProviderAdapter } from './adapter.js';
import type {
  TicketProject,
  Ticket,
  CreateTicketInput,
  CreatedTicket,
  TicketFilter,
} from '../../types/index.js';

const JIRA_API_BASE = 'https://api.atlassian.com/ex/jira';

function mapIssueType(type: string): Ticket['type'] {
  const lower = type.toLowerCase();
  if (lower === 'epic') return 'epic';
  if (lower === 'feature') return 'feature';
  if (lower === 'story') return 'story';
  if (lower === 'sub-task' || lower === 'subtask') return 'subtask';
  if (lower === 'bug') return 'bug';
  return 'task';
}

function toJiraType(type: CreateTicketInput['type']): string {
  switch (type) {
    case 'epic': return 'Epic';
    case 'feature': return 'Story';
    case 'story': return 'Story';
    case 'task': return 'Task';
    case 'subtask': return 'Sub-task';
  }
}

export class JiraAdapter implements TicketProviderAdapter {
  name = 'jira';
  private cloudId: string;
  private token: string;

  constructor(cloudId: string, token: string) {
    this.cloudId = cloudId;
    this.token = token;
  }

  private get baseUrl(): string {
    return `${JIRA_API_BASE}/${this.cloudId}/rest/api/3`;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...options.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jira API error (${res.status}): ${text.slice(0, 300)}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return res.json();
    return {};
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; org?: string }> {
    try {
      const me = await this.request('/myself');
      const serverInfo = await this.request('/serverInfo');
      return { ok: true, user: me.displayName || me.emailAddress, org: serverInfo.serverTitle };
    } catch {
      return { ok: false };
    }
  }

  async getProjects(): Promise<TicketProject[]> {
    const data = await this.request('/project/search?maxResults=50&orderBy=name');
    return (data.values || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      key: p.key,
      url: p.self,
    }));
  }

  async getTickets(projectId: string, filters?: TicketFilter): Promise<Ticket[]> {
    let jql = `project = "${projectId}"`;
    if (filters?.type) jql += ` AND issuetype = "${toJiraType(filters.type as any)}"`;
    if (filters?.status) jql += ` AND status = "${filters.status}"`;
    if (filters?.assignee) jql += ` AND assignee = "${filters.assignee}"`;
    if (filters?.sprint) jql += ` AND sprint = "${filters.sprint}"`;
    jql += ' ORDER BY updated DESC';

    const data = await this.request(
      `/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,description,issuetype,status,priority,assignee,labels,customfield_10016,parent`
    );

    return (data.issues || []).map((issue: any) => this.mapIssue(issue));
  }

  async getTicket(ticketId: string): Promise<Ticket> {
    const issue = await this.request(`/issue/${ticketId}?fields=summary,description,issuetype,status,priority,assignee,labels,customfield_10016,parent,comment`);
    return this.mapIssue(issue);
  }

  async createTicket(ticket: CreateTicketInput): Promise<CreatedTicket> {
    const body: any = {
      fields: {
        project: { id: ticket.projectId },
        summary: ticket.title,
        issuetype: { name: toJiraType(ticket.type) },
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: ticket.description || '' }],
            },
          ],
        },
      },
    };

    if (ticket.labels && ticket.labels.length > 0) {
      body.fields.labels = ticket.labels;
    }
    if (ticket.storyPoints) {
      body.fields.customfield_10016 = ticket.storyPoints;
    }
    if (ticket.priority) {
      const prioMap: Record<string, string> = { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' };
      body.fields.priority = { name: prioMap[ticket.priority] || 'Medium' };
    }
    if (ticket.parentId) {
      body.fields.parent = { id: ticket.parentId };
    }

    const result = await this.request('/issue', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const siteUrl = await this.getSiteUrl();

    return {
      id: result.id,
      key: result.key,
      title: ticket.title,
      type: ticket.type,
      url: `${siteUrl}/browse/${result.key}`,
    };
  }

  async updateTicket(ticketId: string, updates: Partial<CreateTicketInput>): Promise<Ticket> {
    const fields: any = {};
    if (updates.title) fields.summary = updates.title;
    if (updates.description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [{ type: 'paragraph', content: [{ type: 'text', text: updates.description }] }],
      };
    }

    await this.request(`/issue/${ticketId}`, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    });

    return this.getTicket(ticketId);
  }

  async searchTickets(query: string, projectId: string): Promise<Ticket[]> {
    const jql = `project = "${projectId}" AND (summary ~ "${query}" OR description ~ "${query}") ORDER BY updated DESC`;
    const data = await this.request(
      `/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,description,issuetype,status,priority,assignee,labels,parent`
    );
    return (data.issues || []).map((issue: any) => this.mapIssue(issue));
  }

  async linkTickets(parentId: string, childId: string): Promise<void> {
    await this.request(`/issue/${childId}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { parent: { id: parentId } } }),
    });
  }

  private async getSiteUrl(): Promise<string> {
    try {
      const resources = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
      });
      const sites = await resources.json();
      const site = sites.find((s: any) => s.id === this.cloudId);
      return site ? `https://${site.url}` : '';
    } catch {
      return '';
    }
  }

  private mapIssue(issue: any): Ticket {
    const f = issue.fields || {};
    let desc = '';
    if (f.description?.content) {
      desc = f.description.content
        .map((block: any) =>
          (block.content || []).map((c: any) => c.text || '').join('')
        )
        .join('\n');
    } else if (typeof f.description === 'string') {
      desc = f.description;
    }

    return {
      id: issue.id,
      key: issue.key,
      title: f.summary || '',
      description: desc,
      type: mapIssueType(f.issuetype?.name || 'Task'),
      status: f.status?.name || 'To Do',
      priority: f.priority?.name || 'Medium',
      assignee: f.assignee?.displayName,
      storyPoints: f.customfield_10016,
      labels: f.labels || [],
      parentId: f.parent?.id,
      url: `${issue.self?.split('/rest/')[0] || ''}/browse/${issue.key}`,
      createdAt: f.created,
      updatedAt: f.updated,
    };
  }
}
