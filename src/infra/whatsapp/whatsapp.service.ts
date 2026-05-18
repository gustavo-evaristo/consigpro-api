import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { WASocket } from '@whiskeysockets/baileys';
import { Mutex } from 'async-mutex';
import * as QRCode from 'qrcode';
import type Redis from 'ioredis';
import { WhatsappGateway } from './whatsapp.gateway';
import { REDIS_PUB } from '../redis/redis.constants';
import { ProcessMessageUseCase } from 'src/domain/use-cases/flow-engine/process-message.use-case';
import { IMessageHistoryRepository } from 'src/domain/repositories/message-history.repository';
import {
  MessageHistoryEntity,
  MessageSender,
  MessageStatus,
} from 'src/domain/entities/message-history.entity';
import { UUID } from 'src/domain/entities/vos';
import { IWhatsAppSessionRepository } from 'src/domain/repositories/whatsapp-session.repository';
import { IFlowRepository } from 'src/domain/repositories/flow.repository';
import { IPendingOutboundMessageRepository } from 'src/domain/repositories/pending-outbound-message.repository';
import { loadBaileys } from './baileys.loader';
import {
  invalidateAuthCache,
  useWhatsAppAuthState,
} from './whatsapp-auth-state';
import { AcquiredLock, RedisLockService } from '../redis/redis-lock.service';
import { MediaStorageService } from '../storage/media-storage.service';
import { WaJobProducerService } from '../wa-bridge/wa-job-producer.service';
import { isWaWorkerEnabled } from '../wa-bridge/wa-bridge.constants';

