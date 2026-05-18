# Migrations manuais

Migrations que **NÃO** são executadas automaticamente pelo `prisma migrate
deploy` (que o Fly roda no boot). Você aplica manualmente via Supabase SQL
Editor ou `psql` quando estiver pronto.

## drop-instance-lock.sql

Remove a tabela `instance_lock` que era usada pelo `LeaderElectionService`.

**Quando aplicar:**

1. `wa-worker` rodando em produção há >= 24h sem incidentes.
2. `WA_WORKER_ENABLED=true` no `consigpro-api` há >= 24h.
3. `LeaderElectionService` removido do código (PR separada — não foi
   feita ainda, ver Etapa 7 do plano).

**Como aplicar:**

```sql
-- Conferir que ninguem mais escreve nela
SELECT * FROM instance_lock;
-- Se vier 0 linhas (ou linhas expiradas faz muito tempo), seguir:

DROP TABLE instance_lock;
```

Depois, remover do `prisma/schema.prisma` o `model instance_lock` e
rodar `npx prisma generate`.

## Por que não está em prisma/migrations/

Porque migrations destrutivas (DROP TABLE) podem ser aplicadas
inadvertidamente pelo `release_command` do Fly em qualquer deploy. Mantê-las
aqui força ação manual deliberada.
