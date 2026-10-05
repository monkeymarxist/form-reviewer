import * as pdfjs from './vendor/pdf.mjs';
import { compareTokens } from './compare.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.mjs';
const $ = id => document.getElementById(id);
const docs = [null, null], versions = [0, 0], renderVersions = [0, 0];
let changes = [], selected = -1, loading = 0, reviewing = false;
const measure = document.createElement('canvas').getContext('2d');
function notice(text) { $('notice').hidden = !text; $('notice').textContent = text || ''; }
function status(text) { $('status').textContent = text; }
function controls() { $('review').disabled = loading > 0 || reviewing || !docs[0] || !docs[1]; $('sample').disabled = loading > 0 || reviewing; }
function invalidate() { changes = []; selected = -1; $('changes').hidden = true; document.querySelectorAll('.mark').forEach(x => x.remove()); status('Open both documents, then select Review changes.'); }
function splitItem(item, viewport, styles, pageIndex) {
  if (!item.str?.trim()) return [];
  const t = pdfjs.Util.transform(viewport.transform, item.transform);
  const font = styles[item.fontName] || {}, angle = Math.atan2(t[1], t[0]);
  const height = Math.hypot(t[2], t[3]);
  const ascent = font.ascent ?? (font.descent ? 1 + font.descent : .8);
  const width = item.width * viewport.scale;
  measure.font = `${height}px ${font.fontFamily || 'sans-serif'}`;
  const fullWidth = measure.measureText(item.str).width || 1;
  return [...item.str.matchAll(/\S+/gu)].map(m => {
    const before = measure.measureText(item.str.slice(0, m.index)).width / fullWidth * width;
    const wordWidth = measure.measureText(m[0]).width / fullWidth * width;
    return { text: m[0].normalize('NFC'), page: pageIndex, x: (t[4] + Math.cos(angle) * before) / viewport.width,
      y: (t[5] + Math.sin(angle) * before - height * ascent) / viewport.height,
      w: Math.max(wordWidth, 1) / viewport.width, h: Math.max(height, 1) / viewport.height, angle };
  });
}
async function loadPDF(side, data, filename) {
  const previous = docs[side]; const version = ++versions[side]; ++renderVersions[side]; loading++; controls(); invalidate(); notice(''); docs[side] = null;
  const viewer = $('viewer' + side); viewer.replaceChildren(); const message = document.createElement('div'); message.className = 'loading'; message.textContent = 'Opening PDF…'; viewer.append(message);
  if (previous) await previous.pdf.destroy();
  $('name' + side).textContent = filename; $('pages' + side).textContent = 'Reading…';
  let pdf;
  try {
    if (data.byteLength > 100 * 1024 * 1024) throw new Error('Please choose a PDF smaller than 100 MB.');
    const task = pdfjs.getDocument({data, cMapUrl:'./vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'./vendor/standard_fonts/'});
    task.onPassword = () => { task.destroy(); notice('This PDF is password-protected. Open an unprotected copy to compare it.'); };
    pdf = await task.promise;
    if (pdf.numPages > 150) throw new Error('Please compare PDFs with 150 pages or fewer.');
    const pages = [], tokens = []; let emptyPages = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      if (version !== versions[side]) { await pdf.destroy(); return; }
      const page = await pdf.getPage(i), viewport = page.getViewport({scale:1});
      const [content, annotations] = await Promise.all([page.getTextContent(), page.getAnnotations({intent:'display'})]);
      const words = content.items.flatMap(item => splitItem(item, viewport, content.styles, i - 1));
      const fields = [];
      for (const a of annotations) {
        if (a.subtype !== 'Widget' || a.fieldType === 'Sig' || a.pushButton) continue;
        let value = a.fieldValue;
        if (Array.isArray(value)) value = value.join(', ');
        if (a.fieldType === 'Btn') value = value && value !== 'Off' ? 'Checked' : '';
        if (value == null || String(value).trim() === '') continue;
        const rect = viewport.convertToViewportRectangle(a.rect);
        const field = {text:String(value), page:i - 1, x:Math.min(rect[0],rect[2])/viewport.width, y:Math.min(rect[1],rect[3])/viewport.height,
          w:Math.abs(rect[2]-rect[0])/viewport.width, h:Math.abs(rect[3]-rect[1])/viewport.height, angle:0, field:true, checkbox:a.fieldType === 'Btn'};
        fields.push(field);
      }
      // Include form values in spatial reading order when widgets are present.
      const ordered = [...words, ...fields].sort((a,b) => a.y-b.y || a.x-b.x);
      const rows = [];
      for (const token of ordered) {
        const row = rows[rows.length-1];
        if (row && Math.abs(token.y-row.y)<.004) row.tokens.push(token);
        else rows.push({y:token.y,tokens:[token]});
      }
      const pageTokens = rows.flatMap(row => row.tokens.sort((a,b)=>a.x-b.x));
      tokens.push(...pageTokens);
      if (!pageTokens.length) emptyPages++;
      pages.push({page,viewport,fields,element:null});
      message.textContent = `Reading page ${i} of ${pdf.numPages}…`;
    }
    if (version !== versions[side]) { await pdf.destroy(); return; }
    docs[side] = {pdf,pages,tokens,filename,emptyPages};
    $('pages' + side).textContent = `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}`;
    await render(side);
    status(docs.every(Boolean) ? 'Both documents are ready. Select Review changes to compare them.' : 'Document ready. Open the other PDF to begin.');
    if (emptyPages) notice(`${filename}: ${emptyPages} page(s) have no extractable text. Image-only content cannot be compared; run OCR on scanned PDFs first.`);
  } catch(e) {
    if(version !== versions[side]) return;
    docs[side] = null; if(pdf) await pdf.destroy();
    viewer.replaceChildren(); const msg = document.createElement('div'); msg.className = 'loading'; msg.textContent = 'Unable to open this PDF. Choose another file.'; viewer.append(msg);
    $('pages' + side).textContent = '— pages'; notice(e.message || 'Unable to read PDF.');
  } finally { loading--; controls(); }
}
async function render(side) {
  const doc = docs[side]; if(!doc) return;
  const generation = ++renderVersions[side], viewer = $('viewer' + side), zoom = $('zoom' + side).value;
  const scrollRatio = viewer.scrollTop / Math.max(1, viewer.scrollHeight - viewer.clientHeight);
  const available = Math.max(120, viewer.clientWidth - (innerWidth <= 900 ? 20 : 40));
  viewer.replaceChildren();
  for (let i = 0; i < doc.pages.length; i++) {
    const p = doc.pages[i], scale = zoom === 'fit' ? available / p.viewport.width : Number(zoom);
    const viewport = p.page.getViewport({scale});
    const el = document.createElement('div'); el.className = 'page'; el.dataset.page = i; el.style.width = viewport.width + 'px'; el.style.height = viewport.height + 'px';
    const canvas = document.createElement('canvas'); const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(viewport.width * ratio); canvas.height = Math.ceil(viewport.height * ratio); el.append(canvas);
    const overlay = document.createElement('div'); overlay.className = 'overlay'; el.append(overlay);
    const badge = document.createElement('span'); badge.className = 'pagebadge'; badge.textContent = `Page ${i+1}`; el.append(badge); viewer.append(el); p.element = el;
    await p.page.render({canvasContext:canvas.getContext('2d'),viewport,transform:[ratio,0,0,ratio,0,0],annotationMode:pdfjs.AnnotationMode.ENABLE_FORMS}).promise;
    if (generation !== renderVersions[side] || docs[side] !== doc) return;
    for(const f of p.fields) {
      const value = document.createElement('span'); value.className = 'field'; value.textContent = f.checkbox ? '×' : f.text;
      place(value, f); value.style.fontSize = Math.max(7,Math.min(12*scale,f.h*viewport.height*.75)) + 'px'; overlay.append(value);
    }
    addMarks(side, i);
  }
  viewer.scrollTop = scrollRatio * Math.max(0, viewer.scrollHeight-viewer.clientHeight);
}
function place(el,t) { el.style.left = t.x*100+'%'; el.style.top = t.y*100+'%'; el.style.width = t.w*100+'%'; el.style.height = t.h*100+'%'; if(t.angle) { el.style.transformOrigin='0 100%'; el.style.transform=`rotate(${t.angle}rad)`; } }
function addMarks(side,page) {
  const overlay = docs[side]?.pages[page]?.element?.querySelector('.overlay'); if(!overlay) return;
  overlay.querySelectorAll('.mark').forEach(x=>x.remove());
  changes.forEach((change,index) => (side === 0 ? change.old : change.revised).filter(t=>t.page===page).forEach(t=>{
    const mark = document.createElement('span'); mark.className = `mark ${side === 1 ? 'add' : ''} ${selected === index ? 'active' : ''}`; mark.dataset.change = index; place(mark,t); overlay.append(mark);
  }));
}
async function review() {
  if (!docs.every(Boolean) || loading || reviewing) return;
  reviewing = true; controls(); notice(''); status('Comparing text and form values…');
  await new Promise(resolve=>setTimeout(resolve,30));
  try {
    if(docs.some(d=>!d.tokens.length)) throw new Error('One document has no readable text or form values. Run OCR on scanned PDFs before comparing.');
    if(docs.some(d=>d.tokens.length>100000)) throw new Error('There is too much text for this comparison. Please compare smaller PDFs.');
    changes = compareTokens(docs[0].tokens,docs[1].tokens,window.Diff.diffArrays);
    selected = -1;
    docs.forEach((d,side)=>d.pages.forEach((p,i)=>addMarks(side,i)));
    const removed = changes.reduce((n,c)=>n+c.old.length,0), added = changes.reduce((n,c)=>n+c.revised.length,0);
    status(changes.length ? `${changes.length} changes found · ${removed} removed words / values · ${added} added words / values` : 'No text or form-value changes found.');
    const unread = docs.reduce((n,d)=>n+d.emptyPages,0);
    if(unread) notice(`${unread} page(s) have no readable text. Results cover extractable text and filled form values only; image-only content needs OCR.`);
    $('changeCount').textContent = `${changes.length} total`;
    const list = $('changelist'); list.replaceChildren(); $('changes').hidden = false;
    if(!changes.length) { const msg=document.createElement('div'); msg.className='nochange'; msg.textContent='The extracted text and form values match.'; list.append(msg); }
    changes.forEach((c,i)=>{
      const row = document.createElement('button'); row.className='change'; row.dataset.index=i; row.setAttribute('aria-label',`Change ${i+1}`);
      const loc=document.createElement('span'); loc.className='location';
      const lp = c.old[0] || docs[0].tokens[Math.min(c.leftAnchor,docs[0].tokens.length-1)], rp=c.revised[0] || docs[1].tokens[Math.min(c.rightAnchor,docs[1].tokens.length-1)];
      loc.textContent=`#${i+1} · ${c.old.length && c.revised.length ? 'Changed' : c.old.length ? 'Removed' : 'Added'}\nOriginal p.${lp.page+1}\nRevised p.${rp.page+1}`; loc.style.whiteSpace='pre-line';
      const old=document.createElement('span'); old.className='oldtext'; old.textContent=excerpt(c.old) || '—';
      const revised=document.createElement('span'); revised.className='newtext'; revised.textContent=excerpt(c.revised) || '—';
      row.append(loc,old,revised); row.onclick=()=>selectChange(i); list.append(row);
    });
    $('prev').disabled=$('next').disabled=!changes.length; $('current').textContent=changes.length ? `0 / ${changes.length}` : '0 / 0';
  } catch(e) { notice(e.message); status('Comparison could not finish.'); }
  finally { reviewing=false; controls(); }
}
function excerpt(tokens) { const text=tokens.map(t=>t.text).join(' '); return text.length>650 ? text.slice(0,650)+'…' : text; }
function selectChange(index) {
  if(!changes.length) return;
  selected=(index+changes.length)%changes.length; const c=changes[selected];
  document.querySelectorAll('.change').forEach(x=>{ const active=Number(x.dataset.index)===selected; x.classList.toggle('selected',active); x.setAttribute('aria-pressed',String(active)); });
  document.querySelectorAll('.mark').forEach(x=>x.classList.toggle('active',Number(x.dataset.change)===selected));
  [0,1].forEach(side=>{
    const tokens=side===0 ? c.old : c.revised, anchor=side===0?c.leftAnchor:c.rightAnchor;
    const t=tokens[0] || docs[side].tokens[Math.min(anchor,docs[side].tokens.length-1)]; if(!t) return;
    const viewer=$('viewer'+side), page=docs[side].pages[t.page].element;
    viewer.scrollTo({top:page.offsetTop+t.y*page.clientHeight-viewer.clientHeight*.28,left:Math.max(0,t.x*page.clientWidth-viewer.clientWidth*.3),behavior:'smooth'});
  });
  const row=$('changelist').querySelector(`[data-index="${selected}"]`); if(row) $('changelist').scrollTo({top:row.offsetTop-$('changelist').offsetTop,behavior:'smooth'});
  $('current').textContent=`${selected+1} / ${changes.length}`;
}
async function loadFile(side,file) {
  if(!file || reviewing) return;
  if(!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { notice('Please choose a PDF file.'); return; }
  if(file.size > 100*1024*1024) { notice('Please choose a PDF smaller than 100 MB.'); return; }
  try { await loadPDF(side,new Uint8Array(await file.arrayBuffer()),file.name); } catch(e) {notice(e.message);}
}
[0,1].forEach(side=>{
  $('file'+side).onchange=e=>{ const file=e.target.files[0]; e.target.value=''; loadFile(side,file); };
  $('zoom'+side).onchange=()=>render(side).catch(e=>notice(e.message));
  const pane=document.querySelector(`[data-side="${side}"]`);
  pane.ondragover=e=>{e.preventDefault();pane.classList.add('dragging');}; pane.ondragleave=()=>pane.classList.remove('dragging');
  pane.ondrop=e=>{e.preventDefault();pane.classList.remove('dragging');loadFile(side,e.dataTransfer.files[0]);};
});
$('review').onclick=review;
$('highlights').onchange=e=>document.body.classList.toggle('hide-highlights',!e.target.checked);
$('prev').onclick=()=>selectChange(selected-1); $('next').onclick=()=>selectChange(selected+1);
$('sample').onclick=async()=>{
  $('sample').disabled=true;notice('');status('Loading official IRS samples…');
  try {
    const data=await Promise.all(['2023','2024'].map(async year=>{const r=await fetch(`./samples/1065-${year}.pdf`);if(!r.ok)throw new Error('Unable to load sample PDFs.');return new Uint8Array(await r.arrayBuffer());}));
    await Promise.all(data.map((bytes,side)=>loadPDF(side,bytes,`Form 1065 · ${side===0?'2023':'2024'}.pdf`)));
    $('sources').hidden=false;
  }catch(e){notice(e.message);}finally{controls();}
};
let resizeTimer; window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>docs.forEach((d,side)=>{if(d && $('zoom'+side).value==='fit')render(side).catch(e=>notice(e.message));}),200);});
