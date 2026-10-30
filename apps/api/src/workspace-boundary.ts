import {existsSync,realpathSync,mkdirSync} from 'node:fs';
import {dirname,relative,resolve,sep,isAbsolute} from 'node:path';

export function canonicalPath(path:string):string{
  const target=resolve(path);let ancestor=target;
  while(!existsSync(ancestor)&&dirname(ancestor)!==ancestor)ancestor=dirname(ancestor);
  return resolve(realpathSync(ancestor),relative(ancestor,target));
}
export function isWithinPath(target:string,root:string,allowRoot=true):boolean{
  const rel=relative(canonicalPath(root),canonicalPath(target));
  return (allowRoot||rel!=='')&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
}
export function prepareWorkspaceRoot(root:string):string{
  mkdirSync(root,{recursive:true});return realpathSync(root);
}
