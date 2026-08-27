'use strict';
/** iPad 独立模式：浏览器内完整 API（离线阅读 + 联网 AI） */

function localNewId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function localNow(){
  return new Date().toISOString().slice(0, 19);
}

const LOCAL_DEFAULT_SETTINGS = {
  api_base: '',
  api_key: '',
  model: 'gpt-4o-mini',
  lookup_enabled: true,
  lookup_engine: 'bing',
  lookup_url: 'https://www.bing.com/search?q={q}',
  lookup_max_chars: 200,
  sync_enabled: false,
  sync_github_token: '',
  sync_gist_id: '',
  sync_auto_pull: true,
  sync_auto_push: true,
  sync_device_name: 'ipad',
};

const LOCAL_SEED_CHAPTERS = [
  '《黑格尔法哲学批判》导言', '论犹太人问题', '国民经济学批判大纲（恩格斯）',
  '英国状况。十八世纪（恩格斯）', '1844年经济学哲学手稿', '神圣家族（节选）',
  '英国工人阶级状况（节选）（恩格斯）', '关于费尔巴哈的提纲', '德意志意识形态（节选）',
  '哲学的贫困（节选）', '共产主义者和卡尔·海因岑（恩格斯）', '共产主义原理（恩格斯）',
  '关于波兰的演说', '雇佣劳动与资本', '关于自由贸易问题的演说',
];

const LOCAL_SEED_CONCEPTS = [
  {term:'异化劳动', type:'概念', note:'马克思《1844年手稿》：劳动产品、劳动过程、类本质、人与人之间关系的四重异化。'},
  {term:'市民社会', type:'概念', note:'黑格尔法哲学批判中，市民社会是私利的领域，决定国家而非相反。'},
  {term:'唯物史观', type:'理论', note:'不是意识决定生活，而是生活决定意识；生产力与交往形式的矛盾推动历史。'},
  {term:'商品', type:'概念', note:'用于交换的劳动产品，凝结着无差别的人类抽象劳动。'},
  {term:'分工', type:'概念', note:'分工导致私有制与人的片面化，也是异化的重要机制。'},
  {term:'共产主义', type:'理论', note:'对私有财产即人的自我异化的积极的扬弃。'},
];

const LOCAL_READING_MAP = {
  title:'马克思主义经典阅读地图',
  subtitle:'以一手文献为主线的 24 小时冲刺阅读路线',
  target_outcome:'读完本路线后，你应当能够：用唯物史观解释一个现实社会现象；讲清商品—货币—资本的内在矛盾；区分马克思对资本主义的「内在批判」与道德指责；并就任一章节提出自己的读书笔记与可讨论问题。',
  concepts:[
    {id:'c1',term:'异化劳动',note:'劳动产品、劳动过程、类本质、人与人之间关系四重异化。《1844年手稿》核心。'},
    {id:'c2',term:'唯物史观',note:'不是意识决定生活，而是生活决定意识；生产力与交往形式的矛盾推动历史。'},
    {id:'c3',term:'商品与价值',note:'商品是私人劳动的社会表现；价值是凝结的人类抽象劳动；货币是一般等价物。'},
    {id:'c4',term:'剩余价值',note:'劳动力商品的特殊处在于其使用能创造大于自身价值的价值。'},
    {id:'c5',term:'资本积累',note:'剩余价值资本化；相对/绝对剩余价值；积累导致两极分化与危机趋势。'},
    {id:'c6',term:'国家与革命',note:'国家是阶级统治的机器；无产阶级专政是过渡。'},
    {id:'c7',term:'帝国主义',note:'垄断、金融资本、资本输出、瓜分世界的必然阶段。'},
    {id:'c8',term:'矛盾与实践',note:'矛盾的普遍与特殊；实践第一的认识论。'},
  ],
  edges:[['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5'],['c2','c6'],['c5','c7'],['c2','c8']],
  schedule:[], exercises:[], misconceptions:[], final_artifact:'', next7:[],
};

async function localGetSettings(){
  const cur = await idbKvGet('settings', {}) || {};
  const out = Object.assign({}, LOCAL_DEFAULT_SETTINGS, cur);
  const eng = out.lookup_engine || 'bing';
  if(eng === 'bing') out.lookup_url = 'https://www.bing.com/search?q={q}';
  else if(eng === 'baidu') out.lookup_url = 'https://www.baidu.com/s?wd={q}';
  return out;
}

async function localSaveSettings(patch){
  const cur = await localGetSettings();
  if(patch && typeof patch === 'object'){
    for(const k of Object.keys(LOCAL_DEFAULT_SETTINGS)){
      if(k in patch) cur[k] = patch[k];
    }
  }
  const eng = cur.lookup_engine || 'bing';
  if(eng === 'bing') cur.lookup_url = 'https://www.bing.com/search?q={q}';
  else if(eng === 'baidu') cur.lookup_url = 'https://www.baidu.com/s?wd={q}';
  await idbKvSet('settings', cur);
  return cur;
}

