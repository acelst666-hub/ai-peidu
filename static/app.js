'use strict';
const $ = (s, r=document) => r.querySelector(s);
const view = () => $('#view');
/** remote=Mac Python 服务；local=iPad 独立 IndexedDB */
let API_MODE = 'remote';
/** 运行时配置（含选中即查）；启动时从 /api/settings 灌入 */
let APP_CFG = {
  lookup_enabled: true,
  lookup_engine: 'bing',
  lookup_url: 'https://www.bing.com/search?q={q}',
  lookup_max_chars: 200,
};
const FIELDS = [
  ['summary','一句话主旨'],
  ['thesis','核心论点/结论'],
  ['concepts','关键概念（白话拆解，标出处）'],
  ['quotes','原文金句（带章节/页码）'],
  ['background','思想史背景'],
  ['reality','现实对照（用马克思主义分析当下矛盾）'],
  ['relation','我的关联/思考'],
  ['selfcheck','自检问题'],
  ['writing','写作素材标签'],
];

async function detectApiMode(){
  // 显式强制本地模式（iPad 主屏幕图标可带 ?mode=local）
  if(location.search.includes('mode=local') || localStorage.getItem('ai-reader-mode') === 'local'){
    API_MODE = 'local';
    return;
  }
  // GitHub Pages / 任何非本机静态托管：一律本地 IndexedDB（不影响 Mac 本机 127.0.0.1）
  const host = location.hostname || '';
  if(host && host !== '127.0.0.1' && host !== 'localhost'){
    API_MODE = 'local';
    return;
  }
  try{
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 900);
    const r = await fetch('/api/ping', {signal: c.signal});
    clearTimeout(t);
    if(r.ok){
      const j = await r.json().catch(() => null);
      if(j && j.ok){ API_MODE = 'remote'; return; }
    }
  }catch(_){}
  API_MODE = 'local';
}

async function api(path, method='GET', body=null){
  if(API_MODE === 'local'){
    if(typeof localApi !== 'function') throw new Error('本地模块未加载');
    try{
      return await localApi(path, method, body);
    }catch(e){
      throw new Error(e.message || String(e));
    }
  }
  const opt = {method, headers:{}};
  if(body){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(body); }
  let r;
  try{
    r = await fetch(path, opt);
  }catch(e){
    throw new Error('无法连接本地服务（可能已关闭）。请重新双击「AI陪读」再试。');
  }
  const ct = r.headers.get('Content-Type') || '';
  if(!r.ok){
    const t = await r.text().catch(()=> '');
    throw new Error('请求失败 HTTP '+r.status+(t?('：'+t.slice(0,120)):''));
  }
  return ct.includes('application/json') ? await r.json() : await r.text();
}

