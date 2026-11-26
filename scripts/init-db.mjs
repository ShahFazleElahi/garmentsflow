import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES, STAGES_SEED, ACCOUNTS_SEED, PRODUCT_CATEGORIES_SEED, MATERIAL_CATEGORIES } from '../src/lib/constants.ts';
const db = new PrismaClient();
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12 || Buffer.byteLength(password) > 72) {
  console.error('Set a valid ADMIN_EMAIL and ADMIN_PASSWORD (12 characters minimum, 72 UTF-8 bytes maximum).'); process.exit(1);
}
try {
  const passwordHash = await bcrypt.hash(password, 11);
  await db.$transaction(async tx => {
    const existing = await tx.user.findUnique({where:{email}});
    if (existing && existing.roleKey !== 'OWNER') throw new Error('Email is already in use by a non-owner. No privileges changed.');
    if (!existing) {
      if (await tx.user.count()) throw new Error('Users already exist. Create additional owners through the admin interface.');
      await tx.user.create({data:{email,passwordHash,name:process.env.ADMIN_NAME || 'Owner',roleKey:'OWNER'}});
    }
    for (const r of DEFAULT_ROLES) await tx.role.upsert({where:{key:r.key},update:{},create:{key:r.key,name:r.name,permissionsJson:JSON.stringify(r.permissions),isSystem:true}});
    for (const s of STAGES_SEED) await tx.productionStage.upsert({where:{key:s.key},update:{},create:s});
    for (const a of ACCOUNTS_SEED) await tx.account.upsert({where:{code:a.code},update:{},create:a});
    for (const [i,name] of PRODUCT_CATEGORIES_SEED.entries()) await tx.productCategory.upsert({where:{name},update:{},create:{name,code:`PC-${i+1}`}});
    for (const [i,name] of MATERIAL_CATEGORIES.entries()) await tx.materialCategory.upsert({where:{name},update:{},create:{name,code:`MC-${i+1}`}});
    for (const loc of [{code:'DHK',name:'Dhaka',country:'Bangladesh'},{code:'SYL',name:'Sylhet',country:'Bangladesh'},{code:'UK',name:'United Kingdom',country:'United Kingdom',timezone:'Europe/London'}]) {
      const l=await tx.location.upsert({where:{code:loc.code},update:{},create:loc});
      for (const type of ['MAIN','TRANSIT']) { const code=`WH-${loc.code}-${type}`; await tx.warehouse.upsert({where:{code},update:{},create:{code,name:`${loc.name} ${type === 'MAIN' ? 'Warehouse' : 'Transit'}`,locationId:l.id,type}}); }
    }
    for (const [key,value] of Object.entries({business:{name:'GarmentFlow',tagline:'From Product Planning to Global Delivery'},locale:{language:'en',timezone:'Asia/Dhaka',baseCurrency:'BDT'},costing:{method:'WEIGHTED_AVERAGE',wastagePolicy:'NORMAL_IN_COST_ABNORMAL_EXPENSED'},demoMode:false})) await tx.systemSetting.upsert({where:{key},update:{},create:{key,valueJson:JSON.stringify(value)}});
  },{timeout:120000,isolationLevel:'Serializable'});
  console.log(`Initial configuration ready. Owner: ${email}. Existing credentials are not overwritten.`);
} catch(e) { console.error('Initialization failed:',e.message); process.exitCode=1; } finally { await db.$disconnect(); }
