import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { SIMPLE_LOGIN, SESSION_COOKIE, LOCAL_MODE } from '@/lib/simple-auth';
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // 内测简易登录：只看本地 cookie，不依赖 Supabase。
  // 正式上线前将 NEXT_PUBLIC_SIMPLE_LOGIN 设为 false，即会走下方的真实鉴权。
  if (SIMPLE_LOGIN) {
    if (path === '/login' || path.startsWith('/auth/')) return NextResponse.next();
    if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
    return path.startsWith('/api/')
      ? NextResponse.json({error:'请先登录工作空间'}, {status:401})
      : NextResponse.redirect(new URL('/login',request.url));
  }

  // 本地模式（演示或真实 AI）：跳过 Supabase 鉴权，直接渲染界面与处理接口。
  if (LOCAL_MODE) return NextResponse.next();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return new NextResponse('登录服务尚未配置，请联系管理员。', {status:503});
  let response = NextResponse.next({request});
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {getAll:()=>request.cookies.getAll(), setAll(values) {
      values.forEach(({name,value})=>request.cookies.set(name,value));
      response = NextResponse.next({request});
      values.forEach(({name,value,options})=>response.cookies.set(name,value,options));
    }},
  });
  const {data:{user}} = await supabase.auth.getUser();
  if (!user && path !== '/login' && !path.startsWith('/auth/')) {
    const denied = path.startsWith('/api/') ? NextResponse.json({error:'请先登录工作空间'}, {status:401}) : NextResponse.redirect(new URL('/login',request.url));
    response.cookies.getAll().forEach(c=>denied.cookies.set(c)); response=denied;
  }
  response.headers.set('Cache-Control','private, no-store'); return response;
}
export const config = {matcher:['/','/login','/jobs/:path*','/candidates/:path*','/settings/:path*','/api/:path*','/auth/:path*']};
