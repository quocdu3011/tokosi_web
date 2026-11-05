import type { Grant, PermissionCatalog, PermissionDef } from '@/lib/api/types';

/**
 * Logic ma trận phân quyền (docs/api/endpoints.md mục 10). Server là nguồn sự thật
 * (PUT trả bộ quyền cuối cùng + `autoAdded`); ở đây chỉ để HIỂN THỊ TRƯỚC cho Quản lý thấy:
 * - Bật một quyền → tự bật các quyền đi kèm (`requires`, đệ quy).
 * - Tắt một quyền → tắt luôn các quyền đang phụ thuộc nó (nếu không server sẽ tự bật lại).
 */
export type Scope = Grant['scope'];
export type GrantMap = Map<string, Scope>;

export function indexCatalog(catalog: PermissionCatalog): Map<string, PermissionDef> {
  const map = new Map<string, PermissionDef>();
  for (const m of catalog.modules) for (const p of m.permissions) map.set(p.code, p);
  return map;
}

export function toGrantMap(grants: Grant[]): GrantMap {
  return new Map(grants.map((g) => [g.code, g.scope]));
}

export function toGrantList(map: GrantMap): Grant[] {
  return [...map.entries()]
    .map(([code, scope]) => ({ code, scope }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** Bật quyền `code` với phạm vi `scope`; trả map mới + danh sách quyền được bật kèm. */
export function enableGrant(
  current: GrantMap,
  code: string,
  scope: Scope,
  defs: Map<string, PermissionDef>,
): { next: GrantMap; added: string[] } {
  const next = new Map(current);
  const added: string[] = [];
  const visit = (c: string, s: Scope, isRoot: boolean) => {
    const def = defs.get(c);
    if (!def || def.lockedToAdmin) return;
    const effective: Scope = def.scopable ? s : 'all';
    if (next.has(c)) {
      // Quyền đi kèm đã bật sẵn thì giữ phạm vi đang có; chỉ quyền gốc mới đổi phạm vi.
      if (isRoot) next.set(c, effective);
    } else {
      next.set(c, effective);
      if (!isRoot) added.push(c);
    }
    for (const r of def.requires) visit(r, s, false);
  };
  visit(code, scope, true);
  return { next, added };
}

/** Tắt quyền `code` và mọi quyền đang bật cần đến nó; trả map mới + danh sách quyền bị tắt kèm. */
export function disableGrant(
  current: GrantMap,
  code: string,
  defs: Map<string, PermissionDef>,
): { next: GrantMap; removed: string[] } {
  const next = new Map(current);
  const removed: string[] = [];
  const visit = (c: string, isRoot: boolean) => {
    if (!next.has(c)) return;
    next.delete(c);
    if (!isRoot) removed.push(c);
    for (const [other] of next) {
      if (defs.get(other)?.requires.includes(c)) visit(other, false);
    }
  };
  visit(code, true);
  return { next, removed };
}

export function sameGrants(a: GrantMap, b: GrantMap): boolean {
  if (a.size !== b.size) return false;
  for (const [code, scope] of a) if (b.get(code) !== scope) return false;
  return true;
}
