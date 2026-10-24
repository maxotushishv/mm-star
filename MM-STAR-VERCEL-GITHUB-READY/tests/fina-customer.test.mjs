import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeFinaCustomerLookup} from '../lib/fina-core.mjs';

test('FINA customer lookup maps documented fields and preserves tax ID',()=>{
  const x=normalizeFinaCustomerLookup({contragents:[{id:13,code:'012345678',name:'  სატესტო შპს ',address:'თბილისი',phone:'555000000',email:'test@example.com',is_company:true}]},'012345678');
  assert.deepEqual(x,{finaId:13,taxId:'012345678',name:'სატესტო შპს',address:'თბილისი',phone:'555000000',email:'test@example.com',isCompany:true});
});
test('FINA customer lookup accepts documented tel/mail aliases',()=>{
  const x=normalizeFinaCustomerLookup({contragents:[{id:2,code:'12345678910',tel:'123',mail:'a@b.ge',is_company:false}]},'12345678910');
  assert.equal(x.phone,'123');assert.equal(x.email,'a@b.ge');assert.equal(x.isCompany,false);
});
test('FINA customer lookup refuses ambiguous matches',()=>{
  assert.throws(()=>normalizeFinaCustomerLookup({contragents:[{code:'123456789'},{code:'123456789'}]},'123456789'),/AMBIGUOUS/);
});
test('FINA customer lookup refuses unmatched code',()=>{
  assert.throws(()=>normalizeFinaCustomerLookup({contragents:[{code:'123456789'}]},'123456780'),/NOT_FOUND/);
});
