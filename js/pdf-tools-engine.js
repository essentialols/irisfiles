/**
 * IrisFiles - PDF page/text/compression engine.
 * Page manipulation uses pdf-lib and preserves original PDF page contents.
 * Compression is intentionally raster-based and only returned when smaller.
 */
const PDFJS_CDN='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.min.mjs';
const PDFJS_WORKER='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.624/build/pdf.worker.min.mjs';
const PDFLIB_CDN='https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
let pdfjsPromise=null,pdfLibPromise=null;

async function pdfjs(){
  if(!pdfjsPromise) pdfjsPromise=import(PDFJS_CDN).then(lib=>{lib.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;return lib;});
  return pdfjsPromise;
}
function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Could not load PDF library. Check your internet connection.'));document.head.appendChild(s);});}
async function pdfLib(){
  if(!pdfLibPromise) pdfLibPromise=(async()=>{if(!window.PDFLib) await loadScript(PDFLIB_CDN);if(!window.PDFLib) throw new Error('PDF library failed to initialize.');return window.PDFLib;})();
  return pdfLibPromise;
}
async function pdfjsDocument(file){const lib=await pdfjs();return lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;}

export async function renderPdfThumbnails(file,onProgress=()=>{}){
  const doc=await pdfjsDocument(file);const pages=[];
  for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n);const base=page.getViewport({scale:1});const scale=Math.min(1,180/Math.max(base.width,1));const vp=page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(vp.width));canvas.height=Math.max(1,Math.round(vp.height));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport:vp}).promise;
    pages.push({index:n-1,pageNum:n,preview:canvas.toDataURL('image/jpeg',.7)});canvas.width=canvas.height=1;onProgress(Math.round(n/doc.numPages*100));
  }return pages;
}

export async function rebuildPdf(file,pageSpecs,onProgress=()=>{}){
  if(!Array.isArray(pageSpecs)||pageSpecs.length===0) throw new Error('The output PDF must contain at least one page.');
  const PDFLib=await pdfLib();const src=await PDFLib.PDFDocument.load(new Uint8Array(await file.arrayBuffer()));const out=await PDFLib.PDFDocument.create();
  for(let i=0;i<pageSpecs.length;i++){
    const spec=pageSpecs[i];if(spec.index<0||spec.index>=src.getPageCount()) throw new Error('Invalid page selection.');
    const [page]=await out.copyPages(src,[spec.index]);const delta=((spec.rotation||0)%360+360)%360;if(delta){const current=page.getRotation()?.angle||0;page.setRotation(PDFLib.degrees((current+delta)%360));}out.addPage(page);onProgress(Math.round((i+1)/pageSpecs.length*100));
  }
  const bytes=await out.save({useObjectStreams:true});return new Blob([bytes],{type:'application/pdf'});
}

export async function extractPdfText(file,onProgress=()=>{}){
  const doc=await pdfjsDocument(file);const pages=[];
  for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n);const content=await page.getTextContent();let text='';for(const item of content.items){if(!item?.str) continue;text+=item.str;if(item.hasEOL) text+='\n';else text+=' ';}
    pages.push(text.trim());onProgress(Math.round(n/doc.numPages*100));
  }
  return {pages,fullText:pages.map((text,i)=>`Page ${i+1}\n${text}`).join('\n\n')};
}

function canvasJpeg(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not encode compressed PDF page.')),'image/jpeg',quality));}
export async function compressPdf(file,opts={},onProgress=()=>{}){
  const quality=Math.min(.9,Math.max(.35,opts.quality??.7));const requestedScale=Math.min(2,Math.max(.75,opts.scale??1.35));
  const doc=await pdfjsDocument(file);const PDFLib=await pdfLib();const out=await PDFLib.PDFDocument.create();
  for(let n=1;n<=doc.numPages;n++){
    const page=await doc.getPage(n);const base=page.getViewport({scale:1});const maxPixels=12_000_000;const pixelBase=Math.max(1,base.width*base.height);const safeScale=Math.min(requestedScale,Math.sqrt(maxPixels/pixelBase));const vp=page.getViewport({scale:safeScale});
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(vp.width));canvas.height=Math.max(1,Math.round(vp.height));const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport:vp}).promise;
    const jpeg=await canvasJpeg(canvas,quality);const image=await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));const outPage=out.addPage([base.width,base.height]);outPage.drawImage(image,{x:0,y:0,width:base.width,height:base.height});canvas.width=canvas.height=1;onProgress(Math.round(n/doc.numPages*100));
  }
  const bytes=await out.save({useObjectStreams:true});const compressed=new Blob([bytes],{type:'application/pdf'});
  if(compressed.size>=file.size) return {blob:file,reduced:false,flattened:false};
  return {blob:compressed,reduced:true,flattened:true};
}
