-- Quyền mới return.cancel (hủy phiếu trả hàng bán): cấp cho mọi vai trò đang có invoice.cancel, cùng phạm vi.
INSERT INTO "role_permissions" ("role", "permission_code", "scope")
SELECT "role", 'return.cancel', "scope" FROM "role_permissions" WHERE "permission_code" = 'invoice.cancel'
ON CONFLICT ("role", "permission_code") DO NOTHING;
