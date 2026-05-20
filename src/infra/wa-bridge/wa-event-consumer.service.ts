import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Mutex } from 'async-mutex';
import Redis from 'ioredis';
import { REDIS_SUB } from '../redis/redis.constants';
import { ProcessMessageUseCase } from 'src/domain/use-cases/flow-engine/process-message.use-case';
import { IMessageHistoryRepository } from 'src/domain/repositories/message-history.repository';
import { IPendingOutboundMessageRepository } from 'src/domain/repositories/pending-outbound-message.repository';
import { IWhatsAppSessionRepository } from 'src/domain/repositories/whatsapp-session.repository';
import { IFlowRepository } from 'src/domain/repositories/flow.repository';
import { IConversationRepository } from 'src/domain/repositories/conversation.repository';
import {
  MessageHistoryEntity,
  MessageSender,
  MessageStatus,
} from 'src/domain/entities/message-history.entity';
import { ConversationEntity } from 'src/domain/entities/conversation.entity';
import { UUID } from 'src/domain/entities/vos';
import { WhatsappGateway } from '../whatsapp/whatsapp.gateway';
import {
  WA_EVENT_MESSAGE_RECEIVED,
  WA_EVENT_MESSAGE_SENT_FROM_PHONE,
  WA_EVENT_MESSAGE_STATUS,
  WA_EVENT_QR,
  WA_EVENT_STATUS,
  WaMessageReceivedPayload,
  WaMessageSentFromPhonePayload,
  WaMessageStatusPayload,
  WaQrEventPayload,
  WaStatusEventPayload,
  isWaWorkerEnabled,
} from './wa-bridge.constants';

/**
 * Consome eventos Redis Pub/Sub publicados pelo wa-worker e roteia:
 * - QR / status → WhatsappGateway (frontend via Socket.IO)
 * - message.received → ProcessMessageUseCase (roda flow) + persiste em
 *   message_history + enfileira respostas no pending_outbound_message
 * - message.status → WhatsappGateway + atualiza message_history
 *
 * So eh ativado quando WA_WORKER_ENABLED=true. Caso contrario, fica idle
 * (o WhatsappService antigo cuida de tudo localmente).
 */
