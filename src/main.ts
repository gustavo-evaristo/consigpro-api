import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CustomExceptionFilter } from './infra/middlewares/exception.middleware';
import { ValidationPipe } from '@nestjs/common';
import { RedisIoAdapter } from './infra/redis/redis-io.adapter';
import { REDIS_PUB, REDIS_SUB } from './infra/redis/redis.constants';
import type Redis from 'ioredis';

/**
 * Guard contra rodar localmente apontando para Redis/DB de producao.
 * Se em dev (NODE_ENV != production) detectamos URLs do dominio prod
 * (Upstash ou Supabase), abortamos antes de subir o app — evita o
 * cenario classico de "rodei pnpm dev e tirei o WhatsApp do ar".
 */
function assertNotPointingToProd() {
  if (process.env.NODE_ENV === 'production') return;
  const redis = process.env.REDIS_URL ?? '';
  const db = process.env.DATABASE_URL ?? '';
  const flag = (process.env.ALLOW_PROD_RESOURCES ?? '').toLowerCase();
  if (flag === 'true' || flag === '1') return;
  const prodMatch = (url: string, pattern: RegExp) =>
    url.length > 0 && pattern.test(url);
  // Heuristicas: hostnames com -prod ou DB Supabase com nome "consigpro"
  // (ajuste se voce muda os nomes). Bloqueia se reconhecer prod.
  const hits: string[] = [];
  if (prodMatch(redis, /crucial-penguin-124486/)) hits.push('REDIS_URL=prod');
  if (prodMatch(db, /consigpro(?!-dev)|consig\.pro/i))
    hits.push('DATABASE_URL=prod');
  if (hits.length > 0) {
    console.error(
      `\n[ABORT] Tentando rodar em dev mas as URLs apontam para producao: ${hits.join(', ')}.\n` +
        `Use credenciais de dev (.env separado).\n` +
        `Se for intencional, defina ALLOW_PROD_RESOURCES=true.\n`,
    );
    process.exit(1);
  }
}

/**
 * Suprime logs verbosos da libsignal e do Baileys que sao acionados
 * via console.log/console.error direto (sem passar pelo logger Nest).
 *
 * Sao normais e nao acionaveis:
 * - "Closing session: ..." / "Removing old closed session: ..." —
 *   rotacao de chaves do Signal protocol durante decrypt normal.
 * - "Session error: Bad MAC" / "Failed to decrypt message with any known
 *   session" — sessao Signal dessincronizada (lead reinstalou app,
 *   mensagem fora de ordem, bot ficou offline). Acontece em ~1-3% das
 *   mensagens em qualquer bot Baileys.
 */
function silenceLibsignalNoise() {
  const SUPPRESS = [
    /^Closing session:/,
    /^Removing old closed session:/,
    /^Session error:/,
    /^Failed to decrypt message with any known session/,
    /^\s+at .+libsignal/,
    /^\s+at .+@whiskeysockets/,
    /^\s+at SessionCipher\./,
    /^\s+at Object\.verifyMAC/,
    /^\s+at _asyncQueueExecutor/,
    /^\s+at async _asyncQueueExecutor/,
    /^\s+at async \d+_[\d.]+/,
    /^\s+at async SessionCipher/,
  ];
  const matches = (arg: unknown) =>
    typeof arg === 'string' && SUPPRESS.some((re) => re.test(arg));
  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    if (args.length > 0 && matches(args[0])) return;
    origLog(...args);
  };
  console.error = (...args: unknown[]) => {
    if (args.length > 0 && matches(args[0])) return;
    origError(...args);
  };
}

async function bootstrap() {
  assertNotPointingToProd();
  silenceLibsignalNoise();
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  app.useGlobalFilters(new CustomExceptionFilter());

  const pub = app.get<Redis | null>(REDIS_PUB, { strict: false });
  const sub = app.get<Redis | null>(REDIS_SUB, { strict: false });
  const ioAdapter = new RedisIoAdapter(app, pub, sub);
  await ioAdapter.init();
  app.useWebSocketAdapter(ioAdapter);

  const config = new DocumentBuilder()
    .setTitle('Consigpro API')
    .setDescription('Bot api teste')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('api', app, documentFactory);

  await app.listen(process.env.PORT);

  console.log(`Listening on port ${process.env.PORT}`);
}

bootstrap();
