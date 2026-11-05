/** Biểu tượng "G" của Google (theo hướng dẫn thương hiệu: 4 màu). Chỉ để trang trí. */
export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.56-5.17 3.56-8.81z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3a7.2 7.2 0 0 1-10.7-3.78H1.35v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.36 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.35a12 12 0 0 0 0 10.8l4.01-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.35 6.6l4.01 3.09A7.15 7.15 0 0 1 12 4.75z"
      />
    </svg>
  );
}
