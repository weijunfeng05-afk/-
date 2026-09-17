import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
await build({entryPoints:['lib/upload-summary.ts'],bundle:true,platform:'node',format:'esm',outfile:'work/test-upload-summary.mjs'});
const {uploadSummary}=await import('../work/test-upload-summary.mjs');
test('失败不能显示为上传成功',()=>{assert.equal(uploadSummary([{state:'文字不足'},{state:'本地真实模式发生错误'}]),'已处理 2 / 2 · 上传成功 0 · 失败 2')});
test('同时显示等待、已接受和失败的进度',()=>{assert.equal(uploadSummary([{state:'等待上传'},{state:'正在上传'},{state:'已上传，正在解析评分'},{state:'文件损坏'}]),'已处理 2 / 4 · 上传成功 1 · 失败 1')});
