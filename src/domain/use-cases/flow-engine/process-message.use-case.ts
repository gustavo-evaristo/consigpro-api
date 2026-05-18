import { Injectable, Logger } from '@nestjs/common';
import { isAfter, subHours } from 'date-fns';
import { IFlowRepository } from 'src/domain/repositories/flow.repository';
import { IConversationRepository } from 'src/domain/repositories/conversation.repository';
import { IConversationProgressRepository } from 'src/domain/repositories/conversation-progress.repository';
import { ILeadResponseRepository } from 'src/domain/repositories/lead-response.repository';
import { IFormRepository } from 'src/domain/repositories/form.repository';
import { ConversationEntity } from 'src/domain/entities/conversation.entity';
import { ConversationProgressEntity } from 'src/domain/entities/conversation-progress.entity';
import { LeadResponseEntity } from 'src/domain/entities/lead-response.entity';
import { NodeType } from 'src/domain/entities/flow-node.entity';
import { FlowDetails, FlowNodeDetail } from 'src/domain/entities/flow.entity';

interface Input {
  botPhoneNumber: string;
  leadPhoneNumber: string;
  messageText: string;
  leadName?: string | null;
}

interface Output {
  conversationId: string | null;
  userId: string | null;
  messagesToSend: string[];
}

@Injectable()
export class ProcessMessageUseCase {
  private readonly logger = new Logger(ProcessMessageUseCase.name);

  constructor(
    private readonly kanbanRepository: IFlowRepository,
    private readonly conversationRepository: IConversationRepository,
    private readonly conversationProgressRepository: IConversationProgressRepository,
    private readonly leadResponseRepository: ILeadResponseRepository,
    private readonly formRepository: IFormRepository,
  ) {}

