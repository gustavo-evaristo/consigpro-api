export interface LiveActivityItem {
  who: string;
  action: string;
  stageId: string | null;
  stageName: string | null;
  stageColor: string | null;
  timestamp: Date;
}

export type WhatsappSessionStatus = 'connected' | 'pending' | 'disconnected';

export interface WhatsappSessionItem {
  flowId: string;
  flowName: string;
  phone: string | null;
  isActive: boolean;
  status: WhatsappSessionStatus;
}

export interface PipelineStageItem {
  id: string;
  title: string;
  color: string | null;
  order: number;
  count: number;
}

export interface DateCount {
  date: string;
  count: number;
}

export interface DateRate {
  date: string;
  rate: number;
}

export interface FlowPerformance {
  flowId: string;
  name: string;
  leads: number;
  percentage: number;
}

export interface AnalyticsV2Result {
  // KPIs do topo
  messagesReceivedToday: number;
  newLeadsToday: number;
  activeConversations: number;
  pendingResponses: number;
  completionRate: number;

  // Tempo real
  liveActivity: LiveActivityItem[];

  // Sessões WhatsApp por fluxo
  whatsappSessions: WhatsappSessionItem[];

  // Sparkline 14d
  leadsByDay: number[];
  leadsByDayTotal: number;
  leadsByDayDelta: number;

  // Pipeline (kanban)
  pipelineKanbanId: string | null;
  pipelineKanbanTitle: string | null;
  pipelineStages: PipelineStageItem[];

  // Mensagens por hora (24)
  messagesByHour: number[];

  // Período selecionado
  leadsByDateDetailed: DateCount[];
  messagesByDateDetailed: DateCount[];
  completionRateByDate: DateRate[];

  // Status donut
  conversationStatusCounts: {
    active: number;
    completed: number;
    abandoned: number;
  };

  // Performance por fluxo
  performanceByFlow: FlowPerformance[];

  // KPIs finais
  averageResponseTime: string;
  uniqueLeads: number;
  /** null when there is no real cost source available yet. UI hides the card. */
  costPerLead: string | null;
}

export abstract class IAnalyticsV2Repository {
  abstract getAnalyticsV2(
    userId: string,
    startDate: Date,
    endDate: Date,
    kanbanId?: string,
    flowId?: string,
  ): Promise<AnalyticsV2Result>;
}
