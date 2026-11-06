/**
 * Kéo hàng hóa + nhóm hàng + tồn kho từ API công khai KiotViet và ghi ra file .xlsx theo đúng tiêu đề file KiotViet,
 * để nhập bằng chính bộ Import hiện có (Hàng hóa → Import, chế độ "Thêm", chọn chi nhánh) — có chạy thử, nhật ký thao
 * tác và ghi tồn qua InventoryService. Công cụ chỉ ĐỌC từ KiotViet và KHÔNG chạm CSDL.
 *
 * Chạy:  pnpm --filter @kiot/api kiotviet:pull -- --out E:\Web\Data\kiotviet-api-hang-hoa.xlsx [--branch <id chi nhánh KiotViet>]
 * Cần biến môi trường (hoặc trong apps/api/.env, đã bị Git bỏ qua): KIOTVIET_CLIENT_ID, KIOTVIET_CLIENT_SECRET,
 * KIOTVIET_RETAILER (mã cửa hàng). Không bao giờ commit các giá trị này.
 *
 * File đầu ra là DỮ LIỆU THẬT: phải nằm NGOÀI repo (công cụ từ chối ghi vào trong repo).
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { writeSheet } from '../../common/excel.js';
import {
  PRODUCT_COLUMNS,
  buildCategoryPaths,
  mapProducts,
  type KvCategory,
  type KvProduct,
} from './mapper.js';

const TOKEN_URL = 'https://id.kiotviet.vn/connect/token';
const API_URL = 'https://public.kiotapi.com';
const PAGE_SIZE = 100;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Thiếu biến môi trường ${name}`);
    process.exit(2);
  }
  return v;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Thư mục gốc repo (có pnpm-workspace.yaml), để chặn ghi dữ liệu thật vào trong repo. */
function repoRoot(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

class KiotVietClient {
  private token = '';
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly retailer: string,
  ) {}

  private async login(): Promise<void> {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        scopes: 'PublicApi.Access',
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });
    if (!res.ok) throw new Error(`Đăng nhập KiotViet thất bại (${res.status})`);
    this.token = ((await res.json()) as { access_token: string }).access_token;
  }

  /** GET có thử lại: 401 → lấy token mới một lần; 429/5xx → chờ rồi thử lại tối đa 5 lần. */
  async get<T>(path: string): Promise<T> {
    if (!this.token) await this.login();
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${API_URL}${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Retailer: this.retailer,
        },
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.login();
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 5) {
        const wait = Number(res.headers.get('retry-after')) || 2 ** attempt;
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      throw new Error(`GET ${path.split('?')[0]} → ${res.status}`);
    }
  }

  async all<T>(path: string, query = ''): Promise<T[]> {
    const out: T[] = [];
    for (;;) {
      const page = await this.get<{ data: T[]; total: number }>(
        `${path}?pageSize=${PAGE_SIZE}&currentItem=${out.length}${query}`,
      );
      out.push(...page.data);
      if (page.data.length === 0 || out.length >= page.total) return out;
    }
  }
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile?.(resolve(import.meta.dirname, '../../../.env'));
  } catch {
    // không có apps/api/.env: dùng biến môi trường sẵn có
  }
  const outArg = arg('out');
  if (!outArg) {
    console.error('Thiếu --out <đường dẫn file .xlsx> (đặt NGOÀI repo)');
    process.exit(2);
  }
  const out = resolve(process.env.INIT_CWD ?? process.cwd(), outArg);
  const root = repoRoot(process.env.INIT_CWD ?? process.cwd());
  if (root) {
    const rel = relative(root, out);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      console.error(
        `Từ chối: ${out} nằm trong repo. Dữ liệu thật phải để ngoài repo (vd E:\\Web\\Data).`,
      );
      process.exit(2);
    }
  }

  const kv = new KiotVietClient(
    need('KIOTVIET_CLIENT_ID'),
    need('KIOTVIET_CLIENT_SECRET'),
    need('KIOTVIET_RETAILER'),
  );

  const branches = await kv.all<{ id: number; branchName: string }>(
    '/branches',
  );
  const wanted = arg('branch');
  const branch = wanted
    ? branches.find((b) => String(b.id) === wanted)
    : branches.length === 1
      ? branches[0]
      : undefined;
  if (!branch) {
    console.error(
      'Cần chọn chi nhánh KiotViet bằng --branch <id>. Các chi nhánh:\n' +
        branches.map((b) => `  ${b.id}  ${b.branchName}`).join('\n'),
    );
    process.exit(2);
  }
  console.log(`Chi nhánh KiotViet: ${branch.branchName} (${branch.id})`);

  const cats = await kv.all<KvCategory>('/categories');
  console.log(`Nhóm hàng: ${cats.length}`);
  const products = await kv.all<KvProduct>(
    '/products',
    '&includeInventory=true',
  );
  console.log(`Hàng hóa: ${products.length}`);

  const report = mapProducts(products, {
    branchId: branch.id,
    categoryPaths: buildCategoryPaths(cats),
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await writeSheet('Hàng hóa', PRODUCT_COLUMNS, report.rows));

  const withStock = report.rows.filter((r) => r[4] !== null).length;
  console.log(`\nĐã ghi ${report.rows.length} dòng → ${out}`);
  console.log(`  có tồn kho: ${withStock} dòng`);
  if (report.negativeStock)
    console.log(`  tồn âm ở KiotViet (không nhập tồn): ${report.negativeStock}`);
  if (report.imagesTrimmed)
    console.log(`  cắt bớt ảnh quá 10 ảnh: ${report.imagesTrimmed} hàng`);
  if (report.skipped.length > 0) {
    console.log(`\nBỎ QUA ${report.skipped.length} hàng (không sửa mã tự động):`);
    for (const s of report.skipped) console.log(`  ${s.reason}: "${s.code}"`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
