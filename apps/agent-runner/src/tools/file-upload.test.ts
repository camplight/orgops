import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm, symlink, truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../../api/src/app';
import {execute} from './fs';
import {MAX_UPLOAD_BYTES} from './file-upload';
import type {ExecuteContext} from './types';
let dir:string, ctx:ExecuteContext, engine:ReturnType<typeof createApp>;
beforeEach(async()=>{
  dir=await mkdtemp(join(tmpdir(),'orgops-file-upload-'));
  await mkdir(join(dir,'workspace'));
  engine=createApp({dbPath:join(dir,'test.sqlite'),dataDir:dir,projectRoot:dir,runnerToken:'test-runner',adminUser:'test',adminPass:'test-password'});
  ctx={agent:{name:'Artist',workspacePath:join(dir,'workspace')} as any,triggerEvent:{id:'trigger'} as any,injectionEnv:{},
    apiFetch:vi.fn(async(path,init)=>engine.app.request(path,{...init,headers:{'x-orgops-runner-token':'test-runner'}})),emitEvent:vi.fn(),emitAudit:vi.fn()};
});
afterEach(async()=>{engine.db.close();await rm(dir,{recursive:true,force:true});});
it('uploads exact bytes through the real file API and returns a reusable attachment without posting',async()=>{
  const bytes=Buffer.from('89504e470d0a1a0a','hex');
  await writeFile(join(dir,'workspace','drawing.png'),bytes);
  const result=await execute(ctx,'fs_upload',{path:'drawing.png'}) as any;
  expect(result.attachment).toMatchObject({name:'drawing.png',mime:'image/png',size:bytes.length});
  const response=await ctx.apiFetch(result.url);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  expect(ctx.emitEvent).not.toHaveBeenCalled();
});
it('rejects traversal, symlink escapes, directories, and oversized files before upload',async()=>{
  await writeFile(join(dir,'outside.txt'),'private');
  await symlink(join(dir,'outside.txt'),join(dir,'workspace','escape.txt'));
  await writeFile(join(dir,'workspace','large.bin'),'');await truncate(join(dir,'workspace','large.bin'),MAX_UPLOAD_BYTES+1);
  for(const path of ['../outside.txt','escape.txt','.', 'large.bin']) await expect(execute(ctx,'fs_upload',{path})).rejects.toThrow();
  expect(ctx.apiFetch).not.toHaveBeenCalled();
});
it('does not report a failed upload as an attachment',async()=>{
  await writeFile(join(dir,'workspace','notes.txt'),'notes');
  ctx.apiFetch=vi.fn(async()=>new Response('no',{status:503}));
  await expect(execute(ctx,'fs_upload',{path:'notes.txt'})).rejects.toThrow('503');
  ctx.apiFetch=vi.fn(async()=>Response.json({}));
  await expect(execute(ctx,'fs_upload',{path:'notes.txt'})).rejects.toThrow('no file ID');
});
