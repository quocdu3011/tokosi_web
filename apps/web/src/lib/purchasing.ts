import type {
  CreateGoodsReceiptInput,
  CreatePurchaseOrderInput,
  CreatePurchaseReturnInput,
  Product,
  PurchaseDocument,
} from '@/lib/api/types';

export type PurchaseKind = 'orders' | 'receipts' | 'returns';
export const PURCHASE_CONFIG = {
  orders: { path: '/purchase-orders', title: 'Đặt hàng nhập', date: 'orderedAt' },
  receipts: { path: '/goods-receipts', title: 'Nhập hàng', date: 'receivedAt' },
  returns: { path: '/purchase-returns', title: 'Trả hàng nhập', date: 'returnedAt' },
} as const;
export const PURCHASE_STATUS = {
  draft: 'Phiếu tạm',
  confirmed: 'Đã xác nhận NCC',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
};
export const RECEIVE_STATUS = { none: 'Chưa nhập', partial: 'Nhập một phần', full: 'Đã nhập đủ' };

export interface PurchaseRow {
  productId: string;
  code: string;
  name: string;
  qty: string;
  unitCost: string;
}
export interface PurchaseDraft {
  supplierId: string;
  note: string;
  date: string;
  referenceId: string;
  status: 'draft' | 'confirmed';
  items: PurchaseRow[];
}

// Dùng số nguyên tỷ lệ cho số lượng, tránh mất chính xác khi tách combo/gộp dòng.
const SCALE = BigInt(10000);
function scaled(value: string): bigint {
  if (!/^-?\d+(\.\d{1,4})?$/.test(value)) throw new Error('Số thập phân không hợp lệ');
  const negative = value.startsWith('-');
  const [whole = '0', fraction = ''] = value.replace(/^-/, '').split('.');
  return (
    (negative ? BigInt(-1) : BigInt(1)) * (BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0')))
  );
}
function unscaled(value: bigint): string {
  const abs = value < BigInt(0) ? -value : value;
  const fraction = (abs % SCALE).toString().padStart(4, '0').replace(/0+$/, '');
  return `${value < BigInt(0) ? '-' : ''}${abs / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function decimalAdd(a: string, b: string) {
  return unscaled(scaled(a) + scaled(b));
}
export function decimalSubtract(a: string, b: string) {
  return unscaled(scaled(a) - scaled(b));
}

export function expandProduct(
  product: Pick<Product, 'productType' | 'componentItems'> &
    Partial<Pick<Product, 'id' | 'code' | 'name' | 'lastPurchasePrice'>>,
  qty = '1',
): PurchaseRow[] {
  if (product.productType === 'combo')
    return product.componentItems.map((item) => ({
      productId: item.productId,
      code: item.code,
      name: item.name,
      qty: unscaled(scaled(qty) * BigInt(item.qty)),
      unitCost: '0',
    }));
  if (!product.id || !product.code || !product.name) throw new Error('Thiếu thông tin hàng hóa');
  return [
    {
      productId: product.id,
      code: product.code,
      name: product.name,
      qty,
      unitCost: product.lastPurchasePrice ?? '0',
    },
  ];
}
export function mergePurchaseRows(rows: PurchaseRow[], added: PurchaseRow[]): PurchaseRow[] {
  const result = rows.map((r) => ({ ...r }));
  for (const row of added) {
    const existing = result.find((r) => r.productId === row.productId);
    if (existing) existing.qty = decimalAdd(existing.qty || '0', row.qty);
    else result.push(row);
  }
  return result;
}
export function buildPurchaseInput(
  kind: PurchaseKind,
  draft: PurchaseDraft,
): CreatePurchaseOrderInput | CreateGoodsReceiptInput | CreatePurchaseReturnInput {
  const base = { supplierId: draft.supplierId, note: draft.note };
  const date = draft.date ? new Date(`${draft.date}:00+07:00`).toISOString() : undefined;
  if (kind === 'returns')
    return {
      ...base,
      ...(date ? { returnedAt: date } : {}),
      ...(draft.referenceId ? { goodsReceiptId: draft.referenceId } : {}),
      items: draft.items.map((r) => ({
        productId: r.productId,
        qty: r.qty,
        returnPrice: r.unitCost,
      })),
    };
  const items = draft.items.map((r) => ({
    productId: r.productId,
    qty: r.qty,
    unitCost: r.unitCost,
  }));
  if (kind === 'orders')
    return { ...base, ...(date ? { orderedAt: date } : {}), status: draft.status, items };
  return {
    ...base,
    ...(date ? { receivedAt: date } : {}),
    ...(draft.referenceId ? { purchaseOrderId: draft.referenceId } : {}),
    items,
  };
}
export function purchaseActions(
  kind: PurchaseKind,
  doc: { status: PurchaseDocument['status']; receipts?: { id: string; code: string }[] },
) {
  const open = doc.status === 'draft' || doc.status === 'confirmed';
  const received = !!doc.receipts?.length;
  return {
    edit: kind === 'orders' ? open && !received : doc.status === 'completed',
    confirm: kind === 'orders' && doc.status === 'draft',
    complete: kind === 'orders' && open && received,
    cancel: kind === 'orders' ? open && !received : doc.status === 'completed',
  };
}
export function documentDate(doc: PurchaseDocument) {
  return 'orderedAt' in doc ? doc.orderedAt : 'receivedAt' in doc ? doc.receivedAt : doc.returnedAt;
}
