import { Module } from '@nestjs/common';
import { ConfigModule } from './config/app-config.js';
import { DatabaseModule } from './db/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AuthorizationModule } from './modules/authorization/authorization.module.js';
import { BranchesModule } from './modules/branches/branches.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { PreferencesModule } from './modules/preferences/preferences.module.js';
import { PurchasingModule } from './modules/purchasing/purchasing.module.js';
import { SalesModule } from './modules/sales/sales.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { SuppliersModule } from './modules/suppliers/suppliers.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { GoogleAuthModule } from './modules/google-auth/google-auth.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    AuthorizationModule,
    BranchesModule,
    AuthModule,
    SuppliersModule,
    CustomersModule,
    SalesModule,
    PurchasingModule,
    UsersModule,
    PreferencesModule,
    GoogleAuthModule,
    FilesModule,
    CatalogModule,
    ImportsModule,
    IdempotencyModule,
  ],
})
export class AppModule {}
