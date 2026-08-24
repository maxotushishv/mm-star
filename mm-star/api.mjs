import admin from 'firebase-admin';
import crypto from 'crypto';
import PDFDocument from 'pdfkit';
import { SignJWT, jwtVerify } from 'jose';

const env = process.env;
if (!admin.apps.length) {
  const privateKey = (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey
    }),
    storageBucket: env.FIREBASE_STORAGE_BUCKET
  });
}
const db = admin.firestore();
const jwtSecret = new TextEncoder().encode(env.APP_JWT_SECRET || 'mm-star-temporary-change-this-in-netlify');

const json = (statusCode, body, headers={}) => ({statusCode, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers}, body: JSON.stringify(body)});
const bad = (m, code=400) => json(code,{ok:false,error:m});
const ok = (data={}) => json(200,{ok:true,...data});
const bodyOf = e => { try { return e.body ? JSON.parse(e.body) : {}; } catch { return {}; } };
const cleanPhone = p => String(p||'').replace(/\D/g,'').replace(/^0/,'995');
const randomOtp = () => String(crypto.randomInt(100000,1000000));
const hash = v => crypto.createHash('sha256').update(v).digest('hex');
const id = () => crypto.randomUUID();

async function signRole(payload, hours=8){return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime(`${hours}h`).sign(jwtSecret)}
async function roleAuth(event, roles){
  const h=event.headers.authorization||event.headers.Authorization||'';
  const token=h.replace(/^Bearer\s+/i,''); if(!token) throw new Error('AUTH_REQUIRED');
  try { const {payload}=await jwtVerify(token,jwtSecret); if(!roles.includes(payload.role)) throw new Error('FORBIDDEN'); return payload; } catch { throw new Error('AUTH_REQUIRED'); }
}
async function firebaseAuth(event){
  const h=event.headers.authorization||event.headers.Authorization||''; const token=h.replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('AUTH_REQUIRED'); return admin.auth().verifyIdToken(token);
}
async function nextInvoice(kind='customer'){
  const year=new Date().getFullYear(); const ref=db.collection('settings').doc(`counter-${kind}-${year}`);
  return db.runTransaction(async tx=>{ const s=await tx.get(ref); const n=(s.exists?s.data().value:0)+1; tx.set(ref,{value:n,updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true}); return `${kind==='dealer'?'MM-D':'MM'}-${year}-${String(n).padStart(6,'0')}`; });
}
async function ubillSend(phone,text,otp=false){
  if(!env.UBILL_API_KEY) throw new Error('UBILL_NOT_CONFIGURED');
  const r=await fetch(`${env.UBILL_API_URL||'https://api.ubill.dev'}/v1/sms/send`,{method:'POST',headers:{key:env.UBILL_API_KEY,'content-type':'application/json'},body:JSON.stringify({brandID:Number(env.UBILL_BRAND_ID||1),numbers:[cleanPhone(phone)],text,stopList:false,otp})});
  const data=await r.json().catch(()=>({})); if(!r.ok||Number(data.statusID)!==0) throw new Error(data.message||'UBILL_SEND_FAILED'); return data;
}
function keepzPublicKey(raw){
  const key=String(raw||'').replace(/\\n/g,'\n').trim();
  if(key.includes('BEGIN PUBLIC KEY')) return key;
  return crypto.createPublicKey({key:Buffer.from(key,'base64'),format:'der',type:'spki'});
}
function keepzPrivateKey(raw){
  const key=String(raw||'').replace(/\\n/g,'\n').trim();
  if(key.includes('BEGIN PRIVATE KEY')||key.includes('BEGIN RSA PRIVATE KEY')) return key;
  return crypto.createPrivateKey({key:Buffer.from(key,'base64'),format:'der',type:'pkcs8'});
}
function rsaPublicEncrypt(text,key){return crypto.publicEncrypt({key:keepzPublicKey(key),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(text)).toString('base64')}
function rsaPrivateDecrypt(b64,key){return crypto.privateDecrypt({key:keepzPrivateKey(key),padding:crypto.constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(b64,'base64')).toString()}
function aesEncrypt(payload){ const key=crypto.randomBytes(32), iv=crypto.randomBytes(16), c=crypto.createCipheriv('aes-256-cbc',key,iv); const encrypted=Buffer.concat([c.update(JSON.stringify(payload),'utf8'),c.final()]).toString('base64'); return {encrypted,key,iv}; }
function aesDecrypt(b64,key,iv){const d=crypto.createDecipheriv('aes-256-cbc',key,iv); return JSON.parse(Buffer.concat([d.update(Buffer.from(b64,'base64')),d.final()]).toString('utf8'));}
function keepzEncrypt(payload){ if(!env.KEEPZ_PUBLIC_KEY) throw new Error('KEEPZ_PUBLIC_KEY_MISSING'); const {encrypted,key,iv}=aesEncrypt(payload); const joined=`${key.toString('base64')}.${iv.toString('base64')}`; return {identifier:env.KEEPZ_IDENTIFIER||env.KEEPZ_INTEGRATOR_ID,encryptedData:encrypted,encryptedKeys:rsaPublicEncrypt(joined,env.KEEPZ_PUBLIC_KEY),aes:true}; }
function keepzDecrypt(resp){ if(!resp?.encryptedData) return resp; const joined=rsaPrivateDecrypt(resp.encryptedKeys,env.KEEPZ_PRIVATE_KEY); const [k,v]=joined.split('.'); return aesDecrypt(resp.encryptedData,Buffer.from(k,'base64'),Buffer.from(v,'base64')); }
async function keepzCreate(order){
  for(const k of ['KEEPZ_INTEGRATOR_ID','KEEPZ_RECEIVER_ID','KEEPZ_PUBLIC_KEY','KEEPZ_PRIVATE_KEY']) if(!env[k]) throw new Error(`${k}_MISSING`);
  const payload={amount:Number(order.total),receiverId:env.KEEPZ_RECEIVER_ID,receiverType:'BRANCH',integratorId:env.KEEPZ_INTEGRATOR_ID,integratorOrderId:order.keepzOrderId,currency:'GEL',language:'KA',callbackUri:`${env.PUBLIC_SITE_URL}/api/keepz-callback`,successRedirectUri:`${env.PUBLIC_SITE_URL}/?payment=success`,failRedirectUri:`${env.PUBLIC_SITE_URL}/?payment=failed`};
  const r=await fetch(`${env.KEEPZ_BASE_URL||'https://gateway.keepz.me'}/api/integrator/order`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(keepzEncrypt(payload))});
  const raw=await r.json().catch(()=>({})); if(!r.ok) throw new Error('KEEPZ_HTTP_'+r.status); return keepzDecrypt(raw);
}
function productPublic(d){const x=d.data(); return {id:d.id,...x};}

async function handler(event){
  const path=(event.path||'').replace(/^.*\/api\/?/,'').replace(/^\//,''); const method=event.httpMethod;
  try {
    if(path==='health') return ok({service:'MM STAR API',time:new Date().toISOString()});
    if(path==='catalog'&&method==='GET'){
      const [p,c,s]=await Promise.all([db.collection('products').where('active','==',true).get(),db.collection('categories').get(),db.collection('settings').doc('store').get()]);
      return ok({products:p.docs.map(productPublic),categories:c.docs.map(productPublic),settings:s.exists?s.data():{}});
    }
    if(path==='otp/send'&&method==='POST'){
      const {phone}=bodyOf(event); const p=cleanPhone(phone); if(!/^9955\d{8}$/.test(p)) return bad('INVALID_PHONE');
      const ref=db.collection('otpLogs').doc(hash(p)); const snap=await ref.get(); const now=Date.now(); if(snap.exists&&snap.data().resendAfter>now) return bad('WAIT_BEFORE_RESEND',429);
      const code=randomOtp(); await ubillSend(p,`MM STAR verification code: ${code}`,true);
      await ref.set({phoneHash:hash(p),otpHash:hash(code),expiresAt:now+5*60*1000,resendAfter:now+60*1000,attempts:0,createdAt:admin.firestore.FieldValue.serverTimestamp()}); return ok({sent:true,resendIn:60});
    }
    if(path==='otp/verify'&&method==='POST'){
      const {phone,code}=bodyOf(event); const p=cleanPhone(phone), ref=db.collection('otpLogs').doc(hash(p)), snap=await ref.get(); if(!snap.exists) return bad('OTP_NOT_FOUND'); const x=snap.data();
      if(Date.now()>x.expiresAt) return bad('OTP_EXPIRED'); if(x.attempts>=5) return bad('TOO_MANY_ATTEMPTS',429); if(hash(String(code))!==x.otpHash){await ref.update({attempts:admin.firestore.FieldValue.increment(1)}); return bad('OTP_INVALID');}
      const uid=`phone_${hash(p).slice(0,24)}`; let user; try{user=await admin.auth().getUser(uid)}catch{user=await admin.auth().createUser({uid,phoneNumber:'+'+p})}
      const token=await admin.auth().createCustomToken(uid,{phone:'+'+p}); await ref.delete(); return ok({token,isNew:!(await db.collection('customers').doc(uid).get()).exists});
    }
    if(path==='profile'&&method==='GET'){const u=await firebaseAuth(event), s=await db.collection('customers').doc(u.uid).get(); return ok({profile:s.exists?s.data():null});}
    if(path==='profile'&&method==='POST'){const u=await firebaseAuth(event), b=bodyOf(event); const allowed={firstName:b.firstName||'',lastName:b.lastName||'',email:b.email||'',address:b.address||'',phone:u.phone_number||b.phone||'',updatedAt:admin.firestore.FieldValue.serverTimestamp()}; await db.collection('customers').doc(u.uid).set({...allowed,createdAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true}); return ok({profile:allowed});}
    if(path==='orders'&&method==='GET'){const u=await firebaseAuth(event), q=await db.collection('orders').where('customerId','==',u.uid).orderBy('createdAt','desc').limit(100).get(); return ok({orders:q.docs.map(productPublic)});}
    if(path==='orders'&&method==='POST'){
      const u=await firebaseAuth(event), b=bodyOf(event); if(!Array.isArray(b.items)||!b.items.length) return bad('EMPTY_CART'); const profile=(await db.collection('customers').doc(u.uid).get()).data()||{};
      const refs=b.items.map(i=>db.collection('products').doc(String(i.id))); const snaps=await db.getAll(...refs); let total=0; const items=[];
      for(let n=0;n<snaps.length;n++){const s=snaps[n], req=b.items[n], p=s.data(); if(!p||!p.active) return bad('PRODUCT_NOT_AVAILABLE'); const qty=Math.max(1,Number(req.qty)||1); if(Number(p.stock||0)<qty) return bad(`OUT_OF_STOCK:${p.name}`); total+=Number(p.price)*qty; items.push({productId:s.id,code:p.code||'',name:p.name,price:Number(p.price),qty,total:Number(p.price)*qty});}
      const invoice=await nextInvoice('customer'), orderId=id(), ref=db.collection('orders').doc(orderId);
      await db.runTransaction(async tx=>{for(let n=0;n<snaps.length;n++){const fresh=await tx.get(refs[n]); const p=fresh.data(), qty=items[n].qty; if(Number(p.stock)<qty) throw new Error('OUT_OF_STOCK'); tx.update(refs[n],{stock:admin.firestore.FieldValue.increment(-qty),sales:admin.firestore.FieldValue.increment(qty)});} tx.set(ref,{invoice,customerId:u.uid,customer:{firstName:profile.firstName||'',lastName:profile.lastName||'',phone:u.phone_number||profile.phone||'',email:profile.email||'',address:b.address||profile.address||''},items,subtotal:total,deliveryFee:0,total,paymentMethod:b.paymentMethod||'invoice',paymentStatus:'UNPAID',deliveryMethod:b.deliveryMethod||'pickup',status:'ახალი',createdAt:admin.firestore.FieldValue.serverTimestamp(),keepzOrderId:orderId});});
      let payment=null; if(b.paymentMethod==='keepz'){payment=await keepzCreate({total,keepzOrderId:orderId}); await ref.update({keepz:payment,paymentStatus:'PENDING'});}
      return ok({orderId,invoice,total,payment});
    }
    if(path==='keepz-callback'&&method==='POST'){
      let payload=bodyOf(event); try{payload=keepzDecrypt(payload)}catch{} const oid=payload.integratorOrderId; if(oid){const ref=db.collection('orders').doc(oid), s=await ref.get(); if(s.exists){const success=payload.status==='SUCCESS'; await ref.update({paymentStatus:success?'PAID':'FAILED',paymentCallback:payload,status:success?'დადასტურებული':s.data().status});}} return json(200,{received:true});
    }
    if(path.startsWith('invoice/')&&method==='GET'){
      const invoice=decodeURIComponent(path.split('/')[1]); let snap=await db.collection('orders').where('invoice','==',invoice).limit(1).get(); let isDealer=false; if(snap.empty){snap=await db.collection('dealerOrders').where('invoice','==',invoice).limit(1).get();isDealer=true;} if(snap.empty) return bad('NOT_FOUND',404); const o=snap.docs[0].data();
      const doc=new PDFDocument({margin:45,size:'A4'}); const chunks=[]; doc.on('data',c=>chunks.push(c)); const done=new Promise(r=>doc.on('end',r)); doc.fontSize(22).text('MM STAR',{align:'center'}); doc.moveDown(.3).fontSize(12).text(isDealer?'DEALER INVOICE':'CUSTOMER INVOICE',{align:'center'}); doc.moveDown(); doc.fontSize(10).text(`Invoice: ${o.invoice}`).text(`Date: ${new Date().toISOString().slice(0,10)}`).text(`Status: ${o.status}`).moveDown(); if(isDealer&&o.dealer) doc.text(`Dealer: ${o.dealer.name||''}`).text(`ID: ${o.dealer.taxId||''}`).text(`Phone: ${o.dealer.phone||''}`).moveDown(); doc.text('Code                 Product                            Qty      Price      Total'); doc.moveTo(45,doc.y+3).lineTo(550,doc.y+3).stroke(); doc.moveDown(.5); for(const i of o.items||[]) doc.text(`${String(i.code||'').slice(0,18).padEnd(20)} ${String(i.name||'').replace(/[^\x20-\x7E]/g,'?').slice(0,30).padEnd(32)} ${String(i.qty).padEnd(8)} ${Number(i.price).toFixed(2).padEnd(10)} ${Number(i.total).toFixed(2)}`); doc.moveDown().fontSize(13).text(`TOTAL: ${Number(o.total||0).toFixed(2)} GEL`,{align:'right'}); doc.end(); await done; return {statusCode:200,isBase64Encoded:true,headers:{'content-type':'application/pdf','content-disposition':`inline; filename="${invoice}.pdf"`},body:Buffer.concat(chunks).toString('base64')};
    }
    if(path==='admin/login'&&method==='POST'){const b=bodyOf(event); if(b.username===env.ADMIN_USERNAME&&b.password===env.ADMIN_PASSWORD) return ok({token:await signRole({role:'admin',sub:'admin'})}); return bad('INVALID_CREDENTIALS',401);}
    if(path==='admin/dashboard'&&method==='GET'){await roleAuth(event,['admin']); const [p,c,u,d,o,doq]=await Promise.all(['products','categories','customers','dealers','orders','dealerOrders'].map(x=>db.collection(x).get())); const sales=o.docs.reduce((a,s)=>a+(s.data().paymentStatus==='PAID'?Number(s.data().total||0):0),0); return ok({stats:{products:p.size,categories:c.size,customers:u.size,dealers:d.size,orders:o.size,dealerOrders:doq.size,sales}});}
    if(path==='admin/products'&&method==='GET'){await roleAuth(event,['admin']); const q=await db.collection('products').orderBy('name').get();return ok({products:q.docs.map(productPublic)});}
    if(path==='admin/products'&&method==='POST'){await roleAuth(event,['admin']); const b=bodyOf(event), ref=b.id?db.collection('products').doc(b.id):db.collection('products').doc(); const data={code:b.code||'',name:b.name||'',description:b.description||'',categoryId:b.categoryId||'',image:b.image||'',price:Number(b.price||0),dealerPrice:Number(b.dealerPrice||0),stock:Number(b.stock||0),active:b.active!==false,isNew:!!b.isNew,updatedAt:admin.firestore.FieldValue.serverTimestamp()}; await ref.set(data,{merge:true});return ok({id:ref.id});}
    if(path.startsWith('admin/products/')&&method==='DELETE'){await roleAuth(event,['admin']);await db.collection('products').doc(path.split('/')[2]).delete();return ok();}
    if(path==='admin/categories'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('categories').orderBy('name').get();return ok({categories:q.docs.map(productPublic)});}
    if(path==='admin/categories'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),ref=b.id?db.collection('categories').doc(b.id):db.collection('categories').doc();await ref.set({name:b.name||'',emoji:b.emoji||'',image:b.image||'',updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});return ok({id:ref.id});}
    if(path==='admin/orders'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('orders').orderBy('createdAt','desc').limit(200).get();return ok({orders:q.docs.map(productPublic)});}
    if(path==='admin/dealer-orders'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('dealerOrders').orderBy('createdAt','desc').limit(200).get();return ok({orders:q.docs.map(productPublic)});}
    if(path==='admin/order-status'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event);const coll=b.dealer?'dealerOrders':'orders';await db.collection(coll).doc(b.id).update({status:b.status,updatedAt:admin.firestore.FieldValue.serverTimestamp()});return ok();}
    if(path==='admin/dealers'&&method==='GET'){await roleAuth(event,['admin']);const q=await db.collection('dealers').get();return ok({dealers:q.docs.map(d=>({id:d.id,...d.data(),passwordHash:undefined}))});}
    if(path==='admin/dealers'&&method==='POST'){await roleAuth(event,['admin']);const b=bodyOf(event),ref=b.id?db.collection('dealers').doc(b.id):db.collection('dealers').doc();const data={companyType:b.companyType||'შპს',name:b.name||'',taxId:b.taxId||'',address:b.address||'',phone:b.phone||'',email:b.email||'',username:b.username||'',categories:b.categories||[],active:b.active!==false,updatedAt:admin.firestore.FieldValue.serverTimestamp()};if(b.password)data.passwordHash=hash(b.password);await ref.set(data,{merge:true});return ok({id:ref.id});}
    if(path==='dealer/login'&&method==='POST'){const b=bodyOf(event),q=await db.collection('dealers').where('username','==',b.username).limit(1).get();if(q.empty) return bad('INVALID_CREDENTIALS',401);const d=q.docs[0];if(!d.data().active||d.data().passwordHash!==hash(b.password))return bad('INVALID_CREDENTIALS',401);return ok({token:await signRole({role:'dealer',sub:d.id},12),dealer:{id:d.id,name:d.data().name}});}
    if(path==='dealer/catalog'&&method==='GET'){const a=await roleAuth(event,['dealer']);const ds=await db.collection('dealers').doc(a.sub).get(), d=ds.data();const q=await db.collection('products').where('active','==',true).get();const products=q.docs.map(productPublic).filter(p=>(d.categories||[]).length===0||(d.categories||[]).includes(p.categoryId));return ok({products:products.map(p=>({...p,price:p.dealerPrice,retailPrice:p.price,dealerPrice:p.dealerPrice,difference:Number(p.price)-Number(p.dealerPrice)})),dealer:{name:d.name}});}
    if(path==='dealer/orders'&&method==='GET'){const a=await roleAuth(event,['dealer']);const q=await db.collection('dealerOrders').where('dealerId','==',a.sub).orderBy('createdAt','desc').get();return ok({orders:q.docs.map(productPublic)});}
    if(path==='dealer/orders'&&method==='POST'){const a=await roleAuth(event,['dealer']),b=bodyOf(event),dealer=(await db.collection('dealers').doc(a.sub).get()).data();if(!b.items?.length)return bad('EMPTY_CART');let total=0;const items=[];for(const it of b.items){const s=await db.collection('products').doc(it.id).get(),p=s.data();if(!p||!p.active) return bad('PRODUCT_NOT_AVAILABLE');if((dealer.categories||[]).length&&!(dealer.categories||[]).includes(p.categoryId)) return bad('CATEGORY_NOT_ALLOWED');const qty=Math.max(1,Number(it.qty)||1);if(Number(p.stock)<qty)return bad('OUT_OF_STOCK');const price=Number(p.dealerPrice);total+=price*qty;items.push({productId:s.id,code:p.code||'',name:p.name,qty,price,total:price*qty});}const invoice=await nextInvoice('dealer'),ref=db.collection('dealerOrders').doc();await db.runTransaction(async tx=>{for(const i of items){const pr=db.collection('products').doc(i.productId),s=await tx.get(pr);if(Number(s.data().stock)<i.qty)throw new Error('OUT_OF_STOCK');tx.update(pr,{stock:admin.firestore.FieldValue.increment(-i.qty),sales:admin.firestore.FieldValue.increment(i.qty)});}tx.set(ref,{invoice,dealerId:a.sub,dealer:{name:dealer.name,companyType:dealer.companyType,taxId:dealer.taxId,address:dealer.address,phone:dealer.phone},items,total,paymentMethod:b.paymentMethod||'invoice',status:'ახალი',createdAt:admin.firestore.FieldValue.serverTimestamp()});});return ok({id:ref.id,invoice,total});}

    if(path.startsWith('admin/categories/')&&method==='DELETE'){
      await roleAuth(event,['admin']);
      const categoryId=path.split('/')[2];
      const used=await db.collection('products').where('categoryId','==',categoryId).limit(1).get();
      if(!used.empty) return bad('CATEGORY_HAS_PRODUCTS',409);
      await db.collection('categories').doc(categoryId).delete();
      return ok();
    }
    if(path.startsWith('admin/dealers/')&&method==='DELETE'){
      await roleAuth(event,['admin']);
      const dealerId=path.split('/')[2];
      await db.collection('dealers').doc(dealerId).delete();
      return ok();
    }
    if(path==='admin/customers'&&method==='GET'){
      await roleAuth(event,['admin']);
      const q=await db.collection('customers').get();
      const rows=[];
      for(const d of q.docs){
        const oq=await db.collection('orders').where('customerId','==',d.id).get();
        const total=oq.docs.reduce((a,s)=>a+Number(s.data().total||0),0);
        rows.push({id:d.id,...d.data(),ordersCount:oq.size,totalSpent:total});
      }
      return ok({customers:rows});
    }
    if(path==='admin/integrations'&&method==='GET'){await roleAuth(event,['admin']);return ok({integrations:{ubill:{configured:!!env.UBILL_API_KEY,brandId:env.UBILL_BRAND_ID||'1'},keepz:{configured:!!(env.KEEPZ_INTEGRATOR_ID&&env.KEEPZ_RECEIVER_ID&&env.KEEPZ_PUBLIC_KEY&&env.KEEPZ_PRIVATE_KEY),receiverId:env.KEEPZ_RECEIVER_ID||''},onway:{configured:!!(env.ONWAY_API_KEY&&env.ONWAY_SECRET),apiUrl:env.ONWAY_API_URL||''}}});}
    return bad('NOT_FOUND',404);
  } catch(e){console.error(e); const m=e?.message||'SERVER_ERROR'; if(m==='AUTH_REQUIRED')return bad(m,401); if(m==='FORBIDDEN')return bad(m,403); return bad(m,500);}
}
export default async (request, context) => {
  const url = new URL(request.url);
  const headers = Object.fromEntries(request.headers.entries());
  let body = '';
  if (!['GET','HEAD'].includes(request.method)) {
    body = await request.text();
  }

  const event = {
    path: url.pathname,
    rawUrl: request.url,
    httpMethod: request.method,
    headers,
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    body
  };

  const result = await handler(event);

  if (result instanceof Response) return result;

  const responseHeaders = new Headers(result.headers || {});
  if (result.isBase64Encoded) {
    const bytes = Uint8Array.from(Buffer.from(result.body || '', 'base64'));
    return new Response(bytes, {
      status: result.statusCode || 200,
      headers: responseHeaders
    });
  }

  return new Response(result.body ?? '', {
    status: result.statusCode || 200,
    headers: responseHeaders
  });
};