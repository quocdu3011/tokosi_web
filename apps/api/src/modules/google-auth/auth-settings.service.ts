import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error.js';
import { DB, type Database, type DbOrTx } from '../../db/database.module.js';
import { systemSettings } from '../../db/schema/index.js';
import { AuditService } from '../audit/audit.service.js';

const KEY_ENABLED = 'auth.google_signup_enabled';
const KEY_DOMAINS = 'auth.google_signup_domains';
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export interface AuthSettings {
  googleSignupEnabled: boolean;
  /** Tên miền email được tự đăng ký (chữ thường, không có `@`). Rỗng = không ai được tự đăng ký. */
  googleSignupDomains: string[];
}

/** Cài đặt đăng nhập do Quản lý chỉnh. Mặc định tắt và chưa có tên miền nào. */
@Injectable()
export class AuthSettingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async get(db: DbOrTx = this.db): Promise<AuthSettings> {
    const rows = await db.select().from(systemSettings);
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const domains = byKey.get(KEY_DOMAINS);
    return {
      googleSignupEnabled: byKey.get(KEY_ENABLED) === true,
      googleSignupDomains: Array.isArray(domains)
        ? domains.filter((d): d is string => typeof d === 'string')
        : [],
    };
  }

  /** Email này có được tự đăng ký không (công tắc bật VÀ tên miền nằm trong danh sách). */
  async allowsSignup(email: string): Promise<boolean> {
    const s = await this.get();
    if (!s.googleSignupEnabled) return false;
    const domain = email.split('@').pop()?.toLowerCase() ?? '';
    return s.googleSignupDomains.includes(domain);
  }

  async update(
    actorId: string,
    patch: Partial<AuthSettings>,
  ): Promise<AuthSettings> {
    const domains =
      patch.googleSignupDomains === undefined
        ? undefined
        : this.normalizeDomains(patch.googleSignupDomains);
    return this.db.transaction(async (tx) => {
      const before = await this.get(tx);
      const entries: Array<[string, unknown]> = [];
      if (patch.googleSignupEnabled !== undefined)
        entries.push([KEY_ENABLED, patch.googleSignupEnabled]);
      if (domains !== undefined) entries.push([KEY_DOMAINS, domains]);
      for (const [key, value] of entries) {
        await tx
          .insert(systemSettings)
          .values({ key, value, updatedBy: actorId })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value, updatedBy: actorId, updatedAt: new Date() },
          });
      }
      const after = {
        googleSignupEnabled:
          patch.googleSignupEnabled ?? before.googleSignupEnabled,
        googleSignupDomains: domains ?? before.googleSignupDomains,
      };
      if (after.googleSignupEnabled && after.googleSignupDomains.length === 0) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Cần ít nhất một tên miền email trước khi bật tự đăng ký bằng Google',
          [{ field: 'googleSignupDomains', message: 'Chưa có tên miền nào' }],
        );
      }
      await this.audit.record(tx, {
        userId: actorId,
        action: 'settings.auth_update',
        entityType: 'settings',
        entityId: null,
        before,
        after,
      });
      return after;
    });
  }

  private normalizeDomains(input: string[]): string[] {
    const out = new Set<string>();
    for (const raw of input) {
      const d = raw.trim().toLowerCase().replace(/^@/, '');
      if (!DOMAIN_PATTERN.test(d)) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `Tên miền không hợp lệ: ${raw}`,
          [{ field: 'googleSignupDomains', message: `Không hợp lệ: ${raw}` }],
        );
      }
      out.add(d);
    }
    return [...out];
  }
}
