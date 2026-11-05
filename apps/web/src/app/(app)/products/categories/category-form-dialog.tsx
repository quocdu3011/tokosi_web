'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isApiError } from '@/lib/api';
import type { CategoryNode, UpdateCategoryInput } from '@/lib/api/types';
import { findCategory, parentOptions } from '@/lib/categories';
import { applyServerErrors } from '@/lib/forms';
import { useCreateCategory, useUpdateCategory } from '@/lib/queries/categories';

export type CategoryFormMode =
  { kind: 'create'; parentId: string | null } | { kind: 'edit'; node: CategoryNode };

const ROOT = '__root__';
const FIELDS = ['name', 'parentId'] as const;

const schema = z.object({
  name: z.string().trim().min(1, 'Nhập tên nhóm').max(100, 'Tên nhóm tối đa 100 ký tự'),
  parentId: z.string(),
});
type FormValues = z.infer<typeof schema>;

/** Tạo nhóm mới hoặc đổi tên / chuyển nhóm cha. Danh sách nhóm cha đã loại các lựa chọn vượt 3 cấp. */
export function CategoryFormDialog({
  mode,
  tree,
  onClose,
}: {
  mode: CategoryFormMode;
  tree: CategoryNode[];
  onClose: () => void;
}) {
  const editing = mode.kind === 'edit' ? mode.node : null;
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const options = parentOptions(tree, editing);
  const initialParent = editing
    ? (editing.parentId ?? ROOT)
    : mode.kind === 'create'
      ? (mode.parentId ?? ROOT)
      : ROOT;

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: editing?.name ?? '', parentId: initialParent },
  });

  const onSubmit = handleSubmit(async (v) => {
    const parentId = v.parentId === ROOT ? null : v.parentId;
    try {
      if (editing) {
        const patch: UpdateCategoryInput = {};
        if (v.name !== editing.name) patch.name = v.name;
        if (parentId !== editing.parentId) patch.parentId = parentId;
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        await updateCategory.mutateAsync({ id: editing.id, patch });
        toast.success('Đã lưu nhóm hàng');
      } else {
        await createCategory.mutateAsync({ name: v.name, parentId: parentId ?? undefined });
        toast.success(`Đã tạo nhóm ${v.name}`);
      }
      onClose();
    } catch (e) {
      if (isApiError(e, 'DUPLICATE_NAME')) {
        setError('name', { type: 'server', message: e.message });
        return;
      }
      applyServerErrors(e, setError, FIELDS);
    }
  });

  const parentLabel =
    initialParent === ROOT ? 'Nhóm gốc' : (findCategory(tree, initialParent)?.name ?? '');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="modal-form">
        <DialogHeader>
          <DialogTitle>{editing ? `Sửa nhóm ${editing.name}` : 'Thêm nhóm hàng'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Nhóm không bị xóa; chỉ đổi tên hoặc chuyển sang nhóm cha khác.'
              : `Sẽ tạo trong: ${parentLabel}.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="form-grid" noValidate>
          <Field id="cf-name" label="Tên nhóm" error={errors.name?.message} className="span-2">
            <Input
              id="cf-name"
              autoFocus
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'cf-name-error' : undefined}
              {...register('name')}
            />
          </Field>
          <Field
            id="cf-parent"
            label="Nhóm cha"
            error={errors.parentId?.message}
            hint="Cây tối đa 3 cấp nên chỉ hiện các nhóm cha còn phù hợp."
            className="span-2"
          >
            <Controller
              control={control}
              name="parentId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="cf-parent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ROOT}>Nhóm gốc (không có nhóm cha)</SelectItem>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {'  '.repeat(o.level - 1)}
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <DialogFooter className="span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Hủy
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <span className="spinner" aria-hidden="true" />}
              {editing ? 'Lưu' : 'Tạo nhóm'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
