import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { uniqueViolation } from '../../common/pg-errors.js';
import type { AuthUser } from '../../common/auth-user.js';
import { describeErrorForLog } from '../../common/all-exceptions.filter.js';
import { readSheet, writeSheet, type ParsedSheet } from '../../common/excel.js';
import { DB, type Database } from '../../db/database.module.js';
import { importJobs } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';
import { BranchAccessService } from '../branches/branch-access.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { ImportOutcome, ImportRowError } from './import-cells.js';
import {
  MAX_IMPORT_BYTES,
  MAX_STORED_ERRORS,
  SUPPORTED_IMPORT_TYPES,
  type ImportJobDto,
  type ImportMode,
  type SupportedImportType,
} from './imports.dto.js';
import { importProducts } from './products.importer.js';

/** Ném để hủy transaction (chạy thử hoặc có lỗi) nhưng vẫn mang kết quả ra ngoài. */
class Rollback extends Error {
  constructor(readonly outcome: ImportOutcome) {
    super('rollback');
  }
}

type JobRow = typeof importJobs.$inferSelect;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly auditLog: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Nhập file Excel. Xử lý ĐỒNG BỘ (vài nghìn dòng, không cần hàng đợi) trong MỘT transaction, được ăn cả ngã về
   * không: có bất kỳ dòng lỗi nào thì không ghi gì. `dryRun` chạy toàn bộ rồi hoàn tác nên báo cáo chính xác, kể cả
   * lỗi ràng buộc CSDL.
   */
  async run(
    user: AuthUser,
    type: string,
    file: { originalname: string; size: number; buffer: Buffer } | undefined,
    opts: {
      dryRun: boolean;
      branchId?: string;
      mode: ImportMode;
      allowDuplicate?: boolean;
    },
  ): Promise<ImportJobDto> {
    const kind = this.parseType(type);
    if (!file || file.size === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Chưa chọn file Excel', [
        { field: 'file', message: 'Chọn một file .xlsx' },
      ]);
    }
    if (opts.branchId)
      await this.branchAccess.assertAccess(user, opts.branchId);

    let sheet: ParsedSheet;
    try {
      sheet = await readSheet(file.buffer);
    } catch (e) {
      const reason =
        e instanceof Error && /quá \d+ dòng/.test(e.message) ? e.message : null;
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        reason ?? 'Không đọc được file. Hãy dùng file Excel (.xlsx) theo mẫu.',
        [{ field: 'file', message: reason ?? 'File không phải .xlsx hợp lệ' }],
      );
    }

    // Import thêm cộng tồn nên KHÔNG idempotent: cùng một file (theo nội dung) chỉ được nhập thật một lần mỗi chi nhánh.
    // Kiểm tra cả khi chạy thử để người dùng biết trước. Ràng buộc duy nhất ở CSDL chặn hai lần nhập đồng thời.
    const fileHash =
      opts.mode === 'add' && opts.branchId
        ? createHash('sha256').update(file.buffer).digest('hex')
        : null;
    if (fileHash && !opts.allowDuplicate) {
      const [prev] = await this.db
        .select({
          id: importJobs.id,
          fileName: importJobs.fileName,
          createdAt: importJobs.createdAt,
        })
        .from(importJobs)
        .where(
          and(
            eq(importJobs.branchId, opts.branchId!),
            eq(importJobs.fileHash, fileHash),
            eq(importJobs.mode, 'add'),
            eq(importJobs.dryRun, false),
            eq(importJobs.status, 'completed'),
          ),
        );
      if (prev) throw duplicateFile(prev);
    }

    // Id lần nhập sinh trước để làm chứng từ gốc (`refId`, mã IMP-…) của các dòng cộng/trừ tồn ở chế độ "thêm".
    const jobId = randomUUID();
    const ref = { id: jobId, code: `IMP-${jobId.slice(0, 8).toUpperCase()}` };

    let outcome: ImportOutcome;
    let systemError: string | null = null;
    let savedJob: typeof importJobs.$inferSelect | undefined;
    try {
      outcome = await this.db.transaction(async (tx) => {
        const result = await importProducts(tx, sheet, {
          branchId: opts.branchId,
          userId: user.id,
          mode: opts.mode,
          inventory: this.inventory,
          ref,
        });
        if (opts.dryRun || result.errors.length > 0) throw new Rollback(result);
        await this.auditLog.record(tx, {
          action: 'import.run',
          entityType: 'import',
          branchId: opts.branchId ?? null,
          after: {
            type: kind,
            mode: opts.mode,
            ...(opts.mode === 'add' ? { ref: ref.code } : {}),
            fileName: file.originalname,
            rows: sheet.rows.length,
            created: result.created,
            updated: result.updated,
            ...(opts.allowDuplicate && opts.mode === 'add'
              ? { allowDuplicate: true }
              : {}),
          },
        });
        // Nhập thật thành công: ghi lần nhập NGAY TRONG transaction. Hai lần nhập đồng thời cùng file đụng ràng buộc
        // duy nhất → lần sau hoàn tác cả phần cộng tồn của nó.
        [savedJob] = await tx
          .insert(importJobs)
          .values({
            id: jobId,
            type: kind,
            mode: opts.mode,
            status: 'completed',
            dryRun: false,
            fileName: file.originalname.slice(0, 255),
            branchId: opts.branchId ?? null,
            // Cho phép nạp lại thì không lưu băm: lần sau vẫn bị chặn bởi lần nhập gốc
            fileHash: opts.allowDuplicate ? null : fileHash,
            total: sheet.rows.length,
            created: result.created,
            updated: result.updated,
            failed: 0,
            errors: [],
            createdBy: user.id,
            finishedAt: new Date(),
          })
          .returning();
        return result;
      });
    } catch (e) {
      if (e instanceof Rollback) {
        outcome = e.outcome;
      } else if (
        uniqueViolation(e)?.constraint?.includes('import_jobs_add_file_unique')
      ) {
        throw duplicateFile();
      } else {
        // Lỗi ràng buộc/CSDL ngoài dự kiến: không ghi gì (transaction đã hoàn tác), không lộ chi tiết nội bộ
        this.logger.error(`Nhập ${kind} thất bại: ${describeErrorForLog(e)}`);
        systemError =
          'Lỗi hệ thống khi ghi dữ liệu nên không có gì được lưu. Hãy thử lại hoặc báo quản trị kèm mã yêu cầu.';
        outcome = { created: 0, updated: 0, errors: [] };
      }
    }

    const errors: ImportRowError[] = systemError
      ? [{ row: 0, field: '', message: systemError }]
      : outcome.errors;
    const failedRows = new Set(errors.map((x) => x.row)).size;
    const failed = errors.length > 0;
    if (savedJob) return toDto(savedJob);
    const [job] = await this.db
      .insert(importJobs)
      .values({
        id: jobId,
        type: kind,
        mode: opts.mode,
        status: failed ? 'failed' : 'completed',
        dryRun: opts.dryRun,
        fileName: file.originalname.slice(0, 255),
        branchId: opts.branchId ?? null,
        total: sheet.rows.length,
        created: failed ? 0 : outcome.created,
        updated: failed ? 0 : outcome.updated,
        failed: failedRows,
        errors: errors.slice(0, MAX_STORED_ERRORS),
        createdBy: user.id,
        finishedAt: new Date(),
      })
      .returning();
    return toDto(job!);
  }

  async get(id: string): Promise<ImportJobDto> {
    const [job] = await this.db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, id));
    if (!job) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy lần nhập');
    return toDto(job);
  }

  /** File Excel mẫu: tiêu đề giống file KiotViet kèm một dòng ví dụ (dữ liệu giả). */
  async template(type: string): Promise<Buffer> {
    this.parseType(type); // hiện chỉ có mẫu hàng hóa; loại không hỗ trợ ném lỗi
    return writeSheet(
      'Hàng hóa',
      [
        { header: 'Mã hàng', width: 16 },
        { header: 'Tên hàng', width: 36 },
        { header: 'Loại hàng', width: 12 },
        { header: 'Hàng thành phần', width: 30 },
        { header: 'Tồn kho', width: 12 },
        { header: 'Giá vốn', width: 14 },
        { header: 'Tồn nhỏ nhất', width: 14 },
        { header: 'Tồn lớn nhất', width: 14 },
        { header: 'Vị trí', width: 12 },
        { header: 'Mô tả', width: 30 },
        { header: 'Đang kinh doanh', width: 16 },
        { header: 'Hình ảnh (url1,url2...)', width: 40 },
      ],
      [
        [
          'VD001',
          'Hàng ví dụ',
          'Hàng hóa',
          null,
          50,
          21800.5,
          10,
          2000,
          'Kệ A1',
          'Mô tả ngắn',
          1,
          'https://example.com/anh1.jpg',
        ],
        [
          'VD-COMBO',
          'Combo ví dụ',
          'Combo',
          'VD001/2',
          null,
          null,
          null,
          null,
          null,
          null,
          1,
          null,
        ],
      ],
    );
  }

  private parseType(type: string): SupportedImportType {
    if ((SUPPORTED_IMPORT_TYPES as readonly string[]).includes(type)) {
      return type as SupportedImportType;
    }
    if (type === 'customers' || type === 'suppliers') {
      throw new AppError(
        400,
        'IMPORT_TYPE_NOT_SUPPORTED',
        'Chưa hỗ trợ nhập khách hàng / nhà cung cấp từ Excel; sẽ có cùng phân hệ tương ứng',
      );
    }
    throw new AppError(404, 'NOT_FOUND', `Không có loại nhập "${type}"`);
  }
}

function toDto(j: JobRow): ImportJobDto {
  return {
    id: j.id,
    type: j.type,
    mode: j.mode,
    status: j.status,
    dryRun: j.dryRun,
    fileName: j.fileName,
    total: j.total,
    created: j.created,
    updated: j.updated,
    failed: j.failed,
    errors: (j.errors as ImportRowError[] | null) ?? [],
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  };
}

export const IMPORT_FILE_LIMIT = MAX_IMPORT_BYTES;

function duplicateFile(prev?: {
  id: string;
  fileName: string | null;
  createdAt: Date;
}): AppError {
  return new AppError(
    409,
    'IMPORT_DUPLICATE_FILE',
    'File này đã được Import thêm vào chi nhánh này rồi; nhập lại sẽ cộng tồn lần nữa. Nếu thật sự muốn nhập lại, gửi allowDuplicate=true.',
    prev
      ? {
          importId: prev.id,
          fileName: prev.fileName,
          importedAt: prev.createdAt.toISOString(),
        }
      : undefined,
  );
}
