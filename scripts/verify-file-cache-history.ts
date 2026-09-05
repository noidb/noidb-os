import assert from 'node:assert/strict';
import {createParsedFileCache} from '../lib/wms/parsed-file-cache';
import {listSavedOutputFiles} from '../lib/wms/output-file-history';
async function main(){
 const disk=new Map<string,any>();let parses=0,reads=0;
 const store={read:async(k:string)=>{reads++;return structuredClone(disk.get(k));},write:async(k:string,v:unknown)=>{disk.set(k,structuredClone(v));}};
 const parse=async()=>({value:{rows:[++parses]},contentHash:'a'.repeat(64),purchaseOrders:['PO1'],actualDates:['2026-09-06']});
 const valid=(v:any):v is {rows:number[]}=>Array.isArray(v?.rows);
 const first=createParsedFileCache(store);const descriptor={id:'f1',name:'f.xlsx',modifiedTime:'1',size:10};
 const value=await first('v1',descriptor,parse,valid);value.rows[0]=999;
 assert.deepEqual(await first('v1',descriptor,parse,valid),{rows:[1]},'callers cannot mutate cached data');
 assert.deepEqual(await createParsedFileCache(store)('v1',descriptor,parse,valid),{rows:[1]},'new server reuses persisted parse');
 assert.equal(parses,1);
 await first('v1',{...descriptor,modifiedTime:'2'},parse,valid);assert.equal(parses,2);
 await first('v1',descriptor,parse,valid,true);assert.equal(parses,3,'apply bypasses all cache');
 const entry=[...disk.values()].find(v=>v.descriptor.modifiedTime==='1');entry.value.rows=[999];
 await createParsedFileCache(store)('v1',descriptor,parse,valid);assert.equal(parses,4,'corrupted cache reparses');
 await first('v2',descriptor,parse,valid);assert.equal(parses,5,'parser upgrade invalidates cache');
 const broken=createParsedFileCache({read:async()=>{throw Error();},write:async()=>{throw Error();}});
 await broken('v1',descriptor,parse,valid);assert.equal(parses,6,'cache outage preserves source parsing');
 let lists=0;
 const history=await listSavedOutputFiles('all',{resolve:async(path)=>path.at(-1)!,list:async(folder)=>{
  lists++;if(folder==='단종 및 해제')throw new Error('secret configuration must stay hidden');
  return [{id:folder+'1',name:'생성_20260906.xlsx',mimeType:'sheet',modifiedTime:'2026-09-06T00:00:00Z',size:'1'},{id:'template',name:'[양식]원본.xlsx',mimeType:'sheet',modifiedTime:'',size:'1'},{id:'folder',name:'하위폴더',mimeType:'folder',modifiedTime:'',size:'0'}];
 }});
 assert.equal(lists,6);assert.equal(history.items.length,5);assert.equal(history.warnings.length,1);assert.ok(!JSON.stringify(history).includes('secret'));
 assert.ok(history.items.every(i=>i.url.startsWith('https://drive.google.com/file/d/')));
 await assert.rejects(listSavedOutputFiles('arbitrary-folder'),/다시 선택/);
 console.log(JSON.stringify({passed:true,persistentCrossInstanceCache:true,freshWriteRecheck:true,corruptCacheFallback:true,cacheOutageFallback:true,historyFolders:6,partialConnectionWarning:true,operatingWrites:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
