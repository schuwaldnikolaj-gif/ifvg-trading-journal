import { makeHandler } from './handler.mjs';
const env=(name:string)=>Deno.env.get(name)||'';
async function reserve(userId:string){
 const key=env('SUPABASE_SERVICE_ROLE_KEY');
 const response=await fetch(env('SUPABASE_URL')+'/rest/v1/rpc/reserve_chart_coach',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({p_user:userId}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('Quota unavailable');return await response.json()===true;
}
// Custom authentication in the handler validates each POST with Supabase Auth.
// GET only reports readiness; it returns no secrets or user data.
Deno.serve(makeHandler({env,reserve}));
