/**
 * IrisFiles - HTML file to PDF engine.
 * Remote resources and scripts are deliberately blocked before rendering.
 */
const HTML2CANVAS='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
const JSPDF='https://cdn.jsdelivr.net/npm/jspdf@4.2.0/dist/jspdf.umd.min.js';
let libsPromise=null;
function loadScript(src,check){return new Promise((resolve,reject)=>{if(check())return resolve();const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Failed to load HTML to PDF renderer. Check your internet connection.'));document.head.appendChild(s);});}
async function libs(){if(!libsPromise)libsPromise=(async()=>{await loadScript(HTML2CANVAS,()=>!!window.html2canvas);await loadScript(JSPDF,()=>!!window.jspdf?.jsPDF);return {html2canvas:window.html2canvas,jsPDF:window.jspdf.jsPDF};})();return libsPromise;}
function safeUrl(value){const v=(value||'').trim();return v.startsWith('data:')||v.startsWith('blob:')||v.startsWith('#')||v==='';}
function sanitizeHtml(source){
  const parser=new DOMParser();const doc=parser.parseFromString(source,'text/html');
  doc.querySelectorAll('script,iframe,frame,object,embed,audio,video,source,track,base,link[rel="stylesheet"],link[rel="preload"],link[rel="modulepreload"],meta[http-equiv="refresh" i]').forEach(el=>el.remove());
  doc.querySelectorAll('*').forEach(el=>{for(const attr of [...el.attributes]){const name=attr.name.toLowerCase();if(name.startsWith('on'))el.removeAttribute(attr.name);if(['src','href','poster','action','formaction'].includes(name)&&!safeUrl(attr.value))el.removeAttribute(attr.name);if(name==='srcset')el.removeAttribute(attr.name);if(name==='style')el.setAttribute('style',attr.value.replace(/url\([^)]*\)/gi,'none'));}});
  doc.querySelectorAll('style').forEach(style=>{style.textContent=(style.textContent||'').replace(/@import[^;]+;/gi,'').replace(/url\([^)]*\)/gi,'none');});
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;";doc.head.prepend(csp);
  return '<!DOCTYPE html>'+doc.documentElement.outerHTML;
}
function waitForLoad(iframe){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('HTML preview timed out.')),10000);iframe.onload=()=>{clearTimeout(timer);requestAnimationFrame(()=>requestAnimationFrame(resolve));};});}
function dataUrlFromCanvas(canvas,quality=.88){return canvas.toDataURL('image/jpeg',quality);}
export async function htmlFileToPdf(file,onProgress=()=>{}){
  onProgress(5,'Reading HTML...');const source=await file.text();if(source.length>10_000_000)throw new Error('HTML file is too large to render safely.');
  const sanitized=sanitizeHtml(source);const {html2canvas,jsPDF}=await libs();onProgress(20,'Preparing private preview...');
  // Keep the frame renderable but far outside the viewport. visibility:hidden
  // would also hide its document from html2canvas and can produce a blank PDF.
  const iframe=document.createElement('iframe');iframe.setAttribute('sandbox','allow-same-origin');iframe.setAttribute('aria-hidden','true');Object.assign(iframe.style,{position:'fixed',left:'-100000px',top:'0',width:'1100px',height:'900px',border:'0',pointerEvents:'none'});document.body.appendChild(iframe);
  try{
    const loaded=waitForLoad(iframe);iframe.srcdoc=sanitized;await loaded;const doc=iframe.contentDocument;if(!doc)throw new Error('Could not render HTML document.');
    const root=doc.documentElement;const width=Math.min(1400,Math.max(320,root.scrollWidth||1100));iframe.style.width=width+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const height=Math.max(200,root.scrollHeight||900);if(width*height>35_000_000)throw new Error('Rendered HTML is too large. Reduce the document size or page length.');
    iframe.style.height=Math.min(height,20000)+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    onProgress(35,'Rendering HTML...');const canvas=await html2canvas(root,{backgroundColor:'#ffffff',scale:1,useCORS:false,allowTaint:false,logging:false,width,height,windowWidth:width,windowHeight:height,scrollX:0,scrollY:0});
    onProgress(70,'Building PDF...');const pdf=new jsPDF({unit:'pt',format:'a4',orientation:'portrait',compress:true});const pageW=pdf.internal.pageSize.getWidth(),pageH=pdf.internal.pageSize.getHeight(),margin=24,usableW=pageW-margin*2,usableH=pageH-margin*2;const slicePx=Math.max(1,Math.floor(canvas.width*(usableH/usableW)));let y=0,pageIndex=0;
    while(y<canvas.height){const h=Math.min(slicePx,canvas.height-y);const slice=document.createElement('canvas');slice.width=canvas.width;slice.height=h;const ctx=slice.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,slice.width,slice.height);ctx.drawImage(canvas,0,y,canvas.width,h,0,0,canvas.width,h);if(pageIndex>0)pdf.addPage();const drawH=h*usableW/canvas.width;pdf.addImage(dataUrlFromCanvas(slice),'JPEG',margin,margin,usableW,drawH,undefined,'FAST');slice.width=slice.height=1;y+=h;pageIndex++;onProgress(70+Math.round(Math.min(1,y/canvas.height)*28),`Building PDF page ${pageIndex}...`);}
    canvas.width=canvas.height=1;onProgress(100,'Done');return pdf.output('blob');
  }finally{iframe.remove();}
}
