import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'idempotent';

/**
 * Đánh dấu endpoint tạo chứng từ (hóa đơn, phiếu nhập, phiếu thu…) là **chống trùng**: client PHẢI gửi header
 * `Idempotency-Key` (chuỗi ngẫu nhiên duy nhất cho mỗi thao tác của người dùng). Gửi lại cùng khóa + cùng nội dung
 * (do mạng chập chờn, bấm hai lần) thì KHÔNG tạo thêm mà trả lại kết quả của lần đầu.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);
