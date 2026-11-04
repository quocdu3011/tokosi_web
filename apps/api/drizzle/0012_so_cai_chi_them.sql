-- Sổ cái chỉ-thêm do CSDL ép (không chỉ là quy ước trong mã).
-- stock_movements, debt_ledger: cấm UPDATE, DELETE, TRUNCATE. Muốn điều chỉnh hãy THÊM bút toán đảo.
-- cash_transactions: cấm DELETE, TRUNCATE; UPDATE chỉ cho phép (a) hủy phiếu (completed -> cancelled kèm
--   cancelled_at, cancel_reason) và (b) sửa ghi chú; mọi trường tiền/đối tượng/thời điểm là bất biến, và phiếu đã
--   hủy không sửa nữa.
-- Lưu ý: người có quyền chủ bảng/siêu quản trị vẫn có thể ALTER TABLE ... DISABLE TRIGGER; lớp này chặn mã viết sai
--   và câu SQL sửa tay vô ý, không chặn người cố tình. Mọi lần tắt phải được ghi nhận và có người duyệt.
CREATE FUNCTION "forbid_ledger_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Bảng % là sổ cái chỉ-thêm: không được % bản ghi. Muốn điều chỉnh hãy thêm bút toán đảo.',
    TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'LG001';
END;
$$;--> statement-breakpoint
CREATE FUNCTION "guard_cash_transaction_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Phiếu quỹ % đã hủy, không được sửa nữa.', OLD.code USING ERRCODE = 'LG001';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status', 'cancelled_at', 'cancel_reason', 'note', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'cancelled_at', 'cancel_reason', 'note', 'updated_at']) THEN
    RAISE EXCEPTION 'Phiếu quỹ % chỉ được hủy hoặc sửa ghi chú; không được đổi số tiền, quỹ, danh mục, đối tượng hay thời điểm.', OLD.code
      USING ERRCODE = 'LG001';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();--> statement-breakpoint
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_ledger_change"();--> statement-breakpoint
CREATE TRIGGER "debt_ledger_append_only" BEFORE UPDATE OR DELETE ON "debt_ledger" FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();--> statement-breakpoint
CREATE TRIGGER "debt_ledger_no_truncate" BEFORE TRUNCATE ON "debt_ledger" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_ledger_change"();--> statement-breakpoint
CREATE TRIGGER "cash_transactions_no_delete" BEFORE DELETE ON "cash_transactions" FOR EACH ROW EXECUTE FUNCTION "forbid_ledger_change"();--> statement-breakpoint
CREATE TRIGGER "cash_transactions_guard_update" BEFORE UPDATE ON "cash_transactions" FOR EACH ROW EXECUTE FUNCTION "guard_cash_transaction_update"();--> statement-breakpoint
CREATE TRIGGER "cash_transactions_no_truncate" BEFORE TRUNCATE ON "cash_transactions" FOR EACH STATEMENT EXECUTE FUNCTION "forbid_ledger_change"();
