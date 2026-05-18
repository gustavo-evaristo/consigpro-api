import { Logger, INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { ServerOptions } from 'socket.io';

/**
 * Substitui o IoAdapter padrão do Nest para que eventos de Socket.IO
 * emitidos em uma instância da API sejam propagados às demais via Redis
 * Pub/Sub. Sem isso, ao escalar `consigpro-api` para 2+ máquinas, clientes
 * conectados na máquina A não recebem eventos enviados pela máquina B.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly pub: Redis | null,
    private readonly sub: Redis | null,
  ) {
    super(app);
  }

  async init(): Promise<void> {
    if (!this.pub || !this.sub) {
      this.logger.warn(
        'Redis não configurado — Socket.IO operando em modo single-node (sem propagação cross-instance)',
      );
      return;
    }
    this.adapterConstructor = createAdapter(this.pub, this.sub);
    this.logger.log('Socket.IO Redis adapter habilitado');
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
