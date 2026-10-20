// Netlify Scheduled Function. Runs only after FINA_ENABLED=true and credentials are set.
import admin from 'firebase-admin';
import { finaConfig, synchronizeFina } from './fina-core.mjs';

export const config = {schedule:'*/10 * * * *'};
export default async () => {
  const cfg=finaConfig();
  if(!cfg.enabled||process.env.FINA_AUTO_SYNC!=='true')return new Response('FINA_AUTO_SYNC_DISABLED',{status:200});
  if(!admin.apps.length){
    admin.initializeApp({credential:admin.credential.cert({
      projectId:process.env.FIREBASE_PROJECT_ID,
      clientEmail:process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:(process.env.FIREBASE_PRIVATE_KEY||'').replace(/\\n/g,'\n')
    })});
  }
  try{
    const result=await synchronizeFina(admin.firestore(),admin,{dryRun:false,fields:'stock',cfg});
    console.info('FINA_SCHEDULED_SYNC',JSON.stringify(result.stats));
    return new Response(JSON.stringify({ok:true,stats:result.stats}),{headers:{'content-type':'application/json'}});
  }catch(e){
    console.error('FINA_SCHEDULED_SYNC_FAILED',e.message);
    return new Response(JSON.stringify({ok:false,error:e.message}),{status:500,headers:{'content-type':'application/json'}});
  }
};
