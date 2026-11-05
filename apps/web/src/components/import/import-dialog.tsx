'use client';

import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api';
import type { ImportJob } from '@/lib/api/types';
import { useAuthStore } from '@/lib/auth/store';
import { useBranchStore } from '@/lib/branch';
import {
  IMPORT_MODE_LABELS,
  IMPORT_TYPES,
  importOutcome,
  isModeSupported,
  summarizeImport,
  validateImportFile,
  type ImportMode,
  type ImportType,
} from '@/lib/imports';
import { downloadImportTemplate, useRunImport } from '@/lib/queries/imports';
import { saveBlob } from '@/lib/table-export';

const MODES: ImportMode[] = ['overwrite', 'add'];
/** Hiện tối đa bấy nhiêu dòng lỗi trong hộp thoại (API trả tối đa 500). */
const MAX_ERRORS_SHOWN = 50;

/**
 * Nhập dữ liệu từ Excel theo 2 chế độ (Import đè / Import thêm). Luôn KIỂM TRA trước (dryRun) rồi mới
 * cho nhập thật, vì API "tất cả hoặc không gì cả": có dòng lỗi thì không ghi gì.
 * Đổi file hoặc đổi chế độ thì kết quả kiểm tra cũ bị bỏ, phải kiểm tra lại.
 */
