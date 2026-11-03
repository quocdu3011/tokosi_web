import { Module } from '@nestjs/common';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';

@Module({
  imports: [DatabaseModule, HealthModule, AuthorizationModule],
})
export class AppModule {}
