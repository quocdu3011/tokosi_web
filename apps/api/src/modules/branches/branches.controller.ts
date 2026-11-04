import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthUser, CurrentUser } from '../../common/auth-user.js';
import { BranchAccessService } from './branch-access.service.js';

export class BranchDto {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'SG' }) code!: string;
  @ApiProperty({ example: 'Chi nhánh Sài Gòn' }) name!: string;
  @ApiProperty({ description: 'Chi nhánh mặc định của hệ thống' })
  isDefault!: boolean;
}

@ApiTags('Chi nhánh')
@ApiBearerAuth()
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchAccess: BranchAccessService) {}

  @Get()
  @ApiOperation({
    summary: 'Chi nhánh người dùng được phép làm việc (Quản lý: tất cả)',
  })
  @ApiOkResponse({ type: [BranchDto] })
  list(@CurrentUser() user: AuthUser): Promise<BranchDto[]> {
    return this.branchAccess.listAllowed(user);
  }
}
