# CLAUDE.md

Orientações para o Claude Code (claude.ai/code) ao trabalhar neste repositório.

> Idioma: comentários, mensagens de erro/log e documentação devem ser escritos em **português (pt-BR)**, seguindo a convenção do restante do código.

## Papel deste serviço

`consigpro-api` é o **plano HTTP/WebSocket** do produto. Expõe a API REST consumida pelo `web`, emite eventos via Socket.io para o frontend e enfileira jobs para o `wa-worker` executar contra o WhatsApp (Baileys). **Não conecta diretamente ao WhatsApp em produção** — o worker faz isso (ver `WA_WORKER_ENABLED`).

Repositórios irmãos:

- `web/` — frontend Next.js
- `wa-worker/` — worker Baileys isolado (consome BullMQ, publica Pub/Sub)

## Comandos

```bash
pnpm run dev           # Sobe redis local (docker compose) + Nest em watch
pnpm run build         # nest build
pnpm run start:prod    # node dist/src/main
pnpm run lint          # ESLint com auto-fix
pnpm run format        # Prettier
pnpm run test          # Vitest (arquivos *.spec.ts)
```

Swagger em `/api` quando o servidor está rodando.

Após mudar `prisma/schema.prisma`:

```bash
npx prisma migrate dev
npx prisma generate
```

## Arquitetura (Clean/Hexagonal)

### `src/domain/` — Núcleo agnóstico de framework

**Regra dura:** nunca importe nada de `@nestjs/*`, Prisma ou bibliotecas de infra dentro de `domain/`. Se precisar, expanda a interface de repositório.

- `entities/` — classes de domínio com métodos de negócio. Testes `.spec.ts` ficam ao lado da entidade
- `entities/vos/` — value objects (`UUID`, `Password` com bcrypt + regra mín. 6 chars + caractere especial)
- `repositories/` — apenas interfaces (contratos), sem implementação
- `use-cases/` — **uma classe por operação de negócio**, organizada por domínio (`flow/`, `user/`, `conversation/`, `form/`, `kanban/`, `flow-node/`, `flow-engine/`, `analytics/`, `quick-reply/`). Recebem repositórios via construtor. Cada use-case novo deve ser exportado por `use-cases/index.ts`

### `src/infra/` — NestJS, Prisma, integrações

- `controllers/<dominio>/` — um controller fino por use-case + `<dominio>.module.ts` agrupando providers
- `dtos/` — validação de request via `class-validator` + `class-transformer` (`ValidationPipe` global com `transform: true`)
- `responses/` — shape das respostas (apresentação)
- `database/repositories/` — implementações Prisma das interfaces de `domain/repositories/`. Bind em `database/database.module.ts`
- `authentication/` — Passport JWT
- `middlewares/` — `CustomExceptionFilter` global (mapeia `@hapi/boom` e domínio → HTTP)
- `redis/` — conexões `REDIS_PUB`/`REDIS_SUB`, `RedisIoAdapter` (Socket.io multi-instância), `redis-lock.service.ts`
- `storage/` — upload de mídia (mesma interface do wa-worker; mantenha em paralelo)
- `wa-bridge/` — **ponte com o `wa-worker`**: producer (enfileira em BullMQ) + consumer (escuta canais Pub/Sub e propaga via Socket.io)
- `whatsapp/` — caminho legado direto Baileys + leader-election. **Só ativo se `WA_WORKER_ENABLED=false`.** Não toque sem entender o contrato com o worker

### Fluxo de dados

`Controller → Use Case → Repository interface → Prisma repository → Postgres`

Eventos do WhatsApp: `wa-worker (Baileys) → Redis Pub/Sub → WaEventConsumerService → Socket.io → web`

Envio de mensagem: `Controller → SendMessageUseCase → cria pending_outbound_message → WaJobProducerService.enqueue → BullMQ → wa-worker`

## Contrato com o `wa-worker`

O contrato está em `src/infra/wa-bridge/wa-bridge.constants.ts` e **deve ficar idêntico** ao `wa-worker/src/queue/queue.constants.ts` + `wa-worker/src/events/event-channels.ts`. Ao alterar:

1. Atualize **os dois lados** no mesmo PR.
2. Os nomes de filas (`wa.session`, `wa.message`, `wa.read`) e canais (`wa:event:*`) são strings — não renomeie sem coordenar deploy.
3. `correlationId` em `SendMessageJobData` aponta para `pending_outbound_message.id` ou `message_history.id` — o worker devolve `whatsappMessageId` por esse ID.

`WA_WORKER_ENABLED=true` desliga o caminho legado em `infra/whatsapp/` (sem QR/Baileys local). Em dev, fica `true` para não conectar ao número de produção (ver `.env.development`).

## Banco de dados

Prisma 7 + Postgres (Supabase). Schema em `prisma/schema.prisma`, client gerado em `generated/prisma`.

Modelos principais:

- `companies → users → flows → flow_nodes → node_options`
- `flows → conversations → message_history` / `conversation_progress` / `lead_responses`
- `kanbans → kanban_stages` (referenciados por `flow_nodes` para mover leads)
- `forms → form_fields → form_field_options` / `form_responses → form_answers`
- `whatsapp_sessions` (estado de auth Baileys persistido), `pending_outbound_message` (fila durável de envios), `instance_lock` (leader-election quando o caminho legado está ativo), `quick_replies`

Convenções:

- PKs em UUID (`@default(uuid())`)
- Soft delete via `isDeleted: boolean`; soft-deactivate via `isActive`
- Datas: `createdAt` / `updatedAt` (com `@updatedAt`)

## Autenticação

JWT Bearer em `Authorization`. Payload contém `userId`. Use `JwtAuthGuard` nos controllers; endpoints públicos (login, cadastro, formulários públicos via token) ficam sem guard explicitamente.

## Regras importantes

1. **Nunca aponte dev para infra de produção.** `assertNotPointingToProd()` em `main.ts` aborta o boot se `REDIS_URL`/`DATABASE_URL` casarem com padrões de prod. Se for intencional, exporte `ALLOW_PROD_RESOURCES=true` — mas você quase certamente não quer isso.
2. **Não use `console.log` direto para debug.** O `silenceLibsignalNoise()` filtra ruído da libsignal; logs próprios devem ir pelo logger do Nest.
3. **Use cases não conhecem HTTP.** Lançar `Boom` ou erros de domínio; o `CustomExceptionFilter` traduz.
4. **DTO != Entity != Response.** Não retorne entidade de domínio do controller; mapeie para `responses/`.
5. **Pub/Sub é fire-and-forget.** Se precisar de garantia de entrega worker → api, use BullMQ (resultado do job) — não Pub/Sub.
6. **Sockets multi-instância:** sempre via `RedisIoAdapter`. Não emita `io.emit` direto sem ele em produção.

## Variáveis de ambiente

Carregadas com prioridade: `.env.${NODE_ENV}.local` > `.env.${NODE_ENV}` > `.env.local` > `.env`.

```
PORT=3000
DATABASE_URL=             # Postgres (Supabase em prod)
JWT_SECRET_KEY=
REDIS_URL=                # Upstash em prod, docker local em dev
WA_WORKER_ENABLED=true    # ler de wa-worker; false ativa caminho legado
ALLOW_PROD_RESOURCES=     # NÃO defina em dev a menos que saiba o porquê
```

## Testes

Vitest (`pnpm test`). Specs ficam ao lado do código (`*.spec.ts`). Foco em domínio: entidades e VOs têm cobertura; use-cases mockam repositórios via interface.
