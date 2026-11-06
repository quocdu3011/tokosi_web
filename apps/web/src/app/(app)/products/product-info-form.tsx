'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRef, useState, type ReactNode } from 'react';
import { LIQUIDATION_STATUSES, LIQUIDATION_STATUS_LABELS } from '@kiot/shared';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Field } from '@/components/common/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError, errorMessage } from '@/lib/api';
import type { Product, UpdateProductInput } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { applyServerErrors } from '@/lib/forms';
import { can } from '@/lib/permissions';
import { componentsProblem, serializeComponents } from '@/lib/product-components';
import { validateImageFiles } from '@/lib/product-images';
import { useUploadImages } from '@/lib/queries/product-images';
import { useCreateProduct, useUpdateProduct } from '@/lib/queries/products';

import { ComponentEditor, type EditorRow } from './component-editor';

const FIELDS = ['code', 'name', 'productType', 'liquidationStatus', 'description'] as const;

const schema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Nhập mã hàng')
    .max(30, 'Mã hàng tối đa 30 ký tự')
    .regex(/^[A-Za-z0-9._-]+$/, 'Mã chỉ gồm chữ, số và các dấu - _ . (không dấu cách)'),
  name: z.string().trim().min(1, 'Nhập tên hàng').max(255, 'Tên hàng quá dài'),
  productType: z.enum(['goods', 'combo']),
  liquidationStatus: z.enum(LIQUIDATION_STATUSES),
  description: z.string(),
});
type FormValues = z.infer<typeof schema>;

const TYPE_LABELS = { goods: 'Hàng hóa', combo: 'Combo' } as const;

/**
 * Tab "Thông tin": tạo hoặc sửa hàng hóa. Người chỉ có `product.content.edit` chỉ sửa được mô tả
 * (các ô khác bị khóa). Khi tạo, có thể chọn sẵn ảnh để tải lên ngay sau khi lưu hàng (2 bước).
 */
