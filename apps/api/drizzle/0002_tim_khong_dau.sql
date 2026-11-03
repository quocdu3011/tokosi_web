-- Tìm kiếm không phân biệt dấu / hoa thường (tiếng Việt).
-- unaccent() chỉ là STABLE nên không dùng được trong chỉ mục; bọc lại thành hàm IMMUTABLE.
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;--> statement-breakpoint
-- Chuẩn hóa chuỗi để so khớp: bỏ dấu + chữ thường. "Đèn Lồng" -> "den long".
CREATE OR REPLACE FUNCTION f_search_text(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT lower(public.f_unaccent($1)) $$;
