import type {
  AuthenticationState,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import type Redis from 'ioredis';
import { IWhatsAppSessionRepository } from 'src/domain/repositories/whatsapp-session.repository';
import { WhatsAppSessionEntity } from 'src/domain/entities/whatsapp-session.entity';
import { loadBaileys } from './baileys.loader';

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 dias
const cacheKey = (userId: string) => `wa:auth:${userId}`;

interface CachedAuthBlob {
  creds: string;
  keys: string;
}

/**
 * Apaga o cache Redis de auth state para este userId. Necessario sempre
 * que o Postgres for limpo (forceResetSession, logout), senao o proximo
 * startSession le do cache as creds antigas — o que impede a geracao
 * do QR para um numero novo.
 */
export async function invalidateAuthCache(
  userId: string,
  redis: Redis | null,
): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(cacheKey(userId));
  } catch {
    // Falha do Redis nao deve quebrar o reset — o Postgres ja foi limpo.
  }
}

/**
 * Lê o blob de auth do Redis (hot cache); cai para Postgres se Redis
 * estiver indisponível ou cache vazio.
 *
 * Postgres permanece como source of truth — Redis é só aceleração de
 * cold-start e proteção contra picos de leitura quando há muitas sessões
 * sendo reiniciadas em paralelo (deploy, scale-up).
 */
async function loadFromCacheOrDb(
  userId: string,
  repository: IWhatsAppSessionRepository,
  redis: Redis | null,
): Promise<CachedAuthBlob | null> {
  if (redis) {
    try {
      const cached = await redis.get(cacheKey(userId));
      if (cached) {
        const parsed = JSON.parse(cached) as CachedAuthBlob;
        return parsed;
      }
    } catch {
      // Redis indisponível — cai para Postgres
    }
  }

  const stored = await repository.findByUserId(userId);
  if (!stored?.creds) return null;
  const blob: CachedAuthBlob = {
    creds: stored.creds,
    keys: stored.keys ?? '{}',
  };

  if (redis) {
    redis
      .set(cacheKey(userId), JSON.stringify(blob), 'EX', CACHE_TTL_SECONDS)
      .catch(() => {});
  }

  return blob;
}

export async function useWhatsAppAuthState(
  userId: string,
  repository: IWhatsAppSessionRepository,
  redis: Redis | null = null,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const { BufferJSON, initAuthCreds, proto } = await loadBaileys();

  const stored = await loadFromCacheOrDb(userId, repository, redis);

  const creds = stored?.creds
    ? JSON.parse(stored.creds, BufferJSON.reviver)
    : initAuthCreds();

  const keys: Record<string, any> = stored?.keys
    ? JSON.parse(stored.keys, BufferJSON.reviver)
    : {};

  const session = new WhatsAppSessionEntity({ userId });

  const persist = async () => {
    const credsStr = JSON.stringify(creds, BufferJSON.replacer);
    const keysStr = JSON.stringify(keys, BufferJSON.replacer);
    session.updateState(credsStr, keysStr);
    await repository.save(session);
    if (redis) {
      redis
        .set(
          cacheKey(userId),
          JSON.stringify({ creds: credsStr, keys: keysStr }),
          'EX',
          CACHE_TTL_SECONDS,
        )
        .catch(() => {});
    }
  };

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const id of ids) {
            let value = keys[`${type}-${id}`];
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            result[id] = value;
          }
          return result;
        },
        set: async (
          data: Partial<{
            [T in keyof SignalDataTypeMap]: {
              [id: string]: SignalDataTypeMap[T];
            };
          }>,
        ) => {
          for (const category in data) {
            const entries = (data as any)[category] as Record<string, any>;
            for (const id in entries) {
              const value = entries[id];
              const key = `${category}-${id}`;
              if (value) {
                keys[key] = value;
              } else {
                delete keys[key];
              }
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}
