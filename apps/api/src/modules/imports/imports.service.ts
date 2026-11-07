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
import { PermissionsService } from '../authorization/permissions.service.js';
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
import { importCashTransactions } from './cash.importer.js';
import { importCustomers } from './customers.importer.js';
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
    private readonly permissions: PermissionsService,
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
      accountId?: string;
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
    let debtBranchIds: string[] = [];
    if (kind === 'customers') {
      if (opts.mode === 'add') {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Nhập khách hàng chỉ có chế độ cập nhật theo mã/tên (mode=overwrite)',
          [{ field: 'mode', message: 'Khách hàng không có chế độ "thêm"' }],
        );
      }
      // Nhập hàng loạt sửa khách của mọi nhân viên nên cần quyền sửa TẤT CẢ khách
      const edit = await this.permissions.getGrant(user.role, 'customer.edit');
      if (edit?.scope !== 'all') {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Nhập khách hàng cần quyền thêm/sửa khách hàng ở phạm vi tất cả',
          { permission: 'customer.edit' },
        );
      }
      // Công nợ đầu kỳ: cần quyền riêng; chỉ ghi vào các chi nhánh người nhập được phép
      if (await this.permissions.has(user.role, 'customer.debt.opening')) {
        debtBranchIds = (await this.branchAccess.listAllowed(user)).map(
          (b) => b.id,
        );
      }
    }

    if (kind === 'cash-transactions') {
      if (opts.mode === 'add') {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Nhập Sổ quỹ chỉ có chế độ mặc định (mode=overwrite)',
          [{ field: 'mode', message: 'Sổ quỹ không có chế độ "thêm"' }],
        );
      }
      if (!opts.branchId) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Nhập Sổ quỹ cần chọn chi nhánh', [
          { field: 'branchId', message: 'Bắt buộc: file không ghi chi nhánh' },
        ]);
      }
      // Ghi lịch sử quỹ và đặt quỹ đầu kỳ: cần quyền quản lý quỹ
      if (!(await this.permissions.has(user.role, 'cash.manage'))) {
        throw new AppError(
          403,
          'FORBIDDEN',
          'Nhập Sổ quỹ cần quyền quản lý quỹ',
          { permission: 'cash.manage' },
        );
      }
    }

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
        const result =
          kind === 'cash-transactions'
            ? await importCashTransactions(tx, sheet, {
                userId: user.id,
                branchId: opts.branchId!,
                accountId: opts.accountId,
                ref,
              })
            : kind === 'customers'
              ? await importCustomers(tx, sheet, {
                  userId: user.id,
                  ref,
                  debtBranchIds,
                })
              : await importProducts(tx, sheet, {
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
            warnings: (result.warnings ?? []).slice(0, MAX_STORED_ERRORS),
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
        warnings: (outcome.warnings ?? []).slice(0, MAX_STORED_ERRORS),
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
    const kind = this.parseType(type);
    if (kind === 'customers') return customersTemplate();
    if (kind === 'cash-transactions') return cashTemplate();
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
    if (type === 'suppliers') {
      throw new AppError(
        400,
        'IMPORT_TYPE_NOT_SUPPORTED',
        'Chưa hỗ trợ nhập nhà cung cấp từ Excel; sẽ có cùng đợt chuyển dữ liệu nhà cung cấp',
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
    warnings: (j.warnings as ImportRowError[] | null) ?? [],
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

/** Mẫu nhập khách hàng: đúng tiêu đề file TKS kèm một dòng ví dụ (dữ liệu giả). */
function customersTemplate(): Promise<Buffer> {
  return writeSheet(
    'Theo khách hàng',
    [
      { header: 'Mã Khách hàng', width: 14 },
      { header: 'Tên khách', width: 36 },
      { header: 'Sale', width: 20 },
      { header: 'Level giá', width: 10 },
      { header: 'Khách mới', width: 14 },
      { header: 'Tiếp khách lần cuối', width: 18 },
      { header: 'Điện thoại', width: 14 },
      { header: 'Địa chỉ', width: 36 },
      { header: 'Định vị kho', width: 24 },
      { header: 'Số lượng kho', width: 12 },
      { header: 'Diện tích', width: 12 },
      { header: 'Đối thủ', width: 20 },
      { header: 'Hình thức bán hàng', width: 24 },
      { header: 'Quy mô khách', width: 14 },
      { header: 'Các ngày tiếp khách', width: 26 },
      { header: 'Ảnh kho', width: 28 },
      { header: 'Trạng thái', width: 12 },
      { header: 'Ghi chú', width: 24 },
      { header: 'Công nợ Hà Nội', width: 16 },
      { header: 'Công nợ Sài Gòn', width: 16 },
    ],
    [
      [
        null,
        'HN - Cửa hàng Ví Dụ',
        'Nguyễn Văn A',
        'Vừa',
        'T10/26-Page',
        null,
        '0900000001',
        '12 Đường Ví Dụ, Hà Nội',
        null,
        1,
        '300m2',
        null,
        'Bán sàn, FB live',
        'Chưa có',
        null,
        null,
        1,
        null,
        1500000,
        null,
      ],
    ],
  );
}

/** Mẫu nhập Sổ quỹ: đúng tiêu đề file SoQuy của KiotViet kèm vài dòng ví dụ (dữ liệu giả) và bốn dòng tổng kết. */
function cashTemplate(): Promise<Buffer> {
  return writeSheet(
    'Sổ quỹ',
    [
      { header: 'Mã phiếu', width: 14 },
      { header: 'Thời gian', width: 20 },
      { header: 'Loại thu chi', width: 40 },
      { header: 'Người nộp/nhận', width: 24 },
      { header: 'Giá trị', width: 16 },
    ],
    [
      ['TT000001', '03/11/2026 09:15', 'Phiếu thu Tiền khách trả', 'Khách ví dụ', 5000000],
      ['CTM000001', '03/11/2026 10:30', 'Phiếu chi Cước hàng hoàn', 'Nhà xe ví dụ', -300000],
      [null, null, null, 'Quỹ đầu kỳ', 1000000],
      [null, null, null, 'Tổng thu', 5000000],
      [null, null, null, 'Tổng chi', -300000],
      [null, null, null, 'Tồn quỹ', 5700000],
    ],
  );
}
