import test from 'node:test';
import assert from 'node:assert/strict';
import {finaConfig,resolvePriceTypes,mapFinaSnapshot,buildSyncPlan,fetchFinaSnapshot,patchForProduct,synchronizeFina} from '../lib/fina-core.mjs';
const cfg={enabled:true,base:'https://example.invalid',login:'demo',password:'demo',storeId:1,retailId:null,wholesaleId:null,syncPrices:false,timeoutMs:1000};
const products=[{id:7,code:'000123',name:'პროდუქტი',comment:'FINA კომენტარი',weight:0},{id:8,code:'Z2',name:'მეორე'}];
const prices=[{product_id:7,price_id:3,price:19.5,currency:'GEL'},{product_id:7,price_id:4,price:15,currency:'GEL'}];
const rests=[{id:7,rest:4},{id:8,rest:0}];
const mock=async(url)=>{
  const path=new URL(url).pathname;
  const value=path.endsWith('/authenticate')?{token:'token'}:path.endsWith('/getProducts')?{products}:path.endsWith('/getProductPrices')?{prices}:path.endsWith('/getPriceTypes')?{types:[{id:3,name:'საცალო'},{id:4,name:'მცირე საბითუმო'},{id:5,name:'საბითუმო'}]}:path.endsWith('/getProductsRestByStore/1')?{store_rest:rests}:null;
  if(!value)throw Error('Unexpected URL '+url);
  return {ok:true,json:async()=>value};
};
test('price types selected by exact Georgian names',()=>{
  assert.deepEqual(resolvePriceTypes([{id:3,name:'საცალო'},{id:4,name:'მცირე საბითუმო'}],cfg),{retailId:3,wholesaleId:4});
  assert.throws(()=>resolvePriceTypes([{id:4,name:'მცირე საბითუმო'}],cfg),/FINA_PRICE_TYPE_NOT_UNIQUE/);
});
test('FINA API 8.0 mapping preserves leading zeros and maps requested prices',async()=>{
  const snap=await fetchFinaSnapshot(cfg,{fetchImpl:mock});
  const p=snap.byCode.get('000123');
  assert.equal(p.stock,4);assert.equal(p.price,19.5);assert.equal(p.dealerPrice,15);
  assert.equal(p.name,'პროდუქტი');assert.equal(p.description,'პროდუქტი');
  assert.equal(snap.byCode.get('Z2').stock,0);
});
test('stock-only sync preserves names, photos, descriptions and prices',()=>{
  const snap=mapFinaSnapshot({products,prices,rests,storeId:1,retailId:3,wholesaleId:4});
  const plan=buildSyncPlan([{id:'a',code:'000123',name:'Manual',image:'img.jpg',description:'Custom',price:999,stock:10},{id:'b',code:'NO_MATCH',stock:3}],snap,cfg);
  assert.deepEqual(plan.changes[0].patch,{stock:4,finaId:7});assert.equal(plan.stats.notFound,1);
});
test('all fields: description equals FINA name, retail and small wholesale',()=>{
  const p=patchForProduct({name:'Manual',description:'Existing',price:10,stock:1},{finaId:7,name:'FINA',description:'FINA comment',price:20,priceCurrency:'GEL',dealerPrice:12,wholesaleCurrency:'GEL',stock:8,weightKg:null},cfg,{fields:'all'});
  assert.equal(p.description,'FINA');assert.equal(p.name,'FINA');assert.equal(p.stock,8);assert.equal(p.price,20);assert.equal(p.dealerPrice,12);
});
test('local pending online orders are subtracted from FINA stock',()=>{
  const p=patchForProduct({stock:4,finaPendingQty:3},{finaId:7,stock:5,name:'x',price:null,dealerPrice:null},cfg);
  assert.equal(p.stock,2);
  assert.equal(patchForProduct({stock:4,finaPendingQty:9},{finaId:7,stock:5},cfg).stock,0);
});
test('ambiguous FINA or website codes are never updated',()=>{
  const dup=mapFinaSnapshot({products:[...products,{id:9,code:'000123'}],prices,rests,storeId:1,retailId:3,wholesaleId:4});
  const plan=buildSyncPlan([{id:'a',code:'000123'},{id:'b',code:'Z2'},{id:'c',code:'Z2'}],dup,cfg);
  assert.equal(plan.stats.duplicateFina,1);assert.equal(plan.stats.duplicateSite,2);assert.equal(plan.changes.length,0);
});
test('missing stock is not treated as zero',()=>{
  const snap=mapFinaSnapshot({products,prices,rests:[],storeId:1,retailId:3,wholesaleId:4});
  const plan=buildSyncPlan([{id:'a',code:'000123',stock:7,finaId:7}],snap,cfg);
  assert.equal(plan.stats.missingStock,1);assert.equal(plan.changes.length,0);
});
test('read-only sync does not request price data when only stock is needed',async()=>{
  const seen=[];const fetchImpl=async(url,opts)=>{seen.push({url,method:opts.method});return mock(url)};
  await fetchFinaSnapshot(cfg,{fetchImpl,includePrices:false});
  assert.ok(!seen.some(x=>x.url.includes('getProductPrices')));
  assert.ok(seen.every(x=>x.method==='GET'||x.url.includes('/authenticate')));
});
test('transaction recomputes current reservation after preview',async()=>{
  const data={code:'000123',stock:9,finaPendingQty:1},updates=[];
  const doc={id:'a',data:()=>({...data}),exists:true};
  const ref={id:'a'};
  const db={collection(name){return name==='products'?{get:async()=>({docs:[doc]}),doc:()=>ref}:{doc:()=>({set:async()=>{}})}},async runTransaction(fn){return fn({get:async()=>({exists:true,data:()=>({...data,finaPendingQty:2})}),update:(_ref,patch)=>updates.push(patch)})}};
  const admin={firestore:{FieldValue:{serverTimestamp:()=>123}}};
  await synchronizeFina(db,admin,{dryRun:false,cfg,fetchImpl:mock});
  assert.equal(updates[0].stock,2); // FINA stock 4 - current reservation 2
});
test('disabled config is safe by default',()=>{
  const c=finaConfig({});assert.equal(c.enabled,false);assert.equal(c.syncPrices,false);
});
