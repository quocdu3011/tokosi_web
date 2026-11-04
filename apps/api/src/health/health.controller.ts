import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../modules/auth/auth.decorators.js';

export class HealthResponse {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({
    example: '2026-11-03T07:11:16.170Z',
    description: 'Thời gian server (ISO 8601 UTC)',
  })
  time!: string;
}

@ApiTags('Hệ thống')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Kiểm tra server còn sống (không cần đăng nhập)' })
  @ApiOkResponse({ type: HealthResponse })
  check(): HealthResponse {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
