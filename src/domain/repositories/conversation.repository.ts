import { ConversationEntity } from '../entities/conversation.entity';

export interface ConversationSummary {
  id: string;
  leadPhoneNumber: string;
  leadName: string | null;
  status: string;
  automationEnabled: boolean;
  flowId: string;
  flowTitle: string;
  flowKanbanId: string | null;
  kanbanStageId: string | null;
  kanbanStageName: string | null;
  kanbanStageColor: string | null;
  lastMessage: { content: string; sender: string; sentAt: Date } | null;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadSummary {
  id: string;
  leadPhoneNumber: string;
  leadName: string | null;
  status: string;
  flowId: string;
  flowTitle: string;
  kanbanStageId: string | null;
  kanbanStageName: string | null;
  kanbanStageColor: string | null;
  createdAt: Date;
}

export interface ConversationDetail {
  id: string;
  flowId: string;
  leadPhoneNumber: string;
  leadName: string | null;
  status: string;
  automationEnabled: boolean;
  flowTitle: string;
  flowUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export abstract class IConversationRepository {
  abstract create(conversation: ConversationEntity): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract findActive(
    flowId: string,
    leadPhoneNumber: string,
  ): Promise<ConversationEntity | null>;
  abstract update(conversation: ConversationEntity): Promise<void>;
  abstract findManyByUserId(userId: string): Promise<ConversationSummary[]>;
  abstract findById(id: string): Promise<ConversationDetail | null>;
  abstract findByIdAsEntity(id: string): Promise<ConversationEntity | null>;
  abstract findIdsByLeadAndKanban(
    flowId: string,
    leadPhoneNumber: string,
  ): Promise<string[]>;
  abstract findLeadsByUserId(userId: string): Promise<LeadSummary[]>;
  abstract findLastFinished(
    flowId: string,
    leadPhoneNumber: string,
  ): Promise<ConversationEntity | null>;
  abstract findByLeadPhone(
    userId: string,
    leadPhoneNumber: string,
  ): Promise<ConversationEntity | null>;
}