async function localSeedIfEmpty(){
  const books = await idbAllBooks();
  if(books.length) return;
  const bid = localNewId();
  await idbPut(idbTx(['books'], 'readwrite').objectStore('books'), {
    id: bid,
    title: '马克思恩格斯文集（第一卷）',
    author: '马克思、恩格斯',
    created_at: localNow(),
    description: '1843—1848年著作。当前主线阅读书目。',
    chapters: LOCAL_SEED_CHAPTERS.map(t => ({id: localNewId(), title: t, progress: false})),
    concepts: LOCAL_SEED_CONCEPTS.slice(),
    raw_text: '',
  });
}

async function localGetBook(bid){
  const tx = idbTx(['books'], 'readonly');
  return idbGet(tx.objectStore('books'), bid);
}

async function localSaveBook(b){
  const tx = idbTx(['books'], 'readwrite');
  await idbPut(tx.objectStore('books'), b);
  return b;
}

async function localListBooks(){
  const books = await idbAllBooks();
  const cards = await idbAllCards();
  for(const b of books){
    b.card_count = cards.filter(c => c.book_id === b.id).length;
  }
  books.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  return books;
}

async function localListCards(bid){
  let cards = await idbAllCards();
  if(bid) cards = cards.filter(c => c.book_id === bid);
  cards.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return cards;
}

async function localGetCard(cid){
  const tx = idbTx(['cards'], 'readonly');
  return idbGet(tx.objectStore('cards'), cid);
}

async function localSaveCard(c){
  const tx = idbTx(['cards'], 'readwrite');
  await idbPut(tx.objectStore('cards'), c);
  return c;
}

async function localLoadConv(bid){
  const tx = idbTx(['conversations'], 'readonly');
  const row = await idbGet(tx.objectStore('conversations'), bid);
  return row ? (row.messages || []) : [];
}

async function localSaveConv(bid, msgs){
  const tx = idbTx(['conversations'], 'readwrite');
  await idbPut(tx.objectStore('conversations'), {book_id: bid, messages: msgs || []});
}

async function localGetPlan(){
  const p = await idbKvGet('plan', null);
  if(p) return p;
  const seed = {title:'马克思主义经典著作阅读路线（一手文献）', intro:'只围绕马克思、恩格斯、列宁、毛泽东的一手文献展开。', phases:[], custom_books:[]};
  await idbKvSet('plan', seed);
  return seed;
}

async function localGetReadingMap(){
  return await idbKvGet('reading_map', LOCAL_READING_MAP) || LOCAL_READING_MAP;
}

