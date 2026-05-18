import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueEvents } from 'bullmq';
import {
  MarkAsReadJobData,
  SendMessageJobData,
  StartSessionJobData,
  WA_MESSAGE_QUEUE,
  WA_READ_QUEUE,
  WA_SESSION_QUEUE,
} from './wa-bridge.constants';

/**
 * Producer BullMQ — consigpro-api enfileira jobs para o wa-worker consumir.
 * Usado quando WA_WORKER_ENABLED=true. Quando false, o WhatsappService
 * antigo (com Baileys local) continua sendo usado.
 */
@Injectable()
export class WaJobProducerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(WaJobProducerService.name);
  private messageQueueEvents: QueueEvents | null = null;

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(WA_SESSION_QUEUE) private readonly sessionQueue: Queue,
    @InjectQueue(WA_MESSAGE_QUEUE) private readonly messageQueue: Queue,
    @InjectQueue(WA_READ_QUEUE) private readonly readQueue: Queue,
  ) {}

  async onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (url) {
      this.messageQueueEvents = new QueueEvents(WA_MESSAGE_QUEUE, {
        connection: { url, maxRetriesPerRequest: null },
      });
      await this.messageQueueEvents.waitUntilReady();
    }
  }

  async onApplicationShutdown() {
    await this.messageQueueEvents?.close().catch(() => {});
  }

  async startSession(data: StartSessionJobData): Promise<void> {
    await this.sessionQueue.add('start', data, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  /**
   * Enfileira mensagem e AGUARDA o wa-worker enviar (retorna o
   * whatsappMessageId real). Usado pelo OutboundWorkerService que precisa
   * persistir o ID em message_history.
   *
   * Timeout default 60s — se wa-worker estiver fora, BullMQ retenta
   * (`attempts: 3`); se passar do timeout, lanca erro e o outbound
   * trata como falha (incrementa attempts, reagenda).
   */
  async sendMessageAndWait(
    data: SendMessageJobData,
    timeoutMs = 60_000,
  ): Promise<{ whatsappMessageId: string | null }> {
    const job = await this.messageQueue.add('send', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
    if (!this.messageQueueEvents) {
      throw new Error('QueueEvents indisponivel para aguardar wa-worker');
    }
    const result = await job.waitUntilFinished(
      this.messageQueueEvents,
      timeoutMs,
    );
    return {
      whatsappMessageId: result?.whatsappMessageId ?? null,
    };
  }

  async markAsRead(data: MarkAsReadJobData): Promise<void> {
    await this.readQueue.add('read', data, {
      removeOnComplete: 100,
      removeOnFail: 50,
    });
  }
}
