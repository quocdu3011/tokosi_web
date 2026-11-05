import { AsyncLocalStorage } from 'node:async_hooks';

/** Ngữ cảnh của một yêu cầu HTTP, dùng để nhật ký tự gắn `requestId`, người dùng, chi nhánh mà không phải truyền tay. */
export interface RequestContextData {
  requestId: string;
  ip?: string;
  userId?: string;
  branchId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContextData>();

/** Ngữ cảnh của yêu cầu hiện tại, hoặc `undefined` nếu đang chạy ngoài một yêu cầu (script, test gọi service trực tiếp). */
export const currentContext = (): RequestContextData | undefined =>
  requestContext.getStore();
