import { describe, it, expect, vi, beforeEach } from 'vitest';
import { subHours } from 'date-fns';
import { ProcessMessageUseCase } from './process-message.use-case';
import { IKanbanRepository } from 'src/domain/repositories/kanban.repository';
import { IConversationRepository } from 'src/domain/repositories/conversation.repository';
import { IConversationProgressRepository } from 'src/domain/repositories/conversation-progress.repository';
import { ILeadResponseRepository } from 'src/domain/repositories/lead-response.repository';
import { KanbanEntity } from 'src/domain/entities/kanban.entity';
import {
  ConversationEntity,
  ConversationStatus,
} from 'src/domain/entities/conversation.entity';
import { ConversationProgressEntity } from 'src/domain/entities/conversation-progress.entity';
import { NodeType } from 'src/domain/entities/flow-node.entity';
import { UUID } from 'src/domain/entities/vos';

// ---------- helpers ----------

const makeKanban = () =>
  new KanbanEntity({
    userId: UUID.generate().toString(),
    title: 'Test Kanban',
    description: 'Desc',
    phoneNumber: '5511000000000',
    isActive: true,
    startNodeId: 'node-1',
  });

const makeDetails = (
  nodes: {
    id: string;
    type: NodeType;
    defaultNextNodeId?: string | null;
    options?: {
      id: string;
      content: string;
      score: number;
      order: number;
      nextNodeId: string | null;
    }[];
  }[],
) => ({
  id: 'kanban-1',
  title: 'Test Kanban',
  description: 'Desc',
  userId: 'user-1',
  startNodeId: nodes[0]?.id ?? null,
  nodes: nodes.map((n) => ({
    defaultNextNodeId: null,
    options: [],
    content: `Message ${n.id}`,
    x: 0,
    y: 0,
    ...n,
  })),
});

const makeConversation = (kanbanId: string) =>
  new ConversationEntity({ kanbanId, leadPhoneNumber: '5511999999999' });

const makeProgress = (
  conversationId: string,
  nodeId: string,
  waiting = false,
) =>
  new ConversationProgressEntity({
    conversationId,
    currentNodeId: nodeId,
    waitingForResponse: waiting,
  });

// ---------- setup ----------

