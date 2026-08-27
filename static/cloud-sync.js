'use strict';
/** Mac ↔ iPad 云同步：GitHub 私有 Gist 存增量包（笔记/聊天/卡片） */

let _syncPushTimer = null;

function syncConfigured(s){
  s = s || APP_CFG || {};
  return !!(s.sync_enabled && s.sync_github_token);
}

async function ghGistHeaders(token){
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

async function cloudSyncPush(){
  const s = await api('/api/settings');
  if(!syncConfigured(s)) throw new Error('请先在设置中开启云同步并填写 GitHub Token（需 gist 权限）');
  const delta = await api('/api/sync/export-delta');
  const body = JSON.stringify(delta, null, 2);
  const headers = await ghGistHeaders(s.sync_github_token);
  let gistId = (s.sync_gist_id || '').trim();
  if(!gistId){
    const r = await fetch('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'AI陪读 · Mac/iPad 增量同步（私有）',
        public: false,
        files: { 'ai-reader-sync.json': { content: body } },
      }),
    });
    const j = await r.json();
    if(!r.ok) throw new Error((j.message || r.status) + (j.errors ? JSON.stringify(j.errors) : ''));
    gistId = j.id;
    await api('/api/settings', 'POST', { sync_gist_id: gistId });
    APP_CFG.sync_gist_id = gistId;
  } else {
    const r = await fetch('https://api.github.com/gists/' + gistId, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        files: { 'ai-reader-sync.json': { content: body } },
      }),
    });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.message || ('HTTP '+r.status));
  }
  return { ok: true, gist_id: gistId, updated_at: delta.updated_at };
}

async function cloudSyncPull(){
  const s = await api('/api/settings');
  if(!syncConfigured(s)) throw new Error('请先开启云同步并填写 Token');
  const gistId = (s.sync_gist_id || '').trim();
  if(!gistId) throw new Error('尚无 Gist ID：请先在任一端点「上传到云端」一次');
  const headers = await ghGistHeaders(s.sync_github_token);
  const r = await fetch('https://api.github.com/gists/' + gistId, { headers });
  const j = await r.json();
  if(!r.ok) throw new Error(j.message || ('HTTP '+r.status));
  const file = (j.files && (j.files['ai-reader-sync.json'] || Object.values(j.files)[0])) || null;
  if(!file) throw new Error('Gist 中没有同步文件');
  let content = file.content;
  if((!content || file.truncated) && file.raw_url){
    const rr = await fetch(file.raw_url, { headers: { 'Authorization': 'Bearer ' + s.sync_github_token } });
    content = await rr.text();
  }
  const delta = JSON.parse(content);
  if(delta.kind !== 'delta' && !delta.books_delta){
    throw new Error('同步文件格式不对，请重新上传');
  }
  const result = await api('/api/sync/apply-delta', 'POST', delta);
  return result;
}

function scheduleCloudSyncPush(){
  if(!syncConfigured(APP_CFG) || !APP_CFG.sync_auto_push) return;
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(async ()=>{
    try{
      await cloudSyncPush();
      // 静默成功，不打扰阅读
    }catch(e){
      console.warn('云同步上传失败', e);
    }
  }, 4000);
}

async function maybeCloudSyncPullOnStart(){
  if(!syncConfigured(APP_CFG) || APP_CFG.sync_auto_pull === false) return;
  try{
    if(!APP_CFG.sync_gist_id) return;
    const r = await cloudSyncPull();
    if(r && r.ok && ((r.books||0)+(r.conversations||0)+(r.cards||0) > 0)){
      toast('已从云端同步笔记/聊天');
    }
  }catch(e){
    console.warn('云同步拉取跳过', e.message || e);
  }
}

async function uiCloudSyncPush(){
  showBusy('正在上传到云端…');
  try{
    const r = await cloudSyncPush();
    toast('已上传（Gist '+(r.gist_id||'').slice(0,8)+'…）');
    renderSettings();
  }catch(e){
    toast('上传失败：'+(e.message||e));
  }finally{ hideBusy(); }
}

async function uiCloudSyncPull(){
  showBusy('正在从云端拉取…');
  try{
    const r = await cloudSyncPull();
    toast('已合并：书'+r.books+' · 对话'+r.conversations+' · 卡片'+r.cards);
    if(typeof router === 'function') router();
  }catch(e){
    toast('拉取失败：'+(e.message||e));
  }finally{ hideBusy(); }
}
