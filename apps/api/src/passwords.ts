import {randomBytes, scrypt, timingSafeEqual} from 'node:crypto';

const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>{
  scrypt(password,salt,64,(error,key)=>error?reject(error):resolve(key));
});
export async function hashPasswordAsync(password:string):Promise<string>{
  const salt=randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password,salt)).toString('hex')}`;
}
export async function verifyPasswordAsync(password:string,hashed:string):Promise<boolean>{
  const [algorithm,salt,hash,extra]=hashed.split('$');
  if(algorithm!=='scrypt'||!/^[a-f0-9]{32}$/i.test(salt??'')||!/^[a-f0-9]{128}$/i.test(hash??'')||extra!==undefined)return false;
  return timingSafeEqual(await derive(password,salt),Buffer.from(hash,'hex'));
}
// Missing users do the same password derivation as existing password accounts.
export const DUMMY_PASSWORD_HASH=`scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;
