'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DialogHeader, DialogFooter } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Field } from '@/components/common/field';
import type { Supplier } from '@/lib/api/types';
import { errorMessage } from '@/lib/api';
import { useSaveSupplier } from '@/lib/queries/suppliers';

export function SupplierForm({
  supplier,
  onClose,
}: {
  supplier: Supplier | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [code, setCode] = useState('');
  const [group, setGroup] = useState(supplier?.groupName ?? '');
  const [error, setError] = useState('');
  const save = useSaveSupplier();
  return (
    <Sheet open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent
        side="right"
        className="purchase-workspace supplier-workspace"
        aria-describedby={undefined}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <SheetTitle>{supplier ? `Sửa ${supplier.code}` : 'Thêm nhà cung cấp'}</SheetTitle>
        </DialogHeader>
        <form
          className="stack-md"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              const input = { name: name.trim(), groupName: group.trim() || null };
              if (supplier) await save.mutateAsync({ id: supplier.id, input });
              else
                await save.mutateAsync({
                  input: { ...input, ...(code.trim() ? { code: code.trim() } : {}) },
                });
              toast.success('Đã lưu nhà cung cấp');
              onClose();
            } catch (err) {
              setError(errorMessage(err));
            }
          }}
        >
          {!supplier && (
            <Field id="supplier-code" label="Mã nhà cung cấp" hint="Bỏ trống để hệ thống tự cấp">
              <Input
                id="supplier-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={30}
                pattern="[A-Za-z0-9._-]+"
                disabled={save.isPending}
              />
            </Field>
          )}
          <Field id="supplier-name" label="Tên nhà cung cấp">
            <Input
              id="supplier-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
              disabled={save.isPending}
            />
          </Field>
          <Field id="supplier-group" label="Nhóm nhà cung cấp">
            <Input
              id="supplier-group"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              maxLength={255}
              disabled={save.isPending}
            />
          </Field>
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()}>
              {save.isPending ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </DialogFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
