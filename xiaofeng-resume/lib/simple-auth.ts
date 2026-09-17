// 内测简易登录：不接入 Supabase Auth，用「邮箱即账号 + 统一密码」直接进入工作台。
//
// 安全说明：统一密码会随前端代码一起下发，在浏览器里可以直接看到，
// 因此它不构成任何安全保护，仅适用于本地试用或完全信任的小范围内测。
// 正式上线前务必把 NEXT_PUBLIC_SIMPLE_LOGIN 设为 false，恢复 Supabase 真实鉴权。
export const SIMPLE_LOGIN = process.env.NEXT_PUBLIC_SIMPLE_LOGIN === 'true';
export const SIMPLE_PASSWORD = process.env.NEXT_PUBLIC_SIMPLE_PASSWORD || '123456';

// 统一模式开关从 lib/mode 引入，这里仅做转发，保证旧导入路径继续可用。
export { DEMO_MODE, REAL_AI_MODE, LOCAL_MODE } from './mode';

/** 记录登录邮箱的本地 cookie 名（非 httpOnly，仅作身份标识）。 */
export const SESSION_COOKIE = 'xf_user';

export function readSessionEmail(): string {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(new RegExp('(?:^|; )' + SESSION_COOKIE + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

export function writeSessionEmail(email: string) {
  // 保留 7 天；正式环境请改用 Supabase 会话。
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(email)}; path=/; max-age=604800; samesite=lax`;
}

export function clearSessionEmail() {
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

/** 登录邮箱的变更通知，供 useSyncExternalStore 使用。 */
const listeners = new Set<() => void>();
export function subscribeSession(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function notifySessionChange() {
  listeners.forEach(listener => listener());
}