async function localListMapPlans(){
  const plans = await idbAllMapPlans();
  return plans.map(p => ({
    id: p.id, name: p.name, created_at: p.created_at, done: !!p.done,
  })).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

async function localGetMapPlan(pid){
  const tx = idbTx(['map_plans'], 'readonly');
  return idbGet(tx.objectStore('map_plans'), pid);
}

// ---------- fetch / import ----------
function localDecodeHtmlBuffer(buf){
  const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
  const m = head.match(/charset=["']?\s*([\w-]+)/i);
  const enc = m ? m[1].toLowerCase() : null;
  const cands = [];
  if(enc) cands.push(enc.includes('gb') ? 'gb18030' : enc);
  cands.push('utf-8', 'gb18030');
  for(const c of [...new Set(cands)]){
    try{ return new TextDecoder(c).decode(buf); }catch(_){}
  }
  return new TextDecoder('gb18030').decode(buf);
}

function localStripHtml(html){
  html = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const mb = html.match(/<body[^>]*>([\s\S]*)/i);
  if(mb) html = mb[1];
  html = html.replace(/<\/(p|div|h[1-6]|li|tr|th|td|section|article|blockquote)[^>]*>/gi, '\n');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<[^>]+>/g, ' ');
  const el = document.createElement('textarea');
  el.innerHTML = html;
  html = el.value;
  html = html.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n[ \t]*\n+/g, '\n').replace(/\n{3,}/g, '\n\n');
  return html.trim();
}

async function localFetchUrl(url){
  if(!/^https?:\/\//i.test(url || '')) return {ok: false, error: '仅支持 http/https 链接'};
  try{
    const r = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0 (compatible; AIReader/1.0)'}});
    const buf = await r.arrayBuffer();
    const slice = buf.byteLength > 5 * 1024 * 1024 ? buf.slice(0, 5 * 1024 * 1024) : buf;
    const html = localDecodeHtmlBuffer(new Uint8Array(slice));
    const mt = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = mt ? mt[1].replace(/<[^>]+>/g, '').trim() : '';
    const text = localStripHtml(html);
    return {ok: true, title, text, length: text.length, url};
  }catch(e){
    return {ok: false, error: String(e.message || e)};
  }
}

async function localImportFile(filename, content, isB64){
  const fn = (filename || '').toLowerCase();
  if(fn.endsWith('.pdf')){
    if(isB64){
      try{
        const text = await localPdfToText(content);
        return {ok: true, text};
      }catch(e){
        return {ok: false, error: 'PDF 解析失败：' + (e.message || e)};
      }
    }
    return {ok: false, error: 'PDF 需以二进制上传'};
  }
  const text = isB64 ? localB64ToUtf8(content) : content;
  return {ok: true, text};
}

function localB64ToUtf8(b64){
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

let _pdfJsPromise = null;
function localLoadPdfJs(){
  if(window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if(_pdfJsPromise) return _pdfJsPromise;
  _pdfJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = () => {
      try{
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      }catch(e){ reject(e); }
    };
    s.onerror = () => reject(new Error('无法加载 PDF.js（需联网首次导入 PDF）'));
    document.head.appendChild(s);
  });
  return _pdfJsPromise;
}

async function localPdfToText(b64){
  const pdfjs = await localLoadPdfJs();
  const bin = atob(b64);
  const data = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  const pdf = await pdfjs.getDocument({data}).promise;
  const parts = [];
  for(let p = 1; p <= pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    parts.push(tc.items.map(it => it.str).join(' '));
  }
  return parts.join('\n\n');
}

// ---------- LLM ----------
const LOCAL_BUILD_PROMPT_SYSTEM = `你是一位严谨的"马克思主义陪读"助手，陪用户深度阅读并产出结构化知识卡片。

# 陪读核心规则（务必遵守）
1. 优先级 B（现实对照/当代应用）最高：马克思主义是认识世界的工具。遇到概念，必须主动给出"如何用它分析当下现实矛盾/问题"的思路，而不只是举例子。
2. 当用户意在弄清"某理论怎么诞生/发展"时，要讲透思想史背景（针对什么历史矛盾、受谁影响、怎样演进）。
3. 输出要利于写作引用：提炼金句与论证框架，并打标签。
4. 语言：中文，严谨但不晦涩；概念要用大白话拆解，并标出处（章节/著作）。

# 卡片字段（必须严格输出以下 JSON，key 不变，不要任何额外文字、不要 markdown 代码 fence）
{
  "summary": "一句话主旨",
  "thesis": "核心论点/结论",
  "concepts": "关键概念白话拆解（每个概念一行：概念——解释——出处）",
  "quotes": "原文金句（带章节/页码；若无精确出处写'待核对'）",
  "background": "思想史背景：诞生脉络、针对的历史矛盾、思想源流",
  "reality": "现实对照：用马克思主义分析当下什么矛盾/问题，给出分析思路（不止举例）",
  "relation": "我的关联/思考：跨书、跨章节的连接",
  "selfcheck": "自检问题（2-3题，必须包含一题'这能解释你身边的什么矛盾？'）",
  "writing": "写作素材标签：可引用金句 + 论证框架，分号分隔的标签"
}`;

function localBuildPrompt(text, mode, chapterTitle){
  const user = `阅读章节/主题：${chapterTitle || '未指定'}\n阅读模式：${mode}\n\n以下为读到的内容：\n${text}`;
  return {system: LOCAL_BUILD_PROMPT_SYSTEM, user};
}

function localParseFields(content){
  let s = (content || '').trim();
  if(s.startsWith('```')){
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  try{ return JSON.parse(s); }catch(_){}
  const m = s.match(/\{[\s\S]*\}/);
  if(m){ try{ return JSON.parse(m[0]); }catch(_){ return null; } }
  return null;
}

async function localCallLlmChat(messages){
  const s = await localGetSettings();
  if(!s.api_base || !s.api_key) return null;
  const body = {
    model: s.model || 'gpt-4o-mini',
    messages,
    temperature: 0.6,
  };
  try{
    const r = await fetch(s.api_base.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.api_key},
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if(!r.ok) return 'ERROR:' + (data.error && data.error.message ? data.error.message : r.status);
    return data.choices[0].message.content;
  }catch(e){
    return 'ERROR:' + (e.message || e);
  }
}

const LOCAL_MARX_SYSTEM = `你扮演卡尔·马克思，以《资本论》为核心的思维框架与表达方式作答。严格遵守以下规则：
1. 直接用「我」说话，不用「马克思会认为/马克思大概」。
2. 方法优先于道德义愤：从对象自身的范畴出发，揭示其内部矛盾。
3. 始终追问生产关系：谁占有生产资料？剩余价值从何而来？
4. 商品拜物教批判：指出哪些人与人的关系被伪装成了物与物的「自然属性」。
5. 表达：中文；可引用著作原文；避免空谈道德。
6. 直接进入回答，不要元说明。`;

const LOCAL_NEUTRAL_SYSTEM = `你是一位中立的当代现实分析者，基于当下（2026 年）可验证的真实世界事实、数据与主流社会科学回答。以事实为准；不站立场；与同屏的「马克思视角」形成互补。直接进入回答，不要元说明。`;

function localCtxBlock(contextText){
  let ctx = (contextText || '').trim();
  if(!ctx) return '';
  if(ctx.length > 8000) ctx = ctx.slice(0, 8000) + '\n…（原文过长，已截断）';
  return '\n\n【用户当前正在阅读的原文（请优先围绕它回答，可引用其中段落）】\n' + ctx;
}

function localRenderHistory(history){
  return history.map(m => {
    const sp = m.speaker || (m.role === 'user' ? 'me' : 'partner');
    let tag = '【陪读伙伴（上轮）】';
    if(sp === 'me') tag = '【用户】';
    else if(sp === 'marx') tag = '【马克思（上轮）】';
    const c = (m.content || '').trim();
    return c ? tag + c : '';
  }).filter(Boolean).join('\n');
}

function localBuildDiscussMessages(book, chapterTitle, history, newUser, contextText){
  const title = book.title || '';
  const chap = chapterTitle ? `（当前关注章节：${chapterTitle}）` : '';
  let system = `你是一位"马克思主义陪读伙伴"，正在陪用户就《${title}》进行讨论${chap}。\n\n陪读规则：现实对照优先；思想史背景讲透；像同伴而不是讲师。对话体输出，不要用 markdown 标题堆砌。`;
  system += localCtxBlock(contextText);
  const msgs = [{role: 'system', content: system}];
  for(const m of history.slice(-20)){
    if((m.role === 'user' || m.role === 'assistant') && m.content) msgs.push({role: m.role, content: m.content});
  }
  msgs.push({role: 'user', content: newUser});
  return msgs;
}

function localBuildMarxMessages(book, chapterTitle, history, newUser, contextText){
  const title = book.title || '';
  const chap = chapterTitle ? `（当前关注章节：${chapterTitle}）` : '';
  let system = LOCAL_MARX_SYSTEM + `\n\n用户正在阅读《${title}》${chap}，请结合该语境回答。`;
  system += localCtxBlock(contextText);
  const msgs = [{role: 'system', content: system}];
  const hist = localRenderHistory(history);
  if(hist) msgs.push({role: 'user', content: '（以下是对话前文，延续着聊）\n' + hist});
  msgs.push({role: 'user', content: newUser});
  return msgs;
}

function localBuildNeutralMessages(book, chapterTitle, history, newUser, contextText){
  const title = book.title || '';
  const chap = chapterTitle ? `（当前关注章节：${chapterTitle}）` : '';
  let system = LOCAL_NEUTRAL_SYSTEM + `\n\n用户正在阅读《${title}》${chap}，可结合该语境，但重点是用当下现实作答。`;
  system += localCtxBlock(contextText);
  const msgs = [{role: 'system', content: system}];
  const hist = localRenderHistory(history);
  if(hist) msgs.push({role: 'user', content: '（以下是对话前文，延续着聊）\n' + hist});
  msgs.push({role: 'user', content: newUser});
  return msgs;
}

function localMessagesToText(msgs){
  return msgs.map(m => {
    if(m.role === 'system') return '【系统设定】\n' + m.content;
    if(m.role === 'user') return '【用户】\n' + m.content;
    return '【助手】\n' + m.content;
  }).join('\n\n');
}

function localResolveChatTarget(content, explicitTarget){
  const t = (explicitTarget || '').trim().toLowerCase();
  const c = (content || '').trim();
  if(t === 'marx') return ['marx', c];
  if(['神鲸','shenjing','neutral','partner'].includes(t)) return ['shenjing', c];
  const m = c.match(/^\s*@\s*([\u4e00-\u9fa5A-Za-z]+)\s*[：:，,]?\s*([\s\S]*)$/);
  if(m){
    const who = (m[1] || '').trim().toLowerCase();
    const rest = (m[2] || '').trim();
    if(['马克思','marx'].includes(who)) return ['marx', rest || c];
    if(['神鲸','陪读伙伴','neutral','partner','ai'].includes(who)) return ['shenjing', rest || c];
  }
  return ['shenjing', c];
}

async function localSingleChat(book, chapterTitle, history, newUser, contextText, target){
  const msgs = target === 'marx'
    ? localBuildMarxMessages(book, chapterTitle, history, newUser, contextText)
    : localBuildNeutralMessages(book, chapterTitle, history, newUser, contextText);
  const resp = await localCallLlmChat(msgs);
  return [resp, msgs];
}

// ---------- search / export ----------
function localChapterAt(raw, pos, anchors){
  let ch = '';
  for(const [start, title] of anchors){
    if(start <= pos) ch = title;
    else break;
  }
  return ch;
}

function localMakeSnippet(text, pos){
  const s = Math.max(0, pos - 160);
  const e = Math.min(text.length, pos + 340);
  let seg = text.slice(s, e).replace(/\s+/g, ' ').trim();
  seg = seg.replace(/▶\s*\S+/g, '').replace(/(上一篇|下一篇|回目录|返回目录|返回) /g, '');
  return (s > 0 ? '…' : '') + seg + (e < text.length ? '…' : '');
}

async function localSearch(q, bid){
  const tokens = (q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!tokens.length) return [];
  let books = bid ? [await localGetBook(bid)] : await localListBooks();
  books = books.filter(Boolean);
  const results = [];
  for(const b of books){
    const raw = b.raw_text || '';
    if(!raw) continue;
    const low = raw.toLowerCase();
    if(!tokens.every(t => low.includes(t))) continue;
    const anchors = [...raw.matchAll(/\n▶ (.*)/g)].map(m => [m.index, m[1].trim()]);
    const primary = tokens[0];
    const positions = [];
    let idx = 0;
    while((idx = low.indexOf(primary, idx)) >= 0 && positions.length < 5000){
      positions.push(idx);
      idx += primary.length;
    }
    const groups = {};
    for(const pos of positions){
      const ch = localChapterAt(raw, pos, anchors);
      if(!groups[ch]) groups[ch] = [];
      groups[ch].push(pos);
    }
    for(const [ch, poslist] of Object.entries(groups)){
      const snippets = poslist.slice(0, 3).map(p => localMakeSnippet(raw, p));
      results.push({
        bid: b.id, book_title: b.title || '', author: b.author || '',
        chapter: ch, hits: poslist.length,
        snippet: snippets[0] || '', snippets,
      });
    }
  }
  results.sort((a, b) => b.hits - a.hits);
  return results.slice(0, 50);
}

function localCardMd(c){
  const f = c.fields || {};
  const labels = [
    ['summary','一句话主旨'], ['thesis','核心论点/结论'], ['concepts','关键概念'],
    ['quotes','原文金句'], ['background','思想史背景'], ['reality','现实对照'],
    ['relation','我的关联/思考'], ['selfcheck','自检问题'], ['writing','写作素材标签'],
  ];
  const out = [`### 卡片 · ${c.chapter_title || '未归章节'}`, ''];
  for(const [k, lab] of labels){
    if(f[k]) out.push(`**${lab}**：${f[k]}`);
  }
  if(c.tags && c.tags.length) out.push(`\n标签：${c.tags.join('、')}`);
  out.push('');
  return out;
}

async function localExportBook(bid){
  const b = await localGetBook(bid);
  if(!b) return null;
  const lines = [`# ${b.title}`, ''];
  if(b.author) lines.push(`作者：${b.author}`);
  if(b.description) lines.push(`> ${b.description}`);
  lines.push('', '## 篇章地图', '');
  (b.chapters || []).forEach((ch, i) => {
    lines.push(`${i + 1}. ${ch.progress ? '✅' : '⬜'} ${ch.title}`);
  });
  lines.push('', '## 概念全景图', '');
  for(const c of (b.concepts || [])) lines.push(`- **${c.term}**（${c.type || ''}）：${c.note || ''}`);
  lines.push('', '## 知识卡片', '');
  for(const c of await localListCards(bid)) lines.push(...localCardMd(c));
  return lines.join('\n');
}

async function localExportCard(cid){
  const c = await localGetCard(cid);
  if(!c) return null;
  return localCardMd(c).join('\n');
}

// ---------- bootstrap ----------
const LOCAL_KNOWN_HEAD = new Set(['序言','导言','引言','前言','后记','附录','注释','说明','跋','凡例','编者按','内容提要']);

function localIsHeading(p){
  if(!p || p.length > 60) return false;
  if(/[［【《][^］】》]{1,40}[］】》]/.test(p)) return true;
  if(/^第[一二三四五六七八九十百千0-9]+[章卷节部分编篇]/.test(p)) return true;
  if(LOCAL_KNOWN_HEAD.has(p)) return true;
  return false;
}

function localSplitSections(text){
  const paras = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const sections = [];
  let cur = null;
  const flush = () => {
    if(cur && cur.body.length) sections.push({title: cur.title, text: cur.body.join('\n')});
  };
  for(let i = 0; i < paras.length; i++){
    const p = paras[i];
    if(cur === null && (p.includes('文库') || p.includes('->') || p.includes('→'))) continue;
    if(localIsHeading(p)){
      const nxtBody = paras.slice(i + 1, i + 4).some(x => !localIsHeading(x));
      if(!nxtBody) continue;
      flush();
      cur = {title: p, body: []};
    }else{
      if(!cur) cur = {title: '正文', body: []};
      cur.body.push(p);
    }
  }
  flush();
  let out = sections.filter(s => s.text.trim());
  if(out.length && out[0].title === '正文' && out[0].text.length < 120) out = out.slice(1);
  if(!out.length) out = [{title: '全文', text: text}];
  return out;
}

async function localBootstrapBook(payload){
  let title = (payload.title || '').trim() || '未命名书目';
  let raw_text = (payload.raw_text || '').trim();
  const source_url = (payload.source_url || '').trim();
  if(source_url){
    const r = await localFetchUrl(source_url);
    if(!r.ok) return {ok: false, error: r.error || '抓取失败'};
    raw_text = (r.text || '').trim();
    if(title === '未命名书目' && r.title) title = r.title.slice(0, 120);
  }
  if(!raw_text) return {ok: false, error: '正文为空，请粘贴正文或填写可抓取链接'};
  const sections = localSplitSections(raw_text);
  const parts = sections.map(s => `▶ ${(s.title || '正文').slice(0, 80)}\n${(s.text || '').trim()}`).filter(Boolean);
  const anchored = parts.join('\n\n') + (parts.length ? '\n' : '');
  const bid = localNewId();
  const book = {
    id: bid, title,
    author: (payload.author || '').trim(),
    description: (payload.description || '').trim() || '一键初始化导入',
    created_at: localNow(),
    chapters: sections.map(s => ({id: localNewId(), title: (s.title || '正文').slice(0, 80), progress: false})),
    concepts: [],
    raw_text: anchored,
  };
  if(source_url) book.raw_source = source_url;
  await localSaveBook(book);
  return {ok: true, book};
}

// ---------- API router ----------
async function localApi(path, method, body){
  await localSeedIfEmpty();
  const p = path.split('?')[0];
  const qs = path.includes('?') ? Object.fromEntries(new URLSearchParams(path.split('?')[1])) : {};

  if(p === '/api/ping') return {ok: true, mode: 'local'};
  if(p === '/api/shutdown') return {ok: true, stopping: false};

  if(method === 'GET'){
    if(p === '/api/settings') return localGetSettings();
    if(p === '/api/books') return localListBooks();
    if(p === '/api/plans') return localGetPlan();
    if(p === '/api/reading-map') return localGetReadingMap();
    if(p === '/api/map-plans') return localListMapPlans();
    if(p === '/api/search') return localSearch(qs.q, qs.book_id || null);
    let m = p.match(/^\/api\/map-plans\/([\w-]+)$/);
    if(m){ const obj = await localGetMapPlan(m[1]); return obj || {error: 'not found'}; }
    m = p.match(/^\/api\/books\/([\w-]+)$/);
    if(m){ const b = await localGetBook(m[1]); return b || {error: 'not found'}; }
    m = p.match(/^\/api\/books\/([\w-]+)\/cards$/);
    if(m) return localListCards(m[1]);
    m = p.match(/^\/api\/books\/([\w-]+)\/messages$/);
    if(m){
      let msgs = await localLoadConv(m[1]);
      const tid = (qs.thread_id || '').trim();
      if(tid) msgs = msgs.filter(x => (x.thread_id || '') === tid);
      return msgs;
    }
    m = p.match(/^\/api\/cards\/([\w-]+)$/);
    if(m){ const c = await localGetCard(m[1]); return c || {error: 'not found'}; }
    m = p.match(/^\/api\/export\/book\/([\w-]+)$/);
    if(m){
      const md = await localExportBook(m[1]);
      if(!md) throw new Error('书目不存在');
      return md;
    }
    m = p.match(/^\/api\/export\/card\/([\w-]+)$/);
    if(m){
      const md = await localExportCard(m[1]);
      if(!md) throw new Error('卡片不存在');
      return md;
    }
    if(p === '/api/sync/export') return idbExportBundle();
    if(p === '/api/sync/export-delta') return localExportSyncDelta();
    throw new Error('not found: ' + p);
  }

  if(method === 'POST'){
    let m;
    if(p === '/api/settings') return localSaveSettings(body);
    if(p === '/api/books'){
      const bid = localNewId();
      const book = {
        id: bid,
        title: body.title || '未命名书目',
        author: body.author || '',
        description: body.description || '',
        raw_text: body.raw_text || '',
        created_at: localNow(),
        chapters: (body.chapters || []).map(t => typeof t === 'string'
          ? {id: localNewId(), title: t, progress: false}
          : t),
        concepts: body.concepts || [],
      };
      await localSaveBook(book);
      return book;
    }
    if(p === '/api/cards'){
      const card = {
        id: localNewId(),
        book_id: body.book_id,
        chapter_id: body.chapter_id,
        chapter_title: body.chapter_title || '',
        raw: body.raw || '',
        fields: body.fields || {},
        tags: body.tags || [],
        created_at: localNow(),
      };
      await localSaveCard(card);
      return card;
    }
    if(p === '/api/generate'){
      const {system, user} = localBuildPrompt(body.text || '', body.mode || '批量整理', body.chapter_title || '');
      const raw = await localCallLlmChat([{role: 'system', content: system}, {role: 'user', content: user}]);
      if(raw === null) return {configured: false, prompt: system + '\n\n----\n' + user};
      if(raw.startsWith('ERROR:')) return {configured: true, error: raw, raw};
      const fields = localParseFields(raw);
      if(!fields) return {configured: true, raw};
      return {configured: true, fields};
    }
    if(p === '/api/fetch') return localFetchUrl((body.url || '').trim());
    if(p === '/api/import'){
      const fn = body.filename || '';
      const isPdf = fn.toLowerCase().endsWith('.pdf');
      return localImportFile(fn, body.content || '', isPdf);
    }
    if(p === '/api/book/bootstrap') return localBootstrapBook(body);
    if(p === '/api/repair/marx'){
      return {ok: false, checked: 0, books: 0, fixed_chapters: 0, errors: [{error: '马恩补漏请在 Mac 端执行后导出书库，再在 iPad 导入'}]};
    }
    if(p === '/api/reading-map/save'){
      const map = body.map || body;
      await idbKvSet('reading_map', map);
      return map;
    }
    if(p === '/api/sync/export') return idbExportBundle();
    if(p === '/api/sync/export-delta') return localExportSyncDelta();
    if(p === '/api/sync/import'){
      if(!body || !Array.isArray(body.books)) throw new Error('无效的书库包');
      await idbImportBundle(body);
      return {ok: true, books: body.books.length};
    }
    if(p === '/api/sync/apply-delta') return localApplySyncDelta(body);
    m = p.match(/^\/api\/books\/([\w-]+)\/messages$/);
    if(m){
      const bid = m[1];
      const role = body.role;
      if(!['user','assistant'].includes(role)) throw new Error('bad role');
      const msgs = await localLoadConv(bid);
      const msg = {
        role, speaker: body.speaker || (role === 'user' ? 'me' : 'partner'),
        content: body.content || '', ts: localNow(),
      };
      const tid = (body.thread_id || '').trim();
      if(tid) msg.thread_id = tid;
      msgs.push(msg);
      await localSaveConv(bid, msgs);
      return tid ? msgs.filter(x => (x.thread_id || '') === tid) : msgs;
    }
    if(p === '/api/chat'){
      const bid = body.book_id;
      const content = (body.content || '').trim();
      if(!bid || !content) throw new Error('missing book_id/content');
      const book = await localGetBook(bid);
      if(!book) throw new Error('book not found');
      const chapter_title = body.chapter_title || '';
      const context_text = body.context_text || '';
      const thread_id = (body.thread_id || '').trim();
      const [target, clean] = localResolveChatTarget(content, body.target || '');
      let msgs_all = await localLoadConv(bid);
      let msgs_hist = thread_id ? msgs_all.filter(x => (x.thread_id || '') === thread_id) : msgs_all;
      const user_msg = {role: 'user', speaker: 'me', content: clean, ts: localNow()};
      if(thread_id) user_msg.thread_id = thread_id;
      const [resp, msgs_prompt] = await localSingleChat(book, chapter_title, msgs_hist, clean, context_text, target);
      if(resp === null){
        msgs_all = msgs_all.concat([user_msg]);
        await localSaveConv(bid, msgs_all);
        const out = thread_id ? msgs_all.filter(x => (x.thread_id || '') === thread_id) : msgs_all;
        return {configured: false, prompt: localMessagesToText(msgs_prompt), target, history: out};
      }
      msgs_all = msgs_all.concat([user_msg]);
      const speaker = target === 'marx' ? 'marx' : 'shenjing';
      const am = {
        role: 'assistant', speaker,
        content: resp.startsWith('ERROR:') ? `（回答生成失败：${resp.slice(6)}）` : resp,
        ts: localNow(),
      };
      if(thread_id) am.thread_id = thread_id;
      msgs_all.push(am);
      await localSaveConv(bid, msgs_all);
      const out_hist = thread_id ? msgs_all.filter(x => (x.thread_id || '') === thread_id) : msgs_all;
      return {configured: true, target, history: out_hist};
    }
    throw new Error('not found: ' + p);
  }

  if(method === 'PUT'){
    let m = p.match(/^\/api\/books\/([\w-]+)$/);
    if(m){
      const b = await localGetBook(m[1]);
      if(!b) throw new Error('not found');
      for(const k of ['title','author','description','chapters','concepts','discussion_context','raw_text','reader_marks']){
        if(k in body) b[k] = body[k];
      }
      await localSaveBook(b);
      return b;
    }
    if(p === '/api/plans'){
      await idbKvSet('plan', body);
      return body;
    }
    m = p.match(/^\/api\/cards\/([\w-]+)$/);
    if(m){
      const c = await localGetCard(m[1]);
      if(!c) throw new Error('not found');
      for(const k of ['chapter_id','chapter_title','raw','fields','tags']){
        if(k in body) c[k] = body[k];
      }
      await localSaveCard(c);
      return c;
    }
    throw new Error('not found: ' + p);
  }

  if(method === 'DELETE'){
    let m = p.match(/^\/api\/books\/([\w-]+)$/);
    if(m){
      const tx = idbTx(['books','conversations'], 'readwrite');
      await idbDelete(tx.objectStore('books'), m[1]);
      await idbDelete(tx.objectStore('conversations'), m[1]);
      return {ok: true};
    }
    m = p.match(/^\/api\/cards\/([\w-]+)$/);
    if(m){
      const tx = idbTx(['cards'], 'readwrite');
      await idbDelete(tx.objectStore('cards'), m[1]);
      return {ok: true};
    }
    m = p.match(/^\/api\/books\/([\w-]+)\/messages$/);
    if(m){
      await localSaveConv(m[1], []);
      return {ok: true};
    }
    throw new Error('not found: ' + p);
  }

  throw new Error('unsupported: ' + method);
}

async function localExportSyncDelta(){
  const books = await idbAllBooks();
  const books_delta = [];
  for(const b of books){
    const marks = b.reader_marks || [];
    const ctx = b.discussion_context;
    if((marks && marks.length) || ctx){
      books_delta.push({
        id: b.id,
        title: b.title || '',
        reader_marks: marks,
        discussion_context: ctx,
      });
    }
  }
  const tx = idbTx(['conversations'], 'readonly');
  const convRows = await idbGetAll(tx.objectStore('conversations'));
  const conversations = {};
  for(const row of convRows){
    if(row.messages && row.messages.length) conversations[row.book_id] = row.messages;
  }
  const s = await localGetSettings();
  return {
    version: 2,
    kind: 'delta',
    updated_at: localNow(),
    device: s.sync_device_name || 'ipad',
    books_delta,
    conversations,
    cards: await idbAllCards(),
  };
}

function localMergeMessages(local, remote){
  const seen = new Set();
  const out = [];
  for(const m of [...(local||[]), ...(remote||[])]){
    if(!m || typeof m !== 'object') continue;
    const k = [m.role, m.speaker, m.content, m.ts, m.thread_id||''].join('\0');
    if(seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  out.sort((a,b)=>(a.ts||'').localeCompare(b.ts||''));
  return out;
}

function localMergeMarks(local, remote){
  const byId = {};
  for(const m of [...(local||[]), ...(remote||[])]){
    if(!m || !m.id) continue;
    const old = byId[m.id];
    if(!old){ byId[m.id] = m; continue; }
    const ot = (old.thought||'').trim();
    const nt = (m.thought||'').trim();
    if(nt.length > ot.length || (m.created_at||'') >= (old.created_at||'')) byId[m.id] = m;
  }
  return Object.values(byId);
}

async function localApplySyncDelta(d){
  if(!d || typeof d !== 'object') return {ok:false, error:'无效同步包'};
  let books_n = 0, msg_n = 0, card_n = 0;
  for(const item of (d.books_delta || [])){
    if(!item.id) continue;
    const b = await localGetBook(item.id);
    if(!b) continue;
    if('reader_marks' in item) b.reader_marks = localMergeMarks(b.reader_marks||[], item.reader_marks||[]);
    if(item.discussion_context != null){
      const old = b.discussion_context || {};
      const neu = item.discussion_context || {};
      if((neu.updated_at||'') >= (old.updated_at||'')) b.discussion_context = neu;
    }
    await localSaveBook(b);
    books_n++;
  }
  for(const [bid, msgs] of Object.entries(d.conversations || {})){
    const local = await localLoadConv(bid);
    await localSaveConv(bid, localMergeMessages(local, msgs||[]));
    msg_n++;
  }
  for(const c of (d.cards || [])){
    if(!c.id) continue;
    const old = await localGetCard(c.id);
    if(!old || (c.created_at||'') >= (old.created_at||'')){
      await localSaveCard(c);
      card_n++;
    }
  }
  return {ok:true, books:books_n, conversations:msg_n, cards:card_n, from_device:d.device||'', updated_at:d.updated_at||''};
}

async function localInit(){
  await localDbInit();
  await localSeedIfEmpty();
}

function localDownloadJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type: 'application/json;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function localDownloadText(filename, text){
  const blob = new Blob([text], {type: 'text/markdown;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function exportLibraryBundle(){
  const bundle = await idbExportBundle();
  localDownloadJson('AI陪读-书库包-' + new Date().toISOString().slice(0, 10) + '.json', bundle);
  toast('书库包已导出（' + (bundle.books || []).length + ' 本书）');
}

async function importLibraryBundleFromFile(file){
  const text = await file.text();
  const bundle = JSON.parse(text);
  await api('/api/sync/import', 'POST', bundle);
  toast('已导入 ' + (bundle.books || []).length + ' 本书');
  location.hash = '#/';
  router();
}
