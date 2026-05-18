import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { IPendingOutboundMessageRepository } from 'src/domain/repositories/pending-outbound-message.repository';
import { IMessageHistoryRepository } from 'src/domain/repositories/message-history.repository';
import {
  MessageHistoryEntity,
  MessageSender,
  MessageStatus,
} from 'src/domain/entities/message-history.entity';
import { UUID } from 'src/domain/entities/vos';
import { WhatsappService } from './whatsapp.service';
import { LeaderElectionService } from './leader-election.service';
import { WaJobProducerService } from '../wa-bridge/wa-job-producer.service';
import { isWaWorkerEnabled } from '../wa-bridge/wa-bridge.constants';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_SECONDS = 300;

@Injectable()
export class OutboundWorkerService {
  private readonly logger = new Logger(OutboundWorkerService.name);
  private running = false;

  constructor(
    private readonly outboundRepository: IPendingOutboundMessageRepository,
    private readonly messageHistoryRepository: IMessageHistoryRepository,
    private readonly whatsappService: WhatsappService,
    private readonly leaderElection: LeaderElectionService,
    private readonly waJobs: WaJobProducerService,
  ) {}

  @Interval(2_000)
  async tick() {
    // No modo proxy, qualquer instancia do consigpro-api pode processar o outbound
    // — nao depende mais da leader election (o lock granular esta no wa-worker).
    if (!isWaWorkerEnabled() && !this.leaderElection.isLeader()) return;
    if (this.running) return;

    this.running = true;
    try {
      const ready = await this.outboundRepository.findReadyToSend(BATCH_SIZE);
      if (ready.length === 0) return;

      // Agrupa por (userId, toPhoneNumber) para preservar ordem dentro do mesmo lead.
      const groups = new Map<string, typeof ready>();
      for (const msg of ready) {
        const key = `${msg.userId}::${msg.toPhoneNumber}`;
        const list = groups.get(key) ?? [];
        list.push(msg);
        groups.set(key, list);
      }

      await Promise.all(
        Array.from(groups.values()).map((group) => this.processGroup(group)),
      );
    } catch (err) {
      this.logger.error('Erro no tick do outbound worker:', err);
    } finally {
      this.running = false;
    }
  }

  private async processGroup(
    group: Awaited<
      ReturnType<IPendingOutboundMessageRepository['findReadyToSend']>
    >,
  ) {
    for (const msg of group) {
      try {
        const { whatsappMessageId } = isWaWorkerEnabled()
          ? await this.waJobs.sendMessageAndWait({
              userId: msg.userId,
              leadPhoneNumber: msg.toPhoneNumber,
              content: msg.content,
              correlationId: msg.id,
            })
          : await this.whatsappService.sendMessage(
              msg.userId,
              msg.toPhoneNumber,
              msg.content,
              msg.conversationId,
            );

        await this.outboundRepository.markSent(msg.id);

        await this.messageHistoryRepository.create(
          new MessageHistoryEntity({
            conversationId: UUID.from(msg.conversationId),
            sender: MessageSender.BOT,
            content: msg.content,
            whatsappMessageId,
            status: MessageStatus.SENT,
          }),
        );
      } catch (err) {
        const attempts = msg.attempts + 1;
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (attempts >= MAX_ATTEMPTS) {
          await this.outboundRepository.markPermanentlyFailed(
            msg.id,
            errorMessage,
          );
          this.logger.error(
            `Mensagem ${msg.id} falhou ${MAX_ATTEMPTS} vezes — marcada como FAILED. Lead=${msg.toPhoneNumber} erro=${errorMessage}`,
          );
          // Para a sequência deste lead — não faz sentido tentar próximas
          // mensagens se a anterior falhou definitivamente.
          return;
        }

        const backoffSeconds = Math.min(
          Math.pow(2, attempts),
          MAX_BACKOFF_SECONDS,
        );
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

        await this.outboundRepository.markFailed(
          msg.id,
          errorMessage,
          nextAttemptAt,
          attempts,
        );

        this.logger.warn(
          `Falha ao enviar ${msg.id} (tentativa ${attempts}/${MAX_ATTEMPTS}) — retry em ${backoffSeconds}s. Lead=${msg.toPhoneNumber} erro=${errorMessage}`,
        );
        // Aborta o restante do grupo para não inverter ordem das mensagens.
        return;
      }
    }
  }
}
