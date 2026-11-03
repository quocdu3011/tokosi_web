import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Grant, PermissionCode, Role } from '@kiot/shared';
import type { AppRequest } from '../../common/auth-user.js';
import { PermissionGuard } from './permission.guard.js';
import type { PermissionsService } from './permissions.service.js';
import { RequirePermission } from './require-permission.decorator.js';

class Sample {
  @RequirePermission('invoice.create')
  create(this: void) {}

  @RequirePermission('invoice.create', 'cash.create')
  both(this: void) {}

  open(this: void) {}
}

function setup(grantsByRole: Partial<Record<Role, Grant[]>>) {
  const service = {
    getGrant: (role: Role, code: PermissionCode) =>
      Promise.resolve(grantsByRole[role]?.find((g) => g.code === code)),
  } as unknown as PermissionsService;
  const guard = new PermissionGuard(new Reflector(), service);
  const contextFor = (handler: () => void, request: Partial<AppRequest>) =>
    ({
      getHandler: () => handler,
      getClass: () => Sample,
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;
  return { guard, contextFor };
}

describe('PermissionGuard', () => {
  const proto = Sample.prototype;

  it('endpoint không gắn quyền thì cho qua, kể cả chưa đăng nhập', async () => {
    const { guard, contextFor } = setup({});
    await expect(guard.canActivate(contextFor(proto.open, {}))).resolves.toBe(
      true,
    );
  });

  it('chưa đăng nhập → 401 UNAUTHENTICATED', async () => {
    const { guard, contextFor } = setup({});
    await expect(
      guard.canActivate(contextFor(proto.create, {})),
    ).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('thiếu quyền → 403 FORBIDDEN kèm tên quyền', async () => {
    const { guard, contextFor } = setup({ sales: [] });
    const req = { user: { id: 'u1', role: 'sales' as Role } };
    await expect(
      guard.canActivate(contextFor(proto.create, req)),
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      response: { details: { permission: 'invoice.create' } },
    });
  });

  it('đủ quyền → cho qua và gắn phạm vi vào request', async () => {
    const { guard, contextFor } = setup({
      sales: [{ code: 'invoice.create', scope: 'own' }],
    });
    const req: Partial<AppRequest> = { user: { id: 'u1', role: 'sales' } };
    await expect(
      guard.canActivate(contextFor(proto.create, req)),
    ).resolves.toBe(true);
    expect(req.grants).toEqual({ 'invoice.create': 'own' });
  });

  it('yêu cầu nhiều quyền thì phải có ĐỦ tất cả', async () => {
    const { guard, contextFor } = setup({
      sales: [{ code: 'invoice.create', scope: 'all' }],
      accountant: [
        { code: 'invoice.create', scope: 'all' },
        { code: 'cash.create', scope: 'all' },
      ],
    });
    await expect(
      guard.canActivate(
        contextFor(proto.both, { user: { id: 'u1', role: 'sales' } }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      guard.canActivate(
        contextFor(proto.both, { user: { id: 'u2', role: 'accountant' } }),
      ),
    ).resolves.toBe(true);
  });
});
