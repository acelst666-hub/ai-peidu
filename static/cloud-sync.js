'use strict';
/** Mac ↔ iPad 云同步：GitHub 私有 Gist 存增量包（笔记/聊天/卡片） */

let _syncPushTimer = null;
let _syncPullBusy = false;
let _lastAutoPullAt = 0;

function syncConfigured(s){
  s = s || APP_CFG || {};
  // 有 Token 即可同步；「启用」只控制自动拉/推
  return !!(s.sync_github_token && String(s.sync_github_token).trim());
}

function syncAutoOn(s){
  s = s || APP_CFG || {};
  return syncConfigured(s) && s.sync_enabled !== false;
}

/** 从设置页表单即时读出（不依赖是否已点保存） */
function readSyncFormPatch(){
  if(typeof $ !== 'function' || !$('#s_sync_token')) return null;
  const token = ($('#s_sync_token').value || '').trim();
  if(!token) return null;
  return {
    sync_enabled: true,
    sync_github_token: token,
    sync_gist_id: ($('#s_sync_gist') && $('#s_sync_gist').value.trim()) || '',
    sync_device_name: ($('#s_sync_device') && $('#s_sync_device').value.trim()) || (typeof API_MODE !== 'undefined' && API_MODE==='local' ? 'ipad' : 'mac'),
    sync_auto_pull: !($('#s_sync_pull') && !$('#s_sync_pull').checked),
    sync_auto_push: !($('#s_sync_push') && !$('#s_sync_push').checked),
  };
}

async function ensureSyncSettingsSaved(){
  const patch = readSyncFormPatch();
  if(patch){
    try{
      if(typeof saveSettings === 'function' && $('#s_base')){
        await saveSettings({ silent: true, forSync: true });
      } else {
        const s = await api('/api/settings', 'POST', patch);
        APP_CFG = Object.assign({}, APP_CFG, s);
      }
    }catch(e){
      console.warn('保存同步设置失败', e);
    }
  }
  return APP_CFG;
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
  await ensureSyncSettingsSaved();
  const s = Object.assign({}, await api('/api/settings'), APP_CFG);
  if(!syncConfigured(s)) throw new Error('请先在设置中填写 GitHub Token（需 gist 权限）');
  // iPad：直接调本地函数，避免旧缓存里 GET/POST 路由不一致
  let delta;
  if(typeof API_MODE !== 'undefined' && API_MODE === 'local' && typeof localExportSyncDelta === 'function'){
    delta = await localExportSyncDelta();
  } else {
    delta = await api('/api/sync/export-delta');
  }
  if(!delta || typeof delta !== 'object') throw new Error('导出同步包失败，请强制刷新后再试');
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
    await api('/api/settings', 'POST', { sync_enabled: true, sync_gist_id: gistId });
    APP_CFG.sync_gist_id = gistId;
    APP_CFG.sync_enabled = true;
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
  await ensureSyncSettingsSaved();
  const s = Object.assign({}, await api('/api/settings'), APP_CFG);
  if(!syncConfigured(s)) throw new Error('请先填写 GitHub Token');
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
  if(typeof API_MODE !== 'undefined' && API_MODE === 'local' && typeof localApplySyncDelta === 'function'){
    return localApplySyncDelta(delta);
  }
  return api('/api/sync/apply-delta', 'POST', delta);
}

function scheduleCloudSyncPush(){
  if(!syncAutoOn(APP_CFG) || !APP_CFG.sync_auto_push) return;
  clearTimeout(_syncPushTimer);
  _syncPushTimer = setTimeout(async ()=>{
    try{
      await cloudSyncPush();
    }catch(e){
      console.warn('云同步上传失败', e);
    }
  }, 4000);
}

/** 打开 App / 回到前台时自动拉取（主屏幕版无需「刷新网页」） */
async function maybeCloudSyncPullOnStart(opts){
  opts = opts || {};
  if(!syncAutoOn(APP_CFG) || APP_CFG.sync_auto_pull === false) return;
  if(!APP_CFG.sync_gist_id) return;
  if(_syncPullBusy) return;
  const now = Date.now();
  if(opts.fromResume && now - _lastAutoPullAt < 15000) return;
  _syncPullBusy = true;
  _lastAutoPullAt = now;
  try{
    const r = await cloudSyncPull();
    if(r && r.ok && ((r.books||0)+(r.conversations||0)+(r.cards||0) > 0)){
      toast('已从云端同步笔记/聊天');
      if(typeof router === 'function' && opts.refreshView !== false) router();
    }
  }catch(e){
    console.warn('云同步拉取跳过', e.message || e);
  }finally{
    _syncPullBusy = false;
  }
}

function installCloudSyncLifecycle(){
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'visible'){
      maybeCloudSyncPullOnStart({ fromResume: true });
    }
  });
  window.addEventListener('pageshow', (e)=>{
    if(e.persisted) maybeCloudSyncPullOnStart({ fromResume: true });
  });
  window.addEventListener('focus', ()=>{
    maybeCloudSyncPullOnStart({ fromResume: true });
  });
}

async function uiCloudSyncPush(){
  showBusy('正在上传到云端…');
  try{
    const r = await cloudSyncPush();
    toast('已上传（Gist '+(r.gist_id||'').slice(0,8)+'…）');
    if(typeof renderSettings === 'function' && location.hash.indexOf('/settings')>=0) renderSettings();
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

/** 侧栏/设置页一键：先保存表单，再拉后推 */
async function uiCloudSyncNow(){
  showBusy('正在保存并同步…');
  try{
    await ensureSyncSettingsSaved();
    if(!syncConfigured(APP_CFG)){
      hideBusy();
      toast('请先在 Token 框粘贴 ghp_ 开头的密钥');
      location.hash = '#/settings';
      return;
    }
    let pulled = null;
    try{ pulled = await cloudSyncPull(); }catch(e){
      if(String(e.message||e).indexOf('尚无 Gist') >= 0){
        // 首次：只能上传
      }else{
        throw e;
      }
    }
    const pushed = await cloudSyncPush();
    const parts = [];
    if(pulled && pulled.ok) parts.push('已拉取');
    if(pushed && pushed.ok) parts.push('已上传');
    toast(parts.length ? parts.join(' · ') : '同步完成');
    if(typeof renderSettings === 'function' && location.hash.indexOf('/settings')>=0){
      renderSettings();
    } else if(typeof router === 'function'){
      router();
    }
  }catch(e){
    toast('同步失败：'+(e.message||e));
  }finally{ hideBusy(); }
}
