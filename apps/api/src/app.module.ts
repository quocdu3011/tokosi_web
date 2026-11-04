import { Module } from '@nestjs/common';
import { ConfigModule } from './config/app-config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { UsersModule } from './modules/users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthorizationModule,
    BranchesModule,
    AuthModule,
    UsersModule,
  ],
})
export class AppModule {}
