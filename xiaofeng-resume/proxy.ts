import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
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
