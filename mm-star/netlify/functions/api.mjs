import admin from 'firebase-admin';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { SignJWT, jwtVerify } from 'jose';
import { getStore } from '@netlify/blobs';

const env = process.env;
if (!admin.apps.length) {
  const privateKey = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey
    })
  });
}
const db = admin.firestore();
const jwtSecret = new TextEncoder().encode(env.APP_JWT_SECRET || 'mm-star-change-this-secret');
const mediaStore = () => getStore('mm-star-media');

const DEFAULT_STORE = {
  name: 'MM STAR',
  address: 'ლილო მოლი — სექტორი C, რიგი CC9, მაღაზია №1',
  storePhones: ['+995 596 19 59 59', '+995 596 18 59 59'],
  onlineSalesPhone: '+995 514 94 59 59',
  storeHours: '10:00–17:00',
  onlineSalesHours: '24/7',
  email: 'nextstar@list.ru',
  website: 'mmstar.ge',
  companyId: '434157066',
  bank: 'საქართველოს ბანკი',
  iban: 'GE78BG0000000954382600'
};

// User supplied courier tariff table. The exact Tbilisi-district mapping can be refined later.
const DELIVERY_TARIFFS = [
  {maxKg:1,city:6.5,region:10.5,courierBranch:6,centralCity:10.5,village:15.5,mountain:15.5,outskirts:6.5},
  {maxKg:5,city:7.5,region:12.5,courierBranch:6,centralCity:12.5,village:17.5,mountain:17.5,outskirts:7.5},
  {maxKg:10,city:11,region:16,courierBranch:10,centralCity:16,village:21,mountain:21,outskirts:11},
  {maxKg:15,city:16,region:21,courierBranch:15,centralCity:21,village:26,mountain:26,outskirts:16},
  {maxKg:20,city:19,region:26,courierBranch:20,centralCity:26,village:31,mountain:31,outskirts:19},
  {maxKg:30,city:30,region:36,courierBranch:30,centralCity:36,village:45,mountain:45,outskirts:30},
  {maxKg:50,city:45,region:65,courierBranch:50,centralCity:65,village:80,mountain:80,outskirts:45},
  {maxKg:100,city:65,region:105,courierBranch:80,centralCity:105,village:120,mountain:120,outskirts:65},
  {maxKg:150,city:80,region:145,courierBranch:110,centralCity:145,village:175,mountain:175,outskirts:80},
  {maxKg:200,city:100,region:185,courierBranch:140,centralCity:185,village:215,mountain:215,outskirts:100},
  {maxKg:250,city:120,region:220,courierBranch:170,centralCity:220,village:250,mountain:250,outskirts:120},
  {maxKg:300,city:140,region:260,courierBranch:200,centralCity:260,village:290,mountain:290,outskirts:140},
  {maxKg:500,city:220,region:340,courierBranch:280,centralCity:340,village:390,mountain:390,outskirts:220},
  {maxKg:750,city:300,region:450,courierBranch:370,centralCity:450,village:500,mountain:500,outskirts:300},
  {maxKg:1000,city:380,region:700,courierBranch:510,centralCity:700,village:750,mountain:750,outskirts:380}
];

const STATUS_CODES = ['NEW','CONFIRMED','PAID','PROCESSING','READY','SHIPPED','DELIVERED','CANCELLED'];
const STATUS_KA = {NEW:'ახალი',CONFIRMED:'დადასტურებული',PAID:'გადახდილი',PROCESSING:'მუშავდება',READY:'მზადაა',SHIPPED:'გაგზავნილია',DELIVERED:'ჩაბარებულია',CANCELLED:'გაუქმებული'};
const STATUS_FROM_OLD = Object.fromEntries(Object.entries(STATUS_KA).map(([k,v])=>[v,k]));

const json = (statusCode, body, headers={}) => ({statusCode, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}, body:JSON.stringify(body)});
const ok = (data={}) => json(200,{ok:true,...data});
const bad = (error, statusCode=400, extra={}) => json(statusCode,{ok:false,error,...extra});
const bodyOf = event => { try { return event.body ? JSON.parse(event.body) : {}; } catch { return {}; } };
const id = () => crypto.randomUUID();
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const randomOtp = () => String(crypto.randomInt(100000,1000000));
const cleanPhone = p => {
  let d=String(p||'').replace(/\D/g,'');
  if(/^5\d{8}$/.test(d)) return '995'+d;
  if(/^05\d{8}$/.test(d)) return '995'+d.slice(1);
  if(/^9955\d{8}$/.test(d)) return d;
  return d;
};
const publicDoc = d => ({id:d.id,...d.data()});
const language = l => ['ka','en','ru','tr'].includes(String(l||'').toLowerCase()) ? String(l).toLowerCase() : 'ka';
const statusCodeOf = o => o.statusCode || STATUS_FROM_OLD[o.status] || (STATUS_CODES.includes(o.status)?o.status:'NEW');
const salePriceOf = p => {
  const base=Math.max(0,Number(p?.price||0));
  if(!p?.saleActive) return base;
  const hasManual=p.salePrice!==null&&p.salePrice!==undefined&&p.salePrice!=='';
  const manual=Number(p.salePrice);
  if(hasManual&&Number.isFinite(manual)&&manual>=0&&manual<base) return manual;
  const v=Math.max(0,Number(p.discountValue||0));
  if(p.discountType==='percent') return Math.max(0,base-(base*v/100));
  if(p.discountType==='amount') return Math.max(0,base-v);
  return base;
};
const publicProduct = d => { const p=publicDoc(d), effectivePrice=salePriceOf(p); return {...p,effectivePrice,oldPrice:Number(p.price||0),discountPercent:p.saleActive&&Number(p.price)>0?Math.max(0,Math.round((1-effectivePrice/Number(p.price))*100)):0}; };


