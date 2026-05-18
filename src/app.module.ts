import { Module } from '@nestjs/common';
import { InfraModule } from './infra/infra.module';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.module';

const nodeEnv = process.env.NODE_ENV ?? 'development';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        `.env.${nodeEnv}.local`,
        `.env.${nodeEnv}`,
        '.env.local',
        '.env',
      ],
    }),
    RedisModule,
    StorageModule,
    InfraModule,
  ],
})
export class AppModule {}