  async execute({
    botPhoneNumber,
    leadPhoneNumber,
    messageText,
    leadName,
  }: Input): Promise<Output> {
    const kanban =
      await this.kanbanRepository.findByPhoneNumber(botPhoneNumber);

    if (!kanban) {
      return {
        conversationId: null,
        userId: null,
        messagesToSend: [
          'Olá! No momento não há atendimento disponível neste número.',
        ],
      };
    }

    const userId = kanban.userId.toString();

    const details = await this.kanbanRepository.getDetails(
      kanban.id.toString(),
    );

    if (!details || !details.startNodeId || details.nodes.length === 0) {
      return { conversationId: null, userId, messagesToSend: [] };
    }

    const nodeMap = this.buildNodeMap(details);

    let conversation = await this.conversationRepository.findActive(
      kanban.id.toString(),
      leadPhoneNumber,
    );

    // Automação desativada: humano assumiu, bot silencioso
    if (conversation && !conversation.automationEnabled) {
      return {
        conversationId: conversation.id.toString(),
        userId,
        messagesToSend: [],
      };
    }

    // Nova conversa: verificar cooldown de 24h antes de reiniciar o fluxo
    if (!conversation) {
      const lastFinished = await this.conversationRepository.findLastFinished(
        kanban.id.toString(),
        leadPhoneNumber,
      );

      if (
        lastFinished &&
        isAfter(lastFinished.updatedAt, subHours(new Date(), 1))
      ) {
        this.logger.warn(
          `[${leadPhoneNumber}] Cooldown ativo — última conversa encerrada há menos de 1h. Ignorando nova mensagem.`,
        );
        return {
          conversationId: lastFinished.id.toString(),
          userId,
          messagesToSend: [],
        };
      }

      // Se o humano desativou o bot na última conversa, mantém desativado ao
      // criar a próxima — caso contrário um lead que retorna após o cooldown
      // entraria no fluxo de novo.
      if (lastFinished && !lastFinished.automationEnabled) {
        const silentConversation = new ConversationEntity({
          flowId: kanban.id,
          leadPhoneNumber,
          leadName: leadName ?? null,
          automationEnabled: false,
        });
        await this.conversationRepository.create(silentConversation);
        this.logger.log(
          `[${leadPhoneNumber}] Bot pausado para este lead — nova conversa criada silenciosa.`,
        );
        return {
          conversationId: silentConversation.id.toString(),
          userId,
          messagesToSend: [],
        };
      }

      const startNode = nodeMap.get(details.startNodeId);
      if (!startNode) {
        return { conversationId: null, userId, messagesToSend: [] };
      }

      conversation = new ConversationEntity({
        flowId: kanban.id,
        leadPhoneNumber,
        leadName: leadName ?? null,
      });

      const progress = new ConversationProgressEntity({
        conversationId: conversation.id,
        currentNodeId: details.startNodeId,
        waitingForResponse: false,
      });

      await this.conversationRepository.create(conversation);
      await this.conversationProgressRepository.create(progress);

      return this.executeFromCurrentPosition(
        progress,
        nodeMap,
        conversation,
        userId,
        leadPhoneNumber,
      );
    }

    // Conversa existente: processar resposta do lead
    const progress =
      await this.conversationProgressRepository.findByConversationId(
        conversation.id.toString(),
      );

    if (!progress) {
      this.logger.warn(
        `[${leadPhoneNumber}] Progresso não encontrado para conversa ${conversation.id}`,
      );
      return {
        conversationId: conversation.id.toString(),
        userId,
        messagesToSend: [],
      };
    }

    if (!progress.waitingForResponse) {
      this.logger.warn(
        `[${leadPhoneNumber}] Bot não está aguardando resposta (waitingForResponse=false) — mensagem ignorada`,
      );
      return {
        conversationId: conversation.id.toString(),
        userId,
        messagesToSend: [],
      };
    }

    const currentNode = nodeMap.get(progress.currentNodeId);

    if (!currentNode) {
      this.logger.error(
        `[${leadPhoneNumber}] Nó atual não encontrado no mapa: currentNodeId=${progress.currentNodeId}. Verifique se o nó existe e não foi deletado.`,
      );
      return {
        conversationId: conversation.id.toString(),
        userId,
        messagesToSend: [],
      };
    }

    // Determinar próximo nó e salvar resposta
    let nodeOptionId: string | null = null;
    let nextNodeId: string | null;
    let score: number | null = null;

    if (
      currentNode.type === NodeType.QUESTION_MULTIPLE_CHOICE &&
      currentNode.options.length > 0
    ) {
      const trimmed = messageText.trim();
      const indexMatch = parseInt(trimmed, 10);
      const sorted = [...currentNode.options].sort((a, b) => a.order - b.order);
      const matched = sorted.find(
        (o, i) =>
          (!isNaN(indexMatch) && indexMatch === i + 1) ||
          o.content.trim().toLowerCase() === trimmed.toLowerCase(),
      );

      if (!matched) {
        const options = sorted
          .map((o, i) => `${i + 1}. ${o.content}`)
          .join('\n');
        return {
          conversationId: conversation.id.toString(),
          userId,
          messagesToSend: [
            `Opção inválida. Por favor, escolha uma das alternativas:\n\n${options}\n\n_Digite o número da opção desejada._`,
          ],
        };
      }

      nodeOptionId = matched.id;
      nextNodeId = matched.nextNodeId;
      score = matched.score;
    } else {
      // FREE_INPUT: seguir edge padrão do nó
      nextNodeId = currentNode.defaultNextNodeId;
    }

    const leadResponse = new LeadResponseEntity({
      conversationId: conversation.id,
      nodeId: currentNode.id,
      responseText: messageText,
      nodeOptionId,
      score,
    });

    await this.leadResponseRepository.create(leadResponse);

    if (nextNodeId === null) {
      this.logger.warn(
        `[${leadPhoneNumber}] Nó "${currentNode.type}" (id=${currentNode.id}) não tem próximo nó definido (defaultNextNodeId=null). Conversa encerrada.`,
      );
      conversation.finish();
      await this.conversationRepository.update(conversation);
      return {
        conversationId: conversation.id.toString(),
        userId,
        messagesToSend: [],
      };
    }

    progress.advanceTo(nextNodeId);
    await this.conversationProgressRepository.update(progress);

    return this.executeFromCurrentPosition(
      progress,
      nodeMap,
      conversation,
      userId,
      leadPhoneNumber,
    );
  }

