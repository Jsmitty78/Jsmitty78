import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { referenceDrawing, referenceSource, referenceProvenance, referenceCounts, defaultDrawingLayers, drawingBody, renderDrawingSvg } from '../packages/core/src/index.js';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));
const sharp=require('sharp');
const folder=new URL('../docs/drawing/reference/',import.meta.url),d=referenceDrawing();
await writeFile(new URL('source-derived-plan.svg',folder),renderDrawingSvg(d,1));
for(const mode of ['original','edit','overlay'] as const) {
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="1120" viewBox="115 115 510 510">${drawingBody(d,1,{...defaultDrawingLayers,referenceMode:mode})}</svg>`;
 await writeFile(new URL(`${mode}.svg`,folder),svg);await sharp(Buffer.from(svg)).png().toFile(new URL(`${mode}.png`,folder).pathname);
}
const landmarks=d.heads.map(h=>{
 const n=d.nodes.find(n=>n.id===h.nodeId)!,p=referenceProvenance(h.id) as {pdfCenter:number[];pdfPathIndex:number};
 const mapped=[n.x/referenceSource.mmPerPdfPoint+1460,n.y/referenceSource.mmPerPdfPoint+1500];
 return {id:h.id,pdfPathIndex:p.pdfPathIndex,expectedPdfPoint:p.pdfCenter,mappedPdfPoint:mapped,errorPdfPoints:Math.hypot(mapped[0]!-p.pdfCenter[0]!,mapped[1]!-p.pdfCenter[1]!)};
});
const raw=async(file:string)=>sharp(new URL(file,folder).pathname).removeAlpha().raw().toBuffer();
const a=await raw('original.png'),b=await raw('edit.png');let total=0,different=0;
for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);total+=delta;if(delta>32)different++;}
const pdf=await raw('pdf-mezzanine.png');let pdfTotal=0,pdfDifferent=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-pdf[i]);pdfTotal+=delta;if(delta>32)pdfDifferent++;}
const report={directPdfComparison:{description:'Independent PyMuPDF raster vs extracted original SVG raster',meanAbsoluteChannelDifference:pdfTotal/a.length,channelsDifferingOver32Percent:100*pdfDifferent/a.length},source:referenceSource,counts:referenceCounts,tolerancePdfPoints:.02,maxHeadCenterErrorPdfPoints:Math.max(...landmarks.map(v=>v.errorPdfPoints)),landmarks,visualComparison:{description:'Exact original SVG vs editable reconstruction, whole crop; not physical measurement accuracy',meanAbsoluteChannelDifference:total/a.length,channelsDifferingOver32Percent:100*different/a.length}};
await writeFile(new URL('geometry-report.json',folder),JSON.stringify(report,null,2));console.log(JSON.stringify({counts:referenceCounts,maxHeadCenterErrorPdfPoints:report.maxHeadCenterErrorPdfPoints,visualComparison:report.visualComparison}));