export function ImportDialog({ type, onClose }: { type: ImportType; onClose: () => void }) {
  const config = IMPORT_TYPES[type];
  const branchId = useBranchStore((s) => s.branchId);
  const branchName = useAuthStore((s) => s.user?.branches.find((b) => b.id === branchId)?.name);
  const mutation = useRunImport();
  const inputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<ImportMode>('overwrite');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checked, setChecked] = useState<ImportJob | null>(null);
  const [downloading, setDownloading] = useState(false);

  const busy = mutation.isPending;
  const checkedOk = checked !== null && importOutcome(checked) === 'ok';
  const missingBranch = config.needsBranch && !branchId;

  const resetResult = () => {
    setChecked(null);
    mutation.reset();
  };

  const pickFile = (next: File | null) => {
    resetResult();
    setFileError(next ? validateImportFile(next) : null);
    setFile(next);
  };

  const run = async (dryRun: boolean) => {
    if (!file || fileError || missingBranch) return;
    try {
      const job = await mutation.mutateAsync({ type, mode, file, dryRun, branchId });
      if (dryRun) {
        setChecked(job);
        return;
      }
      if (importOutcome(job) === 'ok') {
        toast.success(`Đã nhập ${config.label}: ${summarizeImport(job)}`);
        onClose();
      } else {
        // Nhập thật nhưng phát sinh lỗi: API không ghi gì, giữ hộp thoại để người dùng xem lỗi.
        setChecked(job);
        toast.error('Không có gì được ghi. Sửa các dòng lỗi rồi nhập lại.');
      }
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const downloadTemplate = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await downloadImportTemplate(type);
      saveBlob(blob, filename ?? config.templateFilename);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="modal-form" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Nhập {config.label} từ Excel</DialogTitle>
          <DialogDescription>
            File phải đúng định dạng file mẫu. Hệ thống kiểm tra trước; chỉ khi không có dòng lỗi
            mới cho nhập thật. Dữ liệu không bao giờ bị xóa khi nhập.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="fieldset" disabled={busy}>
          <legend>Chế độ nhập</legend>
          <div className="radio-cards">
            {MODES.map((m) => {
              const supported = isModeSupported(type, m);
              const info = IMPORT_MODE_LABELS[m];
              return (
                <label
                  key={m}
                  className="radio-card"
                  data-checked={mode === m}
                  data-disabled={!supported}
                >
                  <input
                    type="radio"
                    name="import-mode"
                    value={m}
                    checked={mode === m}
                    disabled={!supported}
                    onChange={() => {
                      resetResult();
                      setMode(m);
                    }}
                  />
                  <span className="radio-card-title">{info.title}</span>
                  <span className="radio-card-desc">
                    {info.description}
                    {!supported && ' Tính năng này đang chờ hệ thống hỗ trợ.'}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="stack-sm">
          <div className="import-file">
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              aria-label="Chọn file Excel"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Upload aria-hidden="true" /> {file ? 'Chọn file khác' : 'Chọn file .xlsx'}
            </Button>
            <span className="import-file-name" title={file?.name}>
              {file ? (
                <>
                  <FileSpreadsheet aria-hidden="true" /> {file.name}
                </>
              ) : (
                'Chưa chọn file'
              )}
            </span>
            <Button variant="ghost" onClick={downloadTemplate} disabled={busy || downloading}>
              <Download aria-hidden="true" /> {downloading ? 'Đang tải…' : 'Tải file mẫu'}
            </Button>
          </div>
          {fileError && (
            <p className="field-error" role="alert">
              {fileError}
            </p>
          )}
          {missingBranch && (
            <p className="field-error" role="alert">
              Chưa chọn chi nhánh làm việc nên chưa thể nhập.
            </p>
          )}
        </div>

        {mode === 'add' && (
          <div className="alert alert-warning" role="note">
            <strong>Import thêm làm đổi tồn kho của {branchName ?? 'chi nhánh đang chọn'}.</strong>
            <ul className="import-notes">
              <li>
                Cột &quot;Tồn kho&quot; được CỘNG vào tồn hiện có; số âm là TRỪ (không xuống dưới
                0).
              </li>
              <li>
                Cột &quot;Giá vốn&quot; (nếu có) là giá nhập của lô cộng thêm; thiếu thì giữ giá vốn
                hiện tại.
              </li>
              <li>
                Hàng đã có chỉ đổi tồn, mọi thông tin khác giữ nguyên; mã mới được tạo (cần tên
                hàng).
              </li>
              <li>
                <strong>Chạy lại cùng file sẽ cộng thêm lần nữa.</strong> Hãy bấm &quot;Kiểm tra
                file&quot; rồi nhập đúng một lần.
              </li>
            </ul>
          </div>
        )}

        {checked && <ImportResult job={checked} />}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Đóng
          </Button>
          <Button
            variant="outline"
            onClick={() => void run(true)}
            disabled={!file || !!fileError || missingBranch || busy}
          >
            {busy && !checkedOk ? 'Đang kiểm tra…' : 'Kiểm tra file'}
          </Button>
          <Button onClick={() => void run(false)} disabled={!checkedOk || busy}>
            {busy && checkedOk ? 'Đang nhập…' : 'Nhập dữ liệu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportResult({ job }: { job: ImportJob }) {
  const ok = importOutcome(job) === 'ok';
  const shown = job.errors.slice(0, MAX_ERRORS_SHOWN);
  return (
    <div className="stack-sm" aria-live="polite">
      <p
        className={ok ? 'alert alert-success' : 'alert alert-error'}
        role={ok ? 'status' : 'alert'}
      >
        {ok
          ? `File hợp lệ. ${summarizeImport(job)}. Bấm "Nhập dữ liệu" để ghi.`
          : `Có ${job.failed.toLocaleString('vi-VN')} dòng lỗi nên chưa ghi gì. Sửa file rồi kiểm tra lại.`}
      </p>
      {shown.length > 0 && (
        <ul className="import-errors">
          {shown.map((err, i) => (
            <li key={`${err.row}-${err.field}-${i}`}>
              <span className="tabular">{err.row === 0 ? 'Hệ thống' : `Dòng ${err.row}`}</span>
              <span className="import-error-field">{err.field}</span>
              <span>{err.message}</span>
            </li>
          ))}
        </ul>
      )}
      {job.errors.length > shown.length && (
        <p className="field-hint">
          Chỉ hiện {shown.length} / {job.errors.length} lỗi đầu tiên.
        </p>
      )}
    </div>
  );
}
