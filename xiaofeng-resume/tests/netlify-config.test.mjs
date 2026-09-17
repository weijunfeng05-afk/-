import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {existsSync} from 'node:fs';

test('Netlify builds target the same Next.js output directory as the runtime plugin',()=>{
 const config=readFileSync('netlify.toml','utf8');
 const next=readFileSync('next.config.ts','utf8');
 assert.match(config,/publish = "\.next"/);
 assert.match(config,/NETLIFY = "true"/);
 assert.match(config,/@netlify\/plugin-nextjs/);
 assert.match(next,/process\.env\.NETLIFY \? \{\} : \{ distDir: "\.next-local" \}/);
});
test('Windows Netlify packaging uses hoisted dependencies',()=>{ assert.match(readFileSync('pnpm-workspace.yaml','utf8'),/nodeLinker: hoisted/); });

test('authentication guard uses Edge middleware for Netlify',()=>{ assert.match(readFileSync('middleware.ts','utf8'),/export async function middleware/); assert.match(readFileSync('middleware.ts','utf8'),/supabase.auth.getUser/); });

test('repository root Netlify build targets the same app and runtime',()=>{
 if(!existsSync('../netlify.toml'))return;
 const config=readFileSync('../netlify.toml','utf8');
 assert.match(config,/base = "xiaofeng-resume"/);
 assert.match(config,/publish = "\.next"/);
 assert.match(config,/NETLIFY = "true"/);
 assert.match(config,/@netlify\/plugin-nextjs/);
});