async function signRole(payload,hours=8){ return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(`${hours}h`).sign(jwtSecret); }
async function roleAuth(event,roles){
  const token=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('AUTH_REQUIRED');
  let payload;
  try { ({payload}=await jwtVerify(token,jwtSecret)); } catch { throw new Error('AUTH_REQUIRED'); }
  if(!roles.includes(payload.role)) throw new Error('FORBIDDEN');
  return payload;
}
async function firebaseAuth(event){
  const token=(event.headers.authorization||event.headers.Authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('AUTH_REQUIRED');
  return admin.auth().verifyIdToken(token);
}
async function nextInvoice(kind='customer'){
  const year=new Date().getFullYear(), ref=db.collection('settings').doc(`counter-${kind}-${year}`);
  return db.runTransaction(async tx=>{ const s=await tx.get(ref), n=(s.exists?s.data().value:0)+1; tx.set(ref,{value:n,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true}); return `${kind==='dealer'?'MM-D':'MM'}-${year}-${String(n).padStart(6,'0')}`; });
}
async function storeSettings(){
  const s=await db.collection('settings').doc('store').get();
  return {...DEFAULT_STORE,...(s.exists?s.data():{})};
}
function deliveryFee(weightKg,method,zone='region'){
  if(method==='pickup') return 0;
  const row=DELIVERY_TARIFFS.find(x=>Number(weightKg)<=x.maxKg) || DELIVERY_TARIFFS.at(-1);
  if(method==='tbilisi') return row.city;
  if(method==='region') return row[['region','centralCity','village','mountain','outskirts'].includes(zone)?zone:'region'];
  return 0;
}
function paymentLabel(code,l){
  const x={
    ka:{keepz:'ბარათი/განვადება',invoice:'ინვოისი',branch:'ფილიალში გადახდა',bank:'საბანკო გადარიცხვა'},
    en:{keepz:'Card/installment',invoice:'Invoice',branch:'Pay at branch',bank:'Bank transfer'},
    ru:{keepz:'Карта/рассрочка',invoice:'Инвойс',branch:'Оплата в филиале',bank:'Банковский перевод'},
    tr:{keepz:'Kart/taksit',invoice:'Fatura',branch:'Şubede ödeme',bank:'Banka havalesi'}
  }; return x[language(l)][code]||code;
}
function deliveryLabel(code,l,zone,location=''){
  const x={
    ka:{pickup:'ფილიალიდან გატანა',tbilisi:'მიწოდება თბილისში',region:'მიწოდება რეგიონში'},
    en:{pickup:'Branch pickup',tbilisi:'Tbilisi delivery',region:'Regional delivery'},
    ru:{pickup:'Самовывоз',tbilisi:'Доставка по Тбилиси',region:'Доставка в регион'},
    tr:{pickup:'Şubeden teslim',tbilisi:'Tiflis teslimatı',region:'Bölgesel teslimat'}
  }; return x[language(l)][code]||code;
}
function localizedStatus(code,l){
  const s={
    ka:STATUS_KA,
    en:{NEW:'New',CONFIRMED:'Confirmed',PAID:'Paid',PROCESSING:'Processing',READY:'Ready',SHIPPED:'Shipped',DELIVERED:'Delivered',CANCELLED:'Cancelled'},
    ru:{NEW:'Новый',CONFIRMED:'Подтвержден',PAID:'Оплачен',PROCESSING:'Обрабатывается',READY:'Готов',SHIPPED:'Отправлен',DELIVERED:'Доставлен',CANCELLED:'Отменен'},
    tr:{NEW:'Yeni',CONFIRMED:'Onaylandı',PAID:'Ödendi',PROCESSING:'İşleniyor',READY:'Hazır',SHIPPED:'Gönderildi',DELIVERED:'Teslim edildi',CANCELLED:'İptal edildi'}
  }; return s[language(l)][code]||code;
}
async function ubillSend(phone,text,otp=false){
  if(!env.UBILL_API_KEY) throw new Error('UBILL_NOT_CONFIGURED');
  const r=await fetch(`${env.UBILL_API_URL||'https://api.ubill.dev'}/v1/sms/send`,{method:'POST',headers:{key:env.UBILL_API_KEY,'content-type':'application/json'},body:JSON.stringify({brandID:Number(env.UBILL_BRAND_ID||1),numbers:[cleanPhone(phone)],text,stopList:false,otp})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok||Number(data.statusID)!==0) throw new Error(data.message||'UBILL_SEND_FAILED');
  return data;
}
async function safeSms(phone,text){ if(!phone) return; try{await ubillSend(phone,text,false)}catch(e){console.error('SMS_ERROR',e.message)} }
function itemsText(items,l){
  const shown=(items||[]).slice(0,3).map(i=>`${i.name} x${i.qty}`).join(', ');
  return shown+((items||[]).length>3?'…':'');
}
function orderCreatedSms(o){
  const l=language(o.language), total=`${Number(o.total||0).toFixed(2)} GEL`;
  if(l==='en') return `MM STAR ${o.invoice}: ${itemsText(o.items,l)}. Payment: ${paymentLabel(o.paymentMethod,l)}. Delivery: ${deliveryLabel(o.deliveryMethod,l,o.deliveryZone,o.courierLocation)}. Total: ${total}. Status: ${localizedStatus(statusCodeOf(o),l)}.`;
  if(l==='ru') return `MM STAR ${o.invoice}: ${itemsText(o.items,l)}. Оплата: ${paymentLabel(o.paymentMethod,l)}. Доставка: ${deliveryLabel(o.deliveryMethod,l,o.deliveryZone,o.courierLocation)}. Итого: ${total}. Статус: ${localizedStatus(statusCodeOf(o),l)}.`;
  if(l==='tr') return `MM STAR ${o.invoice}: ${itemsText(o.items,l)}. Ödeme: ${paymentLabel(o.paymentMethod,l)}. Teslimat: ${deliveryLabel(o.deliveryMethod,l,o.deliveryZone,o.courierLocation)}. Toplam: ${total}. Durum: ${localizedStatus(statusCodeOf(o),l)}.`;
  return `MM STAR ${o.invoice}: ${itemsText(o.items,l)}. გადახდა: ${paymentLabel(o.paymentMethod,l)}. მიწოდება: ${deliveryLabel(o.deliveryMethod,l,o.deliveryZone,o.courierLocation)}. სულ: ${total}. სტატუსი: ${localizedStatus(statusCodeOf(o),l)}.`;
}
function statusSms(o,code){
  const l=language(o.language), st=localizedStatus(code,l);
  if(l==='en') return `MM STAR order ${o.invoice} status changed: ${st}.`;
  if(l==='ru') return `MM STAR заказ ${o.invoice}: новый статус — ${st}.`;
  if(l==='tr') return `MM STAR sipariş ${o.invoice}: yeni durum — ${st}.`;
  return `MM STAR შეკვეთა ${o.invoice}: სტატუსი შეიცვალა — ${st}.`;
}

function keepzPublicKey(raw){ const key=String(raw||'').replace(/\\n/g,'\n').trim(); if(key.includes('BEGIN PUBLIC KEY'))return key; return crypto.createPublicKey({key:Buffer.from(key,'base64'),format:'der',type:'spki'}); }
function keepzPrivateKey(raw){ const key=String(raw||'').replace(/\\n/g,'\n').trim(); if(key.includes('BEGIN PRIVATE KEY')||key.includes('BEGIN RSA PRIVATE KEY'))return key; return crypto.createPrivateKey({key:Buffer.from(key,'base64'),format:'der',type:'pkcs8'}); }
function rsaPublicEncrypt(text,key){return crypto.publicEncrypt({key:keepzPublicKey(key),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(text)).toString('base64')}
function rsaPrivateDecrypt(b64,key){return crypto.privateDecrypt({key:keepzPrivateKey(key),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(b64,'base64')).toString()}
function aesEncrypt(payload){const key=crypto.randomBytes(32),iv=crypto.randomBytes(16),c=crypto.createCipheriv('aes-256-cbc',key,iv);return{encrypted:Buffer.concat([c.update(JSON.stringify(payload),'utf8'),c.final()]).toString('base64'),key,iv}}
function aesDecrypt(b64,key,iv){const d=crypto.createDecipheriv('aes-256-cbc',key,iv);return JSON.parse(Buffer.concat([d.update(Buffer.from(b64,'base64')),d.final()]).toString('utf8'))}
function keepzEncrypt(payload){const {encrypted,key,iv}=aesEncrypt(payload),joined=`${key.toString('base64')}.${iv.toString('base64')}`;return{identifier:env.KEEPZ_IDENTIFIER||env.KEEPZ_INTEGRATOR_ID,encryptedData:encrypted,encryptedKeys:rsaPublicEncrypt(joined,env.KEEPZ_PUBLIC_KEY),aes:true}}
function keepzDecrypt(resp){if(!resp?.encryptedData)return resp;const joined=rsaPrivateDecrypt(resp.encryptedKeys,env.KEEPZ_PRIVATE_KEY),[k,v]=joined.split('.');return aesDecrypt(resp.encryptedData,Buffer.from(k,'base64'),Buffer.from(v,'base64'))}
async function keepzCreate(order){
  for(const k of ['KEEPZ_INTEGRATOR_ID','KEEPZ_RECEIVER_ID','KEEPZ_PUBLIC_KEY','KEEPZ_PRIVATE_KEY']) if(!env[k])throw new Error(`${k}_MISSING`);
  const site='https://mmstar.ge';
  const payload={amount:Number(order.total),receiverId:env.KEEPZ_RECEIVER_ID,receiverType:'BRANCH',integratorId:env.KEEPZ_INTEGRATOR_ID,integratorOrderId:order.keepzOrderId,currency:'GEL',language:String(order.language||'ka').toUpperCase(),callbackUri:`${site}/api/keepz-callback`,successRedirectUri:`${site}/checkout.html?payment=success&intent=${encodeURIComponent(order.keepzOrderId)}`,failRedirectUri:`${site}/checkout.html?payment=failed&intent=${encodeURIComponent(order.keepzOrderId)}`};
  const r=await fetch(`${(env.KEEPZ_BASE_URL||'https://gateway.keepz.me/ecommerce-service/api/integrator').replace(/\/$/,'')}/order`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(keepzEncrypt(payload))});
  const raw=await r.json().catch(()=>({}));if(!r.ok)throw new Error(raw.message||`KEEPZ_HTTP_${r.status}`);return keepzDecrypt(raw);
}

async function productItems(requestItems,priceField='price'){
  if(!Array.isArray(requestItems)||!requestItems.length) throw new Error('EMPTY_CART');
  const refs=requestItems.map(i=>db.collection('products').doc(String(i.id))), snaps=await db.getAll(...refs), items=[];
  let subtotal=0, weightKg=0;
  for(let n=0;n<snaps.length;n++){
    const s=snaps[n], p=s.data(), qty=Math.max(1,Number(requestItems[n].qty)||1);
    if(!p||!p.active) throw new Error('PRODUCT_NOT_AVAILABLE');
    if(Number(p.stock||0)<qty) throw new Error(`OUT_OF_STOCK:${p.name||s.id}`);
    const price=priceField==='price'?salePriceOf(p):Number(p[priceField]||0), weight=Number(p.weightKg||1);
    subtotal+=price*qty; weightKg+=weight*qty;
    items.push({productId:s.id,code:p.code||'',name:p.name||'',image:p.image||'',qty,price,total:price*qty,weightKg:weight});
  }
  return {refs,snaps,items,subtotal,weightKg};
}
async function decrementStock(tx,refs,items){
  const fresh=[];for(const r of refs)fresh.push(await tx.get(r));
  for(let n=0;n<fresh.length;n++) if(Number(fresh[n].data()?.stock||0)<items[n].qty) throw new Error('OUT_OF_STOCK');
  for(let n=0;n<refs.length;n++) tx.update(refs[n],{stock:admin.firestore.FieldValue.increment(-items[n].qty),sales:admin.firestore.FieldValue.increment(items[n].qty)});
}
async function restoreStock(items){
  const batch=db.batch();
  for(const i of items||[]){ const r=db.collection('products').doc(i.productId); batch.set(r,{stock:admin.firestore.FieldValue.increment(Number(i.qty)||0),sales:admin.firestore.FieldValue.increment(-(Number(i.qty)||0))},{merge:true}); }
  await batch.commit();
}

let georgianFontPromise;
async function georgianFont(){
  if(!georgianFontPromise) georgianFontPromise=fetch('https://raw.githubusercontent.com/notofonts/noto-fonts/main/hinted/ttf/NotoSansGeorgian/NotoSansGeorgian-Regular.ttf').then(r=>{if(!r.ok)throw new Error('FONT_FETCH_FAILED');return r.arrayBuffer()}).then(b=>{const x=Buffer.from(b);if(x.length<10000)throw new Error('FONT_INVALID');return x;});
  return georgianFontPromise;
}
function pdfHasGeo(s){return /[\u10A0-\u10FF]/.test(String(s||''))}
function pdfSafe(s){return String(s??'').replace(/[•№–—₾]/g,m=>({'•':'-','№':'N','–':'-','—':'-','₾':'GEL'}[m]||m))}
function pdfFontFor(doc,s,bold=false){
  if(pdfHasGeo(s)) return doc.font('Geo');
  return doc.font(bold?'Helvetica-Bold':'Helvetica');
}
function pdfMixedLine(doc,text,x,y,width,size=9){
  const s=pdfSafe(text);
  const runs=s.match(/[\u10A0-\u10FF]+|[^\u10A0-\u10FF]+/g)||[''];
  let xx=x;
  doc.fontSize(size);
  for(const run of runs){
    pdfFontFor(doc,run,false);
    let part=run;
    const remaining=x+width-xx;
    if(remaining<=4)break;
    while(part && doc.widthOfString(part)>remaining){
      part=part.slice(0,-1);
    }
    if(!part)break;
    doc.text(part,xx,y,{lineBreak:false});
    xx+=doc.widthOfString(part);
  }
}
async function invoicePdf(o,isDealer){
  const font=await georgianFont(),settings=await storeSettings();
  const doc=new PDFDocument({margin:36,size:'A4',bufferPages:true}),chunks=[];
  doc.on('data',c=>chunks.push(c));
  const done=new Promise(r=>doc.on('end',r));
  doc.registerFont('Geo',font);

  const RED='#e51b2b', DARK='#161616', MUTED='#666666', LINE='#e5e5e5', SOFT='#fafafa';
  const left=36,right=559,width=523;

  // Header
  try{
    const lr=await fetch('https://mmstar.ge/assets/logo.jpg');
    if(lr.ok)doc.image(Buffer.from(await lr.arrayBuffer()),left,30,{fit:[118,56]});
  }catch{}
  doc.fillColor(DARK).font('Helvetica-Bold').fontSize(20).text('MM STAR',365,34,{width:194,align:'right'});
  doc.fillColor(RED);pdfFontFor(doc,isDealer?'დილერის ინვოისი':'ინვოისი',true).fontSize(14).text(isDealer?'დილერის ინვოისი':'ინვოისი',335,62,{width:224,align:'right'});
  doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(isDealer?'DEALER INVOICE':'CUSTOMER INVOICE',335,82,{width:224,align:'right'});
  doc.moveTo(left,102).lineTo(right,102).lineWidth(2).strokeColor(RED).stroke();

  const date=o.createdAt?new Date((o.createdAt._seconds||Date.now()/1000)*1000):new Date();
  const party=isDealer?o.dealer:o.customer||{};
  const partyName=isDealer?(party.name||''):`${party.firstName||''} ${party.lastName||''}`.trim();

  // Invoice meta card
  doc.roundedRect(left,120,width,92,10).fillColor(SOFT).fill();
  const metaRow=(label,val,y)=>{
    doc.fillColor(MUTED);pdfFontFor(doc,label,true).fontSize(8).text(label,left+16,y,{width:110});
    doc.fillColor(DARK);pdfFontFor(doc,val,false).fontSize(10).text(pdfSafe(val),left+126,y,{width:365});
  };
  metaRow('ინვოისის ნომერი',o.invoice||'-',136);
  metaRow('თარიღი',date.toLocaleDateString('en-GB'),158);
  metaRow('სტატუსი',localizedStatus(statusCodeOf(o),'ka')||'-',180);

  // Customer / dealer card
  let y=228;
  doc.fillColor(DARK);pdfFontFor(doc,isDealer?'დილერის ინფორმაცია':'მომხმარებლის ინფორმაცია',true).fontSize(12).text(isDealer?'დილერის ინფორმაცია':'მომხმარებლის ინფორმაცია',left,y);
  y+=24;
  doc.roundedRect(left,y,width,118,10).lineWidth(1).strokeColor(LINE).stroke();

  const infoRow=(label,val,yy)=>{
    doc.fillColor(MUTED);pdfFontFor(doc,label,true).fontSize(8).text(label,left+14,yy,{width:125});
    doc.fillColor(DARK);
    const safe=pdfSafe(val||'-');
    if(pdfHasGeo(safe) && /[A-Za-z0-9]/.test(safe)) pdfMixedLine(doc,safe,left+142,yy,360,9.5);
    else pdfFontFor(doc,safe,false).fontSize(9.5).text(safe,left+142,yy,{width:360});
  };
  infoRow(isDealer?'დილერი':'მომხმარებელი',partyName||'-',y+16);
  if(isDealer)infoRow('საიდენტიფიკაციო კოდი',party.taxId||'-',y+38);
  else infoRow('ტელეფონი',party.phone||'-',y+38);
  if(isDealer)infoRow('ტელეფონი',party.phone||'-',y+60);
  else infoRow('ელფოსტა',party.email||'-',y+60);
  infoRow('მისამართი',o.address||party.address||'-',y+82);

  // Products table
  y+=142;
  doc.fillColor(DARK);pdfFontFor(doc,'პროდუქტები',true).fontSize(12).text('პროდუქტები',left,y);
  y+=24;

  const cols={code:left,name:left+78,qty:left+318,price:left+365,total:left+445};
  doc.rect(left,y,width,26).fillColor(DARK).fill();
  const head=(txt,x,w,align='left')=>{doc.fillColor('#ffffff');pdfFontFor(doc,txt,true).fontSize(8).text(txt,x,y+8,{width:w,align})};
  head('კოდი',cols.code,72);head('პროდუქტი',cols.name,232);head('რაოდ.',cols.qty,42,'center');head('ფასი',cols.price,74,'right');head('ჯამი',cols.total,78,'right');
  y+=26;

  const items=o.items||[];
  for(let idx=0;idx<items.length;idx++){
    const i=items[idx];
    if(y>680){doc.addPage();y=48}
    const rowH=34;
    if(idx%2===0)doc.rect(left,y,width,rowH).fillColor('#fcfcfc').fill();
    doc.fillColor(DARK).font('Helvetica').fontSize(8.5).text(pdfSafe(i.code||'-'),cols.code,y+10,{width:72});
    const nm=pdfSafe(i.name||'-');
    if(pdfHasGeo(nm)&&/[A-Za-z0-9]/.test(nm))pdfMixedLine(doc,nm,cols.name,y+10,228,8.5);
    else {pdfFontFor(doc,nm,false).fontSize(8.5).text(nm,cols.name,y+9,{width:228,height:18,ellipsis:true})}
    doc.font('Helvetica').fontSize(8.5).text(String(i.qty||0),cols.qty,y+10,{width:42,align:'center'});
    doc.text(`${Number(i.price||0).toFixed(2)} GEL`,cols.price,y+10,{width:74,align:'right'});
    doc.font('Helvetica-Bold').text(`${Number(i.total||0).toFixed(2)} GEL`,cols.total,y+10,{width:78,align:'right'});
    y+=rowH;
  }

  y+=14;
  // Totals card
  const subtotal=Number(o.subtotal??o.total??0),delivery=Number(o.deliveryFee||0),total=Number(o.total||0);
  doc.roundedRect(330,y,229,92,10).fillColor('#fff7f8').fill();
  const totalRow=(lab,n,yy,bold=false)=>{
    doc.fillColor(MUTED);pdfFontFor(doc,lab,bold).fontSize(bold?10:8.5).text(lab,344,yy,{width:90,align:'right'});
    doc.fillColor(bold?RED:DARK).font(bold?'Helvetica-Bold':'Helvetica').fontSize(bold?12:9).text(`${Number(n).toFixed(2)} GEL`,442,yy,{width:101,align:'right'});
  };
  totalRow('პროდუქტები',subtotal,y+15);
  totalRow('მიწოდება',delivery,y+38);
  totalRow('სულ',total,y+63,true);

  // Payment / delivery notes
  const noteY=Math.max(y+112,620);
  doc.fillColor(DARK);pdfFontFor(doc,'შეკვეთის დეტალები',true).fontSize(11).text('შეკვეთის დეტალები',left,noteY);
  const deliveryTxt=o.deliveryMethod==='pickup'?'ფილიალიდან გატანა':o.deliveryMethod==='tbilisi'?'ქალაქში მიწოდება':'რეგიონში მიწოდება';
  const paymentTxt=o.paymentMethod==='keepz'?'ბარათით / განვადება':o.paymentMethod==='invoice'?'ინვოისი / საბანკო გადარიცხვა':'ფილიალში გადახდა';
  doc.fillColor(MUTED);pdfFontFor(doc,'გადახდა',true).fontSize(8).text('გადახდა',left,noteY+22,{width:90});
  doc.fillColor(DARK);pdfFontFor(doc,paymentTxt,false).fontSize(9).text(paymentTxt,left+95,noteY+22,{width:190});
  doc.fillColor(MUTED);pdfFontFor(doc,'მიწოდება',true).fontSize(8).text('მიწოდება',left,noteY+43,{width:90});
  doc.fillColor(DARK);pdfFontFor(doc,deliveryTxt,false).fontSize(9).text(deliveryTxt,left+95,noteY+43,{width:190});
  if(o.address){
    doc.fillColor(MUTED);pdfFontFor(doc,'მისამართი',true).fontSize(8).text('მისამართი',left,noteY+64,{width:90});
    doc.fillColor(DARK);pdfFontFor(doc,o.address,false).fontSize(9).text(pdfSafe(o.address),left+95,noteY+64,{width:420});
  }

  // Footer
  const footerY=780;
  doc.moveTo(left,footerY-18).lineTo(right,footerY-18).lineWidth(1).strokeColor(LINE).stroke();
  doc.fillColor(MUTED);pdfFontFor(doc,settings.address||DEFAULT_STORE.address,false).fontSize(7.5).text(pdfSafe(settings.address||DEFAULT_STORE.address),left,footerY-8,{width:width,align:'center'});
  doc.font('Helvetica').fontSize(7.5).text(`MM STAR | ${settings.onlineSalesPhone||DEFAULT_STORE.onlineSalesPhone} | ${settings.email||DEFAULT_STORE.email} | mmstar.ge`,left,footerY+7,{width:width,align:'center'});

  doc.end();
  await done;
  return Buffer.concat(chunks)
}

async function handler(event){
  const path=(event.path||'').replace(/^.*\/api\/?/,'').replace(/^\//,''), method=event.httpMethod;
  try{
    if(path==='health') return ok({service:'MM STAR API',time:new Date().toISOString()});
    if(path==='catalog'&&method==='GET'){
      const [p,c,s]=await Promise.all([db.collection('products').where('active','==',true).get(),db.collection('categories').get(),db.collection('settings').doc('store').get()]);
      return ok({products:p.docs.map(publicProduct),categories:c.docs.map(publicDoc),settings:{...DEFAULT_STORE,...(s.exists?s.data():{})},deliveryTariffs:DELIVERY_TARIFFS});
    }
    if(path==='delivery/tariffs'&&method==='GET') return ok({tariffs:DELIVERY_TARIFFS});

    if(path==='otp/send'&&method==='POST'){
      const p=cleanPhone(bodyOf(event).phone);if(!/^9955\d{8}$/.test(p))return bad('INVALID_PHONE');
      const ref=db.collection('otpLogs').doc(hash(p)), snap=await ref.get(), now=Date.now();if(snap.exists&&snap.data().resendAfter>now)return bad('WAIT_BEFORE_RESEND',429);
      const code=randomOtp();await ubillSend(p,`MM STAR verification code: ${code}`,true);await ref.set({phoneHash:hash(p),otpHash:hash(code),expiresAt:now+300000,resendAfter:now+60000,attempts:0,createdAt:admin.firestore.FieldValue.serverTimestamp()});return ok({sent:true,resendIn:60});
    }
    if(path==='otp/verify'&&method==='POST'){
      const b=bodyOf(event),p=cleanPhone(b.phone),ref=db.collection('otpLogs').doc(hash(p)),snap=await ref.get();if(!snap.exists)return bad('OTP_NOT_FOUND');const x=snap.data();if(Date.now()>x.expiresAt)return bad('OTP_EXPIRED');if(x.attempts>=5)return bad('TOO_MANY_ATTEMPTS',429);if(hash(String(b.code))!==x.otpHash){await ref.update({attempts:admin.firestore.FieldValue.increment(1)});return bad('OTP_INVALID');}
      const uid=`phone_${hash(p).slice(0,24)}`;try{await admin.auth().getUser(uid)}catch{await admin.auth().createUser({uid,phoneNumber:'+'+p})}const token=await admin.auth().createCustomToken(uid,{phone:'+'+p});await ref.delete();return ok({token,isNew:!(await db.collection('customers').doc(uid).get()).exists});
    }
    if(path==='profile'&&method==='GET'){const u=await firebaseAuth(event),s=await db.collection('customers').doc(u.uid).get();return ok({profile:s.exists?s.data():null});}
    if(path==='profile'&&method==='POST'){const u=await firebaseAuth(event),b=bodyOf(event);const existing=await db.collection('customers').doc(u.uid).get();const data={firstName:b.firstName||'',lastName:b.lastName||'',email:b.email||'',address:b.address||'',phone:u.phone_number||b.phone||'',preferredLanguage:language(b.preferredLanguage),updatedAt:admin.firestore.FieldValue.serverTimestamp()};await db.collection('customers').doc(u.uid).set({...data,...(!existing.exists?{createdAt:admin.firestore.FieldValue.serverTimestamp()}: {})},{merge:true});return ok({profile:data});}

    if(path==='orders'&&method==='GET'){const u=await firebaseAuth(event),q=await db.collection('orders').where('customerId','==',u.uid).limit(100).get();const orders=q.docs.map(publicDoc).sort((a,b)=>(b.createdAt?._seconds||0)-(a.createdAt?._seconds||0));return ok({orders});}
    if(path==='orders'&&method==='POST'){
      const u=await firebaseAuth(event),b=bodyOf(event),profileSnap=await db.collection('customers').doc(u.uid).get(),profile=profileSnap.data()||{},pi=await productItems(b.items,'price');
      const lang=language(b.language||profile.preferredLanguage),fee=deliveryFee(pi.weightKg,b.deliveryMethod,b.deliveryZone),total=pi.subtotal+fee,paymentMethod=b.paymentMethod||'invoice';
      const baseOrder={customerId:u.uid,customer:{firstName:profile.firstName||'',lastName:profile.lastName||'',phone:u.phone_number||profile.phone||'',email:profile.email||'',address:b.address||profile.address||''},items:pi.items,subtotal:pi.subtotal,weightKg:pi.weightKg,deliveryFee:fee,total,paymentMethod,deliveryMethod:b.deliveryMethod||'pickup',deliveryZone:b.deliveryZone||'',district:b.district||'',address:b.address||profile.address||'',courierType:b.courierType||'',courierLocation:b.courierLocation||'',courierDays:b.courierDays||'',estimatedDeliveryDate:b.estimatedDeliveryDate||'',language:lang,statusCode:'NEW',status:STATUS_KA.NEW};
      // Card/Installment: reserve stock and create only a payment intent. The real order is created only after Keepz confirms payment server-side.
      if(paymentMethod==='keepz'){
        const intentId=id(),intentRef=db.collection('paymentIntents').doc(intentId),intent={...baseOrder,paymentStatus:'PENDING',keepzOrderId:intentId,reserved:true,createdAt:admin.firestore.FieldValue.serverTimestamp(),expiresAt:Date.now()+30*60*1000};
        await db.runTransaction(async tx=>{await decrementStock(tx,pi.refs,pi.items);tx.set(intentRef,intent)});
        try{const payment=await keepzCreate({...intent,keepzOrderId:intentId});await intentRef.update({keepz:payment,updatedAt:admin.firestore.FieldValue.serverTimestamp()});return ok({pendingPayment:true,paymentIntentId:intentId,total,deliveryFee:fee,payment});}
        catch(e){await restoreStock(intent.items);await intentRef.delete();throw e;}
      }
      const invoice=await nextInvoice('customer'),orderId=id(),ref=db.collection('orders').doc(orderId),paymentStatus=paymentMethod==='invoice'?'AWAITING_CONFIRMATION':'UNPAID';
      const order={...baseOrder,invoice,paymentStatus,createdAt:admin.firestore.FieldValue.serverTimestamp()};
      await db.runTransaction(async tx=>{await decrementStock(tx,pi.refs,pi.items);tx.set(ref,order)});
      await safeSms(order.customer.phone,orderCreatedSms(order));return ok({orderId,invoice,total,deliveryFee:fee,payment:null,paymentStatus,bank:await storeSettings()});
    }
    if(path==='keepz-callback'&&method==='POST'){
      let payload=bodyOf(event);try{payload=keepzDecrypt(payload)}catch{}
      const oid=payload.integratorOrderId;if(!oid)return json(200,{received:true});
      const completed=await db.collection('orders').doc(oid).get();if(completed.exists)return json(200,{received:true,alreadyCompleted:true});
      const intentRef=db.collection('paymentIntents').doc(oid),s=await intentRef.get();if(!s.exists)return json(200,{received:true,missingIntent:true});
      const intent=s.data(),success=['SUCCESS','PAID','COMPLETED'].includes(String(payload.status||'').toUpperCase());
      if(success){
        if(intent.reservationReleased){const refs=(intent.items||[]).map(i=>db.collection('products').doc(i.productId));await db.runTransaction(async tx=>{await decrementStock(tx,refs,intent.items||[])});}
        const invoice=await nextInvoice('customer'),order={...intent,invoice,paymentStatus:'PAID',statusCode:'PAID',status:STATUS_KA.PAID,paymentCallback:payload,paymentIntentId:oid,paidAt:admin.firestore.FieldValue.serverTimestamp(),createdAt:admin.firestore.FieldValue.serverTimestamp()};
        delete order.expiresAt;delete order.reserved;
        await db.collection('orders').doc(oid).set(order);await intentRef.delete();await safeSms(order.customer?.phone,orderCreatedSms(order));
      }else if(!intent.reservationReleased){await restoreStock(intent.items);await intentRef.set({paymentStatus:'FAILED',reservationReleased:true,paymentCallback:payload,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});}
      return json(200,{received:true});
    }
    if(path.startsWith('payment/status/')&&method==='GET'){
      const oid=decodeURIComponent(path.slice('payment/status/'.length));const order=await db.collection('orders').doc(oid).get();if(order.exists)return ok({state:'completed',invoice:order.data().invoice,orderId:oid,paymentStatus:order.data().paymentStatus});const intent=await db.collection('paymentIntents').doc(oid).get();if(!intent.exists)return ok({state:'unknown'});return ok({state:intent.data().paymentStatus==='FAILED'?'failed':'pending'});
    }
    if(path.startsWith('invoice/')&&method==='GET'){
      const invoice=decodeURIComponent(path.split('/')[1]);let snap=await db.collection('orders').where('invoice','==',invoice).limit(1).get(),isDealer=false;if(snap.empty){snap=await db.collection('dealerOrders').where('invoice','==',invoice).limit(1).get();isDealer=true}if(snap.empty)return bad('NOT_FOUND',404);const pdf=await invoicePdf(snap.docs[0].data(),isDealer);return{statusCode:200,isBase64Encoded:true,headers:{'content-type':'application/pdf','content-disposition':`inline; filename="${invoice}.pdf"`},body:pdf.toString('base64')};
    }

    // Public media served from Netlify Blobs.
    if(path.startsWith('media/')&&method==='GET'){
      const key=decodeURIComponent(path.slice(6)),entry=await mediaStore().getWithMetadata(key,{type:'arrayBuffer'});if(!entry)return bad('NOT_FOUND',404);return{statusCode:200,isBase64Encoded:true,headers:{'content-type':entry.metadata?.contentType||'application/octet-stream','cache-control':'public,max-age=31536000,immutable'},body:Buffer.from(entry.data).toString('base64')};
    }

    // Admin
    if(path==='admin/login'&&method==='POST'){
      const b=bodyOf(event),username=String(b.username||'').trim();
      if(username===env.ADMIN_USERNAME&&b.password===env.ADMIN_PASSWORD)return ok({token:await signRole({role:'admin',sub:'env-admin'}),role:'admin',name:'Admin'});
      const q=await db.collection('admins').where('username','==',username).limit(1).get();if(q.empty)return bad('INVALID_CREDENTIALS',401);const s=q.docs[0],u=s.data();if(u.active===false||u.passwordHash!==hash(b.password))return bad('INVALID_CREDENTIALS',401);const role=u.role==='sales'?'sales':'admin';return ok({token:await signRole({role,sub:s.id,name:u.name||username},10),role,name:u.name||username});
    }
    if(path==='admin/upload-image'&&method==='POST'){
      await roleAuth(event,['admin']);const b=bodyOf(event),m=String(b.dataUrl||'').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/);if(!m)return bad('INVALID_IMAGE');const buf=Buffer.from(m[2],'base64');if(buf.length>5*1024*1024)return bad('IMAGE_TOO_LARGE',413);const ext={"image/jpeg":'jpg',"image/png":'png',"image/webp":'webp',"image/gif":'gif'}[m[1]]||'bin',folder=String(b.folder||'uploads').replace(/[^a-z0-9_-]/gi,'').slice(0,30)||'uploads',key=`${folder}/${Date.now()}-${id()}.${ext}`;const ab=buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength);await mediaStore().set(key,ab,{metadata:{contentType:m[1]}});return ok({url:`/api/media/${encodeURIComponent(key)}`,key});
    }
    if(path==='admin/dashboard'&&method==='GET'){
      await roleAuth(event,['admin','sales']);const[p,c,u,d,o,doq]=await Promise.all(['products','categories','customers','dealers','orders','dealerOrders'].map(x=>db.collection(x).get()));
      const now=new Date(),dayStart=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()/1000,monthStart=new Date(now.getFullYear(),now.getMonth(),1).getTime()/1000;
      const allOrders=o.docs.map(publicDoc),paid=allOrders.filter(x=>x.paymentStatus==='PAID'||statusCodeOf(x)==='PAID'),today=allOrders.filter(x=>(x.createdAt?._seconds||0)>=dayStart),month=allOrders.filter(x=>(x.createdAt?._seconds||0)>=monthStart);
      const counts={};for(const ord of today)for(const it of ord.items||[])counts[it.productId]=(counts[it.productId]||0)+Number(it.qty||0);
      const pp=p.docs.map(publicProduct),topToday=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([id,qty])=>{const x=pp.find(p=>p.id===id)||{};return{id,name:x.name||id,image:x.image||'',qty}}),lowStock=pp.filter(x=>Number(x.stock||0)>0&&Number(x.stock||0)<=5).sort((a,b)=>Number(a.stock)-Number(b.stock)).slice(0,10),outOfStock=pp.filter(x=>Number(x.stock||0)<=0).slice(0,10);
      const sum=a=>a.reduce((n,x)=>n+Number(x.total||0),0);return ok({stats:{products:p.size,categories:c.docs.filter(x=>!x.data().parentId).length,subcategories:c.docs.filter(x=>x.data().parentId).length,customers:u.size,dealers:d.size,orders:o.size,dealerOrders:doq.size,sales:sum(paid),todaySales:sum(today.filter(x=>x.paymentStatus==='PAID'||statusCodeOf(x)==='PAID')),monthSales:sum(month.filter(x=>x.paymentStatus==='PAID'||statusCodeOf(x)==='PAID')),todayOrders:today.length},topToday,lowStock,outOfStock});
    }
    if(path==='admin/products'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('products').get();return ok({products:q.docs.map(publicProduct).sort((a,b)=>String(a.name).localeCompare(String(b.name)))})}
    if(path==='admin/products'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),ref=b.id?db.collection('products').doc(b.id):db.collection('products').doc();await ref.set({code:b.code||'',name:b.name||'',description:b.description||'',categoryId:b.categoryId||'',subcategoryId:b.subcategoryId||'',image:b.image||'',price:Number(b.price||0),dealerPrice:Number(b.dealerPrice||0),stock:Number(b.stock||0),weightKg:Math.max(.01,Number(b.weightKg||1)),active:b.active!==false,isNew:!!b.isNew,saleActive:!!b.saleActive,discountType:['percent','amount'].includes(b.discountType)?b.discountType:'percent',discountValue:Math.max(0,Number(b.discountValue||0)),salePrice:b.salePrice===''||b.salePrice==null?null:Math.max(0,Number(b.salePrice)),updatedAt:admin.firestore.FieldValue.serverTimestamp(),...(!b.id?{createdAt:admin.firestore.FieldValue.serverTimestamp()}: {})},{merge:true});return ok({id:ref.id})}
    if(path.startsWith('admin/products/')&&method==='DELETE'){await roleAuth(event,['admin']);await db.collection('products').doc(path.split('/')[2]).delete();return ok()}
    if(path==='admin/categories'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('categories').get();return ok({categories:q.docs.map(publicDoc).sort((a,b)=>String(a.name).localeCompare(String(b.name)))})}
    if(path==='admin/categories'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),ref=b.id?db.collection('categories').doc(b.id):db.collection('categories').doc();await ref.set({name:b.name||'',emoji:b.emoji||'',image:b.image||'',parentId:b.parentId||'',updatedAt:admin.firestore.FieldValue.serverTimestamp(),...(!b.id?{createdAt:admin.firestore.FieldValue.serverTimestamp()}: {})},{merge:true});return ok({id:ref.id})}
    if(path.startsWith('admin/categories/')&&method==='DELETE'){await roleAuth(event,['admin']);const cid=path.split('/')[2],children=await db.collection('categories').where('parentId','==',cid).limit(1).get(),used1=await db.collection('products').where('categoryId','==',cid).limit(1).get(),used2=await db.collection('products').where('subcategoryId','==',cid).limit(1).get();if(!children.empty)return bad('CATEGORY_HAS_SUBCATEGORIES',409);if(!used1.empty||!used2.empty)return bad('CATEGORY_HAS_PRODUCTS',409);await db.collection('categories').doc(cid).delete();return ok()}


    if(path==='admin/staff'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('admins').get();return ok({staff:q.docs.map(d=>({id:d.id,...d.data(),passwordHash:undefined})).sort((a,b)=>String(a.name||a.username).localeCompare(String(b.name||b.username)))})}
    if(path==='admin/staff'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),username=String(b.username||'').trim();if(!username)return bad('USERNAME_REQUIRED');const ref=b.id?db.collection('admins').doc(b.id):db.collection('admins').doc(),data={name:b.name||'',username,role:b.role==='sales'?'sales':'admin',active:b.active!==false,updatedAt:admin.firestore.FieldValue.serverTimestamp()};if(b.password)data.passwordHash=hash(b.password);if(!b.id&&!b.password)return bad('PASSWORD_REQUIRED');if(!b.id)data.createdAt=admin.firestore.FieldValue.serverTimestamp();await ref.set(data,{merge:true});return ok({id:ref.id})}
    if(path.startsWith('admin/staff/')&&method==='DELETE'){await roleAuth(event,['admin']);await db.collection('admins').doc(path.split('/')[2]).delete();return ok()}

    if(path==='admin/customers'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('customers').get(),rows=[];for(const d of q.docs){const oq=await db.collection('orders').where('customerId','==',d.id).get();rows.push({id:d.id,...d.data(),ordersCount:oq.size,totalSpent:oq.docs.reduce((a,s)=>a+Number(s.data().total||0),0)})}return ok({customers:rows})}
    if(path==='admin/customers'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),p=cleanPhone(b.phone);if(!/^9955\d{8}$/.test(p))return bad('INVALID_PHONE');const uid=b.id||`phone_${hash(p).slice(0,24)}`;try{const au=await admin.auth().getUser(uid);if(au.phoneNumber!=='+'+p)await admin.auth().updateUser(uid,{phoneNumber:'+'+p})}catch{await admin.auth().createUser({uid,phoneNumber:'+'+p})}await db.collection('customers').doc(uid).set({firstName:b.firstName||'',lastName:b.lastName||'',phone:'+'+p,email:b.email||'',address:b.address||'',preferredLanguage:language(b.preferredLanguage),updatedAt:admin.firestore.FieldValue.serverTimestamp(),...(!b.id?{createdAt:admin.firestore.FieldValue.serverTimestamp()}: {})},{merge:true});return ok({id:uid})}
    if(path.startsWith('admin/customers/')&&method==='DELETE'){await roleAuth(event,['admin']);const uid=path.split('/')[2];try{await admin.auth().deleteUser(uid)}catch{}await db.collection('customers').doc(uid).delete();return ok()}

    if(path==='admin/orders'&&method==='GET'){await roleAuth(event,['admin','sales']);const q=await db.collection('orders').limit(300).get();return ok({orders:q.docs.map(publicDoc).sort((a,b)=>(b.createdAt?._seconds||0)-(a.createdAt?._seconds||0))})}
    if(path==='admin/orders'&&method==='POST'){
      await roleAuth(event,['admin']);const b=bodyOf(event);
      if(b.id){
        const ref=db.collection('orders').doc(b.id),s=await ref.get();
        if(!s.exists)return bad('NOT_FOUND',404);
        const old=s.data(),code=STATUS_CODES.includes(b.statusCode)?b.statusCode:statusCodeOf(old);
        const patch={
          paymentMethod:b.paymentMethod||old.paymentMethod||'invoice',
          deliveryMethod:b.deliveryMethod||old.deliveryMethod||'pickup',
          deliveryZone:(b.deliveryZone??old.deliveryZone??''),
          district:(b.district??old.district??''),
          address:(b.address??old.address??''),
          courierType:(b.courierType??old.courierType??''),
          courierLocation:(b.courierLocation??old.courierLocation??''),
          courierDays:(b.courierDays??old.courierDays??''),
          estimatedDeliveryDate:(b.estimatedDeliveryDate??old.estimatedDeliveryDate??''),
          statusCode:code,
          status:STATUS_KA[code]||code,
          paymentStatus:b.paymentStatus||old.paymentStatus||'UNPAID',
          updatedAt:admin.firestore.FieldValue.serverTimestamp()
        };
        await ref.update(patch);
        if(code!==statusCodeOf(old))await safeSms(old.customer?.phone,statusSms(old,code));
        return ok({id:b.id})
      }
      const customer=await db.collection('customers').doc(b.customerId).get();if(!customer.exists)return bad('CUSTOMER_NOT_FOUND');const c=customer.data(),pi=await productItems(b.items,'price'),lang=language(b.language||c.preferredLanguage),fee=deliveryFee(pi.weightKg,b.deliveryMethod,b.deliveryZone),invoice=await nextInvoice('customer'),ref=db.collection('orders').doc();const order={invoice,customerId:customer.id,customer:{firstName:c.firstName||'',lastName:c.lastName||'',phone:c.phone||'',email:c.email||'',address:b.address||c.address||''},items:pi.items,subtotal:pi.subtotal,weightKg:pi.weightKg,deliveryFee:fee,total:pi.subtotal+fee,paymentMethod:b.paymentMethod||'invoice',paymentStatus:b.paymentStatus||'UNPAID',deliveryMethod:b.deliveryMethod||'pickup',deliveryZone:b.deliveryZone||'',district:b.district||'',address:b.address||c.address||'',courierType:b.courierType||'',courierLocation:b.courierLocation||'',courierDays:b.courierDays||'',estimatedDeliveryDate:b.estimatedDeliveryDate||'',language:lang,statusCode:b.statusCode||'NEW',status:STATUS_KA[b.statusCode||'NEW'],createdAt:admin.firestore.FieldValue.serverTimestamp()};await db.runTransaction(async tx=>{await decrementStock(tx,pi.refs,pi.items);tx.set(ref,order)});await safeSms(order.customer.phone,orderCreatedSms(order));return ok({id:ref.id,invoice})
    }
    if(path.startsWith('admin/orders/')&&method==='DELETE'){await roleAuth(event,['admin']);const oid=path.split('/')[2],ref=db.collection('orders').doc(oid),s=await ref.get();if(!s.exists)return bad('NOT_FOUND',404);await restoreStock(s.data().items);await ref.delete();return ok()}
    if(path==='admin/order-status'&&method==='POST'){await roleAuth(event,['admin','sales']);const b=bodyOf(event),coll=b.dealer?'dealerOrders':'orders',ref=db.collection(coll).doc(b.id),s=await ref.get();if(!s.exists)return bad('NOT_FOUND',404);const code=STATUS_CODES.includes(b.statusCode)?b.statusCode:(STATUS_FROM_OLD[b.status]||b.status||'NEW');await ref.update({statusCode:code,status:STATUS_KA[code]||code,...(code==='PAID'?{paymentStatus:'PAID'}:{}),updatedAt:admin.firestore.FieldValue.serverTimestamp()});const o=s.data(),phone=b.dealer?o.dealer?.phone:o.customer?.phone;if(code!==statusCodeOf(o))await safeSms(phone,statusSms(o,code));return ok()}

    if(path==='admin/dealers'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('dealers').get();return ok({dealers:q.docs.map(d=>({id:d.id,...d.data(),passwordHash:undefined}))})}
    if(path==='admin/dealers'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),ref=b.id?db.collection('dealers').doc(b.id):db.collection('dealers').doc(),data={companyType:b.companyType||'შპს',name:b.name||'',taxId:b.taxId||'',address:b.address||'',phone:b.phone||'',email:b.email||'',username:b.username||'',categories:b.categories||[],active:b.active!==false,preferredLanguage:language(b.preferredLanguage),updatedAt:admin.firestore.FieldValue.serverTimestamp()};if(b.password)data.passwordHash=hash(b.password);if(!b.id)data.createdAt=admin.firestore.FieldValue.serverTimestamp();await ref.set(data,{merge:true});return ok({id:ref.id})}
    if(path.startsWith('admin/dealers/')&&method==='DELETE'){await roleAuth(event,['admin']);await db.collection('dealers').doc(path.split('/')[2]).delete();return ok()}

    if(path==='admin/dealer-orders'&&method==='GET'){await roleAuth(event,['admin','sales']);const q=await db.collection('dealerOrders').limit(300).get();return ok({orders:q.docs.map(publicDoc).sort((a,b)=>(b.createdAt?._seconds||0)-(a.createdAt?._seconds||0))})}
    if(path==='admin/dealer-orders'&&method==='POST'){
      await roleAuth(event,['admin']);const b=bodyOf(event);
      if(b.id){const ref=db.collection('dealerOrders').doc(b.id),s=await ref.get();if(!s.exists)return bad('NOT_FOUND',404);const code=STATUS_CODES.includes(b.statusCode)?b.statusCode:statusCodeOf(s.data());await ref.update({paymentMethod:b.paymentMethod||s.data().paymentMethod,statusCode:code,status:STATUS_KA[code],updatedAt:admin.firestore.FieldValue.serverTimestamp()});if(code!==statusCodeOf(s.data()))await safeSms(s.data().dealer?.phone,statusSms(s.data(),code));return ok({id:b.id})}
      const ds=await db.collection('dealers').doc(b.dealerId).get();if(!ds.exists)return bad('DEALER_NOT_FOUND');const d=ds.data(),pi=await productItems(b.items,'dealerPrice'),invoice=await nextInvoice('dealer'),ref=db.collection('dealerOrders').doc(),lang=language(b.language||d.preferredLanguage);const order={invoice,dealerId:ds.id,dealer:{name:d.name||'',companyType:d.companyType||'',taxId:d.taxId||'',address:d.address||'',phone:d.phone||''},items:pi.items,subtotal:pi.subtotal,total:pi.subtotal,paymentMethod:b.paymentMethod||'invoice',language:lang,statusCode:b.statusCode||'NEW',status:STATUS_KA[b.statusCode||'NEW'],createdAt:admin.firestore.FieldValue.serverTimestamp()};await db.runTransaction(async tx=>{await decrementStock(tx,pi.refs,pi.items);tx.set(ref,order)});await safeSms(order.dealer.phone,orderCreatedSms(order));return ok({id:ref.id,invoice})
    }
    if(path.startsWith('admin/dealer-orders/')&&method==='DELETE'){await roleAuth(event,['admin']);const oid=path.split('/')[2],ref=db.collection('dealerOrders').doc(oid),s=await ref.get();if(!s.exists)return bad('NOT_FOUND',404);await restoreStock(s.data().items);await ref.delete();return ok()}

    if(path==='admin/settings'&&method==='GET'){await roleAuth(event,['admin']);return ok({settings:await storeSettings(),deliveryTariffs:DELIVERY_TARIFFS})}
    if(path==='admin/settings'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),allowed={address:b.address||'',storePhones:Array.isArray(b.storePhones)?b.storePhones:[],onlineSalesPhone:b.onlineSalesPhone||'',storeHours:b.storeHours||'',onlineSalesHours:b.onlineSalesHours||'',email:b.email||'',website:b.website||'',companyId:b.companyId||'',bank:b.bank||'',iban:b.iban||'',updatedAt:admin.firestore.FieldValue.serverTimestamp()};await db.collection('settings').doc('store').set(allowed,{merge:true});return ok({settings:{...DEFAULT_STORE,...allowed}})}
    if(path==='admin/integrations'&&method==='GET'){await roleAuth(event,['admin']);return ok({integrations:{ubill:{configured:!!env.UBILL_API_KEY,brandId:env.UBILL_BRAND_ID||'1'},keepz:{configured:!!(env.KEEPZ_INTEGRATOR_ID&&env.KEEPZ_RECEIVER_ID&&env.KEEPZ_PUBLIC_KEY&&env.KEEPZ_PRIVATE_KEY),receiverId:env.KEEPZ_RECEIVER_ID||'',integratorId:env.KEEPZ_INTEGRATOR_ID||''}}})}

    // Dealer portal
    if(path==='dealer/login'&&method==='POST'){const b=bodyOf(event),q=await db.collection('dealers').where('username','==',b.username).limit(1).get();if(q.empty)return bad('INVALID_CREDENTIALS',401);const d=q.docs[0];if(!d.data().active||d.data().passwordHash!==hash(b.password))return bad('INVALID_CREDENTIALS',401);return ok({token:await signRole({role:'dealer',sub:d.id},12),dealer:{id:d.id,name:d.data().name,preferredLanguage:d.data().preferredLanguage||'ka'}})}
    if(path==='dealer/catalog'&&method==='GET'){const a=await roleAuth(event,['dealer']),ds=await db.collection('dealers').doc(a.sub).get(),d=ds.data(),q=await db.collection('products').where('active','==',true).get(),cats=await db.collection('categories').get();const allowed=new Set(d.categories||[]),products=q.docs.map(publicDoc).filter(p=>allowed.has(p.categoryId)||allowed.has(p.subcategoryId)),allCats=cats.docs.map(publicDoc),allowedCats=allCats.filter(c=>allowed.has(c.id)||allowed.has(c.parentId));return ok({products:products.map(p=>({...p,retailPrice:p.price,price:p.dealerPrice,dealerPrice:p.dealerPrice,difference:Number(p.price)-Number(p.dealerPrice)})),categories:allowedCats,dealer:{name:d.name,preferredLanguage:d.preferredLanguage||'ka'}})}
    if(path==='dealer/orders'&&method==='GET'){const a=await roleAuth(event,['dealer']),q=await db.collection('dealerOrders').where('dealerId','==',a.sub).get();return ok({orders:q.docs.map(publicDoc).sort((x,y)=>(y.createdAt?._seconds||0)-(x.createdAt?._seconds||0))})}
    if(path==='dealer/orders'&&method==='POST'){const a=await roleAuth(event,['dealer']),b=bodyOf(event),ds=await db.collection('dealers').doc(a.sub).get(),d=ds.data();const pi=await productItems(b.items,'dealerPrice');for(const i of pi.items){const p=(await db.collection('products').doc(i.productId).get()).data();if(!((d.categories||[]).includes(p.categoryId)||(d.categories||[]).includes(p.subcategoryId)))return bad('CATEGORY_NOT_ALLOWED')}const invoice=await nextInvoice('dealer'),ref=db.collection('dealerOrders').doc(),lang=language(b.language||d.preferredLanguage),order={invoice,dealerId:a.sub,dealer:{name:d.name,companyType:d.companyType,taxId:d.taxId,address:d.address,phone:d.phone},items:pi.items,subtotal:pi.subtotal,total:pi.subtotal,paymentMethod:b.paymentMethod||'invoice',language:lang,statusCode:'NEW',status:STATUS_KA.NEW,createdAt:admin.firestore.FieldValue.serverTimestamp()};await db.runTransaction(async tx=>{await decrementStock(tx,pi.refs,pi.items);tx.set(ref,order)});await db.collection('dealers').doc(a.sub).set({preferredLanguage:lang},{merge:true});await safeSms(order.dealer.phone,orderCreatedSms(order));return ok({id:ref.id,invoice,total:pi.subtotal})}

    return bad('NOT_FOUND',404);
  }catch(e){console.error('API_ERROR',path,e);const m=e?.message||'SERVER_ERROR';if(m==='AUTH_REQUIRED')return bad(m,401);if(m==='FORBIDDEN')return bad(m,403);if(m.startsWith('OUT_OF_STOCK'))return bad(m,409);return bad(m,500)}
}

export default async request => {
  const url=new URL(request.url),headers=Object.fromEntries(request.headers.entries());let body='';if(!['GET','HEAD'].includes(request.method))body=await request.text();
  const event={path:url.pathname,rawUrl:request.url,httpMethod:request.method,headers,queryStringParameters:Object.fromEntries(url.searchParams.entries()),body};
  const result=await handler(event);if(result instanceof Response)return result;const responseHeaders=new Headers(result.headers||{});if(result.isBase64Encoded)return new Response(Uint8Array.from(Buffer.from(result.body||'','base64')),{status:result.statusCode||200,headers:responseHeaders});return new Response(result.body??'',{status:result.statusCode||200,headers:responseHeaders});
};