  private async executeFromCurrentPosition(
    progress: ConversationProgressEntity,
    nodeMap: Map<string, FlowNodeDetail>,
    conversation: ConversationEntity,
    userId: string,
    leadPhoneNumber?: string,
  ): Promise<Output> {
    const messagesToSend: string[] = [];
    const visited = new Set<string>();

    while (true) {
      if (visited.has(progress.currentNodeId)) {
        this.logger.error(
          `Ciclo detectado no fluxo ${conversation.flowId.toString()} no nó ${progress.currentNodeId}. Encerrando conversa para evitar loop infinito.`,
        );
        conversation.finish();
        await this.conversationRepository.update(conversation);
        await this.conversationProgressRepository.update(progress);
        break;
      }
      visited.add(progress.currentNodeId);

      const currentNode = nodeMap.get(progress.currentNodeId);

      if (!currentNode) {
        this.logger.error(
          `Nó não encontrado no mapa durante execução: nodeId=${progress.currentNodeId}. Verifique conexões do fluxo.`,
        );
        conversation.finish();
        await this.conversationRepository.update(conversation);
        break;
      }

      if (currentNode.kanbanStageId) {
        progress.recordKanbanStage(currentNode.kanbanStageId);
      }

      if (currentNode.type === NodeType.END) {
        if (currentNode.content?.trim()) {
          messagesToSend.push(currentNode.content);
        }
        conversation.finish();
        await this.conversationRepository.update(conversation);
        await this.conversationProgressRepository.update(progress);
        break;
      }

      if (currentNode.type === NodeType.FORM) {
        const formMessage = await this.buildFormMessage(
          currentNode,
          leadPhoneNumber,
        );
        messagesToSend.push(formMessage);

        if (!currentNode.defaultNextNodeId) {
          conversation.finish();
          await this.conversationRepository.update(conversation);
          await this.conversationProgressRepository.update(progress);
          break;
        }

        progress.advanceTo(currentNode.defaultNextNodeId);
        await this.conversationProgressRepository.update(progress);
      } else if (currentNode.type === NodeType.TEXT) {
        messagesToSend.push(currentNode.content);

        if (!currentNode.defaultNextNodeId) {
          conversation.finish();
          await this.conversationRepository.update(conversation);
          await this.conversationProgressRepository.update(progress);
          break;
        }

        progress.advanceTo(currentNode.defaultNextNodeId);
        await this.conversationProgressRepository.update(progress);
      } else {
        // QUESTION_MULTIPLE_CHOICE ou QUESTION_FREE_INPUT
        let message = currentNode.content;

        if (
          currentNode.type === NodeType.QUESTION_MULTIPLE_CHOICE &&
          currentNode.options.length > 0
        ) {
          const sorted = [...currentNode.options].sort(
            (a, b) => a.order - b.order,
          );
          const opts = sorted
            .map((o, i) => `${i + 1}. ${o.content}`)
            .join('\n');
          message = `${currentNode.content}\n\n${opts}\n\n_Digite o número da opção desejada._`;
        }

        messagesToSend.push(message);
        progress.waitForResponse();
        await this.conversationProgressRepository.update(progress);
        break;
      }
    }

    return {
      conversationId: conversation.id.toString(),
      userId,
      messagesToSend,
    };
  }

  private async buildFormMessage(
    node: FlowNodeDetail,
    leadPhone: string,
  ): Promise<string> {
    this.logger.log(
      `[FORM] nodeId=${node.id} formId=${node.formId} leadPhone=${leadPhone}`,
    );

    if (!node.formId) {
      this.logger.warn(`[FORM] formId is null — sending content only`);
      return node.content;
    }

    const form = await this.formRepository.getByIdInternal(node.formId);
    this.logger.log(
      `[FORM] form found: ${form ? form.id : 'NOT FOUND'} token=${form?.token}`,
    );

    if (!form) return node.content;

    const params = new URLSearchParams({ phone: leadPhone });
    if (node.postFillKanbanStageId)
      params.set('postFillStageId', node.postFillKanbanStageId);

    const frontendUrl = process.env.FRONTEND_URL || 'https://app.consig.pro';

    const link = `${frontendUrl}/f/${form.token}?${params.toString()}`;

    this.logger.log(`[FORM] link gerado: ${link}`);

    return `${node.content}\n\n${link}`;
  }

  private buildNodeMap(details: FlowDetails): Map<string, FlowNodeDetail> {
    return new Map(details.nodes.map((n) => [n.id, n]));
  }
}
