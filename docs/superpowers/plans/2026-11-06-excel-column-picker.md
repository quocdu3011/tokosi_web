# Excel column picker

**Approved design:** The product Excel export opens a checkbox dialog without search. Select all and Default restore all currently permitted export columns. Show the selected count, disable export with zero columns, preserve filters and cost permissions, and export only checked columns in the existing order. Use existing dialog, button and checkbox components, with two columns on desktop and one on mobile.

**Goal:** Choose product Excel columns before download.

**Architecture:** Share column identifiers and labels between API and web. Send a comma-separated `columns` query parameter; validate it on the API and project both headers and row values after applying permissions. Keep existing output when `columns` is omitted.

**Tech stack:** Next.js client components, Radix Dialog/Checkbox, NestJS DTO validation, ExcelJS, Vitest.

## Tasks

- [x] Add HTTP regression cases in `apps/api/src/modules/imports/imports.http.spec.ts`: selected headers and correctly aligned numeric values, malformed/empty selection, and attempted cost export without permission. Run these tests before implementation.
- [x] Add shared column definitions in `packages/shared/src/product-export.ts`, export through `index.ts`, validate `columns` in the products DTO, and select permitted columns in `ProductsService.exportXlsx`. Reject selections with no permitted columns.
- [x] Move `ExportMenu` to a focused `export-menu.tsx` component and re-export from toolbar. Render the approved dialog, guard duplicate submits, keep failures open, and close after success. Pass options filtered by cost permission from products screen; forward checked IDs through `downloadProductsXlsx`.
- [x] Add responsive styles to existing modal CSS. Regenerate OpenAPI and frontend types; document the query parameter.
- [x] Run targeted HTTP tests, web tests, type checks and lint; inspect the dialog in a browser if available. Review only task changes and leave existing unrelated edits intact.

## Verification

- API import/export HTTP suite: 19 passed, including selected columns, numeric values, invalid selections and cost permissions. The two new positive selection cases failed before implementation because `columns` was not supported.
- Web suite: 87 passed. Web/API type checks and targeted ESLint/oxlint passed. Prettier passed for changed source files.
- Browser: dialog displayed without search; checked counts, zero-selection disabled export, Default and Select all. Exported a file with Description unchecked; ExcelJS readback confirmed exactly 11 columns and 4,091 data rows, with no Description header. The dialog closed after download.
- Layout uses the existing design tokens and a one-column grid below 640px; mobile viewport was not separately exercised.
