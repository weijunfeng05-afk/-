import type { Metadata } from "next";
import "./globals.css";
import Account from '@/components/account';

export const metadata: Metadata = {
  title: "小锋牌简历 · 招聘工作台",
  description: "证据驱动的简历初筛与候选人排序。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased"><Account/>{children}</body>
    </html>
  );
}