@Injectable()
export class WaEventConsumerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(WaEventConsumerService.name);
  private readonly leadMutexes = new Map<string, Mutex>();

  constructor(
    @Inject(REDIS_SUB) private readonly sub: Redis | null,
    private readonly gateway: WhatsappGateway,
    private readonly processMessageUseCase: ProcessMessageUseCase,
    private readonly messageHistoryRepository: IMessageHistoryRepository,
    private readonly outboundRepository: IPendingOutboundMessageRepository,
    private readonly flowRepository: IFlowRepository,
    private readonly sessionRepository: IWhatsAppSessionRepository,
    private readonly conversationRepository: IConversationRepository,
  ) {}

  async onModuleInit() {
    if (!isWaWorkerEnabled()) {
      this.logger.log(
        'WA_WORKER_ENABLED=false — consumer de eventos do wa-worker inativo.',
      );
      return;
    }
    if (!this.sub) {
      this.logger.warn(
        'Redis sub indisponivel — events consumer nao iniciara.',
      );
      return;
    }
    await this.sub.subscribe(
      WA_EVENT_QR,
      WA_EVENT_STATUS,
      WA_EVENT_MESSAGE_RECEIVED,
      WA_EVENT_MESSAGE_STATUS,
      WA_EVENT_MESSAGE_SENT_FROM_PHONE,
    );
    this.sub.on('message', (channel, message) => {
      this.handleEvent(channel, message).catch((err) =>
        this.logger.error(`Erro ao processar evento ${channel}:`, err),
      );
    });
    this.logger.log('Consumer de eventos wa-worker iniciado.');
  }

  async onApplicationShutdown() {
    if (this.sub) {
      await this.sub.unsubscribe().catch(() => {});
    }
  }

  private async handleEvent(channel: string, message: string): Promise<void> {
    const payload = JSON.parse(message);
    switch (channel) {
      case WA_EVENT_QR:
        return this.handleQr(payload);
      case WA_EVENT_STATUS:
        return this.handleStatus(payload);
      case WA_EVENT_MESSAGE_RECEIVED:
        return this.handleMessageReceived(payload);
      case WA_EVENT_MESSAGE_STATUS:
        return this.handleMessageStatus(payload);
      case WA_EVENT_MESSAGE_SENT_FROM_PHONE:
        return this.handleMessageSentFromPhone(payload);
    }
  }

  private async handleQr(p: WaQrEventPayload) {
    this.gateway.sendQrToUser(p.userId, p.qrDataUrl);
  }

  private async handleStatus(p: WaStatusEventPayload) {
    this.gateway.sendStatusToUser(p.userId, p.status);

    // Replica a logica de ativacao/desativacao de fluxos que antes ficava
    // dentro do WhatsappService — quando o socket conecta, fluxos PENDENTES
    // viram ativos; quando desconecta, fluxos ativos sao desativados.
    if (p.status === 'CONNECTED' && p.phone) {
      this.flowRepository
        .activatePendingByUserAndPhone(p.userId, p.phone)
        .then((count) => {
          if (count > 0) {
            this.logger.log(
              `${count} fluxo(s) ativado(s) para ${p.userId} no numero ${p.phone}`,
            );
          }
        })
        .catch((err) => this.logger.error('Falha activatePending:', err));
    } else if (p.status === 'DISCONNECTED') {
      const phone =
        p.phone ??
        (await this.sessionRepository
          .getConnectionInfo(p.userId)
          .then((i) => i?.connectedPhone ?? null)
          .catch(() => null));
      if (phone) {
        this.flowRepository
          .deactivateActiveByUserAndPhone(p.userId, phone)
          .then((count) => {
            if (count > 0) {
              this.logger.log(
                `${count} fluxo(s) desativado(s) para ${p.userId} (${phone})`,
              );
            }
          })
          .catch((err) => this.logger.error('Falha deactivateActive:', err));
      }
    }
  }

  private getLeadMutex(bot: string, lead: string): Mutex {
    const key = `${bot}::${lead}`;
    let m = this.leadMutexes.get(key);
    if (!m) {
      m = new Mutex();
      this.leadMutexes.set(key, m);
    }
    return m;
  }

  private async handleMessageReceived(p: WaMessageReceivedPayload) {
    const mutex = this.getLeadMutex(p.botPhoneNumber, p.leadPhoneNumber);
    await mutex.runExclusive(async () => {
      const {
        conversationId,
        userId: resolvedUserId,
        messagesToSend,
      } = await this.processMessageUseCase.execute({
        botPhoneNumber: p.botPhoneNumber,
        leadPhoneNumber: p.leadPhoneNumber,
        messageText: p.text,
        leadName: p.leadName,
      });

      if (!resolvedUserId) {
        this.logger.warn(
          `Nenhum flow ativo para ${p.botPhoneNumber}. Msg de ${p.leadPhoneNumber} ignorada.`,
        );
        return;
      }

      if (conversationId) {
        await this.messageHistoryRepository.create(
          new MessageHistoryEntity({
            conversationId: UUID.from(conversationId),
            sender: MessageSender.LEAD,
            content: p.text,
            whatsappMessageId: p.whatsappMessageId,
            status: MessageStatus.DELIVERED,
            mediaUrl: p.mediaUrl,
            mediaType: p.mediaType as any,
          }),
        );
        this.gateway.sendNewMessage(resolvedUserId, {
          conversationId,
          sender: 'LEAD',
          content: p.text,
          createdAt: new Date(p.receivedAt),
          whatsappMessageId: p.whatsappMessageId,
          status: 'DELIVERED',
          mediaUrl: p.mediaUrl,
          mediaType: p.mediaType,
        });
      }

      if (conversationId && messagesToSend.length > 0) {
        const baseTime = Date.now();
        await this.outboundRepository.enqueue(
          messagesToSend.map((text, i) => ({
            conversationId,
            userId: resolvedUserId,
            toPhoneNumber: p.leadPhoneNumber,
            content: text,
            nextAttemptAt: new Date(baseTime + i * 3000),
          })),
        );
      }
    });
  }

  /**
   * Mensagem enviada pelo proprio numero conectado a partir do WhatsApp
   * Business no celular (ou eco de mensagem enviada pelo proprio app web).
   * Persiste em message_history com sender=BOT, deduplicando por
   * whatsappMessageId — assim mensagens ja salvas pelo fluxo de envio do app
   * nao sao duplicadas. Nao roda fluxo: e atendimento manual.
   */
  private async handleMessageSentFromPhone(p: WaMessageSentFromPhonePayload) {
    if (!p.whatsappMessageId) {
      this.logger.warn(
        `Mensagem fromMe sem whatsappMessageId — ignorada (bot: ${p.botPhoneNumber}, lead: ${p.leadPhoneNumber})`,
      );
      return;
    }

    // Dedupe antes de qualquer coisa: mensagens enviadas pelo proprio app web
    // ja foram persistidas pelo SendMessageUseCase/OutboundWorker com o mesmo
    // whatsappMessageId. O eco do Baileys nao deve criar duplicata.
    const existing = await this.messageHistoryRepository.findByWhatsappId(
      p.whatsappMessageId,
    );
    if (existing) return;

    const mutex = this.getLeadMutex(p.botPhoneNumber, p.leadPhoneNumber);
    await mutex.runExclusive(async () => {
      // Re-checa dedupe dentro do lock (caso eco do web tenha chegado entre
      // a primeira verificacao e a aquisicao do mutex).
      const again = await this.messageHistoryRepository.findByWhatsappId(
        p.whatsappMessageId!,
      );
      if (again) return;

      const flow = await this.flowRepository.findByPhoneNumber(
        p.botPhoneNumber,
      );
      if (!flow) {
        this.logger.warn(
          `Mensagem do celular ignorada — sem flow para ${p.botPhoneNumber} (lead: ${p.leadPhoneNumber})`,
        );
        return;
      }
      if (flow.userId.toString() !== p.userId) {
        this.logger.warn(
          `Mensagem do celular descartada — flow ${flow.id.toString()} pertence a ${flow.userId.toString()}, evento userId=${p.userId}`,
        );
        return;
      }

      let conversation = await this.conversationRepository.findActive(
        flow.id.toString(),
        p.leadPhoneNumber,
      );

      if (!conversation) {
        // Atendimento iniciado pelo celular para um lead sem conversa ativa.
        // Cria nova conversa com automation desligada — o fluxo nao deve
        // assumir um atendimento que o humano comecou manualmente.
        conversation = new ConversationEntity({
          flowId: flow.id,
          leadPhoneNumber: p.leadPhoneNumber,
          leadName: null,
          automationEnabled: false,
        });
        await this.conversationRepository.create(conversation);
        this.logger.log(
          `Nova conversa criada via celular — flow=${flow.id.toString()} lead=${p.leadPhoneNumber}`,
        );
      }

      const conversationId = conversation.id.toString();

      await this.messageHistoryRepository.create(
        new MessageHistoryEntity({
          conversationId: UUID.from(conversationId),
          sender: MessageSender.BOT,
          content: p.text,
          whatsappMessageId: p.whatsappMessageId,
          status: MessageStatus.SENT,
          mediaUrl: p.mediaUrl,
          mediaType: p.mediaType as any,
          createdAt: new Date(p.sentAt),
        }),
      );

      this.gateway.sendNewMessage(p.userId, {
        conversationId,
        sender: 'BOT',
        content: p.text,
        createdAt: new Date(p.sentAt),
        whatsappMessageId: p.whatsappMessageId,
        status: 'SENT',
        mediaUrl: p.mediaUrl,
        mediaType: p.mediaType,
      });
    });
  }

  private async handleMessageStatus(p: WaMessageStatusPayload) {
    const result = await this.messageHistoryRepository.updateStatusByWhatsappId(
      p.whatsappMessageId,
      p.status as any,
    );
    if (result) {
      this.gateway.sendMessageStatus(p.userId, {
        conversationId: result.conversationId,
        whatsappMessageId: result.whatsappMessageId,
        status: result.status,
        statusUpdatedAt: result.statusUpdatedAt,
      });
    }
  }
}