export function ProductInfoForm({
  product,
  onSaved,
  onCancel,
  children,
  summary,
}: {
  /** `null` = tạo mới. */
  product: Product | null;
  /** `imagesFailed`: hàng đã tạo nhưng tải ảnh lỗi → mở tab Ảnh để thử lại. */
  onSaved: (product: Product, opts?: { imagesFailed?: boolean }) => void;
  onCancel: () => void;
  children?: ReactNode;
  summary?: ReactNode;
}) {
  const isNew = product === null;
  const me = useAuthStore((s) => s.user);
  const canAll = can(me, 'product.edit');
  const canContent = canAll || can(me, 'product.content.edit');
  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const uploadImages = useUploadImages();

  const [rows, setRows] = useState<EditorRow[]>(
    () => product?.componentItems.map((c) => ({ code: c.code, name: c.name, qty: c.qty })) ?? [],
  );
  const [componentsError, setComponentsError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [filesError, setFilesError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: product?.code ?? '',
      name: product?.name ?? '',
      productType: product?.productType ?? 'goods',
      liquidationStatus: product?.liquidationStatus ?? 'normal',
      description: product?.description ?? '',
    },
  });
  const productType = useWatch({ control, name: 'productType' });
  const isCombo = productType === 'combo';
  const lockCore = !canAll; // chỉ mô tả sửa được

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setFilesError(picked.length > 0 ? validateImageFiles(0, picked) : null);
    setFiles(picked);
  };

  const onSubmit = handleSubmit(async (v) => {
    setComponentsError(null);
    if (isCombo && !lockCore) {
      const problem = componentsProblem(rows);
      if (problem) {
        setComponentsError(problem);
        return;
      }
    }
    if (filesError) return;
    const description = v.description.trim() === '' ? null : v.description;

    try {
      if (isNew) {
        const created = await createProduct.mutateAsync({
          code: v.code,
          name: v.name,
          productType: v.productType,
          liquidationStatus: v.liquidationStatus,
          components: isCombo ? serializeComponents(rows) : undefined,
          description: description ?? undefined,
        });
        let imagesFailed = false;
        if (files.length > 0) {
          try {
            await uploadImages.mutateAsync({ id: created.id, files });
          } catch (e) {
            imagesFailed = true;
            toast.error(`Đã tạo hàng nhưng tải ảnh lỗi: ${errorMessage(e)}`);
          }
        }
        if (!imagesFailed) toast.success(`Đã tạo hàng ${created.code}`);
        onSaved(created, { imagesFailed });
        return;
      }

      // Sửa: chỉ gửi trường thay đổi. Người chỉ có quyền nội dung chỉ được gửi mô tả.
      const patch: UpdateProductInput = {};
      if ((description ?? null) !== (product.description ?? null)) patch.description = description;
      if (!lockCore) {
        if (v.code !== product.code) patch.code = v.code;
        if (v.name !== product.name) patch.name = v.name;
        if (v.productType !== product.productType) patch.productType = v.productType;
        if (v.liquidationStatus !== product.liquidationStatus)
          patch.liquidationStatus = v.liquidationStatus;
        if (isCombo) {
          const next = serializeComponents(rows);
          if (next !== product.components || v.productType !== product.productType) {
            patch.components = next;
          }
        }
      }
      if (Object.keys(patch).length === 0) {
        toast.message('Không có thay đổi nào để lưu');
        return;
      }
      const saved = await updateProduct.mutateAsync({ id: product.id, patch });
      toast.success('Đã lưu hàng hóa');
      onSaved(saved);
    } catch (e) {
      // `components` không phải ô của biểu mẫu (là bảng riêng) nên lỗi của nó hiện ở bảng.
      const serverComponents =
        e instanceof ApiError && e.fieldErrors.find((fe) => fe.field === 'components');
      if (serverComponents) {
        setComponentsError(serverComponents.message);
        return;
      }
      applyServerErrors(e, setError, FIELDS);
    }
  });

  const err = (name: keyof FormValues) => errors[name]?.message as string | undefined;
  const aria = (name: keyof FormValues) => ({
    'aria-invalid': !!errors[name],
    'aria-describedby': errors[name] ? `pf-${name}-error` : undefined,
  });

  return (
    <form onSubmit={onSubmit} className="product-detail-form" noValidate>
      <div className="product-form-top">
        <div className="form-grid product-form-fields">
          <Field
            id="pf-code"
            label="Mã hàng"
            error={err('code')}
            hint={
              isNew
                ? undefined
                : 'Chỉ đổi được mã khi hàng chưa có giao dịch nào; nếu đã có, hệ thống sẽ từ chối.'
            }
          >
            <Input
              id="pf-code"
              autoComplete="off"
              disabled={lockCore}
              {...aria('code')}
              {...register('code')}
            />
          </Field>
          <Field id="pf-name" label="Tên hàng" error={err('name')}>
            <Input id="pf-name" disabled={lockCore} {...aria('name')} {...register('name')} />
          </Field>

          <Field
            id="pf-liquidationStatus"
            label="Trạng thái thanh lý"
            error={err('liquidationStatus')}
            hint="Phân loại để theo dõi hàng cần xả hoặc ưu tiên bán; không ảnh hưởng tồn kho."
          >
            <Controller
              control={control}
              name="liquidationStatus"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={lockCore}>
                  <SelectTrigger id="pf-liquidationStatus" {...aria('liquidationStatus')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LIQUIDATION_STATUSES.map((st) => (
                      <SelectItem key={st} value={st}>
                        {LIQUIDATION_STATUS_LABELS[st]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          <Field
            id="pf-productType"
            label="Loại hàng"
            error={err('productType')}
            hint="Combo là gói nhiều hàng hóa để chọn nhanh khi lập đơn; chỉ đổi loại được khi hàng chưa có giao dịch."
          >
            <Controller
              control={control}
              name="productType"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} disabled={lockCore}>
                  <SelectTrigger id="pf-productType" {...aria('productType')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>

          <Field
            id="pf-description"
            label="Mô tả"
            error={err('description')}
            hint="Có thể ghi giá bán quy ước chung ở đây (hệ thống không lưu giá bán riêng)."
            className="span-2"
          >
            <textarea
              id="pf-description"
              className="form-input form-textarea product-description-input"
              rows={1}
              disabled={!canContent}
              {...aria('description')}
              {...register('description')}
            />
          </Field>

          {isCombo && (
            <div className="span-2 stack-sm">
              <span className="form-label">Hàng thành phần của combo</span>
              <ComponentEditor
                rows={rows}
                onChange={setRows}
                disabled={lockCore}
                selfCode={product?.code}
              />
              {componentsError && (
                <p className="field-error" role="alert">
                  {componentsError}
                </p>
              )}
            </div>
          )}

          {isNew && (
            <div className="span-2 stack-sm">
              <span className="form-label">Ảnh (tùy chọn)</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Chọn ảnh hàng hóa"
                onChange={(e) => pickFiles(e.target.files)}
              />
              <div className="import-file">
                <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
                  Chọn ảnh
                </Button>
                <span className="import-file-name">
                  {files.length > 0 ? `${files.length} ảnh đã chọn` : 'Chưa chọn ảnh'}
                </span>
              </div>
              {filesError && (
                <p className="field-error" role="alert">
                  {filesError}
                </p>
              )}
            </div>
          )}
        </div>
        {summary}
      </div>
      {children}
      <div className="span-2 form-actions">
        {isNew && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Hủy
          </Button>
        )}
        {canContent && (
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <span className="spinner" aria-hidden="true" />}
            {isNew ? 'Tạo hàng hóa' : 'Lưu thay đổi'}
          </Button>
        )}
      </div>
    </form>
  );
}
