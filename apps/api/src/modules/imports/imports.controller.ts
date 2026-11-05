import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ParseIdPipe } from '../../common/parse-id.pipe.js';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { type AuthUser, CurrentUser } from '../../common/auth-user.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import {
  ImportJobDto,
  ImportQueryDto,
  MAX_IMPORT_BYTES,
} from './imports.dto.js';
import { ImportsService } from './imports.service.js';

const XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@ApiTags('Nhập dữ liệu từ Excel')
@ApiBearerAuth()
@RequirePermission('import.run')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get(':type/template')
  @Header('Content-Type', XLSX)
  @ApiOperation({ summary: 'Tải file Excel mẫu' })
  @ApiProduces(XLSX)
  async template(@Param('type') type: string): Promise<StreamableFile> {
    const buffer = await this.imports.template(type);
    return new StreamableFile(buffer, {
      type: XLSX,
      disposition: `attachment; filename="mau-nhap-${type}.xlsx"`,
    });
  }

  @Post(':type')
  @HttpCode(202)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Tải file Excel lên để nhập (type: products)',
    description:
      'Mặc định chỉ KIỂM TRA (dryRun=true), không ghi gì; gửi dryRun=false để ghi thật. Xử lý ngay trong yêu cầu nên kết quả (status completed hoặc failed) có sẵn trong phản hồi; vẫn xem lại được qua GET /imports/:id. Tất cả hoặc không gì cả: có dòng lỗi thì không ghi gì. mode=overwrite (mặc định): cập nhật theo mã hàng, chạy lại cùng file không tạo trùng. mode=add: CỘNG tồn kho theo cột Tồn kho; cùng một file (theo nội dung) đã nhập thật vào chi nhánh này sẽ bị từ chối 409 IMPORT_DUPLICATE_FILE, kể cả khi chạy thử, trừ khi gửi allowDuplicate=true.',
  })
  @ApiAcceptedResponse({ type: ImportJobDto })
  run(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @UploadedFile()
    file: { originalname: string; size: number; buffer: Buffer } | undefined,
    @Query() query: ImportQueryDto,
  ) {
    return this.imports.run(user, type, file, {
      dryRun: query.dryRun ?? true,
      branchId: query.branchId,
      mode: query.mode ?? 'overwrite',
      allowDuplicate: query.allowDuplicate ?? false,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Kết quả và lỗi từng dòng của một lần nhập' })
  @ApiOkResponse({ type: ImportJobDto })
  get(@Param('id', ParseIdPipe) id: string) {
    return this.imports.get(id);
  }
}
