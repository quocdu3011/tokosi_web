import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

/** Token inject cho kết nối pg (Pool). */
export const PG_POOL = Symbol('PG_POOL');
/** Token inject cho Drizzle: `@Inject(DB) private readonly db: Database`. */
export const DB = Symbol('DB');

/** Số nguyên dương từ biến môi trường, sai thì ném lỗi rõ ràng. */
function envInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `Biến môi trường ${name} phải là số nguyên dương (đang là "${raw}")`,
    );
  }
  return n;
}

/**
 * Cấu hình kết nối PostgreSQL. Có giới hạn thời gian để một truy vấn treo hoặc một transaction bị bỏ quên KHÔNG
 * giữ khóa dòng (tồn kho, giá) vô thời hạn:
 *  - statement_timeout: truy vấn quá lâu bị hủy (mặc định 30 giây; nhập 2.800 hàng mất ~4 giây);
 *  - idle_in_transaction_session_timeout: transaction mở mà không làm gì bị hủy (mặc định 30 giây).
 * `application_name` giúp nhận diện kết nối của API trong `pg_stat_activity`.
 */
export function buildPoolConfig(
  env: NodeJS.ProcessEnv = process.env,
): PoolConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'Thiếu biến môi trường DATABASE_URL (xem apps/api/.env.example)',
    );
  }
  return {
    connectionString,
    max: envInt(env, 'DB_POOL_MAX', 10),
    connectionTimeoutMillis: envInt(env, 'DB_CONNECT_TIMEOUT_MS', 10_000),
    idleTimeoutMillis: 30_000,
    statement_timeout: envInt(env, 'DB_STATEMENT_TIMEOUT_MS', 30_000),
    idle_in_transaction_session_timeout: envInt(
      env,
      'DB_IDLE_TX_TIMEOUT_MS',
      30_000,
    ),
    application_name: 'kiot-api',
  };
}

export type Database = NodePgDatabase<typeof schema>;
/** Transaction của Drizzle (tham số của callback trong `db.transaction`). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Kết nối thường hoặc transaction: dùng cho hàm chạy được ở cả hai nơi. */
export type DbOrTx = Database | Tx;

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      // Pool chỉ kết nối khi có truy vấn đầu tiên.
      useFactory: (): Pool => new Pool(buildPoolConfig()),
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: Pool): Database =>
        drizzle({ client: pool, schema, casing: 'snake_case' }),
    },
  ],
  exports: [DB, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
