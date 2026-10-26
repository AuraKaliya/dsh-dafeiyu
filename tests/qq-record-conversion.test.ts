import test from 'node:test';
import assert from 'node:assert/strict';
import { QqMediaReader,QqMediaConfigSchema } from '../packages/channel-qq/lib/media-reader.js';
import type { OneBot } from '../packages/channel-qq/lib/onebot.js';
import { syntheticPcm } from './media-pcm-fixture.js';

test('original SnowLuma converted WAV bytes take precedence over the original Silk download URL',async()=>{
  const data=syntheticPcm(),reader=new QqMediaReader(QqMediaConfigSchema.parse({}));let verifies=0;
  const api:Pick<OneBot,'call'|'verify'>={verify:async()=>{verifies++;},call:async(action,params)=>{assert.equal(action,'get_record');assert.ok(JSON.stringify(params).includes('wav'));return {file:'https://not-authorized.invalid/original.silk',out_format:'wav',base64:data.toString('base64')};}};
  const opened=await reader.resolve(api,'audio',{file:'actual-record-handle'},null,new AbortController().signal,()=>{}),parts:Uint8Array[]=[];
  for await(const part of opened.stream)parts.push(part);assert.deepEqual(Buffer.concat(parts),data);assert.equal(opened.mime,'audio/wav');assert.equal(verifies,3);
});
test('invalid conversion data and decoded byte overflow never fall back to the original URL',async()=>{
  const reader=new QqMediaReader(QqMediaConfigSchema.parse({maxReadBytes:1024}));const api:Pick<OneBot,'call'|'verify'>={verify:async()=>{},call:async()=>({file:'https://not-authorized.invalid',out_format:'wav',base64:syntheticPcm().toString('base64')})};
  await assert.rejects(reader.resolve(api,'audio',{file:'handle'},null,new AbortController().signal,()=>{}),/SIZE_LIMIT/);
  api.call=async()=>({out_format:'wav',base64:'invalid!'});await assert.rejects(reader.resolve(api,'audio',{file:'handle'},null,new AbortController().signal,()=>{}),/CONVERSION_INVALID/);
});
test('a converted voice longer than two MiB is read without a recursive validation pattern',async()=>{
  const data=Buffer.alloc(2*1024**2+44);syntheticPcm().copy(data,0,0,44);data.writeUInt32LE(data.length-8,4);data.writeUInt32LE(data.length-44,40);
  const reader=new QqMediaReader(QqMediaConfigSchema.parse({})),api:Pick<OneBot,'call'|'verify'>={verify:async()=>{},call:async()=>({out_format:'wav',base64:data.toString('base64')})};
  const opened=await reader.resolve(api,'audio',{file:'record'},null,new AbortController().signal,()=>{});let size=0;for await(const chunk of opened.stream)size+=chunk.length;assert.equal(size,data.length);
});
