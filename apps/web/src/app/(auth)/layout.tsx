import { AuthLayoutFrame } from '@/components/common/auth-card';

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return <AuthLayoutFrame>{children}</AuthLayoutFrame>;
}
