import assert from 'node:assert/strict';
const base=(process.env.TEST_BASE_URL || 'http://localhost:3000').replace(/\/$/,'');
async function req(path, init={}) { const r=await fetch(base+path,{...init,redirect:'manual'}); return r; }
const health=await req('/api/health'); assert.equal(health.status,200); assert.equal((await health.json()).database,'connected');
assert.equal((await req('/')).status,200);
assert.equal((await req('/garmentflow-icon.svg')).status,200);
assert.equal((await req('/api/data/master/locations')).status,401);
assert.equal((await req('/api/auth/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
assert.equal((await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://invalid.example'},body:'{}'})).status,403);
if(process.env.TEST_EMAIL && process.env.TEST_PASSWORD){
 const r=await req('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:process.env.TEST_EMAIL,password:process.env.TEST_PASSWORD})});
 assert.equal(r.status,200); const data=await r.json(); assert.ok(data.data.user); assert.ok(!('token' in data.data));
 const cookie=r.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);assert.match(r.headers.get('set-cookie'),/HttpOnly/i);
 assert.equal((await req('/api/data/master/locations',{headers:{Cookie:cookie}})).status,200);
 const logout=await req('/api/auth/logout',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(logout.status,200);
 assert.equal((await req('/api/data/master/locations',{headers:{Cookie:cookie}})).status,401);
}
console.log('Smoke checks passed');
