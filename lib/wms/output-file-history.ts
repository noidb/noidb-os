import {listOAuthDriveFolderFiles,resolveDriveFolderPath} from './google-drive-oauth-reader';

export const OUTPUT_FOLDERS = [
 {key:'po',label:'발주확정',path:['쿠팡데이터','발주서업로드완성']},
 {key:'invoice',label:'한진 송장',path:['쿠팡데이터','한진택배 송장파일']},
 {key:'shipment',label:'Shipment 업로드',path:['쿠팡데이터','쉽먼트업로드완성']},
 {key:'output',label:'Shipment 출력세트',path:['쿠팡데이터','쉽먼트업로드완성','쉽먼트출력세트']},
 {key:'discontinue',label:'단종·해제',path:['쿠팡데이터','단종 및 해제']},
 {key:'coupon',label:'쿠폰·미입고',path:['쿠팡데이터','마케팅','쿠폰관리']},
];
export interface SavedOutputFile {id:string;name:string;category:string;categoryLabel:string;modifiedAt:string;url:string}
export async function listSavedOutputFiles(category='all', dependencies={resolve:resolveDriveFolderPath,list:listOAuthDriveFolderFiles}){
 if(category!=='all'&&!OUTPUT_FOLDERS.some(f=>f.key===category))throw new Error('파일 종류를 다시 선택해 주세요.');
 const folders=OUTPUT_FOLDERS.filter(f=>category==='all'||f.key===category);
 const groups=await Promise.all(folders.map(async folder=>{
  try{
   const files=await dependencies.list(await dependencies.resolve(folder.path));
   const items:SavedOutputFile[]=files.filter(f=>/\.(xlsx|pdf|zip)$/i.test(f.name)&&!/^\[(?:양식|샘플|데이터입력샘플)\]/.test(f.name)).map(f=>({id:f.id,name:f.name,category:folder.key,categoryLabel:folder.label,modifiedAt:f.modifiedTime,url:`https://drive.google.com/file/d/${encodeURIComponent(f.id)}/view`}));
   return {items,warning:''};
  }catch{return {items:[] as SavedOutputFile[],warning:`${folder.label} 폴더 연결을 확인해 주세요.`};}
 }));
 return {items:groups.flatMap(g=>g.items).sort((a,b)=>b.modifiedAt.localeCompare(a.modifiedAt)||a.name.localeCompare(b.name)),warnings:groups.map(g=>g.warning).filter(Boolean)};
}
