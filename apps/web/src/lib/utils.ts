import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Gộp class Tailwind, lớp sau ghi đè lớp trước khi xung đột. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
