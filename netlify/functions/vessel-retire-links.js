'use strict';
// One-time cleanup: deactivate Vessel Kitchen's two replaced payment links.
// Fixed IDs and no client input, so this can only ever switch off these two.
// The live $400 link is checked, never changed. Removed after use.
const RETIRE=[
 {id:'plink_1UfMkPBKPpxdHQEl2FpBbblN',label:'$200 deposit (replaced by full payment)'},
 {id:'plink_1UfPvpBKPpxdHQElvAJeRPZX',label:'$400 labeled Deposit (replaced by the Payment link)'}
];
const KEEP='plink_1UfPxHBKPpxdHQEl5b0BNoT1';
const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
async function stripe(path,key,body){
 const r=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/x-www-form-urlencoded'},body:body?new URLSearchParams(body):undefined});
 let j={};try{j=await r.json();}catch(_){}
 return {ok:r.ok,active:j.active,url:j.url,code:j.error&&j.error.code};
}
exports.handler=async event=>{
 if(event.httpMethod!=='POST')return{statusCode:405,headers,body:JSON.stringify({message:'POST only'})};
 const key=process.env.STRIPE_SECRET_KEY;
 if(!key)return{statusCode:500,headers,body:JSON.stringify({message:'Stripe not configured'})};
 const retired=[];
 for(const l of RETIRE){if(l.id===KEEP)continue;try{retired.push(Object.assign({id:l.id,label:l.label},await stripe('payment_links/'+l.id,key,{active:'false'})));}catch(e){retired.push({id:l.id,label:l.label,ok:false});}}
 let kept;try{kept=Object.assign({id:KEEP},await stripe('payment_links/'+KEEP,key));}catch(e){kept={id:KEEP,ok:false};}
 return{statusCode:200,headers,body:JSON.stringify({retired,kept})};
};
