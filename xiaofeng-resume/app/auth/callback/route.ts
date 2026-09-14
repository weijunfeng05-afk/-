import {NextResponse} from 'next/server';
import {supabaseServer} from '@/lib/supabase/server';
export async function GET(request:Request) {
  const code=new URL(request.url).searchParams.get('code');
  if(code) {const {error}=await (await supabaseServer()).auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL('/',request.url));}
  return NextResponse.redirect(new URL('/login',request.url));
}
