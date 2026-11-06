import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Journal} from '@dafeiyu/journal';
import {MessageSchema} from '@dafeiyu/contracts';
import type {NewEvent} from '@dafeiyu/journal';
import {testTempDir} from './test-temp.js';

test('trace lookups retain scope and order and invalidate negative results after local or external appends',async()=>{
  const root=await mkdtemp(join(testTempDir(),'trace-events-')),file=join(root,'journal.sqlite'),journal=new Journal(file),trace=randomUUID();
  const event=(route:string,value:number):NewEvent=>({agentId:'fish',route,traceId:trace,operationId:trace,causedBy:null,type:'patrol.selected',plugin:'fixture',pluginVersion:'1',occurredAt:new Date().toISOString(),sources:[],data:{value}});
  try{assert.equal(journal.eventForTrace('A',trace,'patrol.selected'),null);const first=journal.append(event('A',1));
    assert.equal(journal.eventForTrace('A',trace,'patrol.selected')?.id,first.id);assert.equal(journal.eventForTrace('B',trace,'patrol.selected'),null);
    const returned=journal.eventForTrace('A',trace,'patrol.selected')!;Reflect.set(returned.data,'value',99);assert.equal(journal.eventForTrace('A',trace,'patrol.selected')?.data.value,1);
    const second=journal.append(event('A',2));assert.equal(journal.eventForTrace('A',trace,'patrol.selected','first')?.id,first.id);assert.equal(journal.eventForTrace('A',trace,'patrol.selected')?.id,second.id);
    const external=new DatabaseSync(file);try{const row={...event('B',3),id:randomUUID(),schemaVersion:1,recordedAt:new Date().toISOString(),visibility:{kind:'conversation',route:'B'}};
      external.prepare('INSERT INTO events(id,route,trace_id,operation_id,body) VALUES(?,?,?,?,?)').run(row.id,'B',trace,trace,JSON.stringify(row));
      assert.equal(journal.eventForTrace('B',trace,'patrol.selected')?.id,row.id);
      const hidden={...row,id:randomUUID(),data:{value:4},visibility:{kind:'task',agentId:'fish',taskId:randomUUID()}};external.prepare('INSERT INTO events(id,route,trace_id,operation_id,body) VALUES(?,?,?,?,?)').run(hidden.id,'B',trace,trace,JSON.stringify(hidden));
      assert.deepEqual(journal.eventsForTrace('B',trace).map(e=>e.id),[row.id]);
    }finally{external.close();}
  }finally{journal.close();}
});

test('message parsing reuse never freezes live inbox state or hides an externally changed payload',async()=>{
  const root=await mkdtemp(join(testTempDir(),'message-body-cache-')),file=join(root,'journal.sqlite'),journal=new Journal(file);
  try{const message=MessageSchema.parse({id:'one',occurredAt:new Date().toISOString(),conversation:{channel:'fixture',account:'local',kind:'private',id:'owner'},sender:{id:'owner',displayName:'Owner'},text:'original'}),receipt=journal.accept('fish','fixture','1',message);
    const first=journal.get(receipt.id);Reflect.set(first.message,'text','tampered');assert.equal(journal.get(receipt.id).message.text,'original');
    const event:NewEvent={agentId:'fish',route:first.route,traceId:first.id,operationId:first.id,causedBy:null,type:'turn.started',plugin:'fixture',pluginVersion:'1',occurredAt:new Date().toISOString(),sources:[],data:{}};
    journal.transition(receipt.id,'accepted','processing',event);assert.equal(journal.get(receipt.id).state,'processing');
    const external=new DatabaseSync(file);try{external.prepare('UPDATE inbox SET payload=? WHERE id=?').run(JSON.stringify({...message,text:'changed',sender:{...message.sender,id:'different'}}),receipt.id);
      const changed=journal.get(receipt.id);assert.equal(changed.message.text,'changed');assert.equal(changed.message.sender.id,'different');assert.equal(changed.state,'processing');
    }finally{external.close();}
  }finally{journal.close();}
});
