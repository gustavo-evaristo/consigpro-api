import { ApiProperty } from '@nestjs/swagger';

export class LiveActivityResponse {
  @ApiProperty({ example: 'Camila' })
  who: string;

  @ApiProperty({ example: 'respondeu' })
  action: string;

  @ApiProperty({ example: '7c3a...', nullable: true })
  stageId: string | null;

  @ApiProperty({ example: 'Onboarding', nullable: true })
  stageName: string | null;

  @ApiProperty({ example: '#10b981', nullable: true })
  stageColor: string | null;

  @ApiProperty({ example: '2026-05-01T12:34:56.000Z' })
  timestamp: Date;
}

export class WhatsappSessionResponse {
  @ApiProperty({ example: '7c3a...' })
  flowId: string;

  @ApiProperty({ example: 'Captação revendedoras' })
  flowName: string;

  @ApiProperty({ example: '5511999999999', nullable: true })
  phone: string | null;

  @ApiProperty({
    example: 'pending',
    enum: ['connected', 'pending', 'disconnected'],
  })
  status: 'connected' | 'pending' | 'disconnected';
}

export class PipelineStageResponse {
  @ApiProperty({ example: '7c3a...' })
  id: string;

  @ApiProperty({ example: 'Boas-vindas' })
  title: string;

  @ApiProperty({ example: '#64748b', nullable: true })
  color: string | null;

  @ApiProperty({ example: 0 })
  order: number;

  @ApiProperty({ example: 3 })
  count: number;
}

export class DateCountResponse {
  @ApiProperty({ example: '20/04' })
  date: string;

  @ApiProperty({ example: 12 })
  count: number;
}

export class DateRateResponse {
  @ApiProperty({ example: '20/04' })
  date: string;

  @ApiProperty({ example: 54 })
  rate: number;
}

export class FlowPerformanceResponse {
  @ApiProperty({ example: '7c3a...' })
  flowId: string;

  @ApiProperty({ example: 'Captação revendedoras' })
  name: string;

  @ApiProperty({ example: 84 })
  leads: number;

  @ApiProperty({ example: 61 })
  percentage: number;
}

export class ConversationStatusCountsResponse {
  @ApiProperty({ example: 47 })
  active: number;

  @ApiProperty({ example: 82 })
  completed: number;

  @ApiProperty({ example: 8 })
  abandoned: number;
}

export class GetAnalyticsV2Response {
  @ApiProperty({ example: 34 })
  messagesReceivedToday: number;

  @ApiProperty({ example: 6 })
  newLeadsToday: number;

  @ApiProperty({ example: 12 })
  activeConversations: number;

  @ApiProperty({ example: 3 })
  pendingResponses: number;

  @ApiProperty({ example: 68 })
  completionRate: number;

  @ApiProperty({ type: LiveActivityResponse, isArray: true })
  liveActivity: LiveActivityResponse[];

  @ApiProperty({ type: WhatsappSessionResponse, isArray: true })
  whatsappSessions: WhatsappSessionResponse[];

  @ApiProperty({ example: [4, 3, 5, 7, 6, 8, 9, 11, 8, 12, 14, 12, 13, 15] })
  leadsByDay: number[];

  @ApiProperty({ example: 137 })
  leadsByDayTotal: number;

  @ApiProperty({ example: 23 })
  leadsByDayDelta: number;

  @ApiProperty({ example: '7c3a...', nullable: true })
  pipelineKanbanId: string | null;

  @ApiProperty({ example: 'Captação de revendedoras', nullable: true })
  pipelineKanbanTitle: string | null;

  @ApiProperty({ type: PipelineStageResponse, isArray: true })
  pipelineStages: PipelineStageResponse[];

  @ApiProperty({ example: Array(24).fill(0) })
  messagesByHour: number[];

  @ApiProperty({ type: DateCountResponse, isArray: true })
  leadsByDateDetailed: DateCountResponse[];

  @ApiProperty({ type: DateCountResponse, isArray: true })
  messagesByDateDetailed: DateCountResponse[];

  @ApiProperty({ type: DateRateResponse, isArray: true })
  completionRateByDate: DateRateResponse[];

  @ApiProperty({ type: ConversationStatusCountsResponse })
  conversationStatusCounts: ConversationStatusCountsResponse;

  @ApiProperty({ type: FlowPerformanceResponse, isArray: true })
  performanceByFlow: FlowPerformanceResponse[];

  @ApiProperty({ example: '2m 14s' })
  averageResponseTime: string;

  @ApiProperty({ example: 137 })
  uniqueLeads: number;

  @ApiProperty({
    example: null,
    nullable: true,
    description:
      'null when there is no real cost source available; UI hides the card.',
  })
  costPerLead: string | null;
}
