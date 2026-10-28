import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {testTempDir} from './test-temp.js';
import {MemoryStore} from '@dafeiyu/memory/store';
import {RuntimeStore} from '@dafeiyu/core/runtime-store';
import {Journal} from '@dafeiyu/journal';
import {QqStore} from '@dafeiyu/qq';
import {MediaStore} from '@dafeiyu/media';
import {BiliStore} from '@dafeiyu/bilibili';

test('fresh authoritative stores create the complete current structure and reopen without transformation',async()=>{
  const root=await mkdtemp(join(testTempDir(),'current-storage-')),identity={agentId:'fixture-agent',profileId:'fixture-profile'};
  const cases=[
    {name:'memory',open:(file:string)=>new MemoryStore(file),table:'memory_self'},
    {name:'runtime',open:(file:string)=>new RuntimeStore(file,identity,{create:true}),table:'native_deliveries'},
    {name:'journal',open:(file:string)=>new Journal(file),table:'events'},
    {name:'qq',open:(file:string)=>new QqStore(file),table:'qq_delivery_segments'},
    {name:'media',open:(file:string)=>new MediaStore(file,identity,true),table:'media_reply_drafts'},
    {name:'bilibili',open:(file:string)=>new BiliStore(file,identity,true),table:'bili_pages'},
  ];
  for(const row of cases){const file=join(root,row.name+'.sqlite');row.open(file).close();
    const db=new DatabaseSync(file,{readOnly:true});
    const before=db.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
    assert.ok(before.some(object=>object.name===row.table),row.name);
    assert.ok(!before.some(object=>String(object.name).includes('schema_migrations')));
    db.close();row.open(file).close();const again=new DatabaseSync(file,{readOnly:true});
    assert.deepEqual(again.prepare("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all(),before);again.close();
  }
});

test('invalid storage identity is refused without rewriting the supplied database',async()=>{
  const root=await mkdtemp(join(testTempDir(),'invalid-storage-')),file=join(root,'memory.sqlite');new MemoryStore(file).close();
  const db=new DatabaseSync(file);db.exec('PRAGMA application_id=12345');const before=db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();db.close();
  assert.throws(()=>new MemoryStore(file),/INVALID_STORAGE/);
  const after=new DatabaseSync(file,{readOnly:true});assert.equal(after.prepare('PRAGMA application_id').get()?.application_id,12345);
  assert.deepEqual(after.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(),before);after.close();
});
