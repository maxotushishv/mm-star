// MM STAR ↔ FINA Web API 8.0. Read-only integration: no write calls to FINA.
const norm = value => String(value ?? '').trim();
const positiveId = value => Number.isInteger(Number(value)) && Number(value)>0 ? Number(value) : null;
const amount = value => Number(value);
export function finaConfig(env=process.env) {
  return {
    enabled:env.FINA_ENABLED==='true',base:norm(env.FINA_API_URL).replace(/\/+$/,''),
    login:env.FINA_LOGIN||'',password:env.FINA_PASSWORD||'',
    storeId:positiveId(env.FINA_STORE_ID),
    retailId:positiveId(env.FINA_RETAIL_PRICE_ID),wholesaleId:positiveId(env.FINA_WHOLESALE_PRICE_ID),
    syncPrices:env.FINA_SYNC_PRICES==='true',
    timeoutMs:Math.min(25000,Math.max(1000,Number(env.FINA_TIMEOUT_MS)||12000))
  };
}
export function validateConfig(cfg,{requireStore=true}={}) {
  if(!cfg.enabled)throw new Error('FINA_DISABLED');
  if(!/^https?:\/\//i.test(cfg.base))throw new Error('FINA_URL_REQUIRED');
  if(!cfg.login||!cfg.password)throw new Error('FINA_CREDENTIALS_REQUIRED');
  if(requireStore&&!cfg.storeId)throw new Error('FINA_STORE_REQUIRED');
}
let tokenCache={key:'',token:'',expires:0};
export function createFinaClient(cfg,{fetchImpl=fetch,requireStore=true}={}) {
  validateConfig(cfg,{requireStore});
  const authKey=cfg.base+'|'+cfg.login+'|'+cfg.password;
  const call=async(path,method='GET',body=null,token=null)=>{
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),cfg.timeoutMs);
    try{
      const response=await fetchImpl(cfg.base+'/'+path.replace(/^\//,''),{
        method,signal:controller.signal,
        headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},
        ...(body?{body:JSON.stringify(body)}:{})
      });
      if(!response.ok)throw new Error('FINA_HTTP_'+response.status);
      const data=await response.json();
      if(data?.ex)throw new Error('FINA_API_ERROR: '+String(data.ex).slice(0,160));
      return data;
    }catch(e){if(e.name==='AbortError')throw new Error('FINA_TIMEOUT');throw e}
    finally{clearTimeout(timeout)}
  };
  const authenticate=async(force=false)=>{
    if(!force&&tokenCache.key===authKey&&Date.now()<tokenCache.expires)return tokenCache.token;
    const data=await call('api/authentication/authenticate','POST',{login:cfg.login,password:cfg.password});
    if(!data.token)throw new Error('FINA_AUTH_FAILED');
    tokenCache={key:authKey,token:data.token,expires:Date.now()+35*3600000};return data.token;
  };
  const get=async path=>{
    let token=await authenticate();
    try{return await call(path,'GET',null,token)}
    catch(e){if(e.message!=='FINA_HTTP_401')throw e;token=await authenticate(true);return call(path,'GET',null,token)}
  };
  return {get};
}
export function resolvePriceTypes(types=[],cfg={}) {
  const find=(explicit,expected)=>{
    if(explicit){const p=types.find(x=>Number(x.id)===Number(explicit));if(types.length&&!p)throw new Error('FINA_PRICE_TYPE_ID_NOT_FOUND');return Number(explicit)}
    const matches=types.filter(x=>norm(x.name).toLocaleLowerCase('ka-GE')===expected);
    if(matches.length!==1)throw new Error('FINA_PRICE_TYPE_NOT_UNIQUE: '+expected);
    return Number(matches[0].id);
  };
  const retailId=find(cfg.retailId,'საცალო'),wholesaleId=find(cfg.wholesaleId,'მცირე საბითუმო');
  if(retailId===wholesaleId)throw new Error('FINA_PRICE_TYPES_SAME');
  return {retailId,wholesaleId};
}
export function mapFinaSnapshot({products=[],prices=[],rests=[],storeId,retailId,wholesaleId}) {
  const priceMap=new Map(),stockMap=new Map(),byCode=new Map(),duplicates=new Set();
  for(const price of prices){
    const id=positiveId(price.product_id),type=positiveId(price.price_id),n=amount(price.price);
    if(!id||!type||!Number.isFinite(n)||n<0)continue;
    if(!priceMap.has(id))priceMap.set(id,new Map());
    priceMap.get(id).set(type,price);
  }
  for(const rest of rests){
    const id=positiveId(rest.id),store=positiveId(rest.store??storeId),n=amount(rest.rest);
    if(!id||store!==storeId||!Number.isFinite(n)||n<0)continue;
    stockMap.set(id,(stockMap.get(id)||0)+n);
  }
  for(const p of products){
    const code=norm(p.code),id=positiveId(p.id);if(!code||!id)continue;
    if(byCode.has(code)){duplicates.add(code);continue}
    const pr=priceMap.get(id)||new Map(),retail=pr.get(retailId),wholesale=pr.get(wholesaleId);
    byCode.set(code,{finaId:id,code,name:norm(p.name),description:norm(p.name),
      finaComment:norm(p.comment),weightKg:Number(p.weight)>0?Number(p.weight):null,
      price:retail?Number(retail.price):null,dealerPrice:wholesale?Number(wholesale.price):null,
      stock:stockMap.has(id)?stockMap.get(id):null,
      priceCurrency:retail?.currency||'',wholesaleCurrency:wholesale?.currency||''});
  }
  for(const code of duplicates)byCode.delete(code);
  return {byCode,duplicates};
}
export async function fetchFinaSnapshot(cfg,{fetchImpl,includePrices=true}={}){
  const client=createFinaClient(cfg,{fetchImpl});
  const requests=[client.get('api/operation/getProducts'),client.get('api/operation/getProductsRestByStore/'+cfg.storeId)];
  if(includePrices){requests.push(client.get('api/operation/getProductPrices'));requests.push(client.get('api/operation/getPriceTypes'))}
  const [pd,rs,pr,pt]=await Promise.all(requests);
  if(!Array.isArray(pd?.products)||!Array.isArray(rs?.store_rest))throw new Error('FINA_INVALID_RESPONSE');
  if(includePrices&&(!Array.isArray(pr?.prices)||!Array.isArray(pt?.types)))throw new Error('FINA_INVALID_PRICES');
  const ids=includePrices?resolvePriceTypes(pt.types,cfg):{retailId:null,wholesaleId:null};
  const mapped=mapFinaSnapshot({products:pd.products,prices:pr?.prices||[],rests:rs.store_rest,storeId:cfg.storeId,...ids});
  return {...mapped,priceTypes:pt?.types||[],selectedPriceTypes:ids,counts:{finaProducts:pd.products.length,finaPrices:pr?.prices?.length||0,finaStockRows:rs.store_rest.length}};
}
export function patchForProduct(site,fina,cfg,{fields='stock'}={}){
  const patch={},all=fields==='all';
  if(fina.stock!==null)patch.stock=Math.max(0,fina.stock-Number(site.finaPendingQty||0));
  if(all){
    if(fina.name){patch.name=fina.name;patch.description=fina.name}
    if(fina.weightKg&&(!site.weightKg||site.weightKg===1))patch.weightKg=fina.weightKg;
  }
  if(all||cfg.syncPrices){
    if(fina.price!==null&&(!fina.priceCurrency||fina.priceCurrency==='GEL'))patch.price=fina.price;
    if(fina.dealerPrice!==null&&(!fina.wholesaleCurrency||fina.wholesaleCurrency==='GEL'))patch.dealerPrice=fina.dealerPrice;
  }
  if(Object.keys(patch).length)patch.finaId=fina.finaId;
  return Object.fromEntries(Object.entries(patch).filter(([k,v])=>k==='finaId'||site[k]!==v));
}
export function buildSyncPlan(siteProducts,snapshot,cfg,{fields='stock'}={}){
  const seen=new Map(),duplicateSiteCodes=new Set();
  for(const p of siteProducts){const code=norm(p.code);if(!code)continue;if(seen.has(code))duplicateSiteCodes.add(code);else seen.set(code,p.id)}
  const changes=[],stats={total:siteProducts.length,matched:0,changed:0,unchanged:0,notFound:0,missingCode:0,duplicateSite:0,duplicateFina:0,missingStock:0};
  for(const site of siteProducts){
    const code=norm(site.code);if(!code){stats.missingCode++;continue}
    if(duplicateSiteCodes.has(code)){stats.duplicateSite++;continue}
    if(snapshot.duplicates.has(code)){stats.duplicateFina++;continue}
    const fina=snapshot.byCode.get(code);if(!fina){stats.notFound++;continue}
    stats.matched++;if(fina.stock===null)stats.missingStock++;
    const patch=patchForProduct(site,fina,cfg,{fields});
    if(Object.keys(patch).length){stats.changed++;changes.push({id:site.id,code,patch})}else stats.unchanged++;
  }
  return {changes,stats};
}
export async function synchronizeFina(db,admin,{dryRun=true,fields='stock',cfg=finaConfig(),fetchImpl}={}){
  if(!['stock','all'].includes(fields))throw new Error('INVALID_SYNC_FIELDS');
  const snapshot=await fetchFinaSnapshot(cfg,{fetchImpl,includePrices:fields==='all'||cfg.syncPrices});
  const q=await db.collection('products').get(),siteProducts=q.docs.map(d=>({id:d.id,...d.data()}));
  const plan=buildSyncPlan(siteProducts,snapshot,cfg,{fields});
  if(!dryRun){
    // A Firestore transaction protects stock decrements from concurrent online checkouts.
    // Recompute using the current pending reservation count, not the stale preview.
    for(let i=0;i<plan.changes.length;i+=60){
      const group=plan.changes.slice(i,i+60);
      await db.runTransaction(async tx=>{
        const refs=group.map(change=>db.collection('products').doc(change.id));
        const docs=await Promise.all(refs.map(ref=>tx.get(ref)));
        for(let j=0;j<group.length;j++){
          const change=group[j],doc=docs[j];
          if(!doc.exists||norm(doc.data().code)!==change.code)continue;
          const fina=snapshot.byCode.get(change.code);if(!fina)continue;
          const patch=patchForProduct(doc.data(),fina,cfg,{fields});
          if(Object.keys(patch).length)tx.update(refs[j],{...patch,finaSyncedAt:admin.firestore.FieldValue.serverTimestamp()});
        }
      });
    }
    await db.collection('settings').doc('fina-last-sync').set({stats:plan.stats,fields,at:admin.firestore.FieldValue.serverTimestamp(),status:'success'},{merge:true});
  }
  return {dryRun,fields,stats:plan.stats,preview:plan.changes.slice(0,25),selectedPriceTypes:snapshot.selectedPriceTypes,...snapshot.counts};
}
