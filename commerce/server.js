import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import Stripe from 'stripe';

const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'storefront', 'out');
const REPO = path.join(ROOT, 'repo', 'public');
const PRIVATE = path.join(ROOT, '.private', 'packages');
const PACKAGE_ID = 'com.jimwas.recorder';
const PACKAGE_FILE = 'com.jimwas.recorder_1.9.5_iphoneos-arm64.deb';
const EXPECTED_HASH = '16ef2cadf4a1c9f772b8262fe3ef4f78c39185a258ffd6243d994d4604133f0c';
const PRICE_CENTS = 3499;
const VCAM_ID = 'com.yourcompany.vcam';
const VCAM_FILE = 'com.yourcompany.vcam_0.1.1_iphoneos-arm64.deb';
const VCAM_HASH = 'c54ee49436cdd40c0fc3f6277c1cff14749bdec0f79ed2595ab528efd96c0116';
const PRODUCTS = {
  [PACKAGE_ID]: {name:'JimWas Recorder',file:PACKAGE_FILE,hash:EXPECTED_HASH,priceCents:PRICE_CENTS},
  [VCAM_ID]: {name:'Instagram Virtual Cam (IG VCAM) Supporter Edition',file:VCAM_FILE,hash:VCAM_HASH,priceCents:3499},
};
const MAX_BODY = 1024 * 1024;
const secretHash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
const esc = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createApp(config) {
  const { baseUrl, stripeKey, priceId, priceIds = {}, webhookSecret, authSecret, dbPath, licensePrivateKey, licenseKeyPath, stripe = new Stripe(stripeKey, {apiVersion:'2026-08-26.dahlia'}) } = config;
  const priceFor = (packageId) => priceIds[packageId] ?? (packageId===PACKAGE_ID ? priceId : undefined);
  const signingKey = licensePrivateKey ?? (licenseKeyPath && fs.existsSync(licenseKeyPath) ? fs.readFileSync(licenseKeyPath) : null);
  const origin = new URL(baseUrl).origin;
  fs.mkdirSync(path.dirname(dbPath), {recursive:true});
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, payment_hash TEXT NOT NULL, udid_hash TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, session_id TEXT UNIQUE, package_id TEXT NOT NULL, status TEXT NOT NULL, token_id TEXT, udid_hash TEXT, payment_intent TEXT, customer_email TEXT, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS intents(id_hash TEXT PRIMARY KEY, token_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tickets(id_hash TEXT PRIMARY KEY, token_id TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS orders_device ON orders(udid_hash, status);
    CREATE TABLE IF NOT EXISTS device_trials(udid_hash TEXT PRIMARY KEY, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(intents)').all().some(column=>column.name==='package_id')) db.exec(`ALTER TABLE intents ADD COLUMN package_id TEXT NOT NULL DEFAULT '${PACKAGE_ID}'`);
  if(!db.prepare('PRAGMA table_info(tickets)').all().some(column=>column.name==='package_id')) db.exec(`ALTER TABLE tickets ADD COLUMN package_id TEXT NOT NULL DEFAULT '${PACKAGE_ID}'`);
  const now = () => Math.floor((config.clock ?? Date.now)()/1000);
  const udidHash = (udid) => crypto.createHmac('sha256', authSecret).update(udid).digest('hex');
  const claimCode = (session) => crypto.createHmac('sha256', authSecret).update(`claim:${session}`).digest('hex').slice(0,24).toUpperCase();
  const orderForCode = (code) => {
    const orders = db.prepare("SELECT * FROM orders WHERE status='paid' AND token_id IS NULL AND session_id IS NOT NULL").all();
    return orders.find(order => crypto.timingSafeEqual(Buffer.from(claimCode(order.session_id)), Buffer.from(code))) ?? null;
  };
  const reply = (res, status, body, type='text/plain; charset=utf-8', headers={}) => {
    res.writeHead(status, {'content-type':type,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store',...headers}); res.end(body);
  };
  const json = (res, status, data) => reply(res,status,JSON.stringify(data),'application/json; charset=utf-8');
  const page = (res, status, title, body) => reply(res,status,`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>body{font:16px Arial,sans-serif;background:#0e0f15;color:#f7f8f4;max-width:620px;margin:8vh auto;padding:24px;line-height:1.6}a{color:#bff36d}button{border:0;background:#bff36d;color:#111;padding:14px 20px;border-radius:10px;font-weight:700;cursor:pointer}input{padding:12px;background:#222;color:#fff;border:1px solid #555;border-radius:8px}code{background:#282b2e;padding:9px;border-radius:7px}</style><h1>${esc(title)}</h1>${body}</html>`,'text/html; charset=utf-8');
  const redirect = (res, url) => {res.writeHead(303,{'location':url,'cache-control':'no-store','referrer-policy':'no-referrer'});res.end();};
  const readBody = async (req) => {
    const chunks=[]; let size=0;
    for await (const chunk of req) {size+=chunk.length;if(size>MAX_BODY) throw new Error('Body too large');chunks.push(chunk)}
    return Buffer.concat(chunks);
  };
  const readJson = async (req) => JSON.parse((await readBody(req)).toString('utf8'));
  const bareToken = (value) => typeof value === 'string' ? value.replace(/^BEARER\s+/i,'').trim() : '';
  const getToken = (value) => {
    const token=bareToken(value);
    return token && db.prepare('SELECT * FROM tokens WHERE token_hash=? AND revoked=0').get(secretHash(token));
  };
  const paidOrderForCode = (code) => {
    const orders = db.prepare("SELECT * FROM orders WHERE package_id=? AND status='paid' AND session_id IS NOT NULL").all(PACKAGE_ID);
    return orders.find(order => crypto.timingSafeEqual(Buffer.from(claimCode(order.session_id)), Buffer.from(code))) ?? null;
  };
  const licenseAudit = (status, kind, deviceId, startTrial, codeSupplied) => {
    const device = deviceId ? udidHash(deviceId.toUpperCase()).slice(0,12) : null;
    (config.audit ?? console.log)(JSON.stringify({event:'license_lease',time:new Date().toISOString(),status,kind,device,start_trial:startTrial,code_supplied:codeSupplied}));
  };
  const signedLease = (res, deviceId, kind, trialEndsAt=null, startTrial=false, codeSupplied=false) => {
    const issuedAt=now();
    const validUntil=kind==='paid' ? issuedAt+7*86400 : kind==='trial' ? Math.min(issuedAt+7*86400,trialEndsAt) : issuedAt+300;
    const payload=JSON.stringify({version:1,package_id:PACKAGE_ID,device_hash:secretHash(deviceId.toUpperCase()),kind,issued_at:issuedAt,valid_until:validUntil,trial_ends_at:trialEndsAt});
    const signature=crypto.sign('sha256',Buffer.from(payload),signingKey).toString('base64');
    licenseAudit(200,kind,deviceId,startTrial,codeSupplied);
    return json(res,200,{payload,signature});
  };
  const owns = (token,packageId=PACKAGE_ID) => !!db.prepare("SELECT 1 FROM orders WHERE package_id=? AND status='paid' AND udid_hash=? LIMIT 1").get(packageId,token.udid_hash);
  const sendFile = (res, file, type, downloadName=null) => {
    const st=fs.statSync(file);res.writeHead(200,{'content-type':type,'content-length':st.size,'x-content-type-options':'nosniff','cache-control':'no-store',...(downloadName?{'content-disposition':`attachment; filename="${downloadName}"`}:{})});fs.createReadStream(file).pipe(res);
  };
  const beginCheckout = async (res, packageId, token=null) => {
    const product=PRODUCTS[packageId];
    if(!product||!priceFor(packageId)) return json(res,503,{error:'Checkout unavailable'});
    const id=crypto.randomUUID();
    db.prepare('INSERT INTO orders(id,package_id,status,token_id,udid_hash,created_at) VALUES(?,?,?,?,?,?)').run(id,packageId,'pending',token?.id??null,token?.udid_hash??null,now());
    const letters = [...crypto.randomBytes(8)].map(n=>String.fromCharCode(97+n%26)).join('');
    const session=await stripe.checkout.sessions.create({mode:'payment',line_items:[{price:priceFor(packageId),quantity:1}],client_reference_id:id,metadata:{order_id:id,package_id:packageId},success_url:`${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${origin}/packages/${packageId}/`,integration_identifier:`jimwas-repo-${letters}`});
    db.prepare('UPDATE orders SET session_id=? WHERE id=?').run(session.id,id);
    redirect(res,session.url);
  };
  const handler = async (req,res) => {
    const url=new URL(req.url,origin);const pathname=decodeURIComponent(url.pathname);
    try {
      if(pathname==='/healthz' && req.method==='GET')return json(res,200,{ok:true});
      if(pathname==='/stripe/webhook' && req.method==='POST') {
        const raw=await readBody(req);let event;
        try {event=stripe.webhooks.constructEvent(raw,req.headers['stripe-signature'],webhookSecret)} catch {return reply(res,400,'Invalid webhook signature')}
        if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)) {
          const session=event.data.object;
          const product=PRODUCTS[session.metadata?.package_id];
          if(product && session.payment_status==='paid' && session.amount_total===product.priceCents && session.currency==='usd') db.prepare("UPDATE orders SET status='paid',payment_intent=?,customer_email=? WHERE id=? AND session_id=? AND package_id=? AND status IN ('pending','paid')").run(session.payment_intent??null,session.customer_details?.email??null,session.metadata.order_id,session.id,session.metadata.package_id);
        } else if(event.type==='checkout.session.async_payment_failed') {
          db.prepare("UPDATE orders SET status='failed' WHERE session_id=? AND status='pending'").run(event.data.object.id);
        } else if(event.type==='charge.refunded' && event.data.object.refunded) {
          db.prepare("UPDATE orders SET status='refunded' WHERE payment_intent=?").run(event.data.object.payment_intent);
        }
        return json(res,200,{received:true});
      }
      if(pathname==='/api/license/lease' && req.method==='POST') {
        if(!signingKey){licenseAudit(503,'unavailable',null,false,false);return json(res,503,{error:'License service unavailable'});}
        const body=await readJson(req);
        const deviceId=body.device_id;
        if(typeof deviceId!=='string'||!/^[A-Za-z0-9-]{8,128}$/.test(deviceId)||typeof body.start_trial!=='boolean'){licenseAudit(400,'invalid_request',null,false,false);return json(res,400,{error:'Invalid device request'});}
        const device=udidHash(deviceId.toUpperCase());
        const aliases=[device,udidHash(deviceId.toLowerCase()),udidHash(deviceId)];
        const code=typeof body.activation_code==='string'?body.activation_code.trim().toUpperCase():'';
        if(code) {
          if(!/^[0-9A-F]{24}$/.test(code)){licenseAudit(400,'invalid_code',deviceId,body.start_trial,true);return json(res,400,{error:'Invalid purchase code'});}
          const order=paidOrderForCode(code);
          if(!order||order.udid_hash&&!aliases.includes(order.udid_hash)){licenseAudit(403,'code_denied',deviceId,body.start_trial,true);return json(res,403,{error:'Purchase code unavailable for this device'});}
          db.prepare('UPDATE orders SET udid_hash=? WHERE id=? AND (udid_hash IS NULL OR udid_hash=?)').run(device,order.id,device);
        }
        const paid=db.prepare("SELECT 1 FROM orders WHERE package_id=? AND status='paid' AND udid_hash IN (?,?,?) LIMIT 1").get(PACKAGE_ID,...aliases);
        if(paid)return signedLease(res,deviceId,'paid',null,body.start_trial,!!code);
        if(body.start_trial)db.prepare('INSERT OR IGNORE INTO device_trials(udid_hash,started_at,expires_at) VALUES(?,?,?)').run(device,now(),now()+7*86400);
        const trial=db.prepare('SELECT expires_at FROM device_trials WHERE udid_hash=?').get(device);
        return signedLease(res,deviceId,trial&&trial.expires_at>now()?'trial':trial?'expired':'not_started',trial?.expires_at??null,body.start_trial,!!code);
      }
      if(pathname==='/payment_endpoint' && req.method==='GET') return reply(res,200,origin+'\n');
      if(pathname==='/info' && req.method==='GET') return json(res,200,{name:'JimWas Repo',icon:`${origin}/images/jimwas-recorder-icon.png`,description:'Independent iOS tweaks',authentication_banner:{message:'Sign in to buy or restore your paid tweaks.',button:'Sign in'}});
      if(pathname==='/authenticate' && req.method==='GET') {
        const udid=url.searchParams.get('udid')??'';const model=url.searchParams.get('model')??'';
        if(!/^[A-Za-z0-9-]{8,128}$/.test(udid)) return page(res,400,'Device information missing','<p>Open this page from Sileo.</p>');
        return page(res,200,'Connect JimWas Repo',`<p>Already bought JimWas Recorder on the website? Enter your purchase code. New buyers can continue without one.</p><form method="post" action="/authenticate"><input type="hidden" name="udid" value="${esc(udid)}"><input type="hidden" name="model" value="${esc(model)}"><label>Purchase code (optional)<br><input name="code" autocomplete="off"></label><p><button type="submit">Continue to Sileo</button></p></form>`);
      }
      if(pathname==='/authenticate' && req.method==='POST') {
        const form=new URLSearchParams((await readBody(req)).toString('utf8'));const udid=form.get('udid')??'';const code=(form.get('code')??'').trim().toUpperCase();
        if(!/^[A-Za-z0-9-]{8,128}$/.test(udid)) return page(res,400,'Invalid device','<p>Open sign-in from Sileo.</p>');
        const device=udidHash(udid);
        if(code) {if(!/^[0-9A-F]{24}$/.test(code)) return page(res,400,'Invalid code','<p>Check the purchase code and try again.</p>');const order=orderForCode(code);if(!order||order.udid_hash&&order.udid_hash!==device) return page(res,403,'Code unavailable','<p>This code is invalid or already linked to another device.</p>');db.prepare('UPDATE orders SET udid_hash=? WHERE id=? AND (udid_hash IS NULL OR udid_hash=?)').run(device,order.id,device)}
        const token=randomToken(),paymentSecret=randomToken(),id=crypto.randomUUID();
        db.prepare('INSERT INTO tokens(id,token_hash,payment_hash,udid_hash,created_at) VALUES(?,?,?,?,?)').run(id,secretHash(token),secretHash(paymentSecret),device,now());
        return redirect(res,`sileo://authentication_success?token=${encodeURIComponent(`BEARER ${token}`)}&payment_secret=${encodeURIComponent(paymentSecret)}`);
      }
      if(pathname==='/user_info' && req.method==='POST') {const body=await readJson(req);const token=getToken(body.token);if(!token)return json(res,401,{error:'Sign in again',invalidate:true});const orders=db.prepare("SELECT package_id,customer_email FROM orders WHERE status='paid' AND udid_hash=? ORDER BY created_at DESC").all(token.udid_hash);return json(res,200,{items:[...new Set(orders.map(order=>order.package_id))],user:{name:'JimWas Repo customer',email:orders.find(order=>order.customer_email)?.customer_email??''}})}
      if(pathname==='/sign_out' && req.method==='POST') {const body=await readJson(req);db.prepare('UPDATE tokens SET revoked=1 WHERE token_hash=?').run(secretHash(bareToken(body.token)));return json(res,200,{success:true})}
      const packageRoute=pathname.match(/^\/package\/([^/]+)\/(info|purchase|authorize_download)$/);
      if(packageRoute && req.method==='POST') {
        const packageId=packageRoute[1],product=PRODUCTS[packageId];
        if(!product) return json(res,404,{error:'Package unavailable'});
        const body=await readJson(req),token=getToken(body.token);
        if(packageRoute[2]==='info')return json(res,200,{price:(product.priceCents/100).toFixed(2),purchased:token?owns(token,packageId):false,available:true});
        if(!token)return json(res,401,{error:'Sign in to continue',invalidate:true});
        if(packageRoute[2]==='purchase') {
          if(!body.payment_secret||secretHash(body.payment_secret)!==token.payment_hash)return json(res,403,{error:'Payment authorization failed'});
          if(owns(token,packageId))return json(res,200,{status:0});
          const intent=randomToken();db.prepare('INSERT INTO intents(id_hash,token_id,expires_at,package_id) VALUES(?,?,?,?)').run(secretHash(intent),token.id,now()+600,packageId);
          return json(res,200,{status:1,url:`${origin}/checkout/start?intent=${encodeURIComponent(intent)}`});
        }
        if(!owns(token,packageId))return json(res,403,{error:'Purchase required'});
        const ticket=randomToken();db.prepare('INSERT INTO tickets(id_hash,token_id,expires_at,package_id) VALUES(?,?,?,?)').run(secretHash(ticket),token.id,now()+120,packageId);
        return json(res,200,{url:`${origin}/download/${encodeURIComponent(ticket)}`});
      }
      if(pathname==='/checkout/start' && req.method==='GET') {
        const id=url.searchParams.get('intent')??'';const record=db.prepare('SELECT * FROM intents WHERE id_hash=? AND used=0 AND expires_at>?').get(secretHash(id),now());
        if(!record)return page(res,403,'Link expired','<p>Return to Sileo and try again.</p>');
        db.prepare('UPDATE intents SET used=1 WHERE id_hash=?').run(record.id_hash);
        const token=db.prepare('SELECT * FROM tokens WHERE id=? AND revoked=0').get(record.token_id);
        if(!token)return page(res,403,'Sign-in expired','<p>Sign in again from Sileo.</p>');
        return await beginCheckout(res,record.package_id,token);
      }
      const buy=pathname.match(/^\/buy\/([^/]+)$/);
      if(buy && req.method==='POST') {
        if(req.headers.origin!==origin)return reply(res,403,'Invalid origin');
        return await beginCheckout(res,buy[1]);
      }
      if(pathname==='/checkout/success' && req.method==='GET') {
        const session=url.searchParams.get('session_id')??'';const order=db.prepare('SELECT * FROM orders WHERE session_id=?').get(session);
        if(!order)return page(res,404,'Order not found','<p>Contact support with your Stripe receipt.</p>');
        if(order.status!=='paid')return page(res,202,'Payment processing','<p>Stripe is confirming the payment. Refresh this page in a moment.</p>');
        const name=PRODUCTS[order.package_id]?.name??'tweak';
        if(order.token_id)return page(res,200,'Purchase complete',`<p>Your ${esc(name)} purchase code is:</p><p><code>${claimCode(session)}</code></p><p>Install the package in Sileo. If needed, sign in again and enter this code to restore your purchase.</p><p><a href="sileo://payment_completed">Return to Sileo</a></p>`);
        return page(res,200,'Purchase complete',`<p>Your ${esc(name)} purchase code is:</p><p><code>${claimCode(session)}</code></p><p>In Sileo, add the JimWas Repo source, choose Sign In, and enter this code to unlock your download. This code is for your device; keep it private.</p>`);
      }
      const download=pathname.match(/^\/download\/([A-Za-z0-9_-]+)$/);
      if(download && ['GET','HEAD'].includes(req.method)) {
        const ticket=db.prepare('SELECT * FROM tickets WHERE id_hash=? AND used=0 AND expires_at>?').get(secretHash(download[1]),now());
        if(!ticket)return reply(res,403,'Download link expired');
        const token=db.prepare('SELECT * FROM tokens WHERE id=? AND revoked=0').get(ticket.token_id);
        const packageId=ticket.package_id;
        const product=PRODUCTS[packageId];
        if(!product||!token||!owns(token,packageId))return reply(res,403,'Purchase required');
        if(req.method==='HEAD')return reply(res,200,'','application/vnd.debian.binary-package');
        db.prepare('UPDATE tickets SET used=1 WHERE id_hash=?').run(ticket.id_hash);
        return sendFile(res,path.join(PRIVATE,product.file),'application/vnd.debian.binary-package',product.file);
      }
      if(pathname==='/Packages'||pathname==='/Packages.gz'||pathname==='/Release')return sendFile(res,path.join(REPO,pathname.slice(1)),pathname.endsWith('.gz')?'application/gzip':'text/plain; charset=utf-8');
      if(req.method==='GET' && /^\/[a-z0-9][a-z0-9+._~-]*\.deb$/i.test(pathname)) {
        const file=path.join(REPO,pathname.slice(1));
        if(fs.existsSync(file)&&fs.statSync(file).isFile())return sendFile(res,file,'application/vnd.debian.binary-package');
      }
      if(pathname.startsWith('/private/'))return reply(res,403,'Purchase required');
      if(req.method==='GET'||req.method==='HEAD') {
        const relative=pathname.replace(/^\//,'');
        const file=path.resolve(WEB,relative||'index.html');
        if(!file.startsWith(WEB+path.sep)&&file!==path.join(WEB,'index.html'))return reply(res,403,'Forbidden');
        const actual=fs.existsSync(file)&&fs.statSync(file).isDirectory()
          ? (fs.existsSync(path.join(file,'index.html')) ? path.join(file,'index.html') : `${file}.html`)
          : fs.existsSync(file) ? file : `${file}.html`;
        if(fs.existsSync(actual)&&fs.statSync(actual).isFile()) {
          const ext=path.extname(actual).toLowerCase();const type={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.json':'application/json'}[ext]??'application/octet-stream';return sendFile(res,actual,type);
        }
      }
      return reply(res,404,'Not found');
    } catch(error) {console.error(error);return reply(res,500,'Service unavailable')}
  };
  return {handler,close:()=>db.close()};
}

if(process.argv[1]===new URL(import.meta.url).pathname) {
  const required=['BASE_URL','STRIPE_SECRET_KEY','STRIPE_PRICE_ID','STRIPE_IG_VCAM_PRICE_ID','STRIPE_WEBHOOK_SECRET','AUTH_SECRET'];
  for(const key of required)if(!process.env[key])throw new Error(`Missing ${key}`);
  const publicOrigin=new URL(process.env.BASE_URL);
  if(publicOrigin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(publicOrigin.hostname))throw new Error('BASE_URL must use HTTPS');
  if(process.env.AUTH_SECRET.length<32)throw new Error('AUTH_SECRET must be at least 32 characters');
  for(const product of Object.values(PRODUCTS)) {
    const file=path.join(PRIVATE,product.file);
    if(!fs.existsSync(file)||secretHash(fs.readFileSync(file))!==product.hash)throw new Error(`Private package missing or hash mismatch: ${product.file}`);
  }
  if(!fs.existsSync(path.join(WEB,'index.html')))throw new Error('Build the standalone storefront first');
  const app=createApp({baseUrl:process.env.BASE_URL,stripeKey:process.env.STRIPE_SECRET_KEY,priceIds:{[PACKAGE_ID]:process.env.STRIPE_PRICE_ID,[VCAM_ID]:process.env.STRIPE_IG_VCAM_PRICE_ID},webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,authSecret:process.env.AUTH_SECRET,dbPath:process.env.DB_PATH||path.join(ROOT,'.private','commerce.sqlite'),licenseKeyPath:process.env.LICENSE_SIGNING_KEY_PATH||path.join(ROOT,'.private','license-signing-key.pem')});
  http.createServer(app.handler).listen(Number(process.env.PORT||3000),()=>console.log('JimWas commerce service ready'));
}
