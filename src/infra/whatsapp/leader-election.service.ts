import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../database/prisma.service';
import { WhatsappService } from './whatsapp.service';
import { isWaWorkerEnabled } from '../wa-bridge/wa-bridge.constants';

const LOCK_KEY = 'whatsapp';
const LOCK_TTL_SECONDS = 30;

@Injectable()
export class LeaderElectionService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(LeaderElectionService.name);
  private readonly instanceId = randomUUID();
  private leader = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsappService: WhatsappService,
  ) {}

  isLeader(): boolean {
    return this.leader;
  }

  async onModuleInit() {
    if (isWaWorkerEnabled()) {
      this.logger.log(
        '[Leader] WA_WORKER_ENABLED=true — leader election desabilitado no consigpro-api (wa-worker assumiu).',
      );
      return;
    }
    this.logger.log(`Instance ID: ${this.instanceId}`);
    const acquired = await this.tryAcquireLock();
    if (acquired) {
      await this.becomeLeader();
    } else {
      this.logger.log('[Standby] Lock held by another instance. Waiting...');
    }
  }

  async onApplicationShutdown() {
    if (this.leader) {
      this.whatsappService.setLeaderMode(false);
      await this.whatsappService.stopAllSessions();
      await this.releaseLock();
      this.leader = false;
    }
  }

  // Leader renews the lock every 10s. If renewal fails, steps down.
  @Interval(10_000)
  async heartbeat() {
    if (isWaWorkerEnabled()) return;
    if (!this.leader) return;

    const renewed = await this.tryAcquireLock();
    if (!renewed) {
      this.logger.warn('[Leader] Failed to renew lock — stepping down.');
      this.leader = false;
      this.whatsappService.setLeaderMode(false);
      await this.whatsappService.stopAllSessions();
    }
  }

  // Standby instances probe every 15s to take over if the leader dies.
  @Interval(15_000)
  async probe() {
    if (isWaWorkerEnabled()) return;
    if (this.leader) return;

    const acquired = await this.tryAcquireLock();
    if (acquired) {
      await this.becomeLeader();
    }
  }

  private async becomeLeader() {
    this.leader = true;
    this.logger.log('[Leader] Lock acquired. Starting WhatsApp sessions...');
    this.whatsappService.setLeaderMode(true);
    await this.whatsappService.startAllSessions();
  }

  private async tryAcquireLock(): Promise<boolean> {
    try {
      // Atomic upsert: only takes the lock if it's expired (or doesn't exist yet).
      await this.prisma.$executeRaw`
        INSERT INTO "instance_lock" ("lockKey", "instanceId", "expiresAt", "createdAt", "updatedAt")
        VALUES (
          ${LOCK_KEY},
          ${this.instanceId},
          NOW() + (${LOCK_TTL_SECONDS} * INTERVAL '1 second'),
          NOW(),
          NOW()
        )
        ON CONFLICT ("lockKey") DO UPDATE
          SET "instanceId" = EXCLUDED."instanceId",
              "expiresAt"  = EXCLUDED."expiresAt",
              "updatedAt"  = NOW()
          WHERE "instance_lock"."expiresAt" < NOW()
      `;

      const rows = await this.prisma.$queryRaw<{ instanceId: string }[]>`
        SELECT "instanceId" FROM "instance_lock" WHERE "lockKey" = ${LOCK_KEY}
      `;

      return rows[0]?.instanceId === this.instanceId;
    } catch (err) {
      this.logger.error('Lock operation failed:', err);
      return false;
    }
  }

  private async releaseLock(): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        DELETE FROM "instance_lock"
        WHERE "lockKey" = ${LOCK_KEY} AND "instanceId" = ${this.instanceId}
      `;
    } catch (err) {
      this.logger.error('Failed to release lock:', err);
    }
  }
}
