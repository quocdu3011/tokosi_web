'use client';

import { Copy } from 'lucide-react';
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

/**
 * Hiện mật khẩu tạm do hệ thống sinh — CHỈ MỘT LẦN (server không trả lại lần nữa).
 * Không lưu mật khẩu vào bất kỳ đâu ngoài state của hộp thoại này.
 */
export function TemporaryPasswordDialog({
  value,
  onClose,
}: {
  value: { username: string; password: string } | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Mật khẩu tạm</DialogTitle>
          <DialogDescription>
            Gửi mật khẩu này cho <b>{value?.username}</b>. Mật khẩu chỉ hiện <b>một lần</b>; người
            dùng phải đổi mật khẩu khi đăng nhập lần đầu.
          </DialogDescription>
        </DialogHeader>
        <div className="secret-box">
          <code data-testid="temporary-password">{value?.password}</code>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Sao chép mật khẩu"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value?.password ?? '');
                toast.success('Đã sao chép');
              } catch {
                toast.error('Không sao chép được, hãy chép tay');
              }
            }}
          >
            <Copy />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Tôi đã lưu lại</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
