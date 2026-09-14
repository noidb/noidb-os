import {createHash} from 'node:crypto';
import {get,put} from '@vercel/blob';

export interface ParsedFileRecord<T> { key:string; parserVersion:string; descriptor:unknown; contentHash:string; parsedAt:string; status:'parsed'; purchaseOrders:string[]; actualDates:string[]; value:T; digest:string }
export interface ParseCacheStorage {read(key:string):Promise<unknown>;write(key:string,value:unknown):Promise<void>}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const storage:ParseCacheStorage={
 async read(key){if(!process.env.VERCEL) return null;const r=await get(`noidb-wms/parsed-files/${key}.json`,{access:'private',useCache:false});return r?.statusCode===200&&r.stream?JSON.parse(await new Response(r.stream).text()):null;},
 async write(key,value){if(process.env.VERCEL) await put(`noidb-wms/parsed-files/${key}.json`,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:true,contentType:'application/json'});},
};
/** Versioned performance cache only. Receipt/quantity state always comes from the live ledger. */
export function createParsedFileCache(store:ParseCacheStorage=storage){
 const memory=new Map<string,ParsedFileRecord<unknown>>();
 return async function cached<T>(version:string,descriptor:unknown,parse:()=>Promise<{value:T;contentHash:string;purchaseOrders?:string[];actualDates?:string[]}>,valid:(value:unknown)=>value is T,fresh=false):Promise<T>{
  const key=digest([version,descriptor]);
  if(!fresh){
   let record=memory.get(key);
   if(!record){try{record=await store.read(key) as ParsedFileRecord<unknown>;}catch{/* Cache failure must not stop source validation. */}}
   if(record&&record.key===key&&record.status==='parsed'&&/^[a-f0-9]{64}$/.test(record.contentHash)&&record.digest===digest(record.value)&&valid(record.value)){
    if(memory.size>=100)memory.delete(memory.keys().next().value!);memory.set(key,record);return structuredClone(record.value);
   }
  }
  const parsed=await parse();
  if(!valid(parsed.value)||!/^[a-f0-9]{64}$/.test(parsed.contentHash))throw new Error('원본 파일 분석 결과를 확인하지 못했습니다.');
  const record:ParsedFileRecord<T>={key,parserVersion:version,descriptor,...parsed,parsedAt:new Date().toISOString(),status:'parsed',purchaseOrders:parsed.purchaseOrders||[],actualDates:parsed.actualDates||[],digest:digest(parsed.value)};
  if(memory.size>=100)memory.delete(memory.keys().next().value!);memory.set(key,record);
  try{await store.write(key,record);}catch{/* Safe fallback to parsing on another instance. */}
  return structuredClone(parsed.value);
 };
}
export const cachedParsedFile=createParsedFileCache();
