import { clsx, type ClassValue } from 'clsx';

/** Ghép tên lớp CSS có điều kiện. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
