'use strict';
/** IndexedDB 本地存储（iPad 独立模式） */
const LOCAL_DB_NAME = 'ai-reader-local';
const LOCAL_DB_VER = 1;

let _localDb = null;

function localDb(){
  return _localDb;
}

function localDbInit(){
  if(_localDb) return Promise.resolve(_localDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VER);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('books')) db.createObjectStore('books', {keyPath: 'id'});
      if(!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', {keyPath: 'id'});
      if(!db.objectStoreNames.contains('conversations')) db.createObjectStore('conversations', {keyPath: 'book_id'});
      if(!db.objectStoreNames.contains('map_plans')) db.createObjectStore('map_plans', {keyPath: 'id'});
      if(!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', {keyPath: 'key'});
    };
    req.onsuccess = () => { _localDb = req.result; resolve(_localDb); };
  });
}

function idbTx(storeNames, mode){
  return localDb().transaction(storeNames, mode);
}

function idbGet(store, key){
  return new Promise((resolve, reject) => {
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGetAll(store){
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(store, val){
  return new Promise((resolve, reject) => {
    const req = store.put(val);
    req.onsuccess = () => resolve(val);
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(store, key){
  return new Promise((resolve, reject) => {
    const req = store.delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbKvGet(key, fallback){
  const tx = idbTx(['kv'], 'readonly');
  const row = await idbGet(tx.objectStore('kv'), key);
  return row ? row.value : fallback;
}

async function idbKvSet(key, value){
  const tx = idbTx(['kv'], 'readwrite');
  await idbPut(tx.objectStore('kv'), {key, value});
  return value;
}

async function idbAllBooks(){
  const tx = idbTx(['books'], 'readonly');
  return idbGetAll(tx.objectStore('books'));
}

async function idbAllCards(){
  const tx = idbTx(['cards'], 'readonly');
  return idbGetAll(tx.objectStore('cards'));
}

async function idbAllMapPlans(){
  const tx = idbTx(['map_plans'], 'readonly');
  return idbGetAll(tx.objectStore('map_plans'));
}

async function idbClearAll(){
  const stores = ['books', 'cards', 'conversations', 'map_plans', 'kv'];
  const tx = idbTx(stores, 'readwrite');
  for(const s of stores) tx.objectStore(s).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbImportBundle(bundle){
  await idbClearAll();
  const tx = idbTx(['books', 'cards', 'conversations', 'map_plans', 'kv'], 'readwrite');
  for(const b of (bundle.books || [])) await idbPut(tx.objectStore('books'), b);
  for(const c of (bundle.cards || [])) await idbPut(tx.objectStore('cards'), c);
  const convs = bundle.conversations || {};
  for(const [book_id, msgs] of Object.entries(convs)){
    await idbPut(tx.objectStore('conversations'), {book_id, messages: msgs || []});
  }
  for(const p of (bundle.map_plans || [])) await idbPut(tx.objectStore('map_plans'), p);
  if(bundle.settings) await idbPut(tx.objectStore('kv'), {key: 'settings', value: bundle.settings});
  if(bundle.plan) await idbPut(tx.objectStore('kv'), {key: 'plan', value: bundle.plan});
  if(bundle.reading_map) await idbPut(tx.objectStore('kv'), {key: 'reading_map', value: bundle.reading_map});
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbExportBundle(){
  const books = await idbAllBooks();
  const cards = await idbAllCards();
  const map_plans = await idbAllMapPlans();
  const tx = idbTx(['conversations'], 'readonly');
  const convRows = await idbGetAll(tx.objectStore('conversations'));
  const conversations = {};
  for(const row of convRows) conversations[row.book_id] = row.messages || [];
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    books,
    cards,
    conversations,
    map_plans,
    settings: await idbKvGet('settings', null),
    plan: await idbKvGet('plan', null),
    reading_map: await idbKvGet('reading_map', null),
  };
}