const RECONNECT_BATCH_SIZE = 10;
const SESSION_LOCK_TTL_MS = 30_000;
const SESSION_LOCK_RENEW_MS = 10_000;
const sessionLockKey = (userId: string) => `wa:lock:session:${userId}`;

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private sessions = new Map<string, WASocket>();
  private pendingSessions = new Set<string>();
  private stores = new Map<string, any>();
  private leaderMode = false;
  private readonly sessionLocks = new Map<string, AcquiredLock>();
  private readonly lockRenewers = new Map<string, NodeJS.Timeout>();
  private readonly leadMutexes = new Map<string, Mutex>();
  private readonly jidCache = new Map<
    string,
    { jid: string; cachedAt: number }
  >();
  private readonly JID_CACHE_TTL_MS = 15 * 60 * 1000;
  // Dedup de mensagens entrantes: Baileys reentrega o mesmo messages.upsert
  // apos reconexao, o que dispara P2002 (UNIQUE em whatsappMessageId) e,
  // pior, faz o bot responder 2x ao mesmo lead. Cache em memoria suficiente
  // — a reentrega ocorre em janela curta (segundos a minutos).
  private readonly processedMessageIds = new Map<string, number>();
  private readonly MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;

  private getLeadMutex(botPhone: string, leadPhone: string): Mutex {
    const key = `${botPhone}::${leadPhone}`;
    let m = this.leadMutexes.get(key);
    if (!m) {
      m = new Mutex();
      this.leadMutexes.set(key, m);
    }
    return m;
  }

  private gcLeadMutexes() {
    if (this.leadMutexes.size <= 1000) return;
    for (const [k, mu] of this.leadMutexes) {
      if (!mu.isLocked()) this.leadMutexes.delete(k);
    }
  }

  /**
   * Retorna true se ja processamos esta whatsappMessageId nos ultimos
   * MESSAGE_DEDUP_TTL_MS. Marca como processada na primeira chamada.
   * Aproveita pra GC entradas expiradas (cheap, O(n) so quando map cresce).
   */
  private isDuplicateIncomingMessage(wppId: string | null): boolean {
    if (!wppId) return false;
    const now = Date.now();
    const existing = this.processedMessageIds.get(wppId);
    if (existing && now - existing < this.MESSAGE_DEDUP_TTL_MS) {
      return true;
    }
    this.processedMessageIds.set(wppId, now);
    if (this.processedMessageIds.size > 5000) {
      for (const [k, ts] of this.processedMessageIds) {
        if (now - ts >= this.MESSAGE_DEDUP_TTL_MS) {
          this.processedMessageIds.delete(k);
        }
      }
    }
    return false;
  }

  constructor(
    private readonly gateway: WhatsappGateway,
    private readonly processMessageUseCase: ProcessMessageUseCase,
    private readonly messageHistoryRepository: IMessageHistoryRepository,
    private readonly sessionRepository: IWhatsAppSessionRepository,
    private readonly flowRepository: IFlowRepository,
    private readonly outboundRepository: IPendingOutboundMessageRepository,
    private readonly redisLock: RedisLockService,
    @Inject(REDIS_PUB) private readonly redis: Redis | null,
    private readonly mediaStorage: MediaStorageService,
    private readonly waJobs: WaJobProducerService,
  ) {}

  /**
   * Se a mensagem for uma imagem, baixa via Baileys e sobe pro Storage.
   * Retorna a URL publica, ou null se nao for imagem, falhar download
   * ou exceder limite de tamanho.
   */
  private async maybeUploadIncomingImage(
    userId: string,
    message: any,
    innerMessage: any,
    wppId: string | null,
  ): Promise<string | null> {
    const imageMsg = innerMessage?.imageMessage;
    if (!imageMsg) return null;
    if (!this.mediaStorage.isEnabled()) return null;
    try {
      const baileys = await loadBaileys();
      const buffer = (await baileys.downloadMediaMessage(
        message,
        'buffer',
        {},
      )) as Buffer;
      const mimeType = imageMsg.mimetype || 'image/jpeg';
      const ext = mimeType.split('/')[1]?.split(';')[0] || 'jpg';
      const path = `${userId}/${wppId ?? Date.now()}.${ext}`;
      return await this.mediaStorage.uploadImage(buffer, path, mimeType);
    } catch (err) {
      this.logger.warn(
        `Falha ao baixar/upload imagem (wppId: ${wppId}, userId: ${userId}): ${
          (err as Error).message
        }`,
      );
      return null;
    }
  }

  private startLockRenewal(userId: string, lock: AcquiredLock): void {
    const existing = this.lockRenewers.get(userId);
    if (existing) clearInterval(existing);
    const timer = setInterval(async () => {
      const renewed = await this.redisLock
        .renew(lock, SESSION_LOCK_TTL_MS)
        .catch(() => false);
      if (!renewed) {
        this.logger.warn(
          `[BAILEYS-CONN] Lock perdido (userId: ${userId}) — encerrando socket local para evitar conflito`,
        );
        await this.releaseSessionLock(userId);
        const sock = this.sessions.get(userId);
        if (sock) {
          this.sessions.delete(userId);
          try {
            (sock as any).end?.();
          } catch {}
        }
      }
    }, SESSION_LOCK_RENEW_MS);
    this.lockRenewers.set(userId, timer);
  }

  private async releaseSessionLock(userId: string): Promise<void> {
    const timer = this.lockRenewers.get(userId);
    if (timer) {
      clearInterval(timer);
      this.lockRenewers.delete(userId);
    }
    const lock = this.sessionLocks.get(userId);
    if (lock) {
      this.sessionLocks.delete(userId);
      await this.redisLock.release(lock).catch(() => {});
    }
  }

  /**
   * A cada 30s, se somos lider e existem sessoes WhatsApp registradas no
   * banco que NAO estao no map local (sem socket aberto aqui), tenta de
   * novo o startSession. Cobre o caso em que o boot encontrou lock orfao
   * de uma execucao anterior e desistiu sem retry — sem isso, a sessao
   * fica offline ate o proximo restart manual.
   *
   * Se o lock estiver realmente com outra instancia, o startSession faz
   * no-op (log informativo). So efetivamente conecta quando o lock estiver
   * livre.
   */
  @Interval(30_000)
  async reconcileSessions(): Promise<void> {
    if (!this.leaderMode) return;
    try {
      const userIds = await this.sessionRepository.findAllUserIds();
      for (const userId of userIds) {
        if (this.sessions.has(userId)) continue;
        if (this.pendingSessions.has(userId)) continue;
        if (this.sessionLocks.has(userId)) continue;
        this.logger.log(
          `[BAILEYS-CONN] reconcile: tentando reabrir sessao orfa (userId: ${userId})`,
        );
        this.startSession(userId).catch((err) =>
          this.logger.error(
            `[BAILEYS-CONN] reconcile falhou para userId ${userId}:`,
            err,
          ),
        );
      }
    } catch (err) {
      this.logger.error('[BAILEYS-CONN] reconcileSessions erro:', err);
    }
  }

  setLeaderMode(value: boolean) {
    this.leaderMode = value;
  }

  async startAllSessions(): Promise<void> {
    // Reset all rows to DISCONNECTED before opening sockets. If a previous
    // leader died without stepping down, its CONNECTED row would otherwise
    // mislead the dashboard until the next event.
    await this.sessionRepository
      .markAllDisconnected()
      .catch((err) =>
        this.logger.error('Falha ao resetar status de sessões:', err),
      );

    const userIds = await this.sessionRepository.findAllUserIds();
    if (userIds.length === 0) return;

    this.logger.log(`Restaurando ${userIds.length} sessão(ões) WhatsApp...`);

    for (let i = 0; i < userIds.length; i += RECONNECT_BATCH_SIZE) {
      const batch = userIds.slice(i, i + RECONNECT_BATCH_SIZE);
      await Promise.all(
        batch.map((userId) =>
          this.startSession(userId).catch((err) =>
            this.logger.error(`Erro ao restaurar sessão ${userId}:`, err),
          ),
        ),
      );
    }
  }

  async stopAllSessions(): Promise<void> {
    const snapshot: Array<{ userId: string; phone: string | null }> = [];
    for (const [userId, sock] of this.sessions) {
      const rawPhone = sock.user?.id?.split(':')[0]?.split('@')[0];
      const phone = rawPhone
        ? this.normalizeBrazilianPhone('+' + rawPhone)
        : null;
      snapshot.push({ userId, phone });
      try {
        (sock as any).end?.();
      } catch {}
    }
    this.logger.log(
      `[BAILEYS-CONN] stopAllSessions encerrando ${snapshot.length} socket(s): ${
        snapshot
          .map((s) => `${s.phone ?? 'sem-numero'} (userId: ${s.userId})`)
          .join(', ') || 'nenhum'
      }`,
    );
    const userIdsToRelease = Array.from(this.sessionLocks.keys());
    this.sessions.clear();
    this.stores.clear();
    this.pendingSessions.clear();
    await Promise.all(
      userIdsToRelease.map((userId) => this.releaseSessionLock(userId)),
    );
    // After stepping down we no longer hold any socket. Mark all rows as
    // DISCONNECTED so the new leader (or readers) see consistent state.
    await this.sessionRepository
      .markAllDisconnected()
      .catch((err) =>
        this.logger.error('Falha ao resetar status no shutdown:', err),
      );
  }

  async startSession(
    userId: string,
    targetPhoneNumber?: string | null,
  ): Promise<void> {
    this.logger.log(
      `[BAILEYS-CONN] startSession invocado (userId: ${userId}, targetPhone: ${
        targetPhoneNumber ?? 'nenhum'
      })`,
    );
    const existingSock = this.sessions.get(userId);
    if (existingSock) {
      const rawCurrent = existingSock.user?.id?.split(':')[0]?.split('@')[0];
      const currentPhone = rawCurrent
        ? this.normalizeBrazilianPhone('+' + rawCurrent)
        : null;
      const desiredPhone = targetPhoneNumber
        ? this.normalizeBrazilianPhone(targetPhoneNumber)
        : null;

      if (desiredPhone && currentPhone && currentPhone === desiredPhone) {
        // Sessão já está pareada com o número desejado — re-emite CONNECTED
        // pra UI que acabou de abrir um novo socket, e ativa fluxo pendente.
        this.logger.log(
          `[BAILEYS-CONN] Sessão já existente e pareada (numero: ${currentPhone}, userId: ${userId}) — re-emitindo CONNECTED`,
        );
        this.gateway.sendStatusToUser(userId, 'CONNECTED');
        await this.flowRepository
          .activatePendingByUserAndPhone(userId, currentPhone)
          .catch((err) =>
            this.logger.error(
              `Falha ao ativar fluxo pendente (sessão existente) para ${userId}:`,
              err,
            ),
          );
        return;
      }

      if (desiredPhone && currentPhone && currentPhone !== desiredPhone) {
        // Pareado com OUTRO número — desloga e segue pra parear o novo.
        this.logger.log(
          `[BAILEYS-CONN] Trocando número WhatsApp para userId ${userId}: ${currentPhone} → ${desiredPhone}.`,
        );
        await this.forceResetSession(userId, existingSock);
      } else {
        // Sem alvo informado: mantém o que está e re-emite status.
        if (currentPhone) {
          this.logger.log(
            `[BAILEYS-CONN] Sessão já existente sem alvo informado (numero: ${currentPhone}, userId: ${userId}) — re-emitindo CONNECTED`,
          );
          this.gateway.sendStatusToUser(userId, 'CONNECTED');
        } else {
          this.logger.log(
            `[BAILEYS-CONN] Sessão já existente sem número pareado (userId: ${userId}) — mantendo socket atual`,
          );
        }
        return;
      }
    }

    if (this.pendingSessions.has(userId)) {
      this.logger.log(
        `[BAILEYS-CONN] startSession ignorado pois já há tentativa pendente (userId: ${userId})`,
      );
      return;
    }

    // Lock distribuído por userId: garante que apenas UMA instância da API
    // abra socket Baileys para este número, mesmo durante deploys/restarts
    // que sobrepõem instâncias. Sem isto, dois sockets com as mesmas creds
    // disparam o "connectionReplaced (Stream Errored conflict)" do WhatsApp.
    if (!this.sessionLocks.has(userId)) {
      const lock = await this.redisLock
        .acquire(sessionLockKey(userId), SESSION_LOCK_TTL_MS)
        .catch((err) => {
          this.logger.error(
            `[BAILEYS-CONN] Erro ao adquirir lock (userId: ${userId}):`,
            err,
          );
          return null;
        });
      if (!lock) {
        this.logger.log(
          `[BAILEYS-CONN] startSession ignorado — outra instância já é dona da sessão (userId: ${userId})`,
        );
        return;
      }
      this.sessionLocks.set(userId, lock);
      this.startLockRenewal(userId, lock);
    }

    this.pendingSessions.add(userId);

    let DisconnectReason: any;
    let saveCreds: () => Promise<void>;
    let lidToPhone: Map<string, string>;
    let sock: WASocket;

    try {
      const baileys = await loadBaileys();
      DisconnectReason = baileys.DisconnectReason;

      const authState = await useWhatsAppAuthState(
        userId,
        this.sessionRepository,
        this.redis,
      );
      saveCreds = authState.saveCreds;

      const { version } = await baileys.fetchLatestBaileysVersion();

      lidToPhone = new Map<string, string>();
      this.stores.set(userId, lidToPhone);

      const noopLogger = {
        level: 'silent',
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        fatal: () => {},
        child: () => noopLogger,
      };

      sock = baileys.makeWASocket({
        version,
        auth: authState.state,
        printQRInTerminal: false,
        logger: noopLogger as any,
        // Identifica o linked device como "ConsigPro" no celular do
        // cliente em vez do default "Google Chrome (macOS)". Aplica so a
        // sessoes pareadas a partir daqui — sessoes ja pareadas mantem
        // a identidade antiga ate fazerem novo QR scan (mudar agora
        // invalidaria as creds e forcaria re-pareamento de todos).
        browser: ['ConsigPro', 'Chrome', '1.0.0'],
      });

      this.sessions.set(userId, sock);
    } catch (err) {
      this.pendingSessions.delete(userId);
      await this.releaseSessionLock(userId);
      throw err;
    }

    this.pendingSessions.delete(userId);

    sock.ev.on('creds.update', saveCreds);

    const syncContacts = (contacts: { id: string; lid?: string }[]) => {
      for (const contact of contacts) {
        if (contact.lid && contact.id.endsWith('@s.whatsapp.net')) {
          lidToPhone.set(contact.lid, contact.id);
        }
      }
    };
    sock.ev.on('contacts.upsert', syncContacts);
    sock.ev.on('contacts.update', syncContacts as any);

    sock.ev.on(
      'connection.update',
      async ({ connection, lastDisconnect, qr }) => {
        const rawPhoneCurrent = sock.user?.id?.split(':')[0]?.split('@')[0];
        const phoneCurrent = rawPhoneCurrent
          ? this.normalizeBrazilianPhone('+' + rawPhoneCurrent)
          : null;

        if (connection === 'connecting') {
          this.logger.log(
            `[BAILEYS-CONN] connection=connecting (numero: ${
              phoneCurrent ?? 'desconhecido (ainda nao pareado)'
            }, userId: ${userId})`,
          );
        }

        if (qr) {
          this.logger.log(
            `[BAILEYS-CONN] QR gerado, aguardando leitura (userId: ${userId})`,
          );
          const qrImage = await QRCode.toDataURL(qr);
          this.gateway.sendQrToUser(userId, qrImage);
          await this.sessionRepository
            .setConnectionStatus(userId, 'PENDING', null)
            .catch((err) =>
              this.logger.error(
                `Falha ao persistir status PENDING para ${userId}:`,
                err,
              ),
            );
        }

        if (connection === 'open') {
          const rawPhone = sock.user?.id?.split(':')[0]?.split('@')[0];
          const phone = rawPhone
            ? this.normalizeBrazilianPhone('+' + rawPhone)
            : null;
          this.logger.log(
            `[BAILEYS-CONN] connection=open — WhatsApp conectado! Numero: ${phone} (userId: ${userId})`,
          );
          this.gateway.sendStatusToUser(userId, 'CONNECTED');
          await this.sessionRepository
            .setConnectionStatus(userId, 'CONNECTED', phone)
            .catch((err) =>
              this.logger.error(
                `Falha ao persistir status CONNECTED para ${userId}:`,
                err,
              ),
            );
          if (phone) {
            await this.flowRepository
              .activatePendingByUserAndPhone(userId, phone)
              .then((count) => {
                if (count > 0) {
                  this.logger.log(
                    `${count} fluxo(s) ativado(s) para ${userId} no número ${phone}.`,
                  );
                }
              })
              .catch((err) =>
                this.logger.error(
                  `Falha ao ativar fluxo pendente para ${userId}:`,
                  err,
                ),
              );
          }
        }

        if (connection === 'close') {
          const closeStatusCode = (lastDisconnect?.error as any)?.output
            ?.statusCode;
          const closeReasonName =
            Object.entries(DisconnectReason ?? {}).find(
              ([, v]) => v === closeStatusCode,
            )?.[0] ?? 'desconhecido';
          const closeErrorMsg =
            (lastDisconnect?.error as any)?.message ?? 'sem mensagem';

          // Se este socket já foi substituído por outro (ex.: forceResetSession
          // que troca o número pareado), ignora pra não derrubar a nova sessão.
          if (this.sessions.get(userId) !== sock) {
            this.logger.log(
              `[BAILEYS-CONN] connection=close em socket SUBSTITUÍDO — ignorando (numero: ${
                phoneCurrent ?? 'desconhecido'
              }, userId: ${userId}, statusCode: ${closeStatusCode}, reason: ${closeReasonName})`,
            );
            return;
          }
          this.sessions.delete(userId);

          // Captura o número que estava pareado ANTES de zerar o status,
          // pra desativar os fluxos que dependiam dessa sessão.
          const previouslyConnected = await this.sessionRepository
            .getConnectionInfo(userId)
            .then((info) => info?.connectedPhone ?? null)
            .catch(() => null);

          const numeroAfetado =
            phoneCurrent ?? previouslyConnected ?? 'desconhecido';
          this.logger.warn(
            `[BAILEYS-CONN] connection=close — DESCONECTADO (numero: ${numeroAfetado}, userId: ${userId}, statusCode: ${closeStatusCode}, reason: ${closeReasonName}, errorMsg: "${closeErrorMsg}")`,
          );

          this.gateway.sendStatusToUser(userId, 'DISCONNECTED');
          await this.sessionRepository
            .setConnectionStatus(userId, 'DISCONNECTED', null)
            .catch((err) =>
              this.logger.error(
                `Falha ao persistir status DISCONNECTED para ${userId}:`,
                err,
              ),
            );

          if (previouslyConnected) {
            await this.flowRepository
              .deactivateActiveByUserAndPhone(userId, previouslyConnected)
              .then((count) => {
                if (count > 0) {
                  this.logger.log(
                    `${count} fluxo(s) desativado(s) para ${userId} (número ${previouslyConnected} desconectado).`,
                  );
                }
              })
              .catch((err) =>
                this.logger.error(
                  `Falha ao desativar fluxos para ${userId}:`,
                  err,
                ),
              );
          }

          const statusCode = closeStatusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          if (loggedOut) {
            this.logger.warn(
              `[BAILEYS-CONN] LOGOUT detectado — sessão removida (numero: ${numeroAfetado}, userId: ${userId})`,
            );
            await this.sessionRepository.delete(userId);
            await invalidateAuthCache(userId, this.redis);
            this.stores.delete(userId);
            await this.releaseSessionLock(userId);
          } else if (statusCode === DisconnectReason.connectionReplaced) {
            // Outra instância (ou outro processo no celular do cliente)
            // assumiu a sessão. NÃO reconectamos automaticamente: isso só
            // alimenta o ping-pong de "Stream Errored (conflict)" que era
            // o sintoma original. Liberamos o lock e ficamos em standby —
            // o frontend pode disparar /whatsapp/start de novo se quiser.
            this.logger.warn(
              `[BAILEYS-CONN] connectionReplaced — liberando lock e parando (numero: ${numeroAfetado}, userId: ${userId})`,
            );
            this.stores.delete(userId);
            await this.releaseSessionLock(userId);
          } else if (this.leaderMode) {
            const delay = 2_000;
            this.logger.log(
              `[BAILEYS-CONN] Reconexão agendada em ${
                delay / 1000
              }s (numero: ${numeroAfetado}, userId: ${userId}, statusCode: ${statusCode}, reason: ${closeReasonName})`,
            );
            setTimeout(() => {
              this.logger.log(
                `[BAILEYS-CONN] Reconectando agora (numero anterior: ${numeroAfetado}, userId: ${userId})`,
              );
              this.startSession(userId).catch((err) =>
                this.logger.error(
                  `[BAILEYS-CONN] Erro ao reconectar (numero: ${numeroAfetado}, userId: ${userId}):`,
                  err,
                ),
              );
            }, delay);
          } else {
            this.logger.log(
              `[BAILEYS-CONN] Não reconectando — modo standby (numero: ${numeroAfetado}, userId: ${userId}, statusCode: ${statusCode}, reason: ${closeReasonName})`,
            );
            await this.releaseSessionLock(userId);
          }
        }
      },
    );

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const message of messages) {
        await this.handleIncomingMessage(
          userId,
          sock,
          message,
          lidToPhone,
        ).catch((err) => this.logger.error(`Erro ao processar mensagem:`, err));
      }
    });

    sock.ev.on('messages.update', async (updates) => {
      for (const u of updates) {
        const numericStatus = u.update?.status;
        if (numericStatus === undefined || numericStatus === null) continue;
        const wppId = u.key?.id;
        if (!wppId) continue;

        const mapped = this.mapBaileysStatus(numericStatus);
        if (!mapped) continue;

        try {
          const result =
            await this.messageHistoryRepository.updateStatusByWhatsappId(
              wppId,
              mapped,
            );
          if (result) {
            this.gateway.sendMessageStatus(userId, {
              conversationId: result.conversationId,
              whatsappMessageId: result.whatsappMessageId,
              status: result.status,
              statusUpdatedAt: result.statusUpdatedAt,
            });
          }
        } catch (err) {
          this.logger.error(
            `Erro ao atualizar status da mensagem ${wppId}:`,
            err,
          );
        }
      }
    });
  }

  private mapBaileysStatus(status: number): MessageStatus | null {
    // proto.WebMessageInfo.Status:
    // 0 ERROR | 1 PENDING | 2 SERVER_ACK (SENT) | 3 DELIVERY_ACK | 4 READ | 5 PLAYED
    switch (status) {
      case 0:
        return MessageStatus.FAILED;
      case 1:
        return MessageStatus.PENDING;
      case 2:
        return MessageStatus.SENT;
      case 3:
        return MessageStatus.DELIVERED;
      case 4:
      case 5:
        return MessageStatus.READ;
      default:
        return null;
    }
  }

  private async forceResetSession(
    userId: string,
    sock: WASocket,
  ): Promise<void> {
    // Captura o número paired antes de derrubar tudo — usado pra desativar
    // os fluxos que dependiam dessa sessão.
    const rawPhone = sock.user?.id?.split(':')[0]?.split('@')[0];
    const previousPhone = rawPhone
      ? this.normalizeBrazilianPhone('+' + rawPhone)
      : null;

    this.logger.log(
      `[BAILEYS-CONN] forceResetSession iniciado (numero: ${
        previousPhone ?? 'desconhecido'
      }, userId: ${userId})`,
    );

    // Tira do mapa ANTES do logout pra que o handler de close (que checa
    // identidade) trate isso como sessão antiga e não dispare reconexão.
    this.sessions.delete(userId);
    this.stores.delete(userId);
    await this.releaseSessionLock(userId);

    try {
      await (sock as any).logout?.();
      this.logger.log(
        `[BAILEYS-CONN] forceResetSession — logout concluído (numero: ${
          previousPhone ?? 'desconhecido'
        }, userId: ${userId})`,
      );
    } catch (err) {
      this.logger.warn(
        `[BAILEYS-CONN] forceResetSession — falha no logout (numero: ${
          previousPhone ?? 'desconhecido'
        }, userId: ${userId}):`,
        err,
      );
      try {
        (sock as any).end?.(undefined);
      } catch {}
    }

    await this.sessionRepository
      .delete(userId)
      .catch((err) =>
        this.logger.error(`Falha ao remover sessão ${userId}:`, err),
      );

    // Invalidar cache Redis senao o proximo useWhatsAppAuthState le creds
    // antigas e o Baileys reconecta como o numero anterior em vez de gerar QR.
    await invalidateAuthCache(userId, this.redis);

    if (previousPhone) {
      await this.flowRepository
        .deactivateActiveByUserAndPhone(userId, previousPhone)
        .then((count) => {
          if (count > 0) {
            this.logger.log(
              `${count} fluxo(s) desativado(s) para ${userId} ao trocar de número (saindo de ${previousPhone}).`,
            );
          }
        })
        .catch((err) =>
          this.logger.error(
            `Falha ao desativar fluxos antigos de ${userId}:`,
            err,
          ),
        );
    }
  }

  private isSocketReady(sock: WASocket): boolean {
    const ws = (sock as any).ws;
    const readyState = ws?.readyState ?? ws?.socket?.readyState;
    // WebSocket.OPEN === 1
    return readyState === 1 && !!sock.user;
  }

  // Baileys derruba o socket em qualquer "connection: close" (rede instável,
  // restartRequired, connectionReplaced...). A reconexão é agendada por
  // setTimeout, então existe uma janela de 3–15s em que `sessions.get(userId)`
  // retorna undefined. Sem este wait, o CRM falhava com "Sessão não está ativa"
  // até o usuário tentar de novo manualmente.
  private async waitForActiveSession(
    userId: string,
    timeoutMs: number,
  ): Promise<WASocket | null> {
    const start = Date.now();
    const pollIntervalMs = 250;

    // Se não há socket nem reconexão em andamento e somos o líder, dispara uma.
    const initial = this.sessions.get(userId);
    if (!initial && !this.pendingSessions.has(userId) && this.leaderMode) {
      this.logger.warn(
        `[BAILEYS-CONN] sendMessage sem sessão ativa — disparando startSession (userId: ${userId})`,
      );
      this.startSession(userId).catch((err) =>
        this.logger.error(
          `Falha ao restaurar sessão sob demanda (userId: ${userId}):`,
          err,
        ),
      );
    }

    while (Date.now() - start < timeoutMs) {
      const sock = this.sessions.get(userId);
      if (sock && this.isSocketReady(sock)) {
        if (Date.now() - start > 0) {
          this.logger.log(
            `[BAILEYS-CONN] sendMessage aguardou ${
              Date.now() - start
            }ms até a sessão ficar pronta (userId: ${userId})`,
          );
        }
        return sock;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return null;
  }

  async sendMessage(
    userId: string,
    leadPhoneNumber: string,
    content: string,
    conversationId: string,
  ): Promise<{ whatsappMessageId: string | null }> {
    // Modo proxy: enfileira job no BullMQ e aguarda o wa-worker enviar.
    // O socket Baileys nao existe mais aqui — quem segura eh o wa-worker.
    if (isWaWorkerEnabled()) {
      const { whatsappMessageId } = await this.waJobs.sendMessageAndWait({
        userId,
        leadPhoneNumber,
        content,
        correlationId: conversationId,
      });
      this.gateway.sendNewMessage(userId, {
        conversationId,
        sender: 'BOT',
        content,
        createdAt: new Date(),
        whatsappMessageId,
        status: 'SENT',
      });
      return { whatsappMessageId };
    }

    const sock = await this.waitForActiveSession(userId, 15_000);
    if (!sock) {
      throw new Error(
        'Sessão WhatsApp não está ativa. Conecte-se antes de enviar mensagens.',
      );
    }

    const jid = await this.resolveJid(sock, leadPhoneNumber);
    const sent = await sock.sendMessage(jid, { text: content });
    const whatsappMessageId = sent?.key?.id ?? null;

    this.gateway.sendNewMessage(userId, {
      conversationId,
      sender: 'BOT',
      content,
      createdAt: new Date(),
      whatsappMessageId,
      status: 'SENT',
    });

    return { whatsappMessageId };
  }

  async markAsRead(
    userId: string,
    keys: Array<{ id: string; remoteJid: string; fromMe?: boolean }>,
  ): Promise<void> {
    if (keys.length === 0) return;

    // Modo proxy: enfileira fire-and-forget. Read receipt nao precisa
    // de resposta imediata e o frontend ja atualizou otimisticamente.
    if (isWaWorkerEnabled()) {
      await this.waJobs.markAsRead({ userId, keys });
      return;
    }

    const sock = await this.waitForActiveSession(userId, 5_000);
    if (!sock) {
      this.logger.warn(
        `markAsRead: sessão não está ativa para userId=${userId}`,
      );
      return;
    }

    // Resolve JID canônico para cada key — `remoteJid` recebido pode estar
    // no formato com 9 (normalizado) e divergir do JID real do contato.
    const resolved = await Promise.all(
      keys.map(async (k) => {
        const phone = k.remoteJid.split('@')[0];
        const jid = await this.resolveJid(sock, '+' + phone);
        return {
          id: k.id,
          remoteJid: jid,
          fromMe: k.fromMe ?? false,
        };
      }),
    );

    await sock.readMessages(resolved);
  }

  /**
   * Resolve o JID canônico de um número via servidor do WhatsApp.
   *
   * No Brasil, números com DDD 31-38 (Minas Gerais) e alguns outros têm
   * registro no WhatsApp **sem o "9"** mesmo sendo celular. Construir o JID
   * por concatenação (`<phone>@s.whatsapp.net`) acerta para a maioria mas
   * cria um chat fantasma para esses casos, deixando o lead sem receber a
   * resposta. `onWhatsApp` é a única fonte autoritativa.
   *
   * Cache de 15 min para não consultar a cada mensagem.
   */
  private async resolveJid(sock: WASocket, phone: string): Promise<string> {
    const cleanPhone = phone.replace('+', '');
    const fallbackJid = cleanPhone + '@s.whatsapp.net';

    const cached = this.jidCache.get(cleanPhone);
    if (cached && Date.now() - cached.cachedAt < this.JID_CACHE_TTL_MS) {
      return cached.jid;
    }

    // Para números BR de celular, testa ambas as variantes (com e sem o "9")
    // — DDDs como 32 podem estar registrados sem o 9 no WhatsApp.
    const candidates = this.brazilianPhoneCandidates(cleanPhone);

    try {
      const results = await sock.onWhatsApp(...candidates);
      const found = results?.find((r) => r?.exists);
      if (found?.jid) {
        this.jidCache.set(cleanPhone, { jid: found.jid, cachedAt: Date.now() });
        if (found.jid !== fallbackJid) {
          this.logger.log(
            `[JID] ${cleanPhone} resolvido para ${found.jid} (variante divergente do construído)`,
          );
        }
        return found.jid;
      }
      this.logger.warn(
        `[JID] onWhatsApp não confirmou existência de ${cleanPhone} (testou: ${candidates.join(', ')}) — usando fallback`,
      );
    } catch (err) {
      this.logger.warn(`[JID] onWhatsApp falhou para ${cleanPhone}:`, err);
    }

    return fallbackJid;
  }

  private brazilianPhoneCandidates(cleanPhone: string): string[] {
    if (!cleanPhone.startsWith('55')) return [cleanPhone];
    if (cleanPhone.length === 13) {
      // 55 + DDD(2) + 9 + 8 dígitos — também testa sem o 9
      const without9 = cleanPhone.slice(0, 4) + cleanPhone.slice(5);
      return [cleanPhone, without9];
    }
    if (cleanPhone.length === 12) {
      // 55 + DDD(2) + 8 dígitos — também testa com o 9
      const with9 = cleanPhone.slice(0, 4) + '9' + cleanPhone.slice(4);
      return [cleanPhone, with9];
    }
    return [cleanPhone];
  }

  /**
   * Mensagens do WhatsApp vem aninhadas dentro de wrappers em varios casos:
   * - ephemeralMessage: mensagens que desaparecem
   * - viewOnceMessage / viewOnceMessageV2(Extension): ver uma vez
   * - documentWithCaptionMessage: documento com legenda
   * - editedMessage: mensagens editadas
   * - Click-to-WhatsApp ads (Instagram/Facebook): aninhada em wrappers
   *   carregando contextInfo.externalAdReply
   *
   * Sem unwrap, o conteudo real fica invisivel para o extrator de texto.
   * Loop com limite porque wrappers podem ser duplos aninhados.
   */
  private unwrapMessageContent(msg: any): any {
    let current = msg;
    for (let i = 0; i < 5; i++) {
      if (!current) return null;
      const inner =
        current.ephemeralMessage?.message ??
        current.viewOnceMessage?.message ??
        current.viewOnceMessageV2?.message ??
        current.viewOnceMessageV2Extension?.message ??
        current.documentWithCaptionMessage?.message ??
        current.editedMessage?.message ??
        null;
      if (!inner) return current;
      current = inner;
    }
    return current;
  }

  /**
   * Retorna o "caminho" de chaves aninhadas (so a primeira em cada nivel).
   * Usado para diagnostico — sem expor conteudo, deixa claro o tipo da
   * mensagem e qualquer wrapper desconhecido.
   * Ex: "ephemeralMessage.message.extendedTextMessage"
   */
  private describeMessageShape(msg: any, depth = 0): string {
    if (!msg || typeof msg !== 'object' || depth > 5) return '';
    const k = Object.keys(msg)[0];
    if (!k) return '';
    const child = this.describeMessageShape(msg[k], depth + 1);
    return child ? `${k}.${child}` : k;
  }

  private normalizeBrazilianPhone(phone: string): string {
    const digits = phone.replace('+', '');
    // Número brasileiro sem o 9 extra: +55 + 2 dígitos DDD + 8 dígitos = 12 dígitos
    // Formato correto (celular):         +55 + 2 dígitos DDD + 9 dígitos = 13 dígitos
    if (digits.startsWith('55') && digits.length === 12) {
      return '+' + digits.slice(0, 4) + '9' + digits.slice(4);
    }
    return phone;
  }

  private async handleIncomingMessage(
    userId: string,
    sock: WASocket,
    message: any,
    lidToPhone: Map<string, string>,
  ) {
    const jid = message.key?.remoteJid;
    if (
      !jid ||
      jid.endsWith('@g.us') ||
      jid.endsWith('@broadcast') ||
      jid.endsWith('@newsletter')
    )
      return;
    if (message.key?.fromMe) return;

    const wppId = (message.key?.id as string | undefined) ?? null;

    // Mensagens vindas de "Click-to-WhatsApp ads" (Instagram/Facebook),
    // ephemeral (desaparecem), view-once, editadas etc. chegam aninhadas
    // dentro de wrappers. Sem unwrap, o texto real fica invisivel.
    const innerMessage = this.unwrapMessageContent(message.message);

    // Extracao de texto cobre os tipos mais comuns:
    // - conversation / extendedTextMessage: textos simples e com preview
    // - captions de midia: foto, video, documento
    // - respostas de botoes/listas/templates
    // - templateMessage: chega quando o lead veio via outra plataforma
    //   (WhatsApp Business API, anuncios CTWA com template, bots terceiros)
    //   2 formatos comuns: hydratedTemplate (renderizado) e fourRowTemplate
    // - interactiveMessage: mensagem interativa com body text
    // - reactionMessage: emoji de reacao (lead reage com 👍 em vez de texto)
    const isImage = !!innerMessage?.imageMessage;
    const rawText =
      innerMessage?.conversation ||
      innerMessage?.extendedTextMessage?.text ||
      innerMessage?.imageMessage?.caption ||
      innerMessage?.videoMessage?.caption ||
      innerMessage?.documentMessage?.caption ||
      innerMessage?.buttonsResponseMessage?.selectedDisplayText ||
      innerMessage?.listResponseMessage?.title ||
      innerMessage?.templateButtonReplyMessage?.selectedDisplayText ||
      innerMessage?.templateMessage?.hydratedTemplate?.hydratedContentText ||
      innerMessage?.templateMessage?.fourRowTemplate?.content?.conversation ||
      innerMessage?.templateMessage?.fourRowTemplate?.content
        ?.extendedTextMessage?.text ||
      innerMessage?.interactiveMessage?.body?.text ||
      innerMessage?.reactionMessage?.text ||
      null;

    // Imagem com caption: caption vira o texto (flow roda normal).
    // Imagem sem caption: usa "[Imagem]" como placeholder pro flow saber
    // que recebeu algo e responder seu fallback (ou ignorar conforme node).
    const messageText = isImage ? rawText || '[Imagem]' : rawText;

    if (!messageText || messageText.trim() === '') {
      const shape = this.describeMessageShape(message.message);
      if (!shape) {
        // Sem nenhuma chave em message.message — tipicamente sinal de que
        // o Baileys nao conseguiu decifrar a mensagem (Bad MAC). Lead
        // provavelmente reenvia ou a proxima mensagem reabre a sessao
        // Signal. Nada a fazer no nosso lado.
        this.logger.warn(
          `Mensagem perdida por falha cripto (Bad MAC ou sessao Signal dessincronizada; wppId: ${wppId}, userId: ${userId})`,
        );
        return;
      }
      this.logger.warn(
        `Mensagem sem texto extraivel ignorada (shape: ${shape}, wppId: ${wppId}, userId: ${userId})`,
      );
      return;
    }

    // Dedup so DEPOIS de confirmar que ha texto pra processar. Marcar antes
    // fazia mensagens com midia/audio "queimarem" o wppId no cache, e a
    // proxima reentrega do Baileys (com TEXTO valido, supostamente, ou nao)
    // era descartada como duplicada — bot nunca via a mensagem.
    if (this.isDuplicateIncomingMessage(wppId)) {
      this.logger.log(
        `Mensagem duplicada ignorada (whatsappMessageId: ${wppId}, userId: ${userId})`,
      );
      return;
    }

    // Resolve phone number: @lid JIDs use an internal ID, not the real phone.
    // Baileys provides the real JID in key.remoteJidAlt when addressingMode === "lid".
    // Fall back to the contacts map built during sync, then to the raw JID.
    let phoneJid = jid;
    if (jid.endsWith('@lid')) {
      phoneJid = message.key?.remoteJidAlt ?? lidToPhone.get(jid) ?? jid;
    }
    const rawNumber = phoneJid.split('@')[0];
    if (!rawNumber || !/^\d+$/.test(rawNumber)) return;
    const leadPhoneNumber = this.normalizeBrazilianPhone('+' + rawNumber);
    const botPhoneNumber = sock.user?.id
      ? this.normalizeBrazilianPhone(
          '+' + sock.user.id.split(':')[0].split('@')[0],
        )
      : '';
    const leadName = message.pushName || null;

    // Se for imagem, baixa e sobe pro Storage em paralelo com a logica do
    // flow. Nao bloqueia o processamento — se falhar, mensagem entra so
    // como texto.
    const mediaUrl = isImage
      ? await this.maybeUploadIncomingImage(
          userId,
          message,
          innerMessage,
          wppId,
        )
      : null;
    const mediaType: 'image' | null = isImage && mediaUrl ? 'image' : null;

    this.logger.log(
      `Mensagem recebida — bot: ${botPhoneNumber} | lead: ${leadPhoneNumber} | texto: "${messageText}"${
        mediaUrl ? ` | midia: image` : ''
      }`,
    );

    const mutex = this.getLeadMutex(botPhoneNumber, leadPhoneNumber);
    await mutex.runExclusive(async () => {
      const {
        conversationId,
        userId: resolvedUserId,
        messagesToSend,
      } = await this.processMessageUseCase.execute({
        botPhoneNumber,
        leadPhoneNumber,
        messageText,
        leadName,
      });

      if (!resolvedUserId) {
        this.logger.warn(
          `Nenhum flow ativo para o número ${botPhoneNumber}. Mensagem de ${leadPhoneNumber} ignorada.`,
        );
        return;
      }

      if (conversationId && resolvedUserId) {
        const incomingWppId = message.key?.id ?? null;
        await this.messageHistoryRepository.create(
          new MessageHistoryEntity({
            conversationId: UUID.from(conversationId),
            sender: MessageSender.LEAD,
            content: messageText,
            whatsappMessageId: incomingWppId,
            status: MessageStatus.DELIVERED,
            mediaUrl,
            mediaType,
          }),
        );

        this.gateway.sendNewMessage(resolvedUserId, {
          conversationId,
          sender: 'LEAD',
          content: messageText,
          createdAt: new Date(),
          whatsappMessageId: incomingWppId,
          status: 'DELIVERED',
          mediaUrl,
          mediaType,
        });
      }

      if (conversationId && resolvedUserId && messagesToSend.length > 0) {
        // Enfileira no outbox em vez de enviar inline.
        // O OutboundWorkerService cuida do envio com retry/backoff e persiste
        // message_history (BOT) somente após confirmação de envio.
        const baseTime = Date.now();
        await this.outboundRepository.enqueue(
          messagesToSend.map((text, i) => ({
            conversationId,
            userId: resolvedUserId,
            toPhoneNumber: leadPhoneNumber,
            content: text,
            // Mantém espaçamento de 3s entre mensagens consecutivas.
            nextAttemptAt: new Date(baseTime + i * 3000),
          })),
        );
      }
    });

    this.gcLeadMutexes();
  }
}
