import type { NextConfig } from "next";

// 本地开发/构建使用独立目录 .next-local，绕开本机历史上的脏缓存（幽灵文件）。
// 部署到 Netlify（NETLIFY=true）时改用标准的 .next 输出，与 netlify.toml 的 publish 保持一致。
const nextConfig: NextConfig = process.env.NETLIFY ? {} : { distDir: ".next-local" };

export default nextConfig;
