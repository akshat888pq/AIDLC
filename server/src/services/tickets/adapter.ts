import type {
  TicketProject,
  Ticket,
  CreateTicketInput,
  CreatedTicket,
  TicketFilter,
} from '../../types/index.js';

export interface TicketProviderAdapter {
  name: string;
  getProjects(): Promise<TicketProject[]>;
  getTickets(projectId: string, filters?: TicketFilter): Promise<Ticket[]>;
  getTicket(ticketId: string): Promise<Ticket>;
  createTicket(ticket: CreateTicketInput): Promise<CreatedTicket>;
  updateTicket(ticketId: string, updates: Partial<CreateTicketInput>): Promise<Ticket>;
  searchTickets(query: string, projectId: string): Promise<Ticket[]>;
  linkTickets(parentId: string, childId: string): Promise<void>;
  testConnection(): Promise<{ ok: boolean; user?: string; org?: string }>;
}
