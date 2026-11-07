import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import {
  CashAccountsController,
  CashCategoriesController,
} from './cash-accounts.controller.js';
import { CashAccountsService } from './cash-accounts.service.js';
import {
  CashTransactionsController,
  CustomerReceiptsController,
} from './cash-transactions.controller.js';
import { CashTransactionsService } from './cash-transactions.service.js';

/** Sổ quỹ: quỹ, danh mục thu chi, phiếu thu/chi, thu nợ khách và trả nợ NCC. */
@Module({
  imports: [AuditModule],
  controllers: [
    CashAccountsController,
    CashCategoriesController,
    CashTransactionsController,
    CustomerReceiptsController,
  ],
  providers: [CashAccountsService, CashTransactionsService],
})
export class CashModule {}