function downloadExportText(filename, text){
  const blob = new Blob([text], {type:'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function updateStorageHint(){
  const el = document.querySelector('.side-hint');
  if(!el) return;
  if(API_MODE === 'local'){
    el.innerHTML = 'iPad 独立模式 · 数据存于<br><code>本机浏览器</code><br><span style="font-size:11px;color:#64748b">离线可读 · 联网可用 AI</span>';
  }else{
    el.innerHTML = 'Mac 本地模式 · 笔记存于<br><code>ai-reader/data</code>';
  }
}
function esc(s){ return (s==null?'':String(s)).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
/** 阅读区翻页后滚到页首 */
function scrollPaneTop(el){
  if(!el) return;
  el.scrollTop = 0;
}
/**
 * 对话框滚动定位
 * - bottom：旧行为，贴底
 * - latest-turn：滚到本轮问答开头（优先最后一条「我」的问题，便于从头读 AI 长回复）
 */
function scrollChatAnchor(box, mode){
  if(!box) return;
  if(mode === 'bottom'){ box.scrollTop = box.scrollHeight; return; }
  if(mode === 'top'){ box.scrollTop = 0; return; }
  const msgs = box.querySelectorAll('.msg');
  if(!msgs.length){ box.scrollTop = 0; return; }
  let target = msgs[msgs.length - 1];
  // 若末条是助手回复，且前一条是用户提问，则定位到提问（本轮起点）
  if(msgs.length >= 2 && target.classList.contains('assistant')){
    const prev = msgs[msgs.length - 2];
    if(prev.classList.contains('me') || prev.classList.contains('user')) target = prev;
  } else {
    for(let i = msgs.length - 1; i >= 0; i--){
      if(msgs[i].classList.contains('me') || msgs[i].classList.contains('user')){
        target = msgs[i];
        break;
      }
    }
  }
  const boxTop = box.getBoundingClientRect().top;
  const tTop = target.getBoundingClientRect().top;
  box.scrollTop = Math.max(0, box.scrollTop + (tTop - boxTop) - 4);
}
function inline(s){ return s.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/\*([^*]+)\*/g,'<i>$1</i>'); }
function md(s){
  if(!s) return '';
  const lines = esc(s).split('\n'); let html='', inList=false;
  for(let line of lines){
    if(/^\s*[-*]\s+/.test(line)){ if(!inList){html+='<ul>';inList=true;} html+='<li>'+inline(line.replace(/^\s*[-*]\s+/,''))+'</li>'; continue; }
    if(inList){ html+='</ul>'; inList=false; }
    const h=line.match(/^#{1,4}\s/);
    if(h){ const lvl=h[0].trim().length; html+='<h'+lvl+'>'+inline(line.replace(/^#+\s/,''))+'</h'+lvl+'>'; continue; }
    if(line.trim()===''){ html+='<p></p>'; continue; }
    html+='<p>'+inline(line)+'</p>';
  }
  if(inList) html+='</ul>';
  return html;
}
function cleanChatText(s){
  if(!s) return '';
  return String(s)
    .replace(/```[\s\S]*?```/g, m=>m.replace(/```/g,''))
    .replace(/^\s*---+\s*$/gm,'')
    .replace(/^\s*#{1,6}\s*/gm,'')
    .replace(/^\s*[-*]\s+/gm,'')
    .replace(/^\s*\d+[\.)]\s+/gm,'')
    .replace(/^\s*[（(]?\d+[）)]\s+/gm,'')
    .replace(/\*\*([^*]+)\*\*/g,'$1')
    .replace(/\*([^*]+)\*/g,'$1')
    .replace(/`([^`]+)`/g,'$1')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}
function chatHtml(s){ return esc(cleanChatText(s||'')).replace(/\n/g,'<br>'); }
function toast(msg){ let t=$('#toast'); if(!t){ t=document.createElement('div'); t.id='toast'; t.className='toast'; document.body.appendChild(t);} t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }
function modal(html){ closeModal(); const bg=document.createElement('div'); bg.className='modal-bg'; bg.id='modalBg'; bg.innerHTML='<div class="modal">'+html+'</div>'; bg.onclick=e=>{ if(e.target===bg) closeModal(); }; document.body.appendChild(bg); }
function closeModal(){ const m=$('#modalBg'); if(m) m.remove(); }
function setActive(path){ document.querySelectorAll('#sidebar nav a').forEach(a=>a.classList.toggle('active', a.dataset.route && path.startsWith(a.dataset.route))); }

// ---------------- routes ----------------
// 待编辑的新卡片（从讨论室/录入页"转成卡片"后跳转到独立卡片页）
let pendingNewCard = null;
// 从目录导览点章节时，进入讨论室预选该章节
let pendingChapter = null;
// 从阅读全文/文库导入时，带入讨论室的原文
let pendingContextText = null;
window.addEventListener('hashchange', ()=>{
  persistReadResumeIfReading();
  router();
});
window.addEventListener('DOMContentLoaded', async ()=>{
  await detectApiMode();
  if(API_MODE === 'local'){
    try{ await localInit(); }catch(e){ console.error(e); toast('本地库初始化失败：'+(e&&e.message?e.message:e)); }
    document.body.classList.add('mode-local');
    if('serviceWorker' in navigator){
      // 清掉旧缓存，避免 iPad 一直用坏掉的 local-api
      try{
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('ai-reader-pwa-') && k !== 'ai-reader-pwa-v7').map(k => caches.delete(k)));
        const regs = await navigator.serviceWorker.getRegistrations();
        for(const r of regs){
          if(r.active && !(r.active.scriptURL || '').includes('sw.js')) continue;
        }
      }catch(_){}
      navigator.serviceWorker.register(new URL('static/sw.js?v=20260827f', location.href)).then(reg=>{
        reg.update().catch(()=>{});
      }).catch(()=>{});
    }
  }
  updateStorageHint();
  try{
    const s = await api('/api/settings');
    APP_CFG = Object.assign({}, APP_CFG, s);
  }catch(_){}
  await maybeCloudSyncPullOnStart({ silent: true });
  installCloudSyncLifecycle();
  installReadResumeLifecycle();
  maybeAutoRestoreReading();
  router();
});

function router(){
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  setActive(path);
  let m;
  if(path==='/' || path==='') return renderBooks();
  if((m=path.match(/^\/book\/(.+)\/discuss$/))) return renderDiscuss(m[1]);
  if((m=path.match(/^\/book\/(.+)\/toc$/))) return renderToc(m[1]);
  if((m=path.match(/^\/book\/(.+)\/capture$/))) return renderCapture(m[1]);
  if((m=path.match(/^\/book\/(.+)\/overview$/))) return renderOverview(m[1]);
  if((m=path.match(/^\/book\/(.+)\/read\/chapter\/(.+)$/))) return renderRead(m[1],'chapter',decodeURIComponent(m[2]));
  if((m=path.match(/^\/book\/(.+)\/read\/keyword\/(.+)$/))) return renderRead(m[1],'keyword',decodeURIComponent(m[2]));
  if((m=path.match(/^\/book\/(.+)$/))) return renderBook(m[1]);
  if(path==='/card/new') return renderNewCard();
  if((m=path.match(/^\/card\/(.+)$/))) return renderCard(m[1]);
  if(path==='/plan') return renderPlan();
  if(path==='/search') return renderSearch();
  if(path==='/map') return renderReadingMap();
  if(path==='/settings') return renderSettings();
  if((m=path.match(/^\/book\/(.+)\/read$/))) return renderReader(m[1]);
  view().innerHTML='<div class="card">页面不存在</div>';
}

/** 云同步后局部刷新：不重绘整页，避免清空输入框与聊天区 */
async function refreshViewAfterCloudSync(opts){
  opts = opts || {};
  const hash = location.hash.slice(1) || '/';
  const [path] = hash.split('?');
  let m;
  if((m=path.match(/^\/book\/(.+)\/discuss$/))){
    if($('#msgs')) await loadDiscuss(m[1], {anchor: opts.anchor || 'latest-turn'});
    return;
  }
  if((m=path.match(/^\/book\/(.+)\/read\/chapter\/(.+)$/)) || (m=path.match(/^\/book\/(.+)\/read\/keyword\/(.+)$/))){
    if(READER.chatHistLoaded && $('#r_msgs')) await loadReadChat(m[1], {anchor: opts.anchor || 'latest-turn'});
    return;
  }
  if(path==='/settings'){ renderSettings(); return; }
  if(path==='/' || path===''){ renderBooks(); return; }
}

// ---------------- 书架 ----------------
let shelfSelectMode = false;
let shelfSelected = new Set();

async function renderBooks(){
  const books = await api('/api/books');
  const resume = getReadResume();
  let h = '<h1>书架</h1>';
  if(resume && resume.bid){
    const rb = books.find(x => x.id === resume.bid);
    const title = rb ? rb.title : '上次阅读的书';
    const pageNo = (parseInt(resume.pageIdx, 10) || 0) + 1;
    h += '<div class="card read-resume-card" style="margin-bottom:16px;border:2px solid #fecaca;background:var(--soft)">'
      + '<div style="font-weight:700;margin-bottom:4px">📖 继续阅读</div>'
      + '<div style="font-size:15px;margin-bottom:4px">《'+esc(title)+'》</div>'
      + '<div class="muted">'+esc(resume.term || '')+' · 第 '+pageNo+' 页</div>'
      + '<button class="btn" type="button" style="margin-top:10px" onclick="continueLastReading()">继续阅读</button>'
      + '</div>';
  }
  h += '<div class="row" style="margin-bottom:18px;gap:8px">'
    + '<button class="btn" onclick="showBootstrapBook()">＋ 新建书目（初始化）</button>'
    + '<button class="btn ghost sm" id="shelf_sel_btn" onclick="toggleShelfSelect()">'
    + (shelfSelectMode ? '✓ 选择中' : '☐ 选择删除') + '</button>'
    + '</div>';

  h += '<div class="grid">';
  if(!books.length) h += '<div class="card">还没有书目，点上方"新建书目"。</div>';
  for(const b of books){
    const total=(b.chapters||[]).length, done=(b.chapters||[]).filter(c=>c.progress).length;
    const pct = total? Math.round(done/total*100):0;
    const isSel = shelfSelected.has(b.id);
    if(shelfSelectMode){
      h += '<div class="card book-card select-mode'+(isSel?' selected':'')+'" onclick="toggleShelfPick(\''+b.id+'\')">'
        + '<input type="checkbox" class="shelf-pick" '+(isSel?'checked':'')+' onclick="event.stopPropagation();toggleShelfPick(\''+b.id+'\')">'
        + '<h3>'+esc(b.title)+'</h3>'
        + '<div class="muted">'+(b.author||'')+'</div>'
        + '<div class="muted" style="margin-top:6px">卡片 '+(b.card_count||0)+' · 章节 '+done+'/'+total+'</div>'
        + '<div class="progress-bar"><span style="width:'+pct+'%"></span></div>'
        + '</div>';
    } else {
      h += '<div class="card book-card" onclick="location.hash=\'#/book/'+b.id+'\'">'
        + '<h3>'+esc(b.title)+'</h3>'
        + '<div class="muted">'+(b.author||'')+'</div>'
        + '<div class="muted" style="margin-top:6px">卡片 '+(b.card_count||0)+' · 章节 '+done+'/'+total+'</div>'
        + '<div class="progress-bar"><span style="width:'+pct+'%"></span></div>'
        + '</div>';
    }
  }
  h += '</div>';

  // 浮动操作栏：仅在选择模式 + 至少选了一本时显示
  if(shelfSelectMode && shelfSelected.size > 0){
    h += '<div class="shelf-action-bar">'
      + '<span>已选 <b>'+shelfSelected.size+'</b> 本</span>'
      + '<button class="btn ghost sm" onclick="shelfSelectAll()">全选</button>'
      + '<button class="btn ghost sm" onclick="shelfSelectNone()">全不选</button>'
      + '<button class="btn sec sm" onclick="shelfDeleteSelected()">🗑 删除选中</button>'
      + '<button class="btn ghost sm" onclick="toggleShelfSelect()">取消</button>'
      + '</div>';
  }

  view().innerHTML = h;
}
function toggleShelfSelect(){
  shelfSelectMode = !shelfSelectMode;
  shelfSelected.clear();
  renderBooks();
}
function toggleShelfPick(id){
  if(shelfSelected.has(id)) shelfSelected.delete(id);
  else shelfSelected.add(id);
  renderBooks();
}
async function shelfSelectAll(){
  const books = await api('/api/books');
  for(const b of books) shelfSelected.add(b.id);
  renderBooks();
}
function shelfSelectNone(){
  shelfSelected.clear();
  renderBooks();
}
async function shelfDeleteSelected(){
  if(shelfSelected.size === 0) return;
  const books = await api('/api/books');
  const picked = books.filter(b => shelfSelected.has(b.id));
  const list = picked.map((b,i) => (i+1)+'. '+b.title+'（卡片 '+(b.card_count||0)+' · 章节 '+(b.chapters||[]).length+'）').join('\n');
  if(!confirm('确认删除以下 '+picked.length+' 本书？\n\n'+list+'\n\n（同时会删除它们的卡片、对话、导出等所有数据，不可撤销）')) return;
  for(const b of picked){
    try { await api('/api/books/'+b.id, 'DELETE'); } catch(e) { console.error(e); }
  }
  toast('已删除 '+picked.length+' 本');
  shelfSelected.clear();
  renderBooks();
}
async function delBook(id, title){
  if(!confirm('确认删除《'+title+'》？\n\n（同时会删除它的所有卡片、对话、导出等数据，不可撤销）')) return;
  await api('/api/books/'+id, 'DELETE');
  toast('已删除');
  location.hash = '#/';
}
function showBootstrapBook(){
  modal('<span class="close" onclick="closeModal()">×</span><h2>新建书目（初始化）</h2>'
    + '<p class="muted">推荐上传 PDF / TXT / MD / 图片（OCR）电子书。一次完成：建书目 → 导入正文 → 自动切章 → 自动挂地图节点。</p>'
    + '<div class="field"><label>书名（可留空）</label><input id="bb_title" placeholder="例如：德意志意识形态"></div>'
    + '<div class="field"><label>作者（可选）</label><input id="bb_author" placeholder="马克思、恩格斯"></div>'
    + '<div class="field"><label>简介（可选）</label><input id="bb_desc" placeholder="我的备注"></div>'
    + '<div class="field"><label>上传电子书（推荐）</label><input id="bb_file" type="file" accept=".txt,.md,.pdf,image/*"></div>'
    + '<div class="field"><label>导入链接（可选）</label><input id="bb_url" placeholder="https://..."></div>'
    + '<div class="field"><label>或粘贴正文</label><textarea id="bb_raw" style="min-height:160px" placeholder="粘贴纯文本正文"></textarea></div>'
    + '<div class="row"><button class="btn" onclick="runBootstrapBook()">开始初始化</button><button class="btn ghost" onclick="closeModal()">取消</button></div>');
}
async function runBootstrapBook(){
  let rawText = ($('#bb_raw').value||'').trim();
  const f = $('#bb_file') && $('#bb_file').files && $('#bb_file').files[0] ? $('#bb_file').files[0] : null;
  if(f){
    const name = (f.name||'').toLowerCase();
    if(name.endsWith('.pdf')){
      showBusy('正在解析 PDF…');
      const b64 = await fileToB64(f);
      const r = await api('/api/import','POST',{filename:f.name,content:b64});
      hideBusy();
      if(!r.ok){ toast('PDF 解析失败：'+(r.error||'未知错误')); return; }
      rawText = (r.text||'').trim();
    }else if(/\.(png|jpe?g|webp|bmp)$/.test(name)){
      showBusy('OCR 识别中…');
      try{
        const url = URL.createObjectURL(f);
        const {data}=await Tesseract.recognize(url,'chi_sim+eng');
        URL.revokeObjectURL(url);
        hideBusy();
        rawText = (data.text||'').trim();
      }catch(e){ hideBusy(); toast('OCR 失败：'+e.message); return; }
    }else{
      const text = await f.text();
      const r = await api('/api/import','POST',{filename:f.name,content:text});
      rawText = ((r&&r.text)||text||'').trim();
    }
  }

  const payload = {
    title: ($('#bb_title').value||'').trim(),
    author: ($('#bb_author').value||'').trim(),
    description: ($('#bb_desc').value||'').trim(),
    source_url: ($('#bb_url').value||'').trim(),
    raw_text: rawText,
  };
  showBusy('正在一键初始化新书…');
  const r = await api('/api/book/bootstrap','POST',payload);
  hideBusy();
  if(!r || !r.ok){ toast('初始化失败：'+((r&&r.error)||'未知错误')); return; }
  closeModal();
  toast('初始化完成：已建书目并挂到阅读地图');
  location.hash = '#/book/'+r.book.id;
}

// ---------------- 本书目录导航（首页点书进入） ----------------
let readMode = 'chapter';
let curBookId = null;
async function renderBook(id){
  curBookId = id;
  const b = await api('/api/books/'+id);
  if(b.error){ view().innerHTML='<div class="card">书目不存在</div>'; return; }
  const hasText = !!b.raw_text;
  const m = readMode;
  let h='<div class="row" style="justify-content:space-between;align-items:flex-end"><h1>'+esc(b.title)+'</h1></div>';
  if(b.author) h+='<div class="muted">'+esc(b.author)+'</div>';
  if(b.description) h+='<p class="muted">'+esc(b.description)+'</p>';
  h+='<div class="toolbar row">'
    + (hasText?'<button class="btn sm" onclick="location.hash=\'#/book/'+b.id+'/read\'">📖 阅读全文</button>':'')
    + '<button class="btn sec sm" onclick="openFetchModal(\'book\',\''+b.id+'\')">📥 导入全书原文</button>'
    + '<button class="btn sm" onclick="location.hash=\'#/book/'+b.id+'/overview\'">📊 总览</button>'
    + '<button class="btn sec sm" onclick="exportBook(\''+b.id+'\')">导出</button>'
    + '<button class="btn ghost sm" onclick="delBook(\''+b.id+'\',\''+esc(b.title)+'\')" style="margin-left:auto">🗑 删除本书</button>'
    + '</div>';
  h+='<div class="read-toggle">'
    + '<button class="'+(m==='chapter'?'active':'')+'" onclick="switchReadMode(\'chapter\')">📑 根据章节</button>'
    + '<button class="'+(m==='keyword'?'active':'')+'" onclick="switchReadMode(\'keyword\')">🔑 根据关键词</button>'
    + '</div>';
  if(!hasText){
    h+='<div class="card" style="margin-top:16px"><div class="muted">本书还没有全文。点「📥 导入全书原文」粘贴，或填马克思主义文库链接抓取，导入后即可按章节 / 关键词阅读。</div>'
      + '<div class="row" style="margin-top:10px"><button class="btn sec sm" onclick="openFetchModal(\'book\',\''+b.id+'\')">📥 现在导入</button></div></div>';
  } else if(m==='chapter'){
    const total=(b.chapters||[]).length, done=(b.chapters||[]).filter(c=>c.progress).length;
    h+='<div class="muted" style="margin:14px 0 6px">共 '+total+' 章 · 已读 '+done+' 章（点章节即开始阅读+边读边聊）</div>';
    h+='<div class="toc-list">';
    for(const c of (b.chapters||[])){
      h+='<div class="toc-row'+(c.progress?' done':'')+'" onclick="openChapterRead(\''+b.id+'\',\''+esc(c.title)+'\',true)">'
        + '<input type="checkbox" '+(c.progress?'checked':'')+' onclick="event.stopPropagation();toggleChapter(\''+b.id+'\',\''+c.id+'\')">'
        + '<span class="toc-row-title">'+esc(c.title)+'</span><span class="muted">阅读 ›</span></div>';
    }
    if(!total) h+='<div class="muted">还没有章节。去「📊 总览」添加章节，导入全文后这里就能逐章阅读。</div>';
    h+='</div>';
  } else {
    h+='<div class="muted" style="margin:14px 0 6px">点关键词阅读书中相关内容；也可输入任意关键词检索。</div>';
    h+='<div class="row" style="margin-bottom:10px"><input id="kw_in" placeholder="输入关键词，如：异化、资本、分工" style="flex:1">'
      + '<button class="btn" onclick="openKeywordRead(\''+b.id+'\')">阅读</button></div>';
    const cons=(b.concepts||[]);
    if(cons.length){
      h+='<div class="kw-cloud">';
      for(const c of cons){
        h+='<button class="kw-chip" onclick="location.hash=\'#/book/'+b.id+'/read/keyword/'+encodeURIComponent(c.term)+'\'">'+esc(c.term)+'</button>';
      }
      h+='</div>';
    } else {
      h+='<div class="muted">还没有关键词。在「📊 总览」里添加概念，或直接在上方输入关键词。</div>';
    }
  }
  view().innerHTML=h;
}
function switchReadMode(m){ readMode=m; if(curBookId) renderBook(curBookId); }
function openKeywordRead(bid){
  const v=($('#kw_in')?$('#kw_in').value:'').trim();
  if(!v){ toast('请输入关键词'); return; }
  location.hash='#/book/'+bid+'/read/keyword/'+encodeURIComponent(v);
}
function openChapterRead(bid,title,hasText){
  if(hasText){ location.hash='#/book/'+bid+'/read/chapter/'+encodeURIComponent(title); }
  else { pendingChapter=title; location.hash='#/book/'+bid+'/discuss'; }
}
// ---------------- 总览（概念图谱 / 卡片 / 章节管理） ----------------
async function renderOverview(id){
  const b = await api('/api/books/'+id);
  if(b.error){ view().innerHTML='<div class="card">书目不存在</div>'; return; }
  const cards = await api('/api/books/'+id+'/cards');
  const hasText=!!b.raw_text;
  const total=(b.chapters||[]).length, done=(b.chapters||[]).filter(c=>c.progress).length;
  let h='<div class="row" style="justify-content:space-between"><h1>总览 · '+esc(b.title)+'</h1>'
    + '<div class="row"><button class="btn sm" onclick="location.hash=\'#/book/'+b.id+'\'">‹ 目录导航</button>'
    + (hasText?'<button class="btn sm" onclick="location.hash=\'#/book/'+b.id+'/read\'">📖 阅读全文</button>':'')
    + '<button class="btn sec sm" onclick="openFetchModal(\'book\',\''+b.id+'\')">📥 导入全书原文</button>'
    + '<button class="btn sm" onclick="location.hash=\'#/book/'+b.id+'/toc\'">📑 详细目录</button>'
    + '<button class="btn sec sm" onclick="exportBook(\''+b.id+'\')">导出</button>'
    + '<button class="btn sm" onclick="location.hash=\'#/book/'+b.id+'/capture\'">＋ 录入</button></div></div>';
  if(b.author) h+='<div class="muted">'+esc(b.author)+'</div>';
  if(b.description) h+='<p class="muted">'+esc(b.description)+'</p>';
  h+='<div class="progress-bar" style="max-width:320px"><span style="width:'+(total?Math.round(done/total*100):0)+'%"></span></div>';
  h+='<div class="section-title"><h2>篇章地图</h2><button class="btn ghost sm" onclick="addChapter(\''+b.id+'\')">＋ 章节</button></div><div id="chapters">';
  for(const c of (b.chapters||[])){
    h+='<div class="chapter'+(c.progress?' done':'')+'" data-id="'+c.id+'">'
      + '<input type="checkbox" '+(c.progress?'checked':'')+' onchange="toggleChapter(\''+b.id+'\',\''+c.id+'\')">'
      + '<span class="t" style="cursor:pointer" onclick="openChapterRead(\''+b.id+'\',\''+esc(c.title)+'\','+(hasText?'true':'false')+')">'+esc(c.title)+'</span></div>';
  }
  h+='</div>';
  h+='<div class="section-title"><h2>知识图谱</h2></div>';
  h += '<div class="card kmap-card">';
  h += '<h3 style="margin:0 0 10px">🛤 学习路径</h3>'+renderLearningPath(b);
  h += '<h3 style="margin:18px 0 10px">🧩 概念聚类</h3>'+renderConceptClusters(b);
  h += '<h3 style="margin:18px 0 10px">🔗 概念关系图</h3>'+renderConceptGraph(b, cards);
  h += '</div>';
  h+='<div class="section-title"><h2>概念详情</h2><button class="btn ghost sm" onclick="addConcept(\''+b.id+'\')">＋ 概念</button></div><div id="concepts">';
  for(const c of (b.concepts||[])){
    h+='<div class="concept"><span class="term">'+esc(c.term)+'</span><span class="type">'+esc(c.type||'')+'</span>'
      + '<div class="muted">'+esc(c.note||'')+'</div>'
      + '<div class="row" style="margin-top:6px"><button class="btn ghost sm" onclick="editConcept(\''+b.id+'\',\''+esc(c.term)+'\')">编辑</button>'
      + '<button class="btn ghost sm" onclick="delConcept(\''+b.id+'\',\''+esc(c.term)+'\')">删除</button></div></div>';
  }
  h+='</div>';
  h+='<div class="section-title"><h2>知识卡片（'+(cards.length)+'）</h2></div><div class="grid">';
  for(const c of cards){
    h+='<div class="card book-card" onclick="location.hash=\'#/card/'+c.id+'\'"><div style="font-weight:600">'+(c.chapter_title||'未归章节')+'</div>'
      + '<div class="muted" style="margin-top:4px">'+(esc((c.fields&&c.fields.summary)||'').slice(0,60))+'</div>'
      + (c.tags&&c.tags.length?'<div style="margin-top:6px">'+c.tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')+'</div>';
  }
  h+='</div>';
  view().innerHTML=h;
}
// ---------------- 全书目录导览 ----------------
async function renderToc(bid){
  const b = await api('/api/books/'+bid);
  if(b.error){ view().innerHTML='<div class="card">书目不存在</div>'; return; }
  const cards = await api('/api/books/'+bid+'/cards');
  const chs = b.chapters || [];
  const byChapter = {};
  for(const c of cards){ const t=c.chapter_title||'未归章节'; (byChapter[t]=byChapter[t]||[]).push(c); }
  // 概念 → 出现章节
  const c2ch = {};
  for(const con of (b.concepts||[])){
    const set = new Set();
    for(const c of cards){ if(JSON.stringify(c.fields||{}).includes(con.term)) set.add(c.chapter_title||'未归章节'); }
    if(set.size) c2ch[con.term] = [...set];
  }
  let h='<div class="row" style="justify-content:space-between"><h1>全书目录导览 · '+esc(b.title)+'</h1>'
    + '<button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">← 总览</button></div>';
  h+='<p class="muted">点击任意章节即可进入该章讨论室；下方概念索引显示各概念在哪些章节出现。</p>';
  // 章节横向地图
  h+='<div class="toc-map">';
  chs.forEach((c,i)=>{
    h+='<button class="toc-chip'+(c.progress?' done':'')+'" onclick="openChapterDiscuss(\''+bid+'\',\''+esc(c.title)+'\')">'
      + '<span class="n">'+(i+1)+'</span>'+esc(c.title)+'</button>';
  });
  h+='</div>';
  // 章节明细
  h+='<div class="section-title"><h2>章节明细</h2></div><div class="grid toc-grid">';
  chs.forEach((c,i)=>{
    const cs = byChapter[c.title]||[];
    const summary = cs.length? (cs[0].fields&&cs[0].fields.summary||'') : '';
    const tags = [...new Set(cs.flatMap(x=>x.tags||[]))];
    h+='<div class="card toc-item" onclick="openChapterDiscuss(\''+bid+'\',\''+esc(c.title)+'\')">'
      + '<div class="toc-item-head"><span class="toc-num'+(c.progress?' done':'')+'">'+(i+1)+'</span>'
      + '<span class="toc-title">'+esc(c.title)+'</span>'+(c.progress?'<span class="toc-done">已读</span>':'')+'</div>'
      + (summary?'<div class="toc-sum">'+esc(summary)+'</div>':'<div class="toc-sum muted">暂无卡片摘要</div>')
      + (tags.length?'<div class="toc-tags">'+tags.map(t=>'<span class="tag">'+esc(t)+'</span>').join('')+'</div>':'')
      + '</div>';
  });
  h+='</div>';
  // 概念索引
  const terms = Object.keys(c2ch);
  if(terms.length){
    h+='<div class="section-title"><h2>概念索引（概念 → 出现章节）</h2></div><div class="grid">';
    for(const t of terms){
      h+='<div class="card"><div class="toc-conc">'+esc(t)+'</div><div class="muted" style="margin-top:6px">'
        + c2ch[t].map(x=>'<span class="tag" style="cursor:pointer" onclick="openChapterDiscuss(\''+bid+'\',\''+esc(x)+'\')">'+esc(x)+'</span>').join(' ')
        + '</div></div>';
    }
    h+='</div>';
  }
  view().innerHTML=h;
}
function openChapterDiscuss(bid, title){
  pendingChapter = title;
  location.hash = '#/book/'+bid+'/discuss';
}
// ---------------- 知识图谱：三个可视化辅助函数 ----------------
const CONCEPT_COLORS = {
  '概念':   '#dbeafe', // 蓝
  '人物':   '#fef3c7', // 黄
  '理论':   '#fce7f3', // 粉
  '著作':   '#e0e7ff', // 紫
  '事件':   '#fee2e2', // 红
  'default':'#d1fae5', // 绿
};
function conceptColor(type){
  return CONCEPT_COLORS[type] || CONCEPT_COLORS['default'];
}
function conceptBorder(type){
  const map = {'概念':'#2563eb','人物':'#d97706','理论':'#db2777','著作':'#4338ca','事件':'#dc2626'};
  return map[type] || '#059669';
}
function renderLearningPath(b){
  const chs = b.chapters || [];
  if(!chs.length) return '<div class="muted">还没有章节。</div>';
  // 横向时间线：每章一个节点
  const total = chs.length;
  const done = chs.filter(c=>c.progress).length;
  const pct = Math.round(done/total*100);
  let nodes = '';
  const segW = 100 / Math.max(total,1);
  chs.forEach((c, i) => {
    const left = segW * (i + 0.5);
    nodes += '<div class="lp-node '+(c.progress?'done':'')+'" style="left:'+left.toFixed(2)+'%">'
      + '<div class="lp-dot">'+(i+1)+'</div>'
      + '<div class="lp-title" title="'+esc(c.title)+'">'+esc(c.title)+'</div>'
      + '</div>';
  });
  // 已读进度填充
  const fillW = (done / Math.max(total,1) * 100).toFixed(2);
  let h = '<div class="lp-head"><div class="muted">共 '+total+' 章 · 已读 '+done+' 章（'+pct+'%）</div></div>';
  h += '<div class="lp-track"><div class="lp-line"></div><div class="lp-fill" style="width:'+fillW+'%"></div>'+nodes+'</div>';
  return h;
}
function renderConceptClusters(b){
  const concepts = b.concepts || [];
  if(!concepts.length) return '<div class="muted">还没有概念。点下方「＋ 概念」添加。</div>';
  // 按 type 分组
  const groups = {};
  for(const c of concepts){
    const t = c.type || '其他';
    if(!groups[t]) groups[t] = [];
    groups[t].push(c);
  }
  let h = '<div class="cc-grid">';
  for(const t in groups){
    h += '<div class="cc-group" style="background:'+conceptColor(t)+';border-color:'+conceptBorder(t)+'">';
    h += '<div class="cc-type" style="color:'+conceptBorder(t)+'">'+esc(t)+' <span class="muted">· '+groups[t].length+'</span></div>';
    for(const c of groups[t]){
      h += '<div class="cc-term" title="'+esc(c.note||'')+'">'+esc(c.term)+'</div>';
    }
    h += '</div>';
  }
  h += '</div>';
  return h;
}
function renderConceptGraph(b, cards){
  const concepts = b.concepts || [];
  if(concepts.length < 2) return '<div class="muted">至少添加 2 个概念才能生成关系图。</div>';
  // 卡片里出现的概念 → 跨章连线
  const conceptSet = new Set(concepts.map(c=>c.term));
  // 简单布局：按类型分簇
  const w = 680, h = 320;
  const groups = {};
  for(const c of concepts){
    const t = c.type || '其他';
    if(!groups[t]) groups[t] = [];
    groups[t].push(c);
  }
  const groupKeys = Object.keys(groups);
  // 簇中心（水平均分）
  const groupCenters = {};
  groupKeys.forEach((k, i) => {
    groupCenters[k] = {x: (w / (groupKeys.length+1)) * (i+1), y: h/2};
  });
  // 簇内节点：圆周均布
  const nodes = [];
  for(const k of groupKeys){
    const arr = groups[k];
    const center = groupCenters[k];
    const r = Math.min(110, 30 + arr.length * 8);
    arr.forEach((c, idx) => {
      const ang = (Math.PI*2 / arr.length) * idx - Math.PI/2;
      nodes.push({
        term: c.term, type: k,
        x: center.x + r*Math.cos(ang),
        y: center.y + r*Math.sin(ang),
        color: conceptColor(k), border: conceptBorder(k)
      });
    });
  }
  // 边：来自卡片中同章出现过的概念两两连线（轻度）
  const edges = [];
  for(const card of cards){
    const f = JSON.stringify(card.fields||{});
    const ch = card.chapter_title || '';
    const hit = concepts.filter(c => f.includes(c.term) || (ch && ch.includes(c.term)));
    for(let i=0;i<hit.length;i++){
      for(let j=i+1;j<hit.length;j++){
        const key = [hit[i].term, hit[j].term].sort().join('::');
        if(!edges.find(e=>e.key===key)) edges.push({key, a:hit[i].term, b:hit[j].term});
      }
    }
  }
  // 簇间连一条虚线（视觉提示）
  const crossEdges = [];
  for(let i=0;i<groupKeys.length;i++){
    for(let j=i+1;j<groupKeys.length;j++){
      crossEdges.push({a:groupKeys[i], b:groupKeys[j]});
    }
  }
  const nodeByTerm = {};
  nodes.forEach(n => nodeByTerm[n.term] = n);
  // SVG 输出
  let svg = '<svg viewBox="0 0 '+w+' '+h+'" class="cgraph" preserveAspectRatio="xMidYMid meet">';
  // 簇间虚线
  for(const ce of crossEdges){
    const a = groupCenters[ce.a], b = groupCenters[ce.b];
    svg += '<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="#cbd5e1" stroke-dasharray="3 4" stroke-width="1"/>';
  }
  // 卡片触发的实线
  for(const e of edges){
    const a = nodeByTerm[e.a], b = nodeByTerm[e.b];
    if(!a||!b) continue;
    svg += '<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="#b91c1c" stroke-width="1.2" opacity="0.55"/>';
  }
  // 节点
  for(const n of nodes){
    const r = Math.max(18, Math.min(36, n.term.length*4));
    svg += '<g class="cnode">'
      + '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+r+'" fill="'+n.color+'" stroke="'+n.border+'" stroke-width="1.5"/>'
      + '<text x="'+n.x+'" y="'+n.y+'" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#1f2329" style="pointer-events:none">'+esc(n.term.length>5?n.term.slice(0,5)+'…':n.term)+'</text>'
      + '<title>'+esc(n.term)+'</title>'
      + '</g>';
  }
  // 簇标签
  for(const k of groupKeys){
    const c = groupCenters[k];
    svg += '<text x="'+c.x+'" y="20" text-anchor="middle" font-size="12" font-weight="700" fill="'+conceptBorder(k)+'">'+esc(k)+'</text>';
  }
  svg += '</svg>';
  // 图例
  let legend = '<div class="cgraph-legend">';
  for(const k of groupKeys){
    legend += '<span class="cgraph-leg"><span class="dot" style="background:'+conceptBorder(k)+'"></span>'+esc(k)+'</span>';
  }
  legend += '<span class="cgraph-leg"><span class="line solid"></span>同章卡片连线</span>';
  legend += '<span class="cgraph-leg"><span class="line dashed"></span>类型间</span>';
  legend += '</div>';
  return svg+legend;
}

async function toggleChapter(bid,cid){
  const b=await api('/api/books/'+bid);
  b.chapters=b.chapters.map(c=>c.id===cid?{...c,progress:!c.progress}:c);
  await api('/api/books/'+bid,'PUT',{chapters:b.chapters});
  renderBook(bid);
}
async function addChapter(bid){
  const t=prompt('章节名称：'); if(!t||!t.trim()) return;
  const b=await api('/api/books/'+bid);
  b.chapters=[...b.chapters,{id:Math.random().toString(36).slice(2,10),title:t.trim(),progress:false}];
  await api('/api/books/'+bid,'PUT',{chapters:b.chapters});
  renderBook(bid);
}
function conceptModal(bid, old){
  const c = old ? (api('/api/books/'+bid).then(b=>(b.concepts||[]).find(x=>x.term===old))) : Promise.resolve({});
  c.then(o=>{
    modal('<span class="close" onclick="closeModal()">×</span><h2>'+(old?'编辑概念':'新增概念')+'</h2>'
      + '<div class="field"><label>术语</label><input id="cc_term" value="'+esc(o&&o.term||'')+'"></div>'
      + '<div class="field"><label>类型</label><input id="cc_type" value="'+esc(o&&o.type||'')+'" placeholder="概念/人物/理论"></div>'
      + '<div class="field"><label>说明</label><textarea id="cc_note">'+esc(o&&o.note||'')+'</textarea></div>'
      + '<button class="btn" onclick="saveConcept(\''+bid+'\',\''+esc(old||'')+'\')">保存</button>');
  });
}
function addConcept(bid){ conceptModal(bid,null); }
function editConcept(bid,term){ conceptModal(bid,term); }
async function saveConcept(bid,old){
  const term=$('#cc_term').value.trim(); if(!term){toast('术语必填');return;}
  const b=await api('/api/books/'+bid);
  const list=(b.concepts||[]).filter(x=>x.term!==old);
  list.push({term,type:$('#cc_type').value.trim(),note:$('#cc_note').value.trim()});
  await api('/api/books/'+bid,'PUT',{concepts:list});
  closeModal(); renderBook(bid);
}
async function delConcept(bid,term){
  if(!confirm('删除概念「'+term+'」？')) return;
  const b=await api('/api/books/'+bid);
  await api('/api/books/'+bid,'PUT',{concepts:(b.concepts||[]).filter(x=>x.term!==term)});
  renderBook(bid);
}
async function exportBook(bid){
  if(API_MODE === 'local'){
    const md = await api('/api/export/book/'+bid);
    downloadExportText('book-'+bid+'.md', md);
    return;
  }
  window.open('/api/export/book/'+bid,'_blank');
}

// ---------------- 录入 ----------------
async function renderCapture(bid){
  const b=await api('/api/books/'+bid);
  let opts='<option value="">未归章节</option>';
  for(const c of (b.chapters||[])) opts+='<option value="'+c.id+'">'+esc(c.title)+'</option>';
  view().innerHTML='<div class="row" style="justify-content:space-between"><h1>录入内容</h1>'
    + '<button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">← 返回总览</button></div>'
    + '<div class="card"><div class="row" style="margin-bottom:12px">'
    + '<div style="flex:1;min-width:200px"><label class="field"><span>归属章节</span><select id="cap_chapter">'+opts+'</select></label></div>'
    + '<div style="flex:1;min-width:200px"><label class="field"><span>模式</span><select id="cap_mode"><option>批量整理</option><option>即时讨论</option></select></label></div></div>'
    + '<div class="field"><label>原文 / 笔记 <span class="hint">粘贴文本，或用下方按钮识别图片、导入文件</span></label>'
    + '<textarea id="raw" placeholder="把在微信读书里读到的段落粘到这里…"></textarea></div>'
    + '<div class="row">'
    + '<label class="btn sec sm">📷 识别图片<input id="cap_img" type="file" accept="image/*" hidden></label>'
    + '<label class="btn sec sm">📄 导入文件<input id="cap_file" type="file" accept=".txt,.md,.pdf" hidden></label>'
    + '<button class="btn sec sm" onclick="openFetchModal(\'capture\',\''+bid+'\')">📥 从文库导入全文</button>'
    + '<button class="btn" id="genBtn" onclick="generateCard(\''+bid+'\')">✨ 生成卡片</button>'
    + '<button class="btn ghost" onclick="showCardForm(\''+bid+'\',null,{})">✍️ 手动录入</button>'
    + '</div></div><div id="formSlot"></div>';
  $('#cap_img').addEventListener('change', e=>{ if(e.target.files[0]) ocrImage(e.target.files[0]); });
  $('#cap_file').addEventListener('change', e=>{ if(e.target.files[0]) importFile(e.target.files[0]); });
}
async function ocrImage(file){
  if(typeof Tesseract==='undefined'){ toast('OCR 库未加载（需联网加载 tesseract.js）'); return; }
  toast('OCR 识别中…（首次需下载中文模型，稍候）');
  try{
    const url=URL.createObjectURL(file);
    const {data}=await Tesseract.recognize(url,'chi_sim+eng');
    $('#raw').value += (data.text||'');
    URL.revokeObjectURL(url);
    toast('OCR 完成');
  }catch(e){ toast('OCR 失败：'+e.message); }
}
async function importFile(file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.pdf')){
    const b64=await fileToB64(file);
    const r=await api('/api/import','POST',{filename:file.name,content:b64});
    if(r.ok){ $('#raw').value+=r.text; toast('PDF 解析完成'); } else toast(r.error||'导入失败');
  } else {
    const text=await file.text();
    const r=await api('/api/import','POST',{filename:file.name,content:text});
    $('#raw').value += (r.text||text); toast('已导入');
  }
}
function fileToB64(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res((fr.result.split(',')[1])); fr.onerror=rej; fr.readAsDataURL(file); }); }

async function generateCard(bid){
  const text=$('#raw').value.trim();
  if(!text){ toast('请先填入内容'); return; }
  const chSel=$('#cap_chapter'); const chId=chSel.value;
  const chTitle=chId?(chSel.options[chSel.selectedIndex].text):'';
  $('#genBtn').textContent='生成中…';
  const r=await api('/api/generate','POST',{text, mode:$('#cap_mode').value, chapter_title:chTitle, book_id:bid});
  $('#genBtn').textContent='✨ 生成卡片';
  if(r.configured===false){
    modal('<span class="close" onclick="closeModal()">×</span><h2>未配置 AI 接口 · 兜底方案</h2>'
      + '<p class="muted">把下面这段提示词发给我（AI 陪读对话），我会返回 JSON；把 JSON 粘回下方即可自动填充。</p>'
      + '<textarea readonly id="pf">'+esc(r.prompt)+'</textarea>'
      + '<div class="row"><button class="btn sec sm" onclick="navigator.clipboard.writeText($(\'#pf\').value);toast(\'已复制\')">复制提示词</button></div>'
      + '<div class="field" style="margin-top:12px"><label>粘贴 AI 返回的 JSON</label><textarea id="pf_json" placeholder="在此粘贴 JSON"></textarea></div>'
      + '<button class="btn" onclick="fillFromJson(\''+bid+'\',\''+chId+'\',\''+esc(chTitle)+'\')">解析并填充</button>');
    return;
  }
  if(r.error){ toast('生成出错：'+r.error); return; }
  if(!r.fields){ toast('生成结果无法解析为卡片'); return; }
  showCardForm(bid, chId, r.fields, chTitle);
}
function fillFromJson(bid,chId,chTitle){
  let v=$('#pf_json').value.trim();
  try{ v=JSON.parse(v); }catch(e){ const m=v.match(/\{[\s\S]*\}/); if(m){ try{v=JSON.parse(m[0]);}catch(_){ toast('JSON 解析失败'); return; } } else { toast('JSON 解析失败'); return; } }
  closeModal(); showCardForm(bid,chId,v,chTitle);
}
function showCardForm(bid, chId, prefill, chTitle){
  let opts='<option value="">未归章节</option>';
  api('/api/books/'+bid).then(b=>{
    for(const c of (b.chapters||[])) opts+='<option value="'+c.id+'" '+(c.id===chId?'selected':'')+'>'+esc(c.title)+'</option>';
    let h='<div class="card"><h2>编辑知识卡片</h2>'
      + '<div class="field"><label>归属章节</label><select id="f_chapter">'+opts+'</select></div>';
    for(const [k,lab] of FIELDS){
      h+='<div class="field"><label>'+lab+'</label><textarea id="f_'+k+'">'+esc(prefill&&prefill[k]||'')+'</textarea></div>';
    }
    h+='<div class="field"><label>标签（逗号分隔，便于检索）</label><input id="f_tags" value=""></div>';
    h+='<div class="row"><button class="btn" onclick="saveCard(\''+bid+'\')">保存卡片</button>'
      + '<button class="btn ghost" onclick="location.hash=\'#/book/'+bid+'\'">取消</button></div></div>';
    $('#formSlot').innerHTML=h;
    if(chTitle && !chId) $('#f_chapter').selectedIndex=0;
  });
}
async function saveCard(bid){
  const fields={};
  for(const [k] of FIELDS) fields[k]=$('#f_'+k).value.trim();
  const chSel=$('#f_chapter'); const chId=chSel.value; const chTitle=chId?chSel.options[chSel.selectedIndex].text:'';
  const tags=$('#f_tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  const card=await api('/api/cards','POST',{book_id:bid, chapter_id:chId, chapter_title:chTitle, raw:$('#raw')?$('#raw').value:'', fields, tags});
  toast('已保存');
  location.hash='#/card/'+card.id;
}

// ---------------- 讨论室（同步阅读 · 左右分栏） ----------------
let DISCUSS = {pages:[], idx:0, msgs:[], threadId:''};
function discussThreadId(){
  const ch = ($('#d_chapter')&&$('#d_chapter').value) ? $('#d_chapter').value : 'default';
  return 'discuss::'+ch;
}
function chatSpeaker(sp){
  if(sp==='me') return '我';
  if(sp==='marx') return '马克思';
  if(sp==='neutral' || sp==='partner' || sp==='shenjing') return '神鲸';
  return '神鲸';
}
function chatClass(sp){ return sp==='me' ? 'me' : 'assistant'; }
function detectTarget(text){
  const s=(text||'').trim();
  if(/^@\s*(马克思|marx)(?:\s|[：:，,]|$)/i.test(s)) return 'marx';
  if(/^@\s*(神鲸|ai|partner|neutral|陪读伙伴)(?:\s|[：:，,]|$)/i.test(s)) return 'shenjing';
  return 'shenjing';
}
function stripTargetPrefix(text){
  return String(text||'').replace(/^\s*@\s*([\u4e00-\u9fa5A-Za-z]+)\s*[：:，,]?\s*/, '').trim();
}

async function renderDiscuss(bid){
  const b=await api('/api/books/'+bid);
  if(b.error){ view().innerHTML='<div class="card">书目不存在</div>'; return; }
  await loadBookMarks(bid);
  const ctx = b.discussion_context || {text:'',chapter_title:'',updated_at:null};
  const ctxOverridden = pendingContextText != null;
  const initCtx = ctxOverridden ? pendingContextText : (ctx.text||'');
  if(ctxOverridden){ ctx.text = pendingContextText; pendingContextText = null; }
  const selChapter = pendingChapter || ctx.chapter_title; pendingChapter=null;
  let opts='<option value="">（不指定章节）</option>';
  for(const c of (b.chapters||[])) opts+='<option value="'+esc(c.title)+'"'+(selChapter===c.title?' selected':'')+'>'+esc(c.title)+'</option>';
  view().innerHTML='<div class="row" style="justify-content:space-between"><h1>同步阅读 · '+esc(b.title)+'</h1>'
    + '<div class="row"><button class="btn sec sm" onclick="toCardFromDiscuss(\''+bid+'\')">转成卡片</button>'
    + '<button class="btn ghost sm" onclick="clearDiscuss(\''+bid+'\')">清空对话</button>'
    + '<button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">← 总览</button></div></div>'
    + '<div class="discuss-layout">'
    +   '<div class="discuss-pane discuss-left">'
    +     '<div class="card discuss-source-card">'
    +       '<div class="row" style="justify-content:space-between;align-items:center;margin-bottom:8px">'
    +         '<div style="font-weight:700">📖 当前阅读原文</div>'
    +         '<div class="row">'
    +           '<button class="btn sec sm" onclick="openContextInput(\''+bid+'\')">＋ 粘贴</button>'
    +           '<button class="btn sec sm" onclick="openFetchModal(\'discuss\',\''+bid+'\')">📥 文库导入</button>'
    +           '<label class="btn sec sm" style="cursor:pointer">📷 识别 / 📄 导入<input id="d_ctx_file" type="file" accept="image/*,.txt,.md,.pdf" hidden></label>'
    +           '<button class="btn ghost sm" onclick="clearContext(\''+bid+'\')">清空</button>'
    +         '</div></div>'
    +       '<textarea id="d_ctx_text" style="display:none">'+esc(initCtx||'')+'</textarea>'
    +       '<div id="d_reader" class="discuss-source-view"></div>'
    +       '<div class="reader-nav"><button class="btn ghost sm" id="d_prev">‹ 上一页</button>'
    +         '<span id="d_pageno" class="muted">第 1 / 1 页</span>'
    +         '<button class="btn ghost sm" id="d_next">下一页 ›</button>'
    +         '<button class="btn" id="d_gen" style="margin-left:auto">✨ 基于当前阅读生成卡片</button></div>'
    +       '<div class="muted" style="margin:8px 2px 0">'+(ctx.updated_at?'最近更新：'+ctx.updated_at:'尚未填入；点「发送」时会自动保存到当前讨论上下文')+'</div>'
    +     '</div>'
    +   '</div>'
    +   '<div class="discuss-pane discuss-right">'
    +     '<div class="card discuss-chat-card">'
    +       '<div class="row" style="margin-bottom:10px;align-items:center;flex-wrap:wrap;gap:8px">'
    +         '<div class="muted" style="font-size:13px">📌 关联章节</div>'
    +         '<select id="d_chapter" style="flex:1;max-width:300px">'+opts+'</select>'
    +         '<button type="button" class="btn sec sm" id="d_chat_marks">💭 标注</button>'
    +       '</div>'
    +       '<div class="muted" style="font-size:12px;margin:0 0 6px">对话气泡内选中文字 → 右键可划线/写想法（与阅读器标注同一套）</div>'
    +       '<div id="msgs" class="discuss-box chat-box"></div>'
    +       '<div id="d_status" class="chat-status"></div>'
    +       '<div class="chat-savebar"><label class="selall"><input type="checkbox" id="d_selall"> 全选</label>'
    +         '<label class="selall"><input type="checkbox" id="d_save_marks"> 含标注</label>'
    +         '<span id="d_selcount" class="muted">已选 0 条</span>'
    +         '<button class="btn sec sm" id="d_save">💾 保存选中为读书笔记</button></div>'
    +       '<div class="muted" style="font-size:12px;margin:2px 0 6px">@马克思 只叫马克思回复；@神鲸 只叫神鲸回复（默认神鲸）</div>'
    +       '<div class="row" style="align-items:flex-end;margin-top:8px">'
    +         '<textarea id="d_input" placeholder="输入问题（可用 @马克思 / @神鲸 开头）…（Enter 发送，Shift+Enter 换行）" style="flex:1;min-height:60px"></textarea>'
    +         '<button class="btn" id="d_send" onclick="sendDiscuss(\''+bid+'\')">发送</button>'
    +       '</div>'
    +     '</div>'
    +   '</div>'
    + '</div>';
  $('#d_input').addEventListener('keydown', e=>{
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendDiscuss(bid); }
  });
  $('#d_ctx_file').addEventListener('change', e=>{ if(e.target.files[0]) importContextFile(bid, e.target.files[0]); });
  $('#d_prev').onclick = discussPrevPage;
  $('#d_next').onclick = discussNextPage;
  $('#d_gen').onclick = ()=>genDiscussCard(bid);
  $('#d_save').onclick = ()=>saveNotesFrom('d');
  $('#d_selall').onchange = (e)=>{ document.querySelectorAll('.d-msgsel-cb').forEach(cb=>cb.checked=e.target.checked); updateDiscussSelCount(); };
  $('#d_chapter').onchange = async ()=>{ DISCUSS.threadId = discussThreadId(); await loadDiscuss(bid); };
  const dMarks=$('#d_chat_marks'); if(dMarks) dMarks.onclick = ()=>{ MARK_UI.activeSurface='discuss'; openMarkPanel(); };
  const dSaveMarks=$('#d_save_marks'); if(dSaveMarks) dSaveMarks.onchange = updateDiscussSelCount;
  renderDiscussReader($('#d_ctx_text').value || '');
  DISCUSS.threadId = discussThreadId();
  bindChatMarkEvents('#msgs', 'discuss');
  await loadDiscuss(bid);
  if(ctxOverridden){ await saveContext(bid, true); }
}
function renderDiscussReader(text){
  const raw = (text||'').trim();
  const pages = paginate(cleanReadText(raw), 1800).map(arr => esc(arr.join('\n')).replace(/\n/g,'<br>'));
  DISCUSS.pages = pages.length ? pages : ['<span class="muted">还没有载入原文。可点上方「＋ 粘贴 / 文库导入」。</span>'];
  DISCUSS.idx = 0;
  drawDiscussReader();
}
function drawDiscussReader(){
  const box=$('#d_reader'); if(!box) return;
  box.innerHTML = DISCUSS.pages[DISCUSS.idx] || '<span class="muted">无内容</span>';
  const no=$('#d_pageno'); if(no) no.textContent='第 '+(DISCUSS.idx+1)+' / '+DISCUSS.pages.length+' 页';
  const prev=$('#d_prev'), next=$('#d_next');
  if(prev) prev.disabled = DISCUSS.idx<=0;
  if(next) next.disabled = DISCUSS.idx>=DISCUSS.pages.length-1;
  scrollPaneTop(box);
}
function discussPrevPage(){ if(DISCUSS.idx>0){ DISCUSS.idx--; drawDiscussReader(); } }
function discussNextPage(){ if(DISCUSS.idx<DISCUSS.pages.length-1){ DISCUSS.idx++; drawDiscussReader(); } }

async function loadDiscuss(bid, opts){
  const tid = DISCUSS.threadId || discussThreadId();
  const msgs=await api('/api/books/'+bid+'/messages?thread_id='+encodeURIComponent(tid));
  DISCUSS.msgs = msgs || [];
  const box=$('#msgs');
  if(!DISCUSS.msgs.length){ box.innerHTML='<div class="muted" style="padding:10px">还没有对话。你可以直接提问，或先选择一个建议问题。</div>'; updateDiscussSelCount(); return; }
  box.innerHTML=DISCUSS.msgs.map((m,i)=>{
    const sp=m.speaker || (m.role==='user' ? 'me' : 'shenjing');
    const who = chatSpeaker(sp);
    const cls = chatClass(sp);
    const sel = sp==='me' ? '我的问题' : '回答';
    return '<div class="msg '+cls+'"><div class="msg-top"><span class="who">'+who+'</span>'
      + '<label class="msgsel"><input type="checkbox" class="d-msgsel-cb" data-i="'+i+'"> '+sel+'</label></div>'
      + '<div class="bubble">'+applyMarksToHtml(chatHtml(m.content||''))+'</div></div>';
  }).join('');
  const mode = (opts && opts.anchor === 'preserve') ? null : ((opts && opts.anchor) || 'bottom');
  if(mode) requestAnimationFrame(()=>scrollChatAnchor(box, mode));
  box.querySelectorAll('.d-msgsel-cb').forEach(cb=>cb.onchange=updateDiscussSelCount);
  updateDiscussSelCount();
}
function updateDiscussSelCount(){
  const n=document.querySelectorAll('.d-msgsel-cb:checked').length;
  const marksOn = !!($('#d_save_marks') && $('#d_save_marks').checked);
  const el=$('#d_selcount'); if(el) el.textContent='已选 '+n+' 条';
  const save=$('#d_save'); if(save) save.disabled=(n===0 && !marksOn);
}
async function saveContext(bid, silent){
  const t = $('#d_ctx_text') ? $('#d_ctx_text').value : '';
  const ch = $('#d_chapter') ? $('#d_chapter').value : '';
  const b = await api('/api/books/'+bid);
  b.discussion_context = {text: t, chapter_title: ch, updated_at: new Date().toISOString()};
  await api('/api/books/'+bid,'PUT',{discussion_context: b.discussion_context});
  renderDiscussReader(t);
  if(!silent) toast('已保存原文');
  return b.discussion_context;
}
async function clearContext(bid){
  if(!confirm('清空左侧原文与关联章节？')) return;
  const b = await api('/api/books/'+bid);
  b.discussion_context = {text:'',chapter_title:'',updated_at:null};
  await api('/api/books/'+bid,'PUT',{discussion_context: b.discussion_context});
  $('#d_ctx_text').value = '';
  $('#d_chapter').value = '';
  renderDiscussReader('');
  toast('已清空');
}
function openContextInput(bid){
  modal('<span class="close" onclick="closeModal()">×</span><h2>粘贴原文 / 笔记</h2>'
    + '<p class="muted">把微信读书里读到的段落粘到下面。点保存即会自动放进左侧原文区，AI 讨论时会优先围绕它回答。</p>'
    + '<textarea id="d_ctx_paste" style="min-height:320px"></textarea>'
    + '<div class="row" style="margin-top:10px"><button class="btn" onclick="pasteContext(\''+bid+'\')">保存到左侧</button>'
    + '<button class="btn ghost" onclick="closeModal()">取消</button></div>');
}
function pasteContext(bid){
  const txt=$('#d_ctx_paste').value;
  if(!txt.trim()){ toast('内容为空'); return; }
  $('#d_ctx_text').value = txt;
  renderDiscussReader(txt);
  closeModal();
  saveContext(bid);
}
async function importContextFile(bid, file){
  const name=file.name.toLowerCase();
  if(name.endsWith('.pdf')){
    toast('PDF 解析中…');
    const b64=await fileToB64(file);
    const r=await api('/api/import','POST',{filename:file.name,content:b64});
    if(r.ok){ $('#d_ctx_text').value=r.text; renderDiscussReader(r.text); await saveContext(bid,true); toast('PDF 已导入'); }
    else toast(r.error||'导入失败');
  } else if(/\.(png|jpe?g|webp|bmp)$/.test(name)){
    toast('OCR 识别中…（首次需下载中文模型）');
    try{
      const url=URL.createObjectURL(file);
      const {data}=await Tesseract.recognize(url,'chi_sim+eng');
      $('#d_ctx_text').value += (data.text||'');
      renderDiscussReader($('#d_ctx_text').value);
      URL.revokeObjectURL(url);
      await saveContext(bid,true);
      toast('OCR 完成');
    }catch(e){ toast('OCR 失败：'+e.message); }
  } else {
    const text=await file.text();
    const r=await api('/api/import','POST',{filename:file.name,content:text});
    $('#d_ctx_text').value = r.text||text;
    renderDiscussReader($('#d_ctx_text').value);
    await saveContext(bid,true);
    toast('已导入');
  }
}
async function sendDiscuss(bid){
  const raw=$('#d_input').value.trim();
  if(!raw){ toast('请输入内容'); return; }
  const target = detectTarget(raw);
  const sendBtn=$('#d_send');
  const tid = DISCUSS.threadId || discussThreadId();
  if(sendBtn){ sendBtn.disabled=true; sendBtn.textContent='生成中…'; }
  showDiscussStatus('正在等待 '+(target==='marx'?'马克思':'神鲸')+' 回答…');
  renderDiscussTyping(target);
  try{
    const ctx = await saveContext(bid, true);
    const r=await api('/api/chat','POST',{book_id:bid, content:raw, chapter_title:ctx.chapter_title||'', context_text:ctx.text||'', target, thread_id:tid});
    hideDiscussStatus();
    if(r.error){ toast('出错：'+r.error); await loadDiscuss(bid, {anchor:'latest-turn'}); return; }
    $('#d_input').value='';
    await loadDiscuss(bid, {anchor:'latest-turn'});
    if(typeof scheduleCloudSyncPush === 'function') scheduleCloudSyncPush();
    if(r.configured===false){
      const pf = r.prompt || '';
      modal('<span class="close" onclick="closeModal()">×</span><h2>未配置 AI 接口 · 讨论兜底</h2>'
        + '<p class="muted">你刚才的话已保存。把下面提示词发给我（AI 陪读对话），把回复粘到下方即可存入此讨论。</p>'
        + '<textarea readonly id="dp">'+esc(pf)+'</textarea>'
        + '<div class="row"><button class="btn sec sm" onclick="navigator.clipboard.writeText($(\'#dp\').value);toast(\'已复制\')">复制提示词</button></div>'
        + '<div class="field" style="margin-top:12px"><label>粘贴 AI 回复</label><textarea id="dp_reply" placeholder="在此粘贴 AI 的回复全文"></textarea></div>'
        + '<button class="btn" onclick="saveDiscussReply(\''+bid+'\')">存入讨论</button>');
    }
  }catch(e){
    hideDiscussStatus();
    toast(e.message||String(e));
  }finally{
    if(sendBtn){ sendBtn.disabled=false; sendBtn.textContent='发送'; }
  }
}
function showDiscussStatus(txt){
  const el=$('#d_status'); if(!el) return;
  el.innerHTML='<span class="spinner sm"></span> '+esc(txt);
  el.style.display='flex';
}
function hideDiscussStatus(){ const el=$('#d_status'); if(el) el.style.display='none'; }
function renderDiscussTyping(target){
  const box=$('#msgs'); if(!box) return;
  const who = target==='marx' ? '马克思' : '神鲸';
  box.innerHTML='<div class="msg assistant"><div class="msg-top"><span class="who">'+who+'</span></div>'
    + '<div class="bubble typing"><span class="spinner sm"></span> 正在思考中…</div></div>';
}
async function saveDiscussReply(bid){
  const txt=$('#dp_reply').value.trim();
  if(!txt){ toast('请粘贴 AI 回复'); return; }
  await api('/api/books/'+bid+'/messages','POST',{role:'assistant', speaker:'shenjing', content:txt, thread_id:DISCUSS.threadId||discussThreadId()});
  closeModal(); await loadDiscuss(bid, {anchor:'latest-turn'}); toast('已存入讨论');
  if(typeof scheduleCloudSyncPush === 'function') scheduleCloudSyncPush();
}
async function genDiscussCard(bid){
  const text = ($('#d_ctx_text') ? $('#d_ctx_text').value : '').trim();
  const chSel=$('#d_chapter'); const chTitle=chSel?chSel.value:'';
  if(!text){ toast('请先在左侧载入原文'); return; }
  showBusy('正在生成知识卡片…');
  const r=await api('/api/generate','POST',{text, mode:'批量整理', chapter_title:chTitle, book_id:bid});
  hideBusy();
  if(r.configured===false){
    modal('<span class="close" onclick="closeModal()">×</span><h2>未配置 AI 接口 · 兜底</h2>'
      + '<p class="muted">把下面提示词发给我，返回 JSON 后粘回即可自动填充卡片。</p>'
      + '<textarea readonly id="pf">'+esc(r.prompt)+'</textarea>'
      + '<div class="row"><button class="btn sec sm" onclick="navigator.clipboard.writeText($(\'#pf\').value);toast(\'已复制\')">复制提示词</button></div>'
      + '<div class="field" style="margin-top:12px"><label>粘贴 AI 返回的 JSON</label><textarea id="pf_json" placeholder="在此粘贴 JSON"></textarea></div>'
      + '<button class="btn" onclick="fillToNewCard(\''+bid+'\',\'\',\''+esc(chTitle)+'\')">解析并填充</button>');
    return;
  }
  if(r.error){ toast('生成出错：'+r.error); return; }
  if(!r.fields){ toast('生成结果无法解析为卡片'); return; }
  openCardForm(bid,'',r.fields,chTitle);
}
function collectMarksForExport(surfaceHint){
  const marks = bookMarks();
  if(surfaceHint === 'discuss'){
    return marks.filter(m => m.has_thought && m.chapter === discussThreadId() && (m.quote||'').trim());
  }
  if(surfaceHint === 'read-chat' || markSurface() === 'read'){
    const rid = readThreadId();
    const ck = chapterKey();
    const seen = new Set();
    return marks.filter(m => {
      if(!m.has_thought || !(m.quote||'').trim()) return false;
      if(m.chapter !== rid && m.chapter !== ck) return false;
      if(seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }
  return thoughtMarks().filter(m => (m.quote||'').trim());
}
async function saveNotesFrom(prefix){
  const cls = prefix==='d' ? '.d-msgsel-cb' : '.msgsel-cb';
  const list = prefix==='d' ? DISCUSS.msgs : CHAT_MSGS;
  const sel=[...document.querySelectorAll(cls+':checked')].map(cb=>parseInt(cb.dataset.i));
  const marksEl = $('#'+(prefix==='d'?'d_save_marks':'r_save_marks'));
  const includeMarks = !!(marksEl && marksEl.checked);
  if(!sel.length && !includeMarks){ toast('请勾选对话内容，或勾选「含标注」'); return; }
  const bid = prefix==='d' ? ((location.hash.match(/^#\/book\/([^/]+)/)||[])[1]) : READER.bid;
  if(prefix==='d') MARK_UI.activeSurface = 'discuss';
  else MARK_UI.activeSurface = 'read-chat';
  const order=sel.slice().sort((a,b)=>a-b);
  const messages = [];
  for(const i of order){
    const m=list[i]; if(!m) continue;
    const sp=m.speaker || (m.role==='user'?'me':'shenjing');
    const who = sp==='me' ? '我（问题）' : sp==='marx' ? '马克思' : '神鲸';
    messages.push({who, content: m.content||''});
  }
  const marks = includeMarks ? collectMarksForExport(prefix==='d' ? 'discuss' : 'read-chat') : [];
  const md = await buildReadingNotesMd({
    bid,
    contextLabel: markContextLabel(),
    messages,
    marks,
  });
  downloadMarkdown(md, '读书笔记-'+(await bookTitle(bid))+'-'+dateStr());
  toast('已保存读书笔记到本地');
}
async function clearDiscuss(bid){
  if(!confirm('清空当前章节聊天内容？')) return;
  const all = await api('/api/books/'+bid+'/messages');
  const tid = DISCUSS.threadId || discussThreadId();
  const keep = (all||[]).filter(x => (x.thread_id||'') !== tid).sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  await api('/api/books/'+bid+'/messages','DELETE');
  for(const m of keep){
    await api('/api/books/'+bid+'/messages','POST',{role:m.role, speaker:m.speaker, content:m.content, thread_id:m.thread_id||''});
  }
  await loadDiscuss(bid); toast('已清空当前章节聊天');
}
async function toCardFromDiscuss(bid){
  const msgs=await api('/api/books/'+bid+'/messages');
  if(!msgs.length){ toast('还没有讨论内容'); return; }
  const transcript=msgs.map(m=>(m.role==='user'?'[我] ':'[陪读] ')+m.content).join('\n\n');
  const chSel=$('#d_chapter'); const chTitle=chSel.value;
  const r=await api('/api/generate','POST',{text:transcript, mode:'批量整理', chapter_title:chTitle, book_id:bid});
  if(r.configured===false){
    modal('<span class="close" onclick="closeModal()">×</span><h2>未配置 AI 接口 · 兜底</h2>'
      + '<p class="muted">把下面提示词发给我，返回 JSON 后粘回即可自动填充卡片。</p>'
      + '<textarea readonly id="pf">'+esc(r.prompt)+'</textarea>'
      + '<div class="row"><button class="btn sec sm" onclick="navigator.clipboard.writeText($(\'#pf\').value);toast(\'已复制\')">复制提示词</button></div>'
      + '<div class="field" style="margin-top:12px"><label>粘贴 AI 返回的 JSON</label><textarea id="pf_json" placeholder="在此粘贴 JSON"></textarea></div>'
      + '<button class="btn" onclick="fillToNewCard(\''+bid+'\',\'\',\''+esc(chTitle)+'\')">解析并填充</button>');
    return;
  }
  if(r.error){ toast('生成出错：'+r.error); return; }
  if(!r.fields){ toast('生成结果无法解析为卡片'); return; }
  // 跳转到独立的"编辑卡片"页面，不与讨论页混在一起
  openCardForm(bid, '', r.fields, chTitle);
}
// 把预填内容暂存，跳到独立卡片编辑页（导航分流，讨论页只管讨论）
function openCardForm(bid, chId, prefill, chTitle){
  pendingNewCard = {bid, chId: chId||'', prefill: prefill||{}, chTitle: chTitle||''};
  location.hash = '#/card/new';
}
async function renderNewCard(){
  if(!pendingNewCard){ view().innerHTML='<div class="card">没有待编辑的卡片。<a href="#/">返回书架</a></div>'; return; }
  const {bid, chId, prefill, chTitle} = pendingNewCard;
  const b = await api('/api/books/'+bid);
  let opts='<option value="">未归章节</option>';
  for(const c of (b.chapters||[])) opts+='<option value="'+c.id+'"'+(c.id===chId?' selected':'')+'>'+esc(c.title)+'</option>';
  let h='<div class="row" style="justify-content:space-between;align-items:center"><h1>编辑知识卡片</h1>'
    + '<button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">取消</button></div>'
    + '<div class="card"><div class="field"><label>归属章节</label><select id="f_chapter">'+opts+'</select></div>';
  for(const [k,lab] of FIELDS) h+='<div class="field"><label>'+lab+'</label><textarea id="f_'+k+'">'+esc(prefill[k]||'')+'</textarea></div>';
  h+='<div class="field"><label>标签（逗号分隔，便于检索）</label><input id="f_tags" value=""></div>';
  h+='<div class="row"><button class="btn" onclick="saveNewCard()">保存卡片</button></div></div>';
  view().innerHTML=h;
}
async function saveNewCard(){
  const p = pendingNewCard; if(!p) return;
  const fields={};
  for(const [k] of FIELDS) fields[k]=$('#f_'+k).value.trim();
  const chSel=$('#f_chapter'); const chId=chSel.value; const chTitle=chId?chSel.options[chSel.selectedIndex].text:'';
  const tags=$('#f_tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  const card=await api('/api/cards','POST',{book_id:p.bid, chapter_id:chId, chapter_title:chTitle, raw:'', fields, tags});
  pendingNewCard=null;
  location.hash='#/card/'+card.id;
}
function fillToNewCard(bid,chId,chTitle){
  let v=$('#pf_json').value.trim();
  try{ v=JSON.parse(v); }catch(e){ const m=v.match(/\{[\s\S]*\}/); if(m){ try{v=JSON.parse(m[0]);}catch(_){ toast('JSON 解析失败'); return; } } else { toast('JSON 解析失败'); return; } }
  closeModal();
  openCardForm(bid, chId, v, chTitle);
}

// ---------------- 卡片详情（清爽分层风格） ----------------
async function renderCard(id){
  const c=await api('/api/cards/'+id);
  if(c.error){ view().innerHTML='<div class="card">卡片不存在</div>'; return; }
  const f = c.fields || {};
  const ICONS = {
    summary:'📌', thesis:'🎯', concepts:'💡', quotes:'✒️',
    background:'📚', reality:'⚡', relation:'🔗', selfcheck:'❓', writing:'🏷️'
  };
  const row = (icon,label,body)=>'<section class="kcard-sec"><div class="klabel"><span>'+icon+'</span>'+label+'</div><div class="kbody">'+md(body)+'</div></section>';
  let h='<div class="row" style="justify-content:space-between;align-items:center"><a class="muted" href="#/book/'+c.book_id+'/overview">← 返回总览</a>'
    + '<div class="row"><button class="btn sec sm" onclick="exportCard(\''+c.id+'\')">导出 MD</button>'
    + '<button class="btn ghost sm" onclick="editCard(\''+c.id+'\')">编辑</button>'
    + '<button class="btn ghost sm" onclick="delCard(\''+c.id+'\')">删除</button></div></div>';
  h += '<article class="kcard-v3">';
  h += '<header class="kcard-head">';
  h += '<div class="kcard-chapter">'+esc(c.chapter_title||'未归章节')+'</div>';
  if(f.summary) h += '<h1 class="kcard-title">'+esc(f.summary)+'</h1>';
  if(c.tags&&c.tags.length) h += '<div class="kcard-tags">'+c.tags.map(t=>'<span class="ktag">#'+esc(t)+'</span>').join('')+'</div>';
  h += '<div class="kcard-meta">'+(c.created_at||'')+'</div>';
  h += '</header>';
  if(f.thesis)    h += row(ICONS.thesis,'核心论点',f.thesis);
  if(f.concepts)  h += row(ICONS.concepts,'关键概念（白话拆解）',f.concepts);
  if(f.background) h += row(ICONS.background,'思想史背景',f.background);
  if(f.relation)  h += row(ICONS.relation,'我的关联 / 思考',f.relation);
  if(f.selfcheck) h += row(ICONS.selfcheck,'自检问题',f.selfcheck);
  if(f.writing)   h += row(ICONS.writing,'写作素材标签',f.writing);
  if(f.quotes) h += '<section class="kcard-sec kc-quote"><div class="klabel"><span>'+ICONS.quotes+'</span>原文金句</div><div class="kbody">'+md(f.quotes)+'</div></section>';
  if(f.reality) h += '<section class="kcard-sec kc-reality"><div class="klabel"><span>'+ICONS.reality+'</span>现实对照（用马克思主义分析当下矛盾）</div><div class="kbody">'+md(f.reality)+'</div></section>';
  h += '</article>';
  view().innerHTML=h;
}
async function exportCard(id){
  if(API_MODE === 'local'){
    const md = await api('/api/export/card/'+id);
    downloadExportText('card-'+id+'.md', md);
    return;
  }
  window.open('/api/export/card/'+id,'_blank');
}
async function editCard(id){
  const c=await api('/api/cards/'+id);
  let h='<div class="card"><h2>编辑卡片</h2>';
  for(const [k,lab] of FIELDS) h+='<div class="field"><label>'+lab+'</label><textarea id="e_'+k+'">'+esc(c.fields&&c.fields[k]||'')+'</textarea></div>';
  h+='<div class="field"><label>标签（逗号分隔）</label><input id="e_tags" value="'+esc((c.tags||[]).join('，'))+'"></div>';
  h+='<div class="row"><button class="btn" onclick="updateCard(\''+id+'\')">保存</button>'
    + '<button class="btn ghost" onclick="location.hash=\'#/card/'+id+'\'">取消</button></div></div>';
  view().innerHTML=h;
}
async function updateCard(id){
  const fields={}; for(const [k] of FIELDS) fields[k]=$('#e_'+k).value.trim();
  const tags=$('#e_tags').value.split(/[,，]/).map(s=>s.trim()).filter(Boolean);
  await api('/api/cards/'+id,'PUT',{fields,tags});
  toast('已更新'); location.hash='#/card/'+id;
}
async function delCard(id){
  if(!confirm('删除这张卡片？')) return;
  await api('/api/cards/'+id,'DELETE');
  toast('已删除'); history.back();
}

// ---------------- 检索（全文） ----------------
async function renderSearch(){
  let opts='<option value="">全部书目</option>';
  try{ const bs=await api('/api/books'); for(const b of (bs||[])) opts+='<option value="'+esc(b.id)+'">'+esc(b.title)+'</option>'; }catch(e){}
  view().innerHTML='<h1>检索</h1>'
    + '<div class="card"><div class="row">'
    + '<input id="q" placeholder="搜任意关键词，跨全书全文检索…" style="flex:1">'
    + '<select id="scope" style="max-width:170px">'+opts+'</select>'
    + '<button class="btn" onclick="doSearch()">搜索</button></div>'
    + '<div class="muted" style="margin-top:8px">在已导入全文的书目中检索任意关键词；点结果直接跳到命中章节。</div>'
    + '<div id="results" style="margin-top:14px"></div></div>';
  $('#q').addEventListener('keydown',e=>{ if(e.key==='Enter') doSearch(); });
  setTimeout(()=>$('#q').focus(),50);
}
async function doSearch(){
  const q=$('#q').value.trim(); if(!q){ toast('请输入关键词'); return; }
  const scope=$('#scope')?$('#scope').value:'';
  let url='/api/search?q='+encodeURIComponent(q);
  if(scope) url+='&book_id='+encodeURIComponent(scope);
  const r=await api(url);
  let h='<div class="muted">找到 '+r.length+' 个章节命中</div>';
  if(!r.length) h+='<div class="card">没有匹配。可能该书目尚未导入全文，或换个关键词试试。</div>';
  for(const it of r){
    const chap=it.chapter||'';
    const link = chap
      ? '#/book/'+it.bid+'/read/chapter/'+encodeURIComponent(chap)
      : '#/book/'+it.bid+'/read/keyword/'+encodeURIComponent(q);
    const kwLink = '#/book/'+it.bid+'/read/keyword/'+encodeURIComponent(q);
    h+='<div class="card book-card search-card" onclick="location.hash=\''+link+'\'">'
      + '<div class="sc-head"><span class="sc-book">'+esc(it.book_title)+'</span>'
      + (it.author?' <span class="muted">'+esc(it.author)+'</span>':'')
      + ' <span class="pill">'+(chap||'全书')+'</span>'
      + ' <span class="muted">'+it.hits+' 处命中</span></div>'
      + '<div class="snippet">'+highlightAll(it.snippet||'', q)+'</div>'
      + '<div class="sc-actions" onclick="event.stopPropagation()">'
      + '<a class="lk" href="#/book/'+it.bid+'" onclick="event.stopPropagation()">📖 书目</a>'
      + '<a class="lk" href="'+kwLink+'" onclick="event.stopPropagation()">🔑 看全部命中</a>'
      + '</div></div>';
  }
  $('#results').innerHTML=h;
}
function highlightAll(text, q){
  const terms=q.split(/\s+/).filter(Boolean).map(esc);
  let e=esc(text);
  for(const t of terms){ if(t) e=e.split(t).join('<mark>'+t+'</mark>'); }
  return e;
}

// ---------------- 设置 ----------------
async function renderSettings(){
  const s=await api('/api/settings');
  APP_CFG = Object.assign({}, APP_CFG, s);
  const ok = s.api_base && s.api_key;
  const eng = s.lookup_engine || 'bing';
  const engOpts = [
    ['bing','必应'],
    ['baidu','百度'],
    ['custom','自定义 URL（含 {q}）'],
  ].map(([v,lab])=>'<option value="'+v+'"'+(eng===v?' selected':'')+'>'+lab+'</option>').join('');
  view().innerHTML='<h1>设置</h1>'
    + '<div class="card"><div class="muted" style="margin-bottom:10px">AI 生成卡片：当前状态 <span class="pill">'+(ok?'已配置，可一键生成':'未配置，使用提示词兜底')+'</span></div>'
    + '<div class="field"><label>API Base（OpenAI 兼容，如 https://api.openai.com/v1）</label><input id="s_base" value="'+esc(s.api_base||'')+'"></div>'
    + '<div class="field"><label>API Key</label><input id="s_key" type="password" value="'+esc(s.api_key||'')+'"></div>'
    + '<div class="field"><label>模型名</label><input id="s_model" value="'+esc(s.model||'gpt-4o-mini')+'"></div>'
    + '<button class="btn" onclick="saveSettings()">保存</button>'
    + '<p class="muted" style="margin-top:14px">未配置时，点"生成卡片"会给出提示词，你在 AI 陪读对话里生成后粘回即可。</p></div>'
    + '<div class="card"><h2>选中即查</h2>'
    + '<p class="muted" style="margin-bottom:10px">在对话气泡、原文阅读区、知识卡片正文中划词，旁侧出现 🔍；点击后新开标签页搜索（默认必应）。</p>'
    + '<label class="check-row"><input type="checkbox" id="s_lookup_on"'+(s.lookup_enabled!==false?' checked':'')+'><span>启用选中即查</span></label>'
    + '<div class="field"><label>搜索引擎</label><select id="s_lookup_eng">'+engOpts+'</select></div>'
    + '<div class="field" id="s_lookup_url_wrap"'+(eng==='custom'?'':' style="display:none"')+'><label>自定义搜索 URL（用 <code>{q}</code> 表示关键词）</label>'
    + '<input id="s_lookup_url" value="'+esc(s.lookup_url||'https://www.bing.com/search?q={q}')+'"></div>'
    + '<div class="field"><label>最长选区字数</label><input id="s_lookup_max" type="number" min="20" max="500" value="'+(s.lookup_max_chars||200)+'" style="max-width:120px"></div>'
    + '<button class="btn" onclick="saveSettings()">保存</button></div>'
    + '<div class="card"><h2>云同步（Mac ↔ iPad）</h2>'
    + '<p class="muted" style="margin-bottom:10px">用 GitHub <b>私有 Gist</b> 同步划线/想法与聊天记录（不含全书正文）。<br>'
    + '主屏幕 App <b>不用刷新网页</b>：打开/切回 App 会自动拉取；也可点侧栏 <b>☁ 同步</b>。笔记保存后会自动上传。</p>'
    + '<label class="check-row"><input type="checkbox" id="s_sync_on"'+(s.sync_enabled?' checked':'')+'><span>启用云同步</span></label>'
    + '<div class="field"><label>GitHub Token（classic，勾选 gist）</label><input id="s_sync_token" type="password" value="'+esc(s.sync_github_token||'')+'" placeholder="ghp_…"></div>'
    + '<div class="field"><label>Gist ID（首次上传后自动填写，两端填同一个）</label><input id="s_sync_gist" value="'+esc(s.sync_gist_id||'')+'" placeholder="首次可留空，点上传后自动生成"></div>'
    + '<div class="field"><label>本机名称</label><input id="s_sync_device" value="'+esc(s.sync_device_name|| (API_MODE==='local'?'ipad':'mac'))+'" style="max-width:160px"></div>'
    + '<label class="check-row"><input type="checkbox" id="s_sync_pull"'+(s.sync_auto_pull!==false?' checked':'')+'><span>打开/切回 App 时静默拉取（不刷新整页，不打断正在看的对话）</span></label>'
    + '<label class="check-row"><input type="checkbox" id="s_sync_push"'+(s.sync_auto_push!==false?' checked':'')+'><span>笔记/聊天保存后自动上传</span></label>'
    + '<div class="row" style="gap:10px;flex-wrap:wrap;margin-top:8px">'
    + '<button class="btn" type="button" onclick="uiCloudSyncNow()">☁ 立即同步</button>'
    + '<button class="btn sec" type="button" onclick="saveSettings().then(()=>uiCloudSyncPush())">仅上传</button>'
    + '<button class="btn sec" type="button" onclick="saveSettings().then(()=>uiCloudSyncPull())">仅拉取</button>'
    + '<button class="btn ghost" type="button" onclick="saveSettings()">保存同步设置</button>'
    + '</div></div>'
    + (API_MODE === 'local'
      ? '<div class="card"><h2>书库同步（Mac ↔ iPad）</h2>'
        + '<p class="muted" style="margin-bottom:10px">在 Mac 端导出书库包，拷到 iPad（AirDrop / 文件 App），在此导入。出门不带电脑时，阅读、划线、聊天记录都在 iPad 本地。</p>'
        + '<div class="row" style="gap:10px;flex-wrap:wrap">'
        + '<button class="btn sec" type="button" onclick="exportLibraryBundle()">📤 导出书库包</button>'
        + '<label class="btn sec" style="cursor:pointer">📥 导入书库包<input id="lib_import" type="file" accept=".json,application/json" hidden onchange="importLibraryBundleFromFile(this.files[0]);this.value=\'\'"></label>'
        + '</div></div>'
      : '<div class="card"><h2>书库同步（Mac ↔ iPad）</h2>'
        + '<p class="muted" style="margin-bottom:10px">出门前导出书库包给 iPad；回家后可在 iPad 导出、在此导入合并。详见 <code>iPad独立版.md</code>。</p>'
        + '<div class="row" style="gap:10px;flex-wrap:wrap">'
        + '<button class="btn sec" type="button" onclick="exportLibraryBundleMac()">📤 导出书库包</button>'
        + '<label class="btn sec" style="cursor:pointer">📥 导入书库包<input id="lib_import_mac" type="file" accept=".json,application/json" hidden onchange="importLibraryBundleMacFile(this.files[0]);this.value=\'\'"></label>'
        + '</div></div>')
    + '<div class="card"><h2>数据维护</h2><p class="muted">马恩全集补漏：仅补抓缺失章节，不重跑全量导入。</p>'
    + '<div class="row"><button class="btn sec sm" onclick="runMarxRepair()">🩹 补漏马恩全集</button>'
    + '<input id="repair_vol" placeholder="可选：卷号，如 28" style="max-width:180px"></div>'
    + '<div id="repair_out" class="muted" style="margin-top:10px"></div></div>'
    + '<div class="card"><h2>关于</h2><p class="muted">'+(API_MODE==='local'
      ? 'iPad 独立模式：数据存于浏览器 IndexedDB，离线可读；联网并在上方配置 API 后，聊天室与卡片生成与 Mac 端一致。PDF 导入需联网加载 PDF.js。'
      : 'Mac 本地模式：数据存于 <code>ai-reader/data</code>。图片 OCR 由浏览器端 tesseract.js 完成。PDF 导入依赖系统 <code>pdftotext</code>。')+'</p></div>';
  const engSel = $('#s_lookup_eng');
  if(engSel) engSel.onchange = ()=>{
    const wrap = $('#s_lookup_url_wrap');
    if(wrap) wrap.style.display = engSel.value==='custom' ? '' : 'none';
  };
}
function downloadJsonFile(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
async function exportLibraryBundleMac(){
  showBusy('正在打包书库…');
  try{
    const bundle = await api('/api/sync/export');
    downloadJsonFile('AI陪读-书库包-'+dateStr()+'.json', bundle);
    toast('书库包已导出（'+(bundle.books||[]).length+' 本书）');
  }catch(e){
    toast('导出失败：'+(e.message||e));
  }finally{
    hideBusy();
  }
}
async function importLibraryBundleMacFile(file){
  if(!file) return;
  if(!confirm('导入将合并书库包中的书目与卡片（同 ID 会覆盖）。继续？')) return;
  showBusy('正在导入书库…');
  try{
    const bundle = JSON.parse(await file.text());
    const r = await api('/api/sync/import', 'POST', bundle);
    toast('已导入 '+(r.books||0)+' 本书');
    location.hash = '#/';
    router();
  }catch(e){
    toast('导入失败：'+(e.message||e));
  }finally{
    hideBusy();
  }
}

async function saveSettings(opts){
  opts = opts || {};
  const eng = ($('#s_lookup_eng')&&$('#s_lookup_eng').value) || 'bing';
  let syncOn = !!($('#s_sync_on')&&$('#s_sync_on').checked);
  const syncToken = ($('#s_sync_token')&&$('#s_sync_token').value.trim()) || '';
  // 点同步时：填了 Token 就视为开启，避免漏勾选
  if(opts.forSync && syncToken) syncOn = true;
  const payload = {
    api_base:$('#s_base').value.trim(),
    api_key:$('#s_key').value.trim(),
    model:$('#s_model').value.trim(),
    lookup_enabled: !!($('#s_lookup_on')&&$('#s_lookup_on').checked),
    lookup_engine: eng,
    lookup_max_chars: Math.max(20, Math.min(500, parseInt(($('#s_lookup_max')&&$('#s_lookup_max').value)||200,10)||200)),
    sync_enabled: syncOn,
    sync_github_token: syncToken,
    sync_gist_id: ($('#s_sync_gist')&&$('#s_sync_gist').value.trim()) || '',
    sync_device_name: ($('#s_sync_device')&&$('#s_sync_device').value.trim()) || (API_MODE==='local'?'ipad':'mac'),
    sync_auto_pull: !!($('#s_sync_pull')&&$('#s_sync_pull').checked),
    sync_auto_push: !!($('#s_sync_push')&&$('#s_sync_push').checked),
  };
  if(eng==='custom'){
    payload.lookup_url = ($('#s_lookup_url')&&$('#s_lookup_url').value.trim()) || 'https://www.bing.com/search?q={q}';
  }
  const s = await api('/api/settings','POST', payload);
  APP_CFG = Object.assign({}, APP_CFG, s);
  if(!opts.silent){ toast('已保存'); renderSettings(); }
  return s;
}
async function runMarxRepair(){
  const vol = ($('#repair_vol')?$('#repair_vol').value:'').trim();
  const out = $('#repair_out');
  if(out) out.textContent = '补漏中，请稍候…';
  showBusy('正在补漏马恩全集…');
  const r = await api('/api/repair/marx','POST',{vol});
  hideBusy();
  const msg = '检查卷册 '+(r.checked||0)+'，命中书目 '+(r.books||0)+'，补回章节 '+(r.fixed_chapters||0)
    + ((r.errors&&r.errors.length)?('，失败 '+r.errors.length+' 条'):'，无失败');
  if(out) out.textContent = msg;
  toast(msg);
}

// ---------------- 学习清单（用户自定义） ----------------
let currentPlan = null;
async function renderPlan(){
  const plan = await api('/api/plans');
  currentPlan = plan || {};
  if(!Array.isArray(currentPlan.custom_books)) currentPlan.custom_books = [];
  const books = currentPlan.custom_books;
  const done = books.filter(x=>x.done).length;
  const total = books.length;
  const pct = total ? Math.round(done/total*100) : 0;

  let h = '<div class="row" style="justify-content:space-between;align-items:flex-end"><h1>🗂 学习清单</h1>'
    + '<button class="btn" onclick="openPlanBookModal()">＋ 添加书目</button></div>'
    + '<div class="card plan-intro">已移除固定学习路线。这里改为你自己维护的阅读清单（更灵活，后续可再升级成阅读地图）。</div>'
    + '<div class="progress-bar" style="max-width:420px;margin:10px 0 18px"><span style="width:'+pct+'%"></span></div>'
    + '<div class="muted" style="margin-bottom:10px">已完成 '+done+' / '+total+' 本</div>';

  if(!books.length){
    h += '<div class="card">还没有书目，点击右上角「＋ 添加书目」开始制定你的阅读计划。</div>';
    view().innerHTML = h;
    return;
  }

  h += '<div class="timeline">';
  books.forEach((b, i)=>{
    h += '<div class="plan-phase'+(b.done?' done':'')+'">'
      + '<div class="pp-head"><label class="pp-check"><input type="checkbox" '+(b.done?'checked':'')+' onchange="togglePlanBook('+i+')">'
      + '<span class="pp-num">'+(i+1)+'</span></label><div class="pp-title">'+esc(b.name||'未命名书目')+'</div></div>'
      + (b.url?'<div class="pp-why"><a class="res-name" href="'+esc(b.url)+'" target="_blank" rel="noopener">打开链接</a></div>':'')
      + (b.note?'<div class="pp-why">'+esc(b.note)+'</div>':'')
      + '<div class="row" style="margin-top:10px"><button class="btn ghost sm" onclick="editPlanBook('+i+')">编辑</button>'
      + '<button class="btn ghost sm" onclick="delPlanBook('+i+')">删除</button></div>'
      + '</div>';
  });
  h += '</div>';
  view().innerHTML = h;
}
async function savePlanState(){
  await api('/api/plans','PUT',currentPlan);
}
async function togglePlanBook(i){
  if(!currentPlan || !currentPlan.custom_books || !currentPlan.custom_books[i]) return;
  currentPlan.custom_books[i].done = !currentPlan.custom_books[i].done;
  await savePlanState();
  renderPlan();
}
// ---------------- 阅读地图（基于 learn-anything-24h 思路） ----------------
let RM_STATE = {map:null, books:[], customBooks:[], edit:false};

function gridPos(index){
  const col = index % 4;
  const row = Math.floor(index / 4);
  return {x: 11 + col * 25.5, y: 19 + row * 44};
}
function ensureNodeLinks(m){
  (m.concepts||[]).forEach(c=>{ if(!Array.isArray(c.links)) c.links=[]; });
  if(!m.positions || typeof m.positions!=='object') m.positions = {};
  (m.concepts||[]).forEach((c,i)=>{ if(!m.positions[c.id]) m.positions[c.id] = gridPos(i); });
  return m;
}
function firstLink(links){ return (links||[]).find(x=>x && (x.book_id || x.url)); }
function goNodeLink(link){
  if(!link) return;
  if(link.book_id){ location.hash = '#/book/'+link.book_id; return; }
  if(link.url){ window.open(link.url, '_blank', 'noopener'); }
}

async function renderReadingMap(){
  const [m0, books, plan, histories] = await Promise.all([api('/api/reading-map'), api('/api/books'), api('/api/plans'), api('/api/map-plans')]);
  const m = ensureNodeLinks(m0 || {});
  RM_STATE.map = m;
  RM_STATE.books = books || [];
  RM_STATE.customBooks = (plan && plan.custom_books) ? plan.custom_books : [];
  RM_STATE.histories = histories || [];

  let h = '<div class="row" style="justify-content:space-between;align-items:flex-end"><h1>🗺 '+esc(m.title||'阅读地图')+'</h1>'
    + '<div class="row"><button class="btn" onclick="openMapPlanGenerator()">生成新计划</button>'
    + '<button class="btn ghost sm" onclick="openMapHistory()">历史计划</button>'
    + '<button class="btn ghost sm" onclick="toggleMapEdit()">'+(RM_STATE.edit?'退出编辑':'编辑模式')+'</button>'
    + '<button class="btn sec sm" onclick="saveReadingMap()">保存地图</button></div></div>';
  h += '<p class="muted" style="margin:-6px 0 14px">'+esc(m.subtitle||'')+'</p>';
  h += '<div class="card rm-outcome"><div class="rm-klabel">🎯 学完你要能做什么</div><div class="rm-body">'+chatHtml(m.target_outcome||'')+'</div></div>';

  h += '<div class="card"><div class="rm-klabel" style="margin-bottom:8px">🌐 核心概念地图（可拖拽微调）</div>'
    + '<div class="muted" style="font-size:12px;margin-bottom:10px">连线逻辑：A→B 表示“B 的理解以前置 A 为条件”。编辑模式下可拖拽节点，连线会实时跟随。</div>'
    + '<div class="rm-graph" id="rm_graph"></div>'
    + '<div id="rm_rel" class="rm-rel"></div></div>';

  h += '<div class="card"><div class="rm-klabel" style="margin-bottom:10px">⏱ 24 小时冲刺安排</div><div class="rm-sched">';
  (m.schedule||[]).forEach(s=>{
    h += '<div class="rm-slot"><div class="rm-slot-time">'+esc(s.slot||'')+'</div>'
      + '<div class="rm-slot-body"><div class="rm-slot-focus">'+esc(s.focus||'')+'</div><div class="rm-slot-do">'+chatHtml(s.do||'')+'</div></div></div>';
  });
  h += '</div></div>';

  h += '<div class="card"><div class="rm-klabel" style="margin-bottom:10px">✍️ 主动练习（防“看懂错觉”）</div>';
  (m.exercises||[]).forEach(e=>{
    const lvl = e.level==='warm-up'?'热身':(e.level==='applied'?'应用':'硬核');
    h += '<div class="rm-ex"><span class="rm-ex-tag">'+lvl+'</span>'+chatHtml(e.q||'')+'</div>';
  });
  h += '</div>';

  h += '<div class="card"><div class="rm-klabel" style="margin-bottom:10px">🚩 常见误区陷阱</div><ul class="rm-mis">';
  (m.misconceptions||[]).forEach(x=>{ h += '<li>'+chatHtml(x)+'</li>'; });
  h += '</ul></div>';

  h += '<div class="card"><div class="rm-klabel" style="margin-bottom:10px">📦 最终产出物</div><div class="rm-body">'+chatHtml(m.final_artifact||'')+'</div></div>';
  h += '<div class="card"><div class="rm-klabel" style="margin-bottom:10px">🔁 7 天巩固计划</div><ol class="rm-next">';
  (m.next7||[]).forEach(x=>{ h += '<li>'+chatHtml(x)+'</li>'; });
  h += '</ol><div class="row" style="margin-top:12px"><button class="btn" onclick="mapToCard()">生成我的笔记骨架</button></div></div>';

  view().innerHTML = h;
  drawMapGraph(m);
}

const RM_DRAG = {active:false,id:null};
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function drawMapGraph(m){
  const nodes = m.concepts||[];
  const edges = m.edges||[];
  const stage = $('#rm_graph');
  if(!stage) return;
  stage.classList.toggle('edit', !!RM_STATE.edit);
  const W = stage.clientWidth || 1000;
  const H = stage.clientHeight || 420;
  const pos = m.positions || {};

  const lines = edges.map(([a,b])=>{
    const pa=pos[a], pb=pos[b];
    if(!pa||!pb) return '';
    const x1=pa.x/100*W, y1=pa.y/100*H, x2=pb.x/100*W, y2=pb.y/100*H;
    return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" class="rm-edge" marker-end="url(#arrow)"/>';
  }).join('');

  const nodesHtml = nodes.map((n,i)=>{
    const p = pos[n.id] || gridPos(i);
    const main = firstLink(n.links);
    const links = (n.links||[]).slice(0,3).map((lk,idx)=>{
      const lab = lk.title || lk.name || lk.term || '链接'+(idx+1);
      return '<button class="rm-link" onclick="goNodeLink(RM_STATE.map.concepts['+i+'].links['+idx+'])">'+esc(lab)+'</button>';
    }).join('');
    const dragAttr = RM_STATE.edit ? 'onpointerdown="startDragNode(\''+n.id+'\',event)"' : '';
    return '<div class="rm-node" style="left:'+p.x+'%;top:'+p.y+'%" '+dragAttr+'>'
      + '<div class="rm-node-term" '+(main?'onclick="goNodeLink(firstLink(RM_STATE.map.concepts['+i+'].links))" style="cursor:pointer"':'')+'>'+esc(n.term)+'</div>'
      + '<div class="rm-node-note">'+esc(n.note||'')+'</div>'
      + '<div class="rm-links">'+links+'</div>'
      + (RM_STATE.edit?('<button class="btn ghost sm" style="margin-top:6px" onclick="event.stopPropagation();openMapNodeEditor(\''+n.id+'\')">编辑节点</button>'):'')
      + '</div>';
  }).join('');

  const svg = '<svg viewBox="0 0 '+W+' '+H+'" class="rm-svg" preserveAspectRatio="none"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/></marker></defs>'+lines+'</svg>';
  stage.innerHTML = svg + nodesHtml;

  const nameById = Object.fromEntries(nodes.map(x=>[x.id,x.term]));
  const rel = $('#rm_rel');
  if(rel){
    rel.innerHTML = edges.map(([a,b])=>'<span class="rm-rel-item">'+esc(nameById[a]||a)+' → '+esc(nameById[b]||b)+'（先修）</span>').join('');
  }
}

function startDragNode(id, ev){
  if(!RM_STATE.edit) return;
  RM_DRAG.active = true;
  RM_DRAG.id = id;
  ev.preventDefault();
}
window.addEventListener('pointermove', (ev)=>{
  if(!RM_DRAG.active || !RM_DRAG.id || !RM_STATE.map) return;
  const stage = $('#rm_graph'); if(!stage) return;
  const rect = stage.getBoundingClientRect();
  const x = clamp(((ev.clientX - rect.left) / rect.width) * 100, 10, 90);
  const y = clamp(((ev.clientY - rect.top) / rect.height) * 100, 12, 88);
  RM_STATE.map.positions[RM_DRAG.id] = {x,y};
  drawMapGraph(RM_STATE.map);
});
window.addEventListener('pointerup', ()=>{
  if(!RM_DRAG.active) return;
  RM_DRAG.active = false;
  RM_DRAG.id = null;
});
window.addEventListener('resize', ()=>{
  if(location.hash.startsWith('#/map') && RM_STATE.map) drawMapGraph(RM_STATE.map);
});

function toggleMapEdit(){ RM_STATE.edit = !RM_STATE.edit; renderReadingMap(); }

function openMapNodeEditor(id){
  const m = RM_STATE.map; if(!m) return;
  const idx = (m.concepts||[]).findIndex(x=>x.id===id); if(idx<0) return;
  const node = m.concepts[idx];
  const picked = new Set((node.links||[]).map(x => (x.book_id?('s:'+x.book_id):('c:'+(x.name||x.title||'')))));
  const shelf = (RM_STATE.books||[]).map(b=>'<label class="check-row muted-weight"><input type="checkbox" class="mnk" data-kind="shelf" data-id="'+b.id+'" '+(picked.has('s:'+b.id)?'checked':'')+'><span>'+esc(b.title)+'</span></label>').join('');
  const custom = (RM_STATE.customBooks||[]).map((b,i)=>'<label class="check-row muted-weight"><input type="checkbox" class="mnk" data-kind="custom" data-id="'+i+'" '+(picked.has('c:'+(b.name||''))?'checked':'')+'><span>'+esc(b.name||('书目'+(i+1)))+'</span></label>').join('');
  modal('<span class="close" onclick="closeModal()">×</span><h2>编辑节点：'+esc(node.term)+'</h2>'
    + '<div class="field"><label>概念名</label><input id="mn_term" value="'+esc(node.term||'')+'"></div>'
    + '<div class="field"><label>说明</label><textarea id="mn_note">'+esc(node.note||'')+'</textarea></div>'
    + '<div class="field"><label>挂载书架书目（可跳转）</label><div class="card" style="max-height:180px;overflow:auto">'+(shelf||'<span class="muted">暂无</span>')+'</div></div>'
    + '<div class="field"><label>挂载学习清单书目（外链）</label><div class="card" style="max-height:140px;overflow:auto">'+(custom||'<span class="muted">暂无</span>')+'</div></div>'
    + '<div class="row"><button class="btn" onclick="saveMapNodeEditor(\''+id+'\')">保存节点</button><button class="btn ghost" onclick="closeModal()">取消</button></div>');
}

function saveMapNodeEditor(id){
  const m = RM_STATE.map; if(!m) return;
  const idx = (m.concepts||[]).findIndex(x=>x.id===id); if(idx<0) return;
  const links = [];
  document.querySelectorAll('.mnk:checked').forEach(cb=>{
    const kind = cb.dataset.kind;
    if(kind==='shelf'){
      const b = (RM_STATE.books||[]).find(x=>x.id===cb.dataset.id);
      if(b) links.push({book_id:b.id, title:b.title});
    }else{
      const i = parseInt(cb.dataset.id);
      const b = (RM_STATE.customBooks||[])[i];
      if(b) links.push({name:b.name||'', url:b.url||''});
    }
  });
  m.concepts[idx].term = ($('#mn_term').value||'').trim() || m.concepts[idx].term;
  m.concepts[idx].note = ($('#mn_note').value||'').trim();
  m.concepts[idx].links = links;
  closeModal();
  drawMapGraph(m);
  toast('节点已更新，点「保存地图」持久化');
}

async function saveReadingMap(){
  if(!RM_STATE.map) return;
  await api('/api/reading-map/save','POST',{map:RM_STATE.map});
  toast('阅读地图已保存');
}

function openMapPlanGenerator(){
  const books = RM_STATE.books || [];
  const checks = books.map(b=>'<label class="check-row muted-weight"><input type="checkbox" class="mpb" value="'+b.id+'"><span>'+esc(b.title)+'</span></label>').join('');
  modal('<span class="close" onclick="closeModal()">×</span><h2>根据书目生成阅读地图</h2>'
    + '<div class="field"><label>计划名称</label><input id="mp_name" placeholder="例如：资本论专题计划"></div>'
    + '<div class="field"><label>选择书目（可多选）</label><div class="card" style="max-height:300px;overflow:auto">'+(checks||'<span class="muted">暂无书目</span>')+'</div></div>'
    + '<div class="row"><button class="btn" onclick="createMapPlan()">生成并切换到该计划</button><button class="btn ghost" onclick="closeModal()">取消</button></div>');
}

async function createMapPlan(){
  const name = ($('#mp_name').value||'').trim() || ('阅读计划-'+dateStr());
  const ids = [...document.querySelectorAll('.mpb:checked')].map(x=>x.value);
  if(!ids.length){ toast('请至少选择一本书'); return; }
  showBusy('正在生成阅读地图…');
  const r = await api('/api/map-plans','POST',{name, book_ids: ids});
  hideBusy();
  if(!r || !r.ok){ toast('生成失败：'+((r&&r.error)||'未知错误')); return; }
  closeModal();
  await api('/api/map-plans/'+r.plan.id+'/activate','POST',{});
  toast('已生成并切换到新计划');
  renderReadingMap();
}

function openMapHistory(){
  const rows = (RM_STATE.histories||[]).map(h=>'<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee">'
    + '<div><div style="font-weight:600">'+esc(h.name||'未命名计划')+'</div><div class="muted" style="font-size:12px">'+esc(h.created_at||'')+'</div></div>'
    + '<button class="btn sec sm" onclick="activateMapHistory(\''+h.id+'\')">打开</button></div>').join('');
  modal('<span class="close" onclick="closeModal()">×</span><h2>历史阅读计划</h2>'
    + '<div class="card" style="max-height:360px;overflow:auto">'+(rows||'<span class="muted">还没有历史计划</span>')+'</div>');
}

async function activateMapHistory(id){
  const r = await api('/api/map-plans/'+id+'/activate','POST',{});
  if(!r || !r.ok){ toast('打开失败'); return; }
  closeModal();
  toast('已切换历史计划');
  renderReadingMap();
}

async function mapToCard(){
  const m = RM_STATE.map || await api('/api/reading-map');
  let md = '# 我的阅读地图笔记\n\n';
  md += '## 目标结果\n'+(m.target_outcome||'')+'\n\n';
  md += '## 核心概念\n';
  (m.concepts||[]).forEach(c=>{ md += '- '+(c.term||'')+'：'+(c.note||'')+'\n'; });
  md += '\n## 24 小时安排\n';
  (m.schedule||[]).forEach(s=>{ md += '- ['+s.slot+'] '+s.focus+'：'+s.do+'\n'; });
  md += '\n## 主动练习\n';
  (m.exercises||[]).forEach(e=>{ md += '- ('+e.level+') '+e.q+'\n'; });
  md += '\n## 常见误区\n';
  (m.misconceptions||[]).forEach(x=>{ md += '- '+x+'\n'; });
  md += '\n## 最终产出\n'+(m.final_artifact||'')+'\n';
  const blob = new Blob([md], {type:'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '阅读地图笔记-'+dateStr()+'.md';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
  toast('已生成本地笔记骨架（不再依赖 AI 解析）');
}

function openPlanBookModal(i){
  const b = (i!=null && currentPlan && currentPlan.custom_books) ? (currentPlan.custom_books[i]||{}) : {};
  modal('<span class="close" onclick="closeModal()">×</span><h2>'+(i!=null?'编辑书目':'添加书目')+'</h2>'
    + '<div class="field"><label>书名</label><input id="pb_name" value="'+esc(b.name||'')+'" placeholder="例如：资本论 第一卷"></div>'
    + '<div class="field"><label>链接（可选）</label><input id="pb_url" value="'+esc(b.url||'')+'" placeholder="https://..."></div>'
    + '<div class="field"><label>备注（可选）</label><textarea id="pb_note">'+esc(b.note||'')+'</textarea></div>'
    + '<div class="row"><button class="btn" onclick="savePlanBook('+(i==null?-1:i)+')">保存</button>'
    + '<button class="btn ghost" onclick="closeModal()">取消</button></div>');
}
function editPlanBook(i){ openPlanBookModal(i); }
async function savePlanBook(i){
  const name = ($('#pb_name').value||'').trim();
  if(!name){ toast('请填写书名'); return; }
  const item = {name, url:($('#pb_url').value||'').trim(), note:($('#pb_note').value||'').trim(), done:false};
  if(i>=0 && currentPlan.custom_books[i]) item.done = !!currentPlan.custom_books[i].done;
  if(i>=0) currentPlan.custom_books[i] = item;
  else currentPlan.custom_books.push(item);
  await savePlanState();
  closeModal();
  renderPlan();
}
async function delPlanBook(i){
  if(!currentPlan || !currentPlan.custom_books || !currentPlan.custom_books[i]) return;
  if(!confirm('确认删除该书目？')) return;
  currentPlan.custom_books.splice(i,1);
  await savePlanState();
  renderPlan();
}

// ---------------- 从文库导入全文 ----------------
async function openFetchModal(target, bid, presetUrl){
  // 动态拉一次 plan，把带 fetchUrl 的资源做成"热门资源"一键填入，避免手敲 URL
  let presetBtns = '';
  try {
    const plan = await api('/api/plans');
    const items = [];
    for(const p of (plan.phases||[])){
      for(const r of (p.resources||[])){
        if(r.fetchUrl) items.push({name:r.name, url:r.fetchUrl});
      }
    }
    if(items.length){
      presetBtns = '<div class="muted" style="margin-top:14px">热门资源（点一下直接填入链接）：</div>'
        + '<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:6px">'
        + items.map(it=>'<button class="btn ghost sm" onclick="$(\'#fx_url\').value=\''+esc(it.url)+'\';toast(\'已填入：'+esc(it.name)+'\')">'+esc(it.name)+'</button>').join('')
        + '</div>';
    }
  } catch(e) { /* 拉取失败不影响弹窗主功能 */ }

  modal('<span class="close" onclick="closeModal()">×</span><h2>从马克思主义文库导入全文</h2>'
    + '<p class="muted">粘贴中文马克思主义文库（marxists.org/chinese）或任意文章链接，自动抓取并去除网页格式，得到纯文本，可直接读、讨论、做卡片。</p>'
    + '<div class="field"><label>文章链接</label><input id="fx_url" value="'+esc(presetUrl||'')+'" placeholder="https://www.marxists.org/chinese/..."></div>'
    + '<button class="btn" id="fx_go" onclick="runFetch(\''+target+'\',\''+esc(bid||'')+'\')">抓取全文</button>'
    + '<div id="fx_out" style="margin-top:14px"></div>'
    + presetBtns);
  setTimeout(()=>{ const el=$('#fx_url'); if(el) el.focus(); }, 50);
}
async function runFetch(target, bid){
  const url = $('#fx_url').value.trim();
  if(!url){ toast('请填写链接'); return; }
  $('#fx_go').textContent = '抓取中…';
  const r = await api('/api/fetch','POST',{url});
  $('#fx_go').textContent = '抓取全文';
  const out = $('#fx_out');
  if(!r.ok){
    // 后端不会自动加 "抓取失败：" 前缀；万一以后后端加了，这里剥掉所有可能重复的前缀，只展示一次
    const rawErr = String(r.error||'未知错误');
    const err = rawErr.replace(/^(抓取失败[:：]\s*)+/g,'').trim();
    const is404 = /\b(404|Not Found)\b/i.test(err);
    const hint = is404
      ? '<div class="muted" style="margin-top:6px">提示：链接在 marxists.org 上找不到（404）。可能拼错或页面已迁移。可以从下方"热门资源"选一个直接试。</div>'
      : '';
    out.innerHTML = '<div class="card" style="border-color:#fca5a5"><b>抓取失败</b>：'+esc(err)+hint+'</div>';
    return;
  }
  const txt = r.text || '';
  let actions = '';
  if(target==='discuss') actions = '<button class="btn" onclick="fxFill(\'discuss\')">填入同步阅读（左侧原文）</button>';
  else if(target==='capture') actions = '<button class="btn" onclick="fxFill(\'capture\')">填入录入框</button>';
  else if(target==='book') actions = '<button class="btn" onclick="fxSaveBook(\''+esc(bid)+'\')">保存为本书全文</button>';
  else if(target==='plan') actions = '<div class="row"><button class="btn" onclick="fxSaveNewBook()">保存为新建书目</button>'
      + '<button class="btn ghost" onclick="navigator.clipboard.writeText($(\'#fx_text\').value);toast(\'已复制\')">复制全文</button></div>';
  out.innerHTML = '<div class="card"><div class="muted" style="margin-bottom:6px">标题：'+esc(r.title||'(无)')+' · 字数 '+(r.length||0)+'</div>'
    + '<textarea id="fx_text" readonly style="min-height:260px">'+esc(txt)+'</textarea>'
    + '<div class="row" style="margin-top:10px">'+actions+'</div></div>';
  window.__fxText = txt; window.__fxTitle = r.title;
}
function fxFill(target){
  if(target==='discuss'){
    const el=$('#d_ctx_text');
    if(el){
      el.value = window.__fxText;
      renderDiscussReader(window.__fxText);
      const m = location.hash.match(/^#\/book\/([^/]+)\/discuss$/);
      if(m && m[1]) saveContext(m[1], true);
      toast('已填入同步阅读');
    }
  }
  else if(target==='capture'){ const el=$('#raw'); if(el){ el.value = window.__fxText; toast('已填入录入框'); } }
  closeModal();
}
async function fxSaveBook(bid){
  await api('/api/books/'+bid,'PUT',{raw_text: window.__fxText});
  toast('已保存为本书全文');
  closeModal();
  location.hash = '#/book/'+bid+'/read';
}
async function fxSaveNewBook(){
  const title = (window.__fxTitle||'文库导入').replace(/\s+/g,' ').slice(0,80);
  const b = await api('/api/books','POST',{title, raw_text: window.__fxText, description:'从马克思主义文库导入'});
  toast('已创建书目');
  closeModal();
  location.hash = '#/book/'+b.id+'/read';
}

// ---------------- 阅读全文 ----------------
async function renderReader(bid){
  const b = await api('/api/books/'+bid);
  if(b.error){ view().innerHTML='<div class="card">书目不存在</div>'; return; }
  if(!b.raw_text){
    view().innerHTML = '<div class="row" style="justify-content:space-between"><h1>阅读全文 · '+esc(b.title)+'</h1>'
      + '<button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">← 总览</button></div>'
      + '<div class="card">还没有存入全文。点下方从马克思主义文库导入：'
      + '<div class="row" style="margin-top:12px"><button class="btn sec sm" onclick="openFetchModal(\'book\',\''+bid+'\')">📥 导入全书原文</button></div></div>';
    return;
  }
  view().innerHTML = '<div class="row" style="justify-content:space-between;align-items:flex-end"><h1>阅读全文 · '+esc(b.title)+'</h1>'
    + '<div class="row"><button class="btn sec sm" onclick="readerToDiscuss(\''+bid+'\',true)">↪ 全文载入同步阅读</button>'
    + '<button class="btn sec sm" onclick="readerToDiscuss(\''+bid+'\',false)">↪ 载入选中段落</button>'
    + '<button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">← 总览</button></div></div>'
    + '<div class="card"><textarea id="read_area" style="min-height:70vh">'+esc(b.raw_text)+'</textarea></div>';
}
function readerToDiscuss(bid, whole){
  const area = $('#read_area');
  const text = whole ? area.value : (window.getSelection().toString() || area.value);
  if(!text.trim()){ toast('没有可载入的内容'); return; }
  pendingContextText = text;
  location.hash = '#/book/'+bid+'/discuss';
}

// ---------------- 阅读页（左阅读器 + 右聊天） ----------------
function chapterSlice(raw, title, chapters){
  if(!raw) return '';
  const MARK = '\n▶ ';
  let i = raw.indexOf(MARK + title);
  if(i < 0) i = raw.indexOf(title);   // 兜底：兼容未带锚点的旧全文
  if(i < 0) return '（未在全文中找到「'+title+'」。可能尚未导入对应全文，或章节标题与全文文字不一致；可改用「根据关键词」阅读。）';
  let end = raw.length;
  for(const c of (chapters||[])){
    if(c.title === title) continue;
    const j = raw.indexOf(MARK + c.title, i + (MARK + title).length);
    if(j > i && j < end) end = j;
  }
  return raw.slice(i, end).trim();
}
function findPassages(raw, term, maxN=8, before=160, after=340){
  const out=[]; if(!raw||!term) return out;
  let p = raw.indexOf(term);
  while(p>=0 && out.length<maxN){
    let s=Math.max(0,p-before), e=Math.min(raw.length,p+term.length+after);
    let seg=raw.slice(s,e);
    if(s>0) seg='…'+seg; if(e<raw.length) seg=seg+'…';
    out.push(seg);
    p = raw.indexOf(term, p+term.length);
  }
  return out;
}
function highlight(text, term){
  const e=esc(text), t=esc(term);
  return t ? e.split(t).join('<mark>'+t+'</mark>') : e;
}
// 清洗从 marxists 卷册抓来的正文：去掉章节锚点符与页码标记（〔67〕 等），保留标题块与正文
function cleanReadText(s){
  if(!s) return s;
  return s.split('\n')
    .map(line=>line.replace(/〔\d+〕/g,''))            // 去卷册页码标记
    .filter(line=>{
      const t=line.trim();
      if(!t) return true;                              // 保留空行（段落间距）
      if(t.indexOf('中文马克思主义文库')>=0) return false; // 站点导航行
      return true;
    }).join('\n')
    .replace(/^\s*▶ [^\n]*\n/, '')                     // 去章节锚点行
    .replace(/^\s*[\u3000\s]+/, '');                  // 去开头全角空格
}
function chapterOpts(b, title){
  let opts='<option value="'+esc(title)+'">'+esc(title||'（不指定章节）')+'</option>';
  for(const c of (b.chapters||[])) opts+='<option value="'+esc(c.title)+'">'+esc(c.title)+'</option>';
  return opts;
}
function readCtx(b, term, mode){
  if(mode==='chapter') return chapterSlice(b.raw_text||'', term, b.chapters||[]);
  return findPassages(b.raw_text||'', term).slice(0,6).join('\n\n').slice(0,6000);
}
let READER = {bid:null, mode:null, term:null, pages:[], idx:0, threadId:'', marks:[], chatHistLoaded:false};

const READ_RESUME_KEY = 'ai-reader-read-resume';

function isHomeHash(){
  const path = (location.hash.slice(1) || '/').split('?')[0];
  return path === '/' || path === '';
}
function isOnReadRoute(){
  const path = (location.hash.slice(1) || '/').split('?')[0];
  return /^\/book\/[^/]+\/read\/(chapter|keyword)\//.test(path);
}
function getReadResume(){
  try{
    const raw = localStorage.getItem(READ_RESUME_KEY);
    if(!raw) return null;
    const o = JSON.parse(raw);
    if(!o || !o.bid || !o.term) return null;
    return o;
  }catch(_){ return null; }
}
function readResumeHash(r){
  if(!r || !r.bid) return '#/';
  const mode = r.mode === 'keyword' ? 'keyword' : 'chapter';
  return '#/book/'+r.bid+'/read/'+mode+'/'+encodeURIComponent(r.term);
}
function saveReadResume(){
  if(!READER.bid || !READER.term) return;
  try{
    localStorage.setItem(READ_RESUME_KEY, JSON.stringify({
      bid: READER.bid,
      mode: READER.mode || 'chapter',
      term: READER.term,
      pageIdx: READER.idx || 0,
      updatedAt: new Date().toISOString(),
    }));
  }catch(_){}
}
function persistReadResumeIfReading(){
  if(!READER.bid || !READER.term) return;
  if(isOnReadRoute()) saveReadResume();
}
function restoreReadPageIdx(bid, mode, term){
  const saved = getReadResume();
  if(!saved || saved.bid !== bid || saved.mode !== mode || saved.term !== term) return 0;
  const idx = parseInt(saved.pageIdx, 10);
  return Number.isFinite(idx) && idx >= 0 ? idx : 0;
}
function maybeAutoRestoreReading(){
  if(!isHomeHash()) return;
  const r = getReadResume();
  if(!r) return;
  location.hash = readResumeHash(r);
}
function continueLastReading(){
  const r = getReadResume();
  if(!r){ toast('暂无阅读记录'); return; }
  location.hash = readResumeHash(r);
}
function installReadResumeLifecycle(){
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') persistReadResumeIfReading();
  });
  window.addEventListener('pagehide', ()=> persistReadResumeIfReading());
}
let CHAT_MSGS = [];
let MARK_BOOK = { bid: null, marks: [] };
let MARK_UI = {
  pendingQuote:'', pendingRect:null, openTagId:null,
  panelView:'list', detailId:null, selectedIds:new Set(), collapsing:false,
  activeSurface: null,
};

function markSurface(){
  const hash = location.hash || '';
  if(hash.includes('/discuss')) return 'discuss';
  if(hash.includes('/read/')) return 'read';
  return 'reader';
}
function markContextKey(){
  const surf = MARK_UI.activeSurface || markSurface();
  if(surf === 'discuss') return discussThreadId();
  if(surf === 'read-chat' || surf === 'read') return readThreadId();
  return chapterKey();
}
function markPanelTitle(){
  const s = markSurface();
  if(s === 'discuss') return '本讨论标注';
  if(s === 'read') return '本对话标注';
  return '本章标注';
}
function activeMarkBid(){
  if(MARK_BOOK.bid) return MARK_BOOK.bid;
  if(READER.bid) return READER.bid;
  const m = (location.hash || '').match(/^#\/book\/([^/]+)/);
  return m ? m[1] : null;
}
async function loadBookMarks(bid){
  if(!bid) return;
  const b = await api('/api/books/'+bid);
  MARK_BOOK = { bid, marks: Array.isArray(b.reader_marks) ? b.reader_marks : [] };
  if(READER.bid === bid) READER.marks = MARK_BOOK.marks;
}
function bookMarks(){ return MARK_BOOK.marks || READER.marks || []; }

function markUid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function chapterKey(){ return READER.term || ''; }
function contextMarks(){
  const ch = markContextKey();
  return bookMarks().filter(m => (m.chapter || '') === ch);
}
function chapterMarks(){ return contextMarks(); }
function thoughtMarks(){
  return contextMarks().filter(m => m.has_thought);
}
async function refreshReaderMarks(){
  if(!READER.bid){ READER.marks = []; return; }
  await loadBookMarks(READER.bid);
}
async function persistBookMarks(){
  const bid = activeMarkBid();
  if(!bid) return;
  const marks = bookMarks();
  await api('/api/books/'+bid, 'PUT', {reader_marks: marks});
  MARK_BOOK.marks = marks;
  if(READER.bid === bid) READER.marks = marks;
  if(typeof scheduleCloudSyncPush === 'function') scheduleCloudSyncPush();
}
async function persistReaderMarks(){ return persistBookMarks(); }
function quoteHtmlNeedle(quote){
  return esc(quote || '').replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
}
function applyMarksToHtml(html){
  let out = String(html || '');
  const list = chapterMarks().slice().sort((a, b) => (b.quote || '').length - (a.quote || '').length);
  for(const m of list){
    const needle = quoteHtmlNeedle(m.quote);
    if(!needle || out.indexOf(needle) < 0) continue;
    if(out.indexOf('data-mid="'+m.id+'"') >= 0) continue;
    const ul = m.underline ? ' mark-ul' : '';
    let rep = '<span class="mark-span'+ul+'" data-mid="'+esc(m.id)+'">'+needle+'</span>';
    if(m.has_thought){
      const filled = (m.thought || '').trim() ? ' has-text' : '';
      rep += '<button type="button" class="mark-dot'+filled+'" data-mid="'+esc(m.id)+'" title="查看想法">💭</button>';
    }
    out = out.replace(needle, rep);
  }
  return out;
}
function ensureMarkChrome(){
  if(!$('#mark-ctx')){
    const ctx = document.createElement('div');
    ctx.id = 'mark-ctx';
    ctx.className = 'mark-ctx';
    ctx.innerHTML =
      '<button type="button" data-act="copy"><span class="ico">📄</span>复制</button>'
      + '<button type="button" data-act="uline"><span class="ico">A̲</span>划线</button>'
      + '<button type="button" data-act="thought"><span class="ico">💭</span>写想法</button>';
    document.body.appendChild(ctx);
    ctx.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    ctx.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if(!btn) return;
      e.preventDefault();
      e.stopPropagation();
      runMarkAction(btn.getAttribute('data-act'));
    });
  }
  if(!$('#mark-tag')){
    const tag = document.createElement('div');
    tag.id = 'mark-tag';
    tag.className = 'mark-tag';
    tag.innerHTML =
      '<div class="mt-quote" id="mt_quote"></div>'
      + '<textarea id="mt_text" placeholder="写下你的想法…"></textarea>'
      + '<div class="mt-actions"><button type="button" class="btn ghost sm" id="mt_cancel">收起</button>'
      + '<button type="button" class="btn sm" id="mt_ok">完成</button></div>';
    document.body.appendChild(tag);
    tag.addEventListener('mousedown', e => e.stopPropagation());
    // 先收起 UI，再异步落盘，避免接口慢时「收起」像失灵
    const collapse = e => { e.preventDefault(); e.stopPropagation(); collapseMarkTag(); };
    $('#mt_ok').onclick = collapse;
    $('#mt_cancel').onclick = collapse;
  }
  if(!$('#mark-panel-backdrop')){
    const bd = document.createElement('div');
    bd.id = 'mark-panel-backdrop';
    bd.className = 'mark-panel-backdrop';
    bd.addEventListener('mousedown', () => closeMarkPanel());
    document.body.appendChild(bd);
  }
  if($('#mark-panel') && !$('#mark-panel-back')){
    try{ $('#mark-panel').remove(); }catch(_){}
  }
  if(!$('#mark-panel')){
    const pan = document.createElement('div');
    pan.id = 'mark-panel';
    pan.className = 'mark-panel';
    pan.innerHTML =
      '<div class="mark-panel-head" id="mark-panel-head">'
      + '<div class="mp-head-left">'
      + '<button type="button" class="btn ghost sm" id="mark-panel-back">← 返回</button>'
      + '<span id="mark-panel-title">本章标签</span></div>'
      + '<button type="button" class="btn ghost sm" id="mark-panel-close">关闭</button></div>'
      + '<div class="mark-panel-list" id="mark-panel-list"></div>'
      + '<div class="mark-panel-foot" id="mark-panel-foot">'
      + '<button type="button" class="btn" id="mark-export-btn" disabled>生成读书笔记</button></div>';
    document.body.appendChild(pan);
    pan.addEventListener('mousedown', e => e.stopPropagation());
    $('#mark-panel-back').onclick = () => backMarkPanelList();
    $('#mark-panel-close').onclick = () => closeMarkPanel();
    $('#mark-export-btn').onclick = () => exportMarkNotes();
  }
}
function hideMarkCtx(){
  const ctx = $('#mark-ctx');
  if(ctx) ctx.classList.remove('show');
}
function showMarkCtx(x, y){
  ensureMarkChrome();
  const ctx = $('#mark-ctx');
  ctx.classList.add('show');
  const w = ctx.offsetWidth || 200;
  const h = ctx.offsetHeight || 64;
  let left = x - w / 2;
  let top = y - h - 14;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  if(top < 8) top = y + 14;
  ctx.style.left = left + 'px';
  ctx.style.top = top + 'px';
}
function getSelectionQuoteIn(container){
  const sel = window.getSelection();
  if(!sel || sel.isCollapsed || !sel.rangeCount || !container) return '';
  const a = sel.anchorNode, f = sel.focusNode;
  if(!a || !f || !container.contains(a) || !container.contains(f)) return '';
  return String(sel.toString() || '').replace(/\r\n/g, '\n').trim();
}
function getReaderSelectionQuote(){
  return getSelectionQuoteIn($('#r_reader'));
}
async function refreshMarkViews(opts){
  opts = opts || {};
  const surf = markSurface();
  if(surf === 'discuss'){
    const m = (location.hash || '').match(/^#\/book\/([^/]+)\/discuss/);
    if(m) await loadDiscuss(m[1], { anchor: opts.anchor || 'preserve' });
    return;
  }
  if(surf === 'read'){
    if(READER.bid && READER.chatHistLoaded) await loadReadChat(READER.bid, { anchor: opts.anchor || 'preserve' });
    renderReaderPage();
    return;
  }
  renderReaderPage();
}
function bindReaderMarkEvents(){
  ensureMarkChrome();
  const box = $('#r_reader');
  if(!box || box._markBound) return;
  box._markBound = true;
  box.addEventListener('contextmenu', e => {
    MARK_UI.activeSurface = 'reader';
    const quote = getReaderSelectionQuote();
    if(!quote){ hideMarkCtx(); return; }
    e.preventDefault();
    e.stopPropagation();
    MARK_UI.pendingQuote = quote;
    try{
      const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      MARK_UI.pendingRect = r;
      showMarkCtx(r.left + r.width / 2, r.top);
    }catch(_){
      showMarkCtx(e.clientX, e.clientY);
    }
  });
  box.addEventListener('click', e => {
    const dot = e.target.closest('.mark-dot');
    if(dot){
      e.preventDefault();
      e.stopPropagation();
      MARK_UI.activeSurface = 'reader';
      openMarkThought(dot.getAttribute('data-mid'), dot);
      return;
    }
  });
}
function bindChatMarkEvents(rootSel, surface){
  const box = rootSel ? document.querySelector(rootSel) : null;
  if(!box || box._chatMarkBound) return;
  box._chatMarkBound = true;
  box.addEventListener('contextmenu', e => {
    const bubble = e.target.closest('.bubble');
    if(!bubble || !box.contains(bubble)) return;
    const quote = getSelectionQuoteIn(bubble);
    if(!quote){ hideMarkCtx(); return; }
    e.preventDefault();
    e.stopPropagation();
    MARK_UI.activeSurface = surface;
    MARK_UI.pendingQuote = quote;
    try{
      const r = window.getSelection().getRangeAt(0).getBoundingClientRect();
      MARK_UI.pendingRect = r;
      showMarkCtx(r.left + r.width / 2, r.top);
    }catch(_){
      showMarkCtx(e.clientX, e.clientY);
    }
  });
  box.addEventListener('click', e => {
    const dot = e.target.closest('.mark-dot');
    if(dot){
      e.preventDefault();
      e.stopPropagation();
      MARK_UI.activeSurface = surface;
      openMarkThought(dot.getAttribute('data-mid'), dot);
    }
  });
}
async function runMarkAction(act){
  const quote = MARK_UI.pendingQuote;
  const surf = MARK_UI.activeSurface || markSurface();
  const box = surf === 'reader' ? $('#r_reader') : null;
  const keepY = box ? box.scrollTop : 0;
  hideMarkCtx();
  if(!quote){ toast('请先选中文字'); return; }
  if(act === 'copy'){
    try{
      await navigator.clipboard.writeText(quote);
      toast('已复制');
    }catch(_){
      const ta = document.createElement('textarea');
      ta.value = quote;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
      document.body.appendChild(ta);
      ta.focus({preventScroll:true});
      ta.select();
      try{ document.execCommand('copy'); toast('已复制'); }catch(e){ toast('复制失败'); }
      ta.remove();
    }
    const restore = () => { if(box) box.scrollTop = keepY; };
    restore();
    requestAnimationFrame(restore);
    setTimeout(restore, 0);
    setTimeout(restore, 50);
    return;
  }
  if(act === 'uline'){
    upsertMark({quote, underline:true});
    await persistBookMarks();
    await refreshMarkViews();
    if(box) box.scrollTop = keepY;
    toast('已划线');
    return;
  }
  if(act === 'thought'){
    const m = upsertMark({quote, has_thought:true, thought:''});
    await persistBookMarks();
    await refreshMarkViews();
    if(box) box.scrollTop = keepY;
    requestAnimationFrame(() => openMarkThought(m.id));
  }
}
function upsertMark(partial){
  if(!MARK_BOOK.marks) MARK_BOOK.marks = [];
  const quote = partial.quote;
  const ctx = markContextKey();
  const surf = MARK_UI.activeSurface || markSurface();
  let m = contextMarks().find(x => x.quote === quote && (surf !== 'reader' || x.page_idx === READER.idx))
    || contextMarks().find(x => x.quote === quote);
  if(!m){
    m = {
      id: markUid(),
      chapter: ctx,
      page_idx: surf === 'reader' ? READER.idx : undefined,
      quote,
      underline: false,
      has_thought: false,
      thought: '',
      source: surf === 'discuss' ? 'discuss-chat' : (surf === 'read' || surf === 'read-chat' ? 'read-chat' : 'reader'),
      created_at: new Date().toISOString(),
    };
    MARK_BOOK.marks.push(m);
    if(READER.bid === MARK_BOOK.bid) READER.marks = MARK_BOOK.marks;
  }
  if(partial.underline) m.underline = true;
  if(partial.has_thought){
    m.has_thought = true;
    if(typeof partial.thought === 'string' && !m.thought) m.thought = partial.thought;
  }
  if(typeof partial.thought === 'string' && partial.forceThought) m.thought = partial.thought;
  return m;
}
function findMark(id){
  return bookMarks().find(m => m.id === id);
}
function openMarkThought(id, anchorEl){
  ensureMarkChrome();
  const m = findMark(id);
  if(!m || !m.has_thought) return;
  // 再点同一标签：收起
  if(MARK_UI.openTagId === id && $('#mark-tag') && $('#mark-tag').classList.contains('show')){
    collapseMarkTag();
    return;
  }
  MARK_UI.openTagId = id;
  const tag = $('#mark-tag');
  $('#mt_quote').textContent = '「' + (m.quote || '').slice(0, 60) + ((m.quote||'').length > 60 ? '…' : '') + '」';
  $('#mt_text').value = m.thought || '';
  let left = 80, top = 120;
  const el = anchorEl || document.querySelector('.mark-dot[data-mid="'+id+'"]');
  if(el){
    const r = el.getBoundingClientRect();
    left = Math.min(window.innerWidth - 300, Math.max(8, r.right + 8));
    top = Math.min(window.innerHeight - 220, Math.max(8, r.top - 10));
  } else if(MARK_UI.pendingRect){
    const r = MARK_UI.pendingRect;
    left = Math.min(window.innerWidth - 300, Math.max(8, r.left));
    top = Math.min(window.innerHeight - 220, Math.max(8, r.bottom + 8));
  }
  tag.style.left = left + 'px';
  tag.style.top = top + 'px';
  tag.classList.add('show');
  setTimeout(() => { try{ $('#mt_text').focus(); }catch(_){} }, 30);
}
async function collapseMarkTag(){
  if(MARK_UI.collapsing) return;
  MARK_UI.collapsing = true;
  const id = MARK_UI.openTagId;
  const tag = $('#mark-tag');
  const box = $('#r_reader');
  const keepY = box ? box.scrollTop : 0;
  const thought = ($('#mt_text') && $('#mt_text').value) || '';
  if(tag) tag.classList.remove('show');
  MARK_UI.openTagId = null;
  try{
    if(id){
      const m = findMark(id);
      if(m){
        m.thought = thought;
        await persistBookMarks();
        await refreshMarkViews();
        if(box) box.scrollTop = keepY;
      }
    }
  }catch(err){
    console.error(err);
    toast('想法保存失败');
  }finally{
    MARK_UI.collapsing = false;
  }
}
async function commitMarkThought(minimize){
  if(minimize) return collapseMarkTag();
  const id = MARK_UI.openTagId;
  if(!id) return;
  const m = findMark(id);
  if(m){
    m.thought = ($('#mt_text') && $('#mt_text').value) || '';
    await persistBookMarks();
  }
}
function setMarkPanelHead(view){
  const head = $('#mark-panel-head');
  const title = $('#mark-panel-title');
  const foot = $('#mark-panel-foot');
  if(head) head.classList.toggle('detail', view === 'detail');
  if(title) title.textContent = view === 'detail' ? '标注详情' : markPanelTitle();
  if(foot) foot.style.display = view === 'detail' ? 'none' : '';
}
function syncSelectedFromDom(){
  document.querySelectorAll('.mpi-cb').forEach(cb => {
    if(cb.checked) MARK_UI.selectedIds.add(cb.value);
    else MARK_UI.selectedIds.delete(cb.value);
  });
}
function renderMarkPanelList(){
  const box = $('#mark-panel-list');
  if(!box) return;
  MARK_UI.panelView = 'list';
  MARK_UI.detailId = null;
  setMarkPanelHead('list');
  const list = thoughtMarks().slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  if(!list.length){
    box.innerHTML = '<div class="mark-panel-empty">当前还没有想法标注。<br>在原文或对话气泡中选中文字 → 右键 → 写想法</div>';
    updateMarkExportBtn();
    return;
  }
  box.innerHTML = list.map(m => {
    const preview = (m.quote || '').replace(/\s+/g, ' ').slice(0, 20);
    const more = (m.quote || '').replace(/\s+/g, ' ').length > 20 ? '…' : '';
    const tip = (m.thought || '').trim() ? '已写想法' : '想法为空';
    const loc = (m.source === 'discuss-chat' || m.source === 'read-chat') ? '对话' : '第 '+((m.page_idx||0)+1)+' 页';
    const checked = MARK_UI.selectedIds.has(m.id) ? ' checked' : '';
    const sel = MARK_UI.selectedIds.has(m.id) ? ' selected' : '';
    return '<div class="mark-panel-item'+sel+'" data-mid="'+esc(m.id)+'">'
      + '<input type="checkbox" class="mpi-cb" value="'+esc(m.id)+'"'+checked+'>'
      + '<div class="mpi-body"><div class="mpi-quote">'+esc(preview + more)+'</div>'
      + '<div class="mpi-meta">'+tip+' · '+loc+'</div></div></div>';
  }).join('');
  box.querySelectorAll('.mpi-cb').forEach(cb => {
    cb.addEventListener('click', e => e.stopPropagation());
    cb.addEventListener('change', () => {
      const item = cb.closest('.mark-panel-item');
      if(cb.checked) MARK_UI.selectedIds.add(cb.value);
      else MARK_UI.selectedIds.delete(cb.value);
      if(item) item.classList.toggle('selected', cb.checked);
      updateMarkExportBtn();
    });
  });
  box.querySelectorAll('.mark-panel-item').forEach(item => {
    item.addEventListener('click', e => {
      if(e.target.closest && e.target.closest('.mpi-cb')) return;
      const id = item.getAttribute('data-mid');
      if(id) showMarkPanelDetail(id);
    });
  });
  updateMarkExportBtn();
}
function showMarkPanelDetail(id){
  const m = findMark(id);
  const box = $('#mark-panel-list');
  if(!m || !box) return;
  syncSelectedFromDom();
  MARK_UI.panelView = 'detail';
  MARK_UI.detailId = id;
  setMarkPanelHead('detail');
  const tip = (m.thought || '').trim() ? '已写想法' : '想法为空';
  const loc = (m.source === 'discuss-chat' || m.source === 'read-chat') ? '对话' : '第 '+((m.page_idx||0)+1)+' 页';
  box.innerHTML =
    '<div class="mark-panel-detail">'
    + '<div class="mpd-meta">'+tip+' · '+loc+'</div>'
    + '<div class="mpd-label">原文</div>'
    + '<div class="mpd-quote">'+esc(m.quote || '')+'</div>'
    + '<div class="mpd-label">想法</div>'
    + '<textarea id="mpd_thought" placeholder="写下你的想法…">'+esc(m.thought || '')+'</textarea>'
    + '<div class="row" style="justify-content:flex-end;margin-top:4px">'
    + '<button type="button" class="btn sm" id="mpd_save">保存想法</button></div></div>';
  const saveBtn = $('#mpd_save');
  if(saveBtn){
    saveBtn.onclick = async () => {
      const mm = findMark(id);
      if(!mm) return;
      mm.thought = ($('#mpd_thought') && $('#mpd_thought').value) || '';
      try{
        await persistReaderMarks();
        toast('已保存');
      }catch(_){ toast('保存失败'); }
    };
  }
}
async function backMarkPanelList(){
  const id = MARK_UI.detailId;
  if(id && $('#mpd_thought')){
    const m = findMark(id);
    if(m){
      const next = $('#mpd_thought').value || '';
      if(next !== (m.thought || '')){
        m.thought = next;
        try{ await persistBookMarks(); }catch(_){}
      }
    }
  }
  renderMarkPanelList();
}
function closeMarkPanel(){
  if(MARK_UI.panelView === 'detail' && $('#mpd_thought') && MARK_UI.detailId){
    const m = findMark(MARK_UI.detailId);
    if(m) m.thought = $('#mpd_thought').value || '';
    persistBookMarks().catch(()=>{});
  }
  MARK_UI.panelView = 'list';
  MARK_UI.detailId = null;
  const bd = $('#mark-panel-backdrop');
  const pan = $('#mark-panel');
  if(bd) bd.classList.remove('show');
  if(pan) pan.classList.remove('show');
}
function openMarkPanel(){
  ensureMarkChrome();
  hideMarkCtx();
  collapseMarkTag();
  if(!MARK_UI.activeSurface) MARK_UI.activeSurface = markSurface() === 'read' ? 'read-chat' : markSurface();
  MARK_UI.selectedIds = new Set();
  renderMarkPanelList();
  $('#mark-panel-backdrop').classList.add('show');
  $('#mark-panel').classList.add('show');
}
function updateMarkExportBtn(){
  const n = MARK_UI.selectedIds ? MARK_UI.selectedIds.size : document.querySelectorAll('.mpi-cb:checked').length;
  const btn = $('#mark-export-btn');
  if(btn) btn.disabled = n === 0;
}
async function exportMarkNotes(){
  syncSelectedFromDom();
  const ids = [...(MARK_UI.selectedIds || [])];
  if(!ids.length){ toast('请先勾选标注'); return; }
  const marks = thoughtMarks().filter(m => ids.includes(m.id));
  marks.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const bid = activeMarkBid();
  if(!bid){ toast('无法确定书目'); return; }
  const md = await buildReadingNotesMd({
    bid,
    contextLabel: markContextLabel(),
    messages: [],
    marks,
  });
  downloadMarkdown(md, '读书笔记-标注-'+(await bookTitle(bid))+'-'+dateStr());
  toast('已生成标注读书笔记（'+marks.length+' 条）');
  closeMarkPanel();
}
function markContextLabel(){
  const s = markSurface();
  if(s === 'discuss') return '讨论章节：'+(($('#d_chapter')&&$('#d_chapter').value)||'未指定');
  if(s === 'read') return '阅读对话：'+(READER.term||'');
  return '阅读章节：'+(READER.term||'');
}
async function bookTitle(bid){
  const b = await api('/api/books/'+bid);
  return b.title || '笔记';
}
async function buildReadingNotesMd(opts){
  const bid = opts.bid;
  const b = await api('/api/books/'+bid);
  let md = '# 读书笔记 · 《'+(b.title||'未命名')+'》\n\n';
  md += '导出时间：'+new Date().toLocaleString('zh-CN')+'\n';
  if(opts.contextLabel) md += opts.contextLabel+'\n';
  md += '\n---\n\n';
  const msgs = opts.messages || [];
  if(msgs.length){
    md += '## 对话摘录\n\n';
    for(const item of msgs){
      md += '### '+item.who+'\n\n'+(item.content||'')+'\n\n';
    }
    md += '---\n\n';
  }
  const marks = opts.marks || [];
  if(marks.length){
    md += '## 标注与想法\n\n';
    marks.forEach((m, i) => {
      md += '### 标注 '+(i+1)+'\n\n';
      md += '**原文：**\n\n'+(m.quote||'')+'\n\n';
      const th = (m.thought||'').trim();
      if(th) md += '**想法：**\n\n'+th+'\n\n';
      md += '---\n\n';
    });
  }
  md += '_由 AI 陪读导出_';
  return md;
}
function downloadMarkdown(md, filename){
  const blob = new Blob([md], {type:'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith('.md') ? filename : filename+'.md';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}

// 点击页面空白：收起右键菜单 / 最小化想法 tag（不关标签列表——列表有独立遮罩）
document.addEventListener('mousedown', e => {
  const ctx = $('#mark-ctx');
  if(ctx && ctx.classList.contains('show') && !ctx.contains(e.target)) hideMarkCtx();
  const tag = $('#mark-tag');
  if(tag && tag.classList.contains('show') && !tag.contains(e.target)){
    // 点想法圆点本身会再打开/切换，这里先收起保存
    if(!(e.target.closest && e.target.closest('.mark-dot'))){
      collapseMarkTag();
    }
  }
});

function readThreadId(){
  const ch = ($('#r_chapter')&&$('#r_chapter').value) ? $('#r_chapter').value : (READER.term||'default');
  return 'read::'+(READER.mode||'chapter')+'::'+ch;
}

// 把正文按段落切成固定大小的「页」，避免一页过长
function paginate(text, size){
  const ps = text.split('\n').map(s=>s.trim()).filter(s=>s.length);
  const pages=[]; let cur=[]; let len=0;
  for(const p of ps){
    if(cur.length && len + p.length + 1 > size){ pages.push(cur); cur=[]; len=0; }
    cur.push(p); len += p.length + 1;
  }
  if(cur.length) pages.push(cur);
  return pages.length ? pages : [['（本段无内容）']];
}

function renderReaderPage(opts){
  const box = $('#r_reader');
  if(!box) return;
  const resetScroll = !!(opts && opts.resetScroll);
  const y = box.scrollTop;
  const page = READER.pages[READER.idx] || '';
  const rawHtml = (typeof page === 'string') ? page : page.join('<br>');
  box.innerHTML = applyMarksToHtml(rawHtml);
  const no = $('#r_pageno');
  if(no) no.textContent = '第 '+(READER.idx+1)+' / '+READER.pages.length+' 页';
  const prev = $('#r_prev'), next = $('#r_next');
  if(prev) prev.disabled = READER.idx<=0;
  if(next) next.disabled = READER.idx>=READER.pages.length-1;
  // 仅翻页/初次进入回顶；划线、想法、复制后重绘须保持阅读位置
  if(resetScroll) scrollPaneTop(box);
  else box.scrollTop = y;
  bindReaderMarkEvents();
}
function readerPrev(){
  if(READER.idx>0){
    READER.idx--;
    renderReaderPage({resetScroll:true});
    saveReadResume();
  }
}
function readerNext(){
  if(READER.idx<READER.pages.length-1){
    READER.idx++;
    renderReaderPage({resetScroll:true});
    saveReadResume();
  }
}

async function chapterCardsForCurrentRead(){
  if(!READER.bid) return [];
  const cards = await api('/api/books/'+READER.bid+'/cards');
  const chapter = READER.term || '';
  return (cards || []).filter(c => (c.chapter_title || '') === chapter)
    .sort((a,b)=> String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
async function refreshReadCardEntry(){
  const btn = $('#r_gen');
  if(!btn) return;
  if(READER.mode !== 'chapter'){
    btn.textContent = '✨ 生成知识卡片';
    btn.onclick = ()=>genReadCard(READER.bid, READER.term, READER.mode);
    return;
  }
  const list = await chapterCardsForCurrentRead();
  if(list.length){
    btn.textContent = '查看知识卡片';
    btn.onclick = ()=>openReadCardList();
  } else {
    btn.textContent = '✨ 生成知识卡片';
    btn.onclick = ()=>genReadCard(READER.bid, READER.term, READER.mode);
  }
}
async function openReadCardList(){
  const cards = await chapterCardsForCurrentRead();
  if(!cards.length){
    genReadCard(READER.bid, READER.term, READER.mode);
    return;
  }
  let h = '<span class="close" onclick="closeModal()">×</span><h2>知识卡片 · '+esc(READER.term||'当前章节')+'</h2>';
  h += '<div class="muted" style="margin-bottom:12px">关闭卡片页后，你也可以在本书的「总览」→「知识卡片」里回看全部卡片。</div>';
  h += '<div style="display:flex;flex-direction:column;gap:10px">';
  for(const c of cards){
    const sum = esc(((c.fields && c.fields.summary) || '').slice(0, 80));
    h += '<div class="card" style="margin:0;padding:14px 16px">'
      + '<div style="font-weight:700">'+esc(c.chapter_title || '未归章节')+'</div>'
      + (sum ? '<div class="muted" style="margin-top:6px">'+sum+'</div>' : '')
      + '<div class="muted" style="margin-top:4px">创建时间：'+esc(c.created_at || '')+'</div>'
      + '<div class="row" style="margin-top:10px">'
      + `<button class="btn sm" onclick="closeModal();location.hash='#/card/${c.id}'">打开</button>`
      + `<button class="btn ghost sm" onclick="closeModal();editCard('${c.id}')">编辑</button>`
      + `<button class="btn ghost sm" onclick="deleteReadCardAndRefresh('${c.id}')">删除</button>`
      + '</div></div>';
  }
  h += '</div>';
  modal(h);
}
async function deleteReadCardAndRefresh(id){
  if(!confirm('删除这张卡片？')) return;
  await api('/api/cards/'+id, 'DELETE');
  toast('已删除');
  closeModal();
  await refreshReadCardEntry();
}

async function renderRead(bid, mode, key){
  const b = await api('/api/books/'+bid);
  if(b.error){ view().innerHTML='<div class="card">书目不存在</div>'; return; }
  if(!b.raw_text){
    view().innerHTML='<div class="row" style="justify-content:space-between"><h1>阅读</h1><button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">‹ 目录</button></div>'
      + '<div class="card">本书还没有全文。<button class="btn sec sm" onclick="openFetchModal(\'book\',\''+bid+'\')">📥 导入全书原文</button></div>';
    return;
  }
  const term = decodeURIComponent(key);
  const title = (mode==='keyword') ? '关键词：'+term : term;
  READER = {bid, mode, term, pages:[], idx:0, threadId:'', marks:[], chatHistLoaded:false};
  // 计算阅读器分页内容
  if(mode==='chapter'){
    const slice = chapterSlice(b.raw_text, term, b.chapters||[]);
    const cleaned = cleanReadText(slice);
    READER.pages = paginate(cleaned, 1800).map(arr => esc(arr.join('\n')).replace(/\n/g,'<br>'));
  } else {
    const ps = findPassages(b.raw_text, term);
    if(!ps.length){ READER.pages = ['<div class="reader-text muted">没有在全文里找到「'+esc(term)+'」。</div>']; }
    else {
      const joined = ps.map(p=>cleanReadText(p)).join('\n\n');
      READER.pages = paginate(joined, 1800).map(arr => highlight(arr.join('\n'), term).replace(/\n/g,'<br>'));
    }
  }
  const savedIdx = restoreReadPageIdx(bid, mode, term);
  READER.idx = Math.max(0, Math.min(savedIdx, Math.max(0, READER.pages.length - 1)));
  READER.marks = Array.isArray(b.reader_marks) ? b.reader_marks : [];
  MARK_BOOK = { bid, marks: READER.marks };
  let h='<div class="row" style="justify-content:space-between;align-items:flex-end"><h1>'+esc(title)+'</h1>'
    + '<div class="row"><button class="btn ghost sm" onclick="location.hash=\'#/book/'+bid+'\'">‹ 目录</button>'
    + '<button class="btn sec sm" id="r_gen">✨ 生成知识卡片</button></div></div>';
  h+='<div class="read-layout">'
    + '<div class="read-pane"><div class="card read-card">'
    + '<div class="reader-toolbar"><button type="button" class="btn sec sm" id="r_marks">查看标签</button></div>'
    + '<div id="r_reader" class="reader-box"></div>'
    + '<div class="reader-nav"><button class="btn ghost sm" id="r_prev">‹ 上一页</button>'
    + '<span id="r_pageno" class="muted">第 1 / 1 页</span>'
    + '<button class="btn ghost sm" id="r_next">下一页 ›</button>'
    + '<button class="btn" id="r_gen2" style="margin-left:auto">✨ 生成知识卡片</button></div>'
    + '</div></div>';
  h+='<div class="read-pane"><div class="card discuss-chat-card">'
    + '<div class="chat-head"><div class="muted" style="font-size:13px">💬 聊天室</div>'
    + '<select id="r_chapter" style="flex:1;max-width:240px">'+chapterOpts(b, title)+'</select>'
    + '<button type="button" class="btn sec sm" id="r_chat_marks">💭 标注</button></div>'
    + '<div class="muted" style="font-size:12px;margin:0 0 8px">@马克思 只叫马克思回复；@神鲸 只叫神鲸回复（默认神鲸）。气泡内选中 → 右键写想法。</div>'
    + '<div id="r_qs" class="starter-host"></div>'
    + '<div id="r_msgs" class="discuss-box chat-box"></div>'
    + '<div id="r_status" class="chat-status"></div>'
    + '<div class="chat-savebar"><label class="selall"><input type="checkbox" id="r_selall"> 全选</label>'
    + '<label class="selall"><input type="checkbox" id="r_save_marks"> 含标注</label>'
    + '<span id="r_selcount" class="muted">已选 0 条</span>'
    + '<div class="row" style="gap:8px"><button class="btn ghost sm" id="r_load_hist">加载本章历史</button><button class="btn sec sm" id="r_save">💾 保存选中为读书笔记</button></div></div>'
    + '<div class="row" style="align-items:flex-end;margin-top:8px"><textarea id="r_input" placeholder="输入问题（可用 @马克思 / @神鲸 开头）…（Enter 发送，Shift+Enter 换行）" style="flex:1;min-height:60px"></textarea>'
    + '<button class="btn" id="r_send">发送</button></div>'
    + '</div></div></div>';
  view().innerHTML=h;
  ensureMarkChrome();
  renderReaderPage({resetScroll:true});
  const prev=$('#r_prev'); if(prev) prev.onclick = readerPrev;
  const next=$('#r_next'); if(next) next.onclick = readerNext;
  const gen2=$('#r_gen2'); if(gen2) gen2.onclick = ()=>genReadCard(READER.bid, READER.term, READER.mode);
  const marksBtn=$('#r_marks'); if(marksBtn) marksBtn.onclick = ()=>{ MARK_UI.activeSurface='reader'; openMarkPanel(); };
  const chatMarksBtn=$('#r_chat_marks'); if(chatMarksBtn) chatMarksBtn.onclick = ()=>{ MARK_UI.activeSurface='read-chat'; openMarkPanel(); };
  const send=$('#r_send'); if(send) send.onclick = ()=>sendReadChat(READER.bid, READER.term, READER.mode);
  const save=$('#r_save'); if(save) save.onclick = saveNotes;
  const loadHist=$('#r_load_hist'); if(loadHist) loadHist.onclick = ()=>loadReadChat(bid);
  const rSaveMarks=$('#r_save_marks'); if(rSaveMarks) rSaveMarks.onchange = updateSelCount;
  const selall=$('#r_selall'); if(selall) selall.onchange = (e)=>{ document.querySelectorAll('.msgsel-cb').forEach(cb=>cb.checked=e.target.checked); updateSelCount(); };
  const ch=$('#r_chapter'); if(ch) ch.onchange = async ()=>{ READER.threadId = readThreadId(); renderStarterQuestions(); clearReadChatPanel(); };
  const input=$('#r_input'); if(input) input.addEventListener('keydown', e=>{
    if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendReadChat(READER.bid, READER.term, READER.mode); }
  });
  bindChatMarkEvents('#r_msgs', 'read-chat');
  READER.threadId = readThreadId();
  renderStarterQuestions();
  clearReadChatPanel();
  await refreshReadCardEntry();
  saveReadResume();
}
function clearReadChatPanel(){
  CHAT_MSGS = [];
  READER.chatHistLoaded = false;
  const box=$('#r_msgs');
  if(box) box.innerHTML='<div class="muted" style="padding:10px">当前默认不自动加载历史。你可直接提问，或点「加载本章历史」。</div>';
  updateSelCount();
}
async function loadReadChat(bid, opts){
  const tid = READER.threadId || readThreadId();
  const msgs=await api('/api/books/'+bid+'/messages?thread_id='+encodeURIComponent(tid));
  CHAT_MSGS = msgs || [];
  READER.chatHistLoaded = true;
  const box=$('#r_msgs');
  if(!box) return;
  if(!CHAT_MSGS.length){ box.innerHTML='<div class="muted" style="padding:10px">还没有对话。可点上方建议问题，或直接输入你的问题。</div>'; updateSelCount(); return; }
  box.innerHTML=CHAT_MSGS.map((m,i)=>{
    const sp=m.speaker || (m.role==='user' ? 'me' : 'shenjing');
    const who = chatSpeaker(sp);
    const cls = chatClass(sp);
    const sel = sp==='me' ? '我的问题' : '回答';
    return '<div class="msg '+cls+'"><div class="msg-top"><span class="who">'+who+'</span>'
      + '<label class="msgsel"><input type="checkbox" class="msgsel-cb" data-i="'+i+'"> '+sel+'</label></div>'
      + '<div class="bubble">'+applyMarksToHtml(chatHtml(m.content||''))+'</div></div>';
  }).join('');
  const mode = (opts && opts.anchor === 'preserve') ? null : ((opts && opts.anchor) || 'bottom');
  if(mode) requestAnimationFrame(()=>scrollChatAnchor(box, mode));
  box.querySelectorAll('.msgsel-cb').forEach(cb=>cb.onchange=updateSelCount);
  updateSelCount();
}
function updateSelCount(){
  const n=document.querySelectorAll('.msgsel-cb:checked').length;
  const marksOn = !!($('#r_save_marks') && $('#r_save_marks').checked);
  const el=$('#r_selcount'); if(el) el.textContent='已选 '+n+' 条';
  const save=$('#r_save'); if(save) save.disabled=(n===0 && !marksOn);
}
function starterQuestions(term){
  const t = term||'当前章节';
  return [
    '请用三句话概括“'+t+'”的核心观点',
    '这个章节里最容易误解的概念是什么？',
    '把“'+t+'”放到当下现实里该怎么分析？',
    '@马克思 你会如何批判这一段的表象？',
    '@神鲸 给我一个更现实的数据化解读角度'
  ];
}
function starterStateKey(){
  return 'starter-selected::'+(READER.threadId||'default');
}
function starterExpandKey(){ return 'starter-expanded'; }
function setStarterSelected(i){
  try{ localStorage.setItem(starterStateKey(), String(i)); }catch(e){}
}
function getStarterSelected(){
  try{ return parseInt(localStorage.getItem(starterStateKey())||'-1'); }catch(e){ return -1; }
}
function getStarterExpanded(){
  try{ return localStorage.getItem(starterExpandKey())==='1'; }catch(e){ return false; }
}
function setStarterExpanded(on){
  try{ localStorage.setItem(starterExpandKey(), on?'1':'0'); }catch(e){}
}
function toggleStarterPanel(){
  setStarterExpanded(!getStarterExpanded());
  renderStarterQuestions();
}
function renderStarterQuestions(){
  const box=$('#r_qs'); if(!box) return;
  const qs=starterQuestions(READER.term);
  const sel = getStarterSelected();
  const open = getStarterExpanded();
  const chips = qs.map((q,i)=>'<button type="button" class="kw-chip starter '+(sel===i?'active':'')+'" onclick="selectStarterQuestion('+i+',decodeURIComponent(\''+encodeURIComponent(q)+'\'))">'+esc(q)+'</button>').join('');
  box.innerHTML = '<div class="starter-bar">'
    + '<button type="button" class="starter-toggle" onclick="toggleStarterPanel()" aria-expanded="'+(open?'true':'false')+'">'
    + (open ? '收起建议问题' : '展开建议问题（'+qs.length+'）')
    + '</button>'
    + (sel>=0 && !open ? '<span class="starter-hint muted">已选 1 条 · 点展开可更换</span>' : '')
    + '</div>'
    + '<div class="starter-list'+(open?'':' is-collapsed')+'"'+(open?'':' hidden')+'>'+chips+'</div>';
}
function selectStarterQuestion(i, q){
  const cur = getStarterSelected();
  if(cur===i) setStarterSelected(-1);
  else setStarterSelected(i);
  renderStarterQuestions();
  const el=$('#r_input'); if(!el) return;
  if(cur===i) el.value = '';
  else el.value = q;
}
function sendStarterQuestion(q){
  const el=$('#r_input'); if(!el) return;
  el.value = q;
  sendReadChat(READER.bid, READER.term, READER.mode);
}
async function sendReadChat(bid, term, mode){
  const raw=$('#r_input').value.trim(); if(!raw){ toast('请输入'); return; }
  const target = detectTarget(raw);
  const sendBtn=$('#r_send');
  const tid = READER.threadId || readThreadId();
  if(sendBtn){ sendBtn.disabled=true; sendBtn.textContent='生成中…'; }
  showChatStatus('正在等待 '+(target==='marx'?'马克思':'神鲸')+' 回答…');
  renderTyping(target);
  try{
    const b=await api('/api/books/'+bid);
    const ctx=readCtx(b, term, mode);
    const chSel=$('#r_chapter'); const chTitle=chSel?chSel.value:term;
    const r=await api('/api/chat','POST',{book_id:bid, content:raw, chapter_title:chTitle, context_text:ctx, target, thread_id:tid});
    hideChatStatus();
    if(r.error){ toast('出错：'+r.error); await loadReadChat(bid, {anchor:'latest-turn'}); return; }
    $('#r_input').value='';
    if(typeof scheduleCloudSyncPush === 'function') scheduleCloudSyncPush();
    if(r.configured===false){ readChatFallbackSingle(bid, r.prompt||'', target); await loadReadChat(bid, {anchor:'latest-turn'}); return; }
    await loadReadChat(bid, {anchor:'latest-turn'});
  }catch(e){
    hideChatStatus();
    toast(e.message||String(e));
    const box=$('#r_msgs');
    if(box) box.innerHTML='<div class="muted" style="padding:10px">发送失败：'+esc(e.message||String(e))+'</div>';
  }finally{
    if(sendBtn){ sendBtn.disabled=false; sendBtn.textContent='发送'; }
  }
}
function showChatStatus(txt){
  const el=$('#r_status'); if(!el) return;
  el.innerHTML='<span class="spinner sm"></span> '+esc(txt);
  el.style.display='flex';
}
function hideChatStatus(){ const el=$('#r_status'); if(el) el.style.display='none'; }
function renderTyping(target){
  const box=$('#r_msgs'); if(!box) return;
  const who = target==='marx' ? '马克思' : '神鲸';
  box.innerHTML='<div class="msg assistant"><div class="msg-top"><span class="who">'+who+'</span></div>'
    + '<div class="bubble typing"><span class="spinner sm"></span> 正在思考中…</div></div>';
}
function readChatFallbackSingle(bid, prompt, target){
  const who = target==='marx' ? '马克思' : '神鲸';
  modal('<span class="close" onclick="closeModal()">×</span><h2>未配置 AI 接口 · 讨论兜底</h2>'
    + '<p class="muted">你的问题已保存。把下方提示词发给我，把'+who+'的回复粘回即可存入此讨论。</p>'
    + '<textarea readonly id="rp_one">'+esc(prompt||'')+'</textarea>'
    + '<div class="row"><button class="btn sec sm" onclick="navigator.clipboard.writeText($(\'#rp_one\').value);toast(\'已复制\')">复制提示词</button></div>'
    + '<div class="field" style="margin-top:12px"><label>粘贴「'+who+'」回复</label><textarea id="rp_one_reply" placeholder="在此粘贴回复全文"></textarea></div>'
    + '<button class="btn" onclick="saveReadReplySingle(\''+bid+'\',\''+target+'\')">存入讨论</button>');
}
async function saveReadReplySingle(bid, target){
  const txt=(($('#rp_one_reply').value||'').trim());
  if(!txt){ toast('请粘贴回复'); return; }
  const sp = target==='marx' ? 'marx' : 'shenjing';
  await api('/api/books/'+bid+'/messages','POST',{role:'assistant', speaker:sp, content:txt, thread_id:READER.threadId||readThreadId()});
  closeModal(); await loadReadChat(bid, {anchor:'latest-turn'}); toast('已存入讨论');
}
function dateStr(){ const d=new Date(); const p=n=>String(n).padStart(2,'0'); return d.getFullYear()+p(d.getMonth()+1)+p(d.getDate()); }
async function saveNotes(){
  const sel=[...document.querySelectorAll('.msgsel-cb:checked')].map(cb=>parseInt(cb.dataset.i));
  const includeMarks = !!($('#r_save_marks') && $('#r_save_marks').checked);
  if(!sel.length && !includeMarks){ toast('请勾选对话内容，或勾选「含标注」'); return; }
  MARK_UI.activeSurface = 'read-chat';
  const order=sel.slice().sort((a,b)=>a-b);
  const messages = [];
  for(const i of order){
    const m=CHAT_MSGS[i]; if(!m) continue;
    const sp=m.speaker || (m.role==='user'?'me':'shenjing');
    const who = sp==='me' ? '我（问题）' : sp==='marx' ? '马克思' : '神鲸';
    messages.push({who, content: m.content||''});
  }
  const marks = includeMarks ? collectMarksForExport('read-chat') : [];
  const md = await buildReadingNotesMd({
    bid: READER.bid,
    contextLabel: markContextLabel(),
    messages,
    marks,
  });
  downloadMarkdown(md, '读书笔记-'+(await bookTitle(READER.bid))+'-'+dateStr());
  toast('已保存读书笔记到本地');
}
function showBusy(txt){
  let b=$('#busy');
  if(!b){ b=document.createElement('div'); b.id='busy'; b.className='busy';
    b.innerHTML='<div class="spinner"></div><div class="busy-txt"></div>'; document.body.appendChild(b); }
  b.querySelector('.busy-txt').textContent=txt||'处理中…';
  b.style.display='flex';
}
function hideBusy(){ const b=$('#busy'); if(b) b.style.display='none'; }
async function genReadCard(bid, term, mode){
  const b = await api('/api/books/'+bid);
  const text = (mode==='chapter') ? cleanReadText(chapterSlice(b.raw_text||'', term, b.chapters||[])) : findPassages(b.raw_text||'', term).map(cleanReadText).join('\n\n');
  if(!text || text.length<10){ toast('当前内容太短，无法生成卡片'); return; }
  showBusy('正在生成知识卡片…');
  const r = await api('/api/generate','POST',{text, mode:'批量整理', chapter_title:term, book_id:bid});
  hideBusy();
  if(r.configured===false){
    modal('<span class="close" onclick="closeModal()">×</span><h2>未配置 AI 接口 · 兜底</h2>'
      + '<p class="muted">把下面提示词发给我，返回 JSON 后粘回即可自动填充卡片。</p>'
      + '<textarea readonly id="rpf">'+esc(r.prompt)+'</textarea>'
      + '<div class="row"><button class="btn sec sm" onclick="navigator.clipboard.writeText($(\'#rpf\').value);toast(\'已复制\')">复制提示词</button></div>'
      + '<div class="field" style="margin-top:12px"><label>粘贴 AI 返回的 JSON</label><textarea id="rpf_json" placeholder="在此粘贴 JSON"></textarea></div>'
      + '<button class="btn" onclick="fillToNewCard(\''+bid+'\',\'\',\''+esc(term)+'\')">解析并填充</button>');
    return;
  }
  if(r.error){ toast('生成出错：'+r.error); return; }
  if(!r.fields){ toast('生成结果无法解析为卡片'); return; }
  openCardForm(bid,'',r.fields,term);
}


/* 选中即查 · 框架能力（设置页可开关 / 换引擎；见 APP_CFG） */
(function(){
  const LOOKUP_SEL = '.chat-box .bubble, #msgs .bubble, #r_msgs .bubble, .discuss-source-view, .reader-box, .kcard-v3 .kbody';
  let btn = null;
  let lastQuery = '';

  function cfg(){ return APP_CFG || {}; }
  function maxChars(){
    const n = parseInt(cfg().lookup_max_chars, 10);
    return (n >= 20 && n <= 500) ? n : 200;
  }
  function searchUrl(q){
    const tpl = (cfg().lookup_url || 'https://www.bing.com/search?q={q}');
    if(tpl.indexOf('{q}') >= 0) return tpl.split('{q}').join(encodeURIComponent(q));
    return tpl + encodeURIComponent(q);
  }
  function engineLabel(){
    const e = cfg().lookup_engine || 'bing';
    if(e === 'baidu') return '百度';
    if(e === 'custom') return '外搜';
    return '必应';
  }

  function ensureBtn(){
    if(btn) return btn;
    btn = document.createElement('button');
    btn.id = 'sel-lookup';
    btn.type = 'button';
    btn.title = '查询选中文字';
    btn.setAttribute('aria-label', '查询选中文字');
    btn.textContent = '🔍';
    document.body.appendChild(btn);
    btn.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const q = (lastQuery || '').trim();
      if(!q){ hide(); return; }
      window.open(searchUrl(q), '_blank', 'noopener,noreferrer');
      hide();
      try{ window.getSelection().removeAllRanges(); }catch(_){}
    });
    return btn;
  }

  function hide(){
    if(btn) btn.classList.remove('show');
    lastQuery = '';
  }

  function inLookupZone(node){
    if(!node) return false;
    const el = node.nodeType === 3 ? node.parentElement : node;
    return !!(el && el.closest && el.closest(LOOKUP_SEL));
  }

  function update(){
    if(cfg().lookup_enabled === false){ hide(); return; }
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount){ hide(); return; }
    const text = String(sel.toString() || '').trim();
    if(!text || text.length > maxChars()){ hide(); return; }
    const anchor = sel.anchorNode;
    const focus = sel.focusNode;
    if(!inLookupZone(anchor) || !inLookupZone(focus)){ hide(); return; }
    const ae = document.activeElement;
    if(ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT' || ae.isContentEditable)){ hide(); return; }

    let rect;
    try{
      const range = sel.getRangeAt(0);
      const rects = range.getClientRects();
      rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    }catch(_){ hide(); return; }
    if(!rect || (!rect.width && !rect.height)){ hide(); return; }

    lastQuery = text;
    const el = ensureBtn();
    const tip = (text.length > 24 ? text.slice(0, 24) + '…' : text);
    el.title = '在' + engineLabel() + '查询「' + tip + '」';
    let left = rect.right + 6;
    let top = rect.top - 4;
    if(left + 40 > window.innerWidth) left = rect.left - 40;
    if(top < 8) top = rect.bottom + 4;
    if(top + 40 > window.innerHeight) top = window.innerHeight - 44;
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = Math.max(8, top) + 'px';
    el.classList.add('show');
  }

  document.addEventListener('mouseup', () => { setTimeout(update, 10); });
  document.addEventListener('keyup', e => {
    if(e.key === 'Escape') hide();
    else if(e.shiftKey || e.key.startsWith('Arrow')) setTimeout(update, 10);
  });
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if(!sel || sel.isCollapsed) hide();
  });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  document.addEventListener('mousedown', e => {
    if(btn && btn.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      if(!sel || sel.isCollapsed) hide();
    }, 0);
  });
})();

/* AI_READER_KEEPALIVE: 关标签后停服；仅 pagehide（不绑 beforeunload，避免误杀） */
(function(){
  const ping = () => { try { fetch('/api/ping', {method:'GET', cache:'no-store'}); } catch(e){} };
  const bye = () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/shutdown', new Blob([JSON.stringify({bye:true})], {type:'application/json'}));
      } else {
        fetch('/api/shutdown', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{"bye":true}', keepalive:true});
      }
    } catch(e){}
  };
  ping();
  setInterval(ping, 2500);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) ping(); });
  window.addEventListener('pagehide', bye);
})();
