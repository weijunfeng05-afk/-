import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadDeployment} from './deployment-env.mjs';
const require=createRequire(import.meta.url);
const args=process.argv.slice(2);
if(!args.length||!['dev','build','start'].includes(args[0]))throw Error('Expected dev, build or start');
const local=loadDeployment();
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),...args],{
 cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,...local},stdio:'inherit',windowsHide:true
});
child.on('exit',code=>{process.exitCode=code??1});