describe('ProcessMessageUseCase', () => {
  let kanbanRepository: IKanbanRepository;
  let conversationRepository: IConversationRepository;
  let progressRepository: IConversationProgressRepository;
  let leadResponseRepository: ILeadResponseRepository;
  let useCase: ProcessMessageUseCase;

  beforeEach(() => {
    kanbanRepository = {
      findByPhoneNumber: vi.fn(),
      getDetails: vi.fn(),
    } as unknown as IKanbanRepository;

    conversationRepository = {
      create: vi.fn(),
      findActive: vi.fn(),
      findLastFinished: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    } as unknown as IConversationRepository;

    progressRepository = {
      create: vi.fn(),
      findByConversationId: vi.fn(),
      update: vi.fn(),
    } as unknown as IConversationProgressRepository;

    leadResponseRepository = {
      create: vi.fn(),
    } as unknown as ILeadResponseRepository;

    useCase = new ProcessMessageUseCase(
      kanbanRepository,
      conversationRepository,
      progressRepository,
      leadResponseRepository,
    );
  });

  // ---- no kanban ----

  it('should return a default message when no kanban is found for the number', async () => {
    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(null);

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511000000000',
      messageText: 'Hello',
    });

    expect(messagesToSend).toHaveLength(1);
    expect(messagesToSend[0]).toContain('não há atendimento');
  });

  // ---- new conversation with TEXT ----

  it('should send all consecutive TEXT messages when starting a new conversation', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      { id: 'node-1', type: NodeType.TEXT, defaultNextNodeId: 'node-2' },
      { id: 'node-2', type: NodeType.TEXT, defaultNextNodeId: null },
    ]);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(null);
    vi.mocked(conversationRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Hello',
    });

    expect(messagesToSend).toHaveLength(2);
    expect(messagesToSend[0]).toBe('Message node-1');
    expect(messagesToSend[1]).toBe('Message node-2');
  });

  it('should stop and wait for response when hitting FREE_INPUT', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      { id: 'node-1', type: NodeType.TEXT, defaultNextNodeId: 'node-2' },
      {
        id: 'node-2',
        type: NodeType.QUESTION_FREE_INPUT,
        defaultNextNodeId: 'node-3',
      },
      { id: 'node-3', type: NodeType.TEXT, defaultNextNodeId: null },
    ]);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(null);
    vi.mocked(conversationRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Hi',
    });

    // Should send TEXT then FREE_INPUT question, but not node-3
    expect(messagesToSend).toHaveLength(2);
    expect(messagesToSend[1]).toBe('Message node-2');
  });

  it('should send numbered options for MULTIPLE_CHOICE', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      {
        id: 'node-1',
        type: NodeType.QUESTION_MULTIPLE_CHOICE,
        options: [
          {
            id: 'opt-1',
            content: 'Yes',
            score: 10,
            order: 0,
            nextNodeId: null,
          },
          { id: 'opt-2', content: 'No', score: 0, order: 1, nextNodeId: null },
        ],
      },
    ]);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(null);
    vi.mocked(conversationRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Hi',
    });

    expect(messagesToSend).toHaveLength(1);
    expect(messagesToSend[0]).toContain('1. Yes');
    expect(messagesToSend[0]).toContain('2. No');
  });

  // ---- replying to FREE_INPUT ----

  it('should save lead response and advance to next node', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      {
        id: 'node-1',
        type: NodeType.QUESTION_FREE_INPUT,
        defaultNextNodeId: 'node-2',
      },
      { id: 'node-2', type: NodeType.TEXT, defaultNextNodeId: null },
    ]);

    const conversation = makeConversation(kanban.id.toString());
    const progress = makeProgress(conversation.id.toString(), 'node-1', true);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(
      conversation,
    );
    vi.mocked(progressRepository.findByConversationId).mockResolvedValue(
      progress,
    );
    vi.mocked(leadResponseRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'I want to know more!',
    });

    expect(leadResponseRepository.create).toHaveBeenCalledOnce();
    expect(messagesToSend).toHaveLength(1);
    expect(messagesToSend[0]).toBe('Message node-2');
  });

  // ---- replying to MULTIPLE_CHOICE with branching ----

  it('should route to the option nextNodeId when picking a multiple choice answer', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      {
        id: 'node-1',
        type: NodeType.QUESTION_MULTIPLE_CHOICE,
        options: [
          {
            id: 'opt-1',
            content: 'Yes',
            score: 10,
            order: 0,
            nextNodeId: 'node-yes',
          },
          {
            id: 'opt-2',
            content: 'No',
            score: 0,
            order: 1,
            nextNodeId: 'node-no',
          },
        ],
      },
      { id: 'node-yes', type: NodeType.TEXT, defaultNextNodeId: null },
      { id: 'node-no', type: NodeType.TEXT, defaultNextNodeId: null },
    ]);

    const conversation = makeConversation(kanban.id.toString());
    const progress = makeProgress(conversation.id.toString(), 'node-1', true);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(
      conversation,
    );
    vi.mocked(progressRepository.findByConversationId).mockResolvedValue(
      progress,
    );
    vi.mocked(leadResponseRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    // Lead escolhe "Yes" → deve ir para node-yes
    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Yes',
    });

    const savedResponse = vi.mocked(leadResponseRepository.create).mock
      .calls[0][0];
    expect(savedResponse.nodeOptionId).toBe('opt-1');
    expect(savedResponse.score).toBe(10);
    expect(messagesToSend[0]).toBe('Message node-yes');
  });

  it('should associate nodeOptionId and score when saving a multiple choice response', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      {
        id: 'node-1',
        type: NodeType.QUESTION_MULTIPLE_CHOICE,
        options: [
          {
            id: 'opt-1',
            content: 'Yes',
            score: 10,
            order: 0,
            nextNodeId: null,
          },
          { id: 'opt-2', content: 'No', score: 0, order: 1, nextNodeId: null },
        ],
      },
    ]);

    const conversation = makeConversation(kanban.id.toString());
    const progress = makeProgress(conversation.id.toString(), 'node-1', true);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(
      conversation,
    );
    vi.mocked(progressRepository.findByConversationId).mockResolvedValue(
      progress,
    );
    vi.mocked(leadResponseRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Yes',
    });

    const savedResponse = vi.mocked(leadResponseRepository.create).mock
      .calls[0][0];
    expect(savedResponse.nodeOptionId).toBe('opt-1');
    expect(savedResponse.score).toBe(10);
  });

  // ---- end of flow ----

  it('should finish the conversation after the last node', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      {
        id: 'node-1',
        type: NodeType.QUESTION_FREE_INPUT,
        defaultNextNodeId: null,
      },
    ]);

    const conversation = makeConversation(kanban.id.toString());
    const progress = makeProgress(conversation.id.toString(), 'node-1', true);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(
      conversation,
    );
    vi.mocked(progressRepository.findByConversationId).mockResolvedValue(
      progress,
    );
    vi.mocked(leadResponseRepository.create).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Final answer',
    });

    const updatedConversation = vi.mocked(conversationRepository.update).mock
      .calls[0][0];
    expect(updatedConversation.isActive()).toBe(false);
  });

  // ---- 24h cooldown after FINISHED ----

  it('should not start a new flow when lead messages within 24h of finishing', async () => {
    const kanban = makeKanban();
    const details = makeDetails([{ id: 'node-1', type: NodeType.TEXT }]);

    const finishedConversation = new ConversationEntity({
      kanbanId: kanban.id.toString(),
      leadPhoneNumber: '5511999999999',
      status: ConversationStatus.FINISHED,
      updatedAt: subHours(new Date(), 2),
    });

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(null);
    vi.mocked(conversationRepository.findLastFinished).mockResolvedValue(
      finishedConversation,
    );

    const { conversationId, messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Tenho uma dúvida',
    });

    expect(conversationId).toBe(finishedConversation.id.toString());
    expect(messagesToSend).toHaveLength(0);
    expect(conversationRepository.create).not.toHaveBeenCalled();
  });

  it('should start a new flow when lead messages after the 24h cooldown', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      { id: 'node-1', type: NodeType.TEXT, defaultNextNodeId: null },
    ]);

    const finishedConversation = new ConversationEntity({
      kanbanId: kanban.id.toString(),
      leadPhoneNumber: '5511999999999',
      status: ConversationStatus.FINISHED,
      updatedAt: subHours(new Date(), 25),
    });

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(null);
    vi.mocked(conversationRepository.findLastFinished).mockResolvedValue(
      finishedConversation,
    );
    vi.mocked(conversationRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Olá novamente',
    });

    expect(conversationRepository.create).toHaveBeenCalledOnce();
    expect(messagesToSend).toHaveLength(1);
  });

  it('should start a new flow when there is no previous finished conversation', async () => {
    const kanban = makeKanban();
    const details = makeDetails([
      { id: 'node-1', type: NodeType.TEXT, defaultNextNodeId: null },
    ]);

    vi.mocked(kanbanRepository.findByPhoneNumber).mockResolvedValue(kanban);
    vi.mocked(kanbanRepository.getDetails).mockResolvedValue(details);
    vi.mocked(conversationRepository.findActive).mockResolvedValue(null);
    vi.mocked(conversationRepository.findLastFinished).mockResolvedValue(null);
    vi.mocked(conversationRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.create).mockResolvedValue();
    vi.mocked(progressRepository.update).mockResolvedValue();
    vi.mocked(conversationRepository.update).mockResolvedValue();

    const { messagesToSend } = await useCase.execute({
      botPhoneNumber: '5511000000000',
      leadPhoneNumber: '5511999999999',
      messageText: 'Oi',
    });

    expect(conversationRepository.create).toHaveBeenCalledOnce();
    expect(messagesToSend).toHaveLength(1);
  });
});
