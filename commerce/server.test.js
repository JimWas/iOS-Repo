import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createApp} from './server.js';

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jimwas-commerce-'));
let created;
let checkoutCount=0;
const fakeStripe={
  checkout:{sessions:{create:async (input)=>{created=input;checkoutCount++;return {id:checkoutCount===1?'cs_test_recorder':'cs_test_web',url:'https://checkout.stripe.com/test'}}}},
  webhooks:{constructEvent:(raw,signature)=>{if(signature!=='valid')throw new Error('bad signature');return JSON.parse(raw.toString())}}
};
const licenseKeys=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
let testTime=Date.now();
const app=createApp({licensePrivateKey:licenseKeys.privateKey,clock:()=>testTime,baseUrl:'http://127.0.0.1:3000',stripeKey:'sk_test_fake',priceId:'price_test_recorder',webhookSecret:'whsec_fake',authSecret:'a'.repeat(40),dbPath:path.join(tmp,'db.sqlite'),stripe:fakeStripe});
const server=http.createServer(app.handler);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const call=(url,options={})=>fetch(base+url,{redirect:'manual',...options});
const post=(url,body)=>call(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

const lease=async(device_id,start_trial,activation_code)=>{
  const response=await post('/api/license/lease',{device_id,start_trial,...(activation_code?{activation_code}:{})});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.ok(crypto.verify('sha256',Buffer.from(body.payload),licenseKeys.publicKey,Buffer.from(body.signature,'base64')));
  return JSON.parse(body.payload);
};

test('trial date persists for the same device',async()=>{
  const device='A1B2C3D4E5F60718293A4B5C6D7E8F90';
  assert.equal((await lease(device,false)).kind,'not_started');
  const first=await lease(device,true);
  assert.equal(first.kind,'trial');
  assert.equal(first.trial_ends_at-first.issued_at,7*86400);
  const reinstalled=await lease(device,true);
  assert.equal(reinstalled.trial_ends_at,first.trial_ends_at);
  testTime+=8*86400*1000;
  const expired=await lease(device,true);
  assert.equal(expired.kind,'expired');
  assert.equal(expired.trial_ends_at,first.trial_ends_at);
});

test('paid package requires verified purchase and one-time download URL',async()=>{
  assert.equal((await call('/packages')).status,200);
  const productPage=await call('/packages/com.jimwas.recorder');
  assert.equal(productPage.status,200);
  assert.match(await productPage.text(),/Buy with Stripe/);
  const index=await call('/Packages');
  const packages=await index.text();
  assert.match(packages,/Tag: cydia::commercial/);
  assert.equal((await call('/private/com.jimwas.recorder_1.9.5_iphoneos-arm64.deb')).status,403);
  const signIn=await call('/authenticate',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'udid=0123456789abcdef0123456789abcdef'});
  assert.equal(signIn.status,303);
  const callback=new URL(signIn.headers.get('location'));
  const token=callback.searchParams.get('token');
  const paymentSecret=callback.searchParams.get('payment_secret');
  assert.equal((await post('/package/com.jimwas.recorder/authorize_download',{token})).status,403);
  const purchase=await post('/package/com.jimwas.recorder/purchase',{token,payment_secret:paymentSecret});
  const action=await purchase.json();
  assert.equal(action.status,1);
  const checkout=await fetch(action.url.replace('127.0.0.1:3000',`127.0.0.1:${server.address().port}`),{redirect:'manual'});
  assert.equal(checkout.status,303);
  assert.equal(checkout.headers.get('location'),'https://checkout.stripe.com/test');
  assert.equal(created.line_items[0].price,'price_test_recorder');
  const webhook={type:'checkout.session.completed',data:{object:{id:'cs_test_recorder',payment_status:'paid',amount_total:3499,currency:'usd',payment_intent:'pi_test_1',metadata:{package_id:'com.jimwas.recorder',order_id:created.client_reference_id},customer_details:{email:'buyer@example.com'}}}};
  const invalid=await call('/stripe/webhook',{method:'POST',headers:{'stripe-signature':'bad'},body:JSON.stringify(webhook)});
  assert.equal(invalid.status,400);
  assert.equal((await post('/package/com.jimwas.recorder/authorize_download',{token})).status,403);
  const verified=await call('/stripe/webhook',{method:'POST',headers:{'stripe-signature':'valid'},body:JSON.stringify(webhook)});
  assert.equal(verified.status,200);
  assert.equal((await lease('0123456789abcdef0123456789abcdef',false)).kind,'paid');
  const authorization=await post('/package/com.jimwas.recorder/authorize_download',{token});
  const downloadUrl=(await authorization.json()).url.replace('127.0.0.1:3000',`127.0.0.1:${server.address().port}`);
  const head=await fetch(downloadUrl,{method:'HEAD'});assert.equal(head.status,200);
  const download=await fetch(downloadUrl);assert.equal(download.status,200);
  const bytes=Buffer.from(await download.arrayBuffer());
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'16ef2cadf4a1c9f772b8262fe3ef4f78c39185a258ffd6243d994d4604133f0c');
  assert.equal((await fetch(downloadUrl)).status,403);
  const refund={type:'charge.refunded',data:{object:{refunded:true,payment_intent:'pi_test_1'}}};
  await call('/stripe/webhook',{method:'POST',headers:{'stripe-signature':'valid'},body:JSON.stringify(refund)});
  assert.equal((await post('/package/com.jimwas.recorder/authorize_download',{token})).status,403);
});

test('website purchase code binds a paid order to one device',async()=>{
  const buy=await call('/buy/com.jimwas.recorder',{method:'POST',headers:{origin:'http://127.0.0.1:3000'}});
  assert.equal(buy.status,303);
  const orderId=created.client_reference_id;
  const event={type:'checkout.session.completed',data:{object:{id:'cs_test_web',payment_status:'paid',amount_total:3499,currency:'usd',payment_intent:'pi_test_web',metadata:{package_id:'com.jimwas.recorder',order_id:orderId},customer_details:{email:'buyer@example.com'}}}};
  await call('/stripe/webhook',{method:'POST',headers:{'stripe-signature':'valid'},body:JSON.stringify(event)});
  const success=await call('/checkout/success?session_id=cs_test_web');
  const html=await success.text();
  const code=html.match(/<code>([0-9A-F]{24})<\/code>/)?.[1];
  assert.ok(code);
  const claim=await call('/authenticate',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({udid:'1234567890abcdef1234567890abcdef',code})});
  assert.equal(claim.status,303);
  const token=new URL(claim.headers.get('location')).searchParams.get('token');
  assert.equal((await lease('1234567890abcdef1234567890abcdef',false,code)).kind,'paid');
  assert.equal((await post('/api/license/lease',{device_id:'fedcba0987654321fedcba0987654321',start_trial:false,activation_code:code})).status,403);
  assert.equal((await post('/package/com.jimwas.recorder/info',{token})).status,200);
  assert.equal((await(await post('/package/com.jimwas.recorder/info',{token})).json()).purchased,true);
  const second=await call('/authenticate',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({udid:'fedcba0987654321fedcba0987654321',code})});
  assert.equal(second.status,403);
});

test.after(async()=>{await new Promise(resolve=>server.close(resolve));app.close();fs.rmSync(tmp,{recursive:true,force:true})});
