'use client';

import { useState } from 'react';
import { CUSTOMER_PRICE_LEVELS, CUSTOMER_SALES_METHODS, DEFAULT_PAGE_SIZE } from '@kiot/shared';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/common/field';
import { FilterSelect } from '@/components/data-table/table-toolbar';
import { QueryError } from '@/components/purchasing/query-feedback';
import { errorMessage } from '@/lib/api';
import type { Customer, CreateCustomerInput } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { customerMonth } from '@/lib/customers';
import { can, scopeOf } from '@/lib/permissions';
import { useSaveCustomer } from '@/lib/queries/customers';
import { useUserList } from '@/lib/queries/users';
import { useDebouncedValue } from '@/hooks/use-debounced-value';

export function CustomerForm({
  customer,
  onClose,
}: {
  customer: Customer | null;
  onClose: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const [level, setLevel] = useState(customer?.priceLevel ?? 'new');
  const [owner, setOwner] = useState(customer?.salesOwner?.id ?? '');
  const [userSearch, setUserSearch] = useState('');
  const userQuery = useDebouncedValue(userSearch.trim(), 300);
  const [selectedOwner, setSelectedOwner] = useState(customer?.salesOwner ?? null);
  const [methods, setMethods] = useState(customer?.profile?.salesMethods ?? []);
  const [error, setError] = useState('');
  const save = useSaveCustomer();
  const canAssign = scopeOf(me, 'customer.edit') === 'all';
  const staff = useUserList(
    { q: userQuery, isActive: true, page: 1, limit: DEFAULT_PAGE_SIZE },
    { enabled: canAssign && can(me, 'user.manage') },
  );
  const ownerOptions = new Map<string, string>();
  if (me) ownerOptions.set(me.id, me.fullName);
  if (customer?.salesOwner) ownerOptions.set(customer.salesOwner.id, customer.salesOwner.fullName);
  if (selectedOwner) ownerOptions.set(selectedOwner.id, selectedOwner.fullName);
  staff.data?.data.forEach((u) => ownerOptions.set(u.id, u.fullName));

  function textField(
    name: string,
    label: string,
    value: string | number | null | undefined,
    maxLength: number,
    type = 'text',
  ) {
    return (
      <Field id={`cf-${name}`} label={label}>
        <Input
          id={`cf-${name}`}
          name={name}
          defaultValue={value ?? ''}
          maxLength={maxLength}
          type={type}
        />
      </Field>
    );
  }
  return (
    <Sheet open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent
        side="right"
        className="purchase-workspace"
        aria-describedby={undefined}
        showCloseButton={!save.isPending}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <SheetTitle>{customer ? `Sửa ${customer.code}` : 'Thêm khách hàng'}</SheetTitle>
        </DialogHeader>
        <form
          className="stack-md"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            const data = new FormData(e.currentTarget);
            const value = (key: string) => String(data.get(key) ?? '').trim();
            const nullable = (key: string) => value(key) || null;
            const input: CreateCustomerInput = {
              name: value('name'),
              phone: nullable('phone'),
              address: nullable('address'),
              priceLevel: level,
              newSince: customerMonth(value('newSince')),
              acquisitionSource: nullable('acquisitionSource'),
              note: nullable('note'),
              ...(canAssign && owner !== (customer?.salesOwner?.id ?? '')
                ? { salesOwnerId: owner || null }
                : {}),
              profile: {
                warehouseLocation: nullable('warehouseLocation'),
                warehouseCount: value('warehouseCount') ? Number(value('warehouseCount')) : null,
                warehouseArea: nullable('warehouseArea'),
                warehousePhotoUrl: nullable('warehousePhotoUrl'),
                competitors: nullable('competitors'),
                scale: nullable('scale'),
                salesMethods: methods as NonNullable<
                  CreateCustomerInput['profile']
                >['salesMethods'],
              },
            };
            if (!input.name) {
              setError('Vui lòng nhập tên khách hàng.');
              return;
            }
            try {
              const result = await save.mutateAsync(
                customer
                  ? { id: customer.id, input }
                  : { input: { ...input, ...(value('code') ? { code: value('code') } : {}) } },
              );
              for (const warning of result.warnings ?? []) toast.warning(warning.message);
              toast.success('Đã lưu khách hàng');
              onClose();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          <fieldset className="fieldset stack-md" disabled={save.isPending}>
            <legend>Thông tin khách hàng</legend>
            {!customer && (
              <Field id="cf-code" label="Mã khách hàng" hint="Bỏ trống để hệ thống tự cấp">
                <Input id="cf-code" name="code" maxLength={30} pattern="[A-Za-z0-9._-]+" />
              </Field>
            )}
            <Field id="cf-name" label="Tên khách hàng">
              <Input
                id="cf-name"
                name="name"
                defaultValue={customer?.name ?? ''}
                required
                maxLength={255}
              />
            </Field>
            {textField('phone', 'Điện thoại', customer?.phone, 50, 'tel')}
            {textField('address', 'Địa chỉ', customer?.address, 500)}
            <Field id="cf-level" label="Level giá" hint="Thông tin tham khảo khi báo giá">
              <FilterSelect
                id="cf-level"
                label="Level giá khách hàng"
                value={level}
                onChange={(v) => setLevel(v as Customer['priceLevel'])}
                options={Object.entries(CUSTOMER_PRICE_LEVELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                disabled={save.isPending}
              />
            </Field>
            {canAssign && (
              <>
                {can(me, 'user.manage') && (
                  <Field id="cf-user-search" label="Tìm nhân viên phụ trách">
                    <Input
                      id="cf-user-search"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Tên hoặc mã nhân viên"
                    />
                  </Field>
                )}
                {staff.isError && <QueryError error={staff.error} retry={staff.refetch} />}
                <Field id="cf-owner" label="Sale phụ trách">
                  <FilterSelect
                    id="cf-owner"
                    label="Chọn nhân viên phụ trách"
                    value={owner}
                    onChange={(value) => {
                      setOwner(value);
                      setSelectedOwner(
                        value ? { id: value, fullName: ownerOptions.get(value) ?? '' } : null,
                      );
                    }}
                    options={[
                      { value: '', label: 'Chưa phân công' },
                      ...Array.from(ownerOptions, ([value, label]) => ({ value, label })),
                    ]}
                    disabled={save.isPending}
                  />
                </Field>
              </>
            )}
            {textField(
              'newSince',
              'Khách mới từ tháng',
              customer?.newSince?.slice(0, 7),
              7,
              'month',
            )}
            {textField('acquisitionSource', 'Nguồn khách', customer?.acquisitionSource, 100)}
            {textField('note', 'Ghi chú', customer?.note, 2000)}
          </fieldset>
          <fieldset className="fieldset stack-md" disabled={save.isPending}>
            <legend>Hồ sơ kinh doanh</legend>
            {textField(
              'warehouseLocation',
              'Định vị kho',
              customer?.profile?.warehouseLocation,
              1000,
            )}
            <Field id="cf-warehouseCount" label="Số kho">
              <Input
                id="cf-warehouseCount"
                name="warehouseCount"
                type="number"
                min={0}
                max={1000}
                step={1}
                defaultValue={customer?.profile?.warehouseCount ?? ''}
              />
            </Field>
            {textField('warehouseArea', 'Diện tích kho', customer?.profile?.warehouseArea, 200)}
            {textField(
              'warehousePhotoUrl',
              'Đường dẫn ảnh kho',
              customer?.profile?.warehousePhotoUrl,
              1000,
              'url',
            )}
            {textField('competitors', 'Đối thủ', customer?.profile?.competitors, 1000)}
            {textField('scale', 'Quy mô', customer?.profile?.scale, 100)}
            <fieldset className="fieldset stack-sm">
              <legend>Hình thức bán hàng</legend>
              {CUSTOMER_SALES_METHODS.map((method) => (
                <label key={method} className="export-column-option">
                  <Checkbox
                    checked={methods.includes(method)}
                    onCheckedChange={(checked) =>
                      setMethods((old) =>
                        checked === true ? [...old, method] : old.filter((m) => m !== method),
                      )
                    }
                  />
                  <span>{method}</span>
                </label>
              ))}
            </fieldset>
          </fieldset>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Đang lưu…' : 'Lưu khách hàng'}
            </Button>
          </DialogFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
