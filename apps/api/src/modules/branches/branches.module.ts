import { Global, Module } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service.js';
import { BranchesController } from './branches.controller.js';

/** Chi nhánh và quyền truy cập chi nhánh. Toàn cục để mọi module nghiệp vụ dùng `BranchAccessService`. */
@Global()
@Module({
  controllers: [BranchesController],
  providers: [BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchesModule {}
