import type { ShipmentOutputGeneration } from './picking-wave/types';
const key=(groups:readonly string[][])=>JSON.stringify(groups.map(g=>[...g].sort()).sort((a,b)=>a.join('|').localeCompare(b.join('|'))));
export function connectInvoiceGeneration(generations:readonly ShipmentOutputGeneration[],incoming:ShipmentOutputGeneration){
 const selected=new Set(incoming.purchaseOrderNumbers);
 const active=generations.filter(g=>!g.supersededByGenerationId);
 if(active.some(g=>g.purchaseOrderNumbers.some(po=>selected.has(po))&&g.purchaseOrderNumbers.some(po=>!selected.has(po))))throw new Error('기존 출력 대상의 일부 발주만 겹칩니다. 기존 대상 전체를 선택하거나 겹치지 않는 발주를 선택해 주세요.');
 const exact=active.find(g=>g.purchaseOrderNumbers.length===selected.size&&g.purchaseOrderNumbers.every(po=>selected.has(po))&&g.invoiceGroups&&incoming.invoiceGroups&&key(g.invoiceGroups)===key(incoming.invoiceGroups));
 const generation=exact?{...exact,invoiceFileName:incoming.invoiceFileName,updatedAt:incoming.updatedAt}:incoming;
 const output=generations.map(g=>g.generationId===generation.generationId?generation:!g.supersededByGenerationId&&g.purchaseOrderNumbers.every(po=>selected.has(po))?{...g,supersededByGenerationId:generation.generationId}:g);
 if(!exact)output.push(generation);
 return {generation,outputGenerations:output};
}
