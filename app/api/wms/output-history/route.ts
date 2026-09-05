import {NextRequest,NextResponse} from 'next/server';
import {listSavedOutputFiles} from '@/lib/wms/output-file-history';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=180;
export async function GET(request:NextRequest){
 try{return NextResponse.json({success:true,...await listSavedOutputFiles(request.nextUrl.searchParams.get('category')||'all')},{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({success:false,error:'파일 이력을 확인하지 못했습니다. 다시 시도해 주세요.'},{status:400});}
}
