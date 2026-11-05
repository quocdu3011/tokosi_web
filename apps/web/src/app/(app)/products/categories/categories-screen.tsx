'use client';

import { FolderPlus, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { PageHeader } from '@/components/common/coming-soon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/api';
import type { CategoryNode } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { MAX_CATEGORY_DEPTH } from '@/lib/categories';
import { can } from '@/lib/permissions';
import { useCategories } from '@/lib/queries/products';

import { CategoryFormDialog, type CategoryFormMode } from './category-form-dialog';

/** Cây nhóm hàng (tối đa 3 cấp). Không có thao tác xóa: nhóm chỉ đổi tên hoặc chuyển nhóm cha. */
export function CategoriesScreen() {
  const me = useAuthStore((s) => s.user);
  const canEdit = can(me, 'product.edit');
  const { data: tree, isLoading, isError, error } = useCategories();
  const [dialog, setDialog] = useState<CategoryFormMode | null>(null);

  return (
    <div className="page">
      <PageHeader
        title="Nhóm hàng"
        description="Cây nhóm hàng tối đa 3 cấp. Số hàng của nhóm cha đã gồm hàng của các nhóm con."
        actions={
          canEdit ? (
            <Button onClick={() => setDialog({ kind: 'create', parentId: null })}>
              <Plus aria-hidden="true" /> Thêm nhóm gốc
            </Button>
          ) : undefined
        }
      />

      {isError ? (
        <p className="alert alert-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : isLoading ? (
        <Skeleton className="skeleton-block" />
      ) : !tree || tree.length === 0 ? (
        <div className="empty-state">
          <FolderPlus aria-hidden="true" />
          <h2>Chưa có nhóm hàng nào</h2>
          {canEdit && <p>Bấm &quot;Thêm nhóm gốc&quot; để tạo nhóm đầu tiên.</p>}
        </div>
      ) : (
        <ul className="tree" aria-label="Cây nhóm hàng">
          {tree.map((n) => (
            <TreeNode key={n.id} node={n} level={1} canEdit={canEdit} onAction={setDialog} />
          ))}
        </ul>
      )}

      {dialog && tree && (
        <CategoryFormDialog mode={dialog} tree={tree} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function TreeNode({
  node,
  level,
  canEdit,
  onAction,
}: {
  node: CategoryNode;
  level: number;
  canEdit: boolean;
  onAction: (mode: CategoryFormMode) => void;
}) {
  return (
    <li>
      <div className="tree-row">
        <span className="tree-name">{node.name}</span>
        <Badge variant="secondary">{node.productCount.toLocaleString('vi-VN')} hàng</Badge>
        {canEdit && (
          <span className="tree-actions">
            {level < MAX_CATEGORY_DEPTH && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAction({ kind: 'create', parentId: node.id })}
                aria-label={`Thêm nhóm con cho ${node.name}`}
              >
                <FolderPlus aria-hidden="true" /> Thêm nhóm con
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAction({ kind: 'edit', node })}
              aria-label={`Sửa nhóm ${node.name}`}
            >
              <Pencil aria-hidden="true" /> Sửa
            </Button>
          </span>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <TreeNode key={c.id} node={c} level={level + 1} canEdit={canEdit} onAction={onAction} />
          ))}
        </ul>
      )}
    </li>
  );
}
