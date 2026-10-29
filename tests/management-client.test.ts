import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('the native client mounts one owner service and one DSH settings section using shared React',async()=>{
  let registered:unknown,contribution:unknown,plugin:{apply:(ctx:unknown)=>Promise<void>}|undefined;
  const react=require('react') as {createElement:(component:unknown)=>unknown};
  runInNewContext(readFileSync('packages/plugin/client.js','utf8'),{window:{__ModuleLoader__:{load:(module:{id:string;factory:(require:(id:string)=>unknown)=>unknown})=>{assert.equal(module.id,'dsh-dafeiyu');plugin=module.factory(id=>{assert.equal(id,'react');return react;}) as typeof plugin;}}},document:{createElement:()=>({textContent:'',remove(){}}),head:{append(){}}},console});
  await plugin!.apply({effect:(callback:()=>unknown)=>callback(),remote:{$mount:async(value:unknown)=>{contribution=value;return ()=>{};}},slots:{inject:(name:string,callback:()=>void)=>{assert.equal(name,'settings.section');callback();},register:(options:{id:string;label:()=>string},component:unknown)=>{assert.equal(options.id,'dafeiyu');assert.equal(options.label(),'大肥鱼管理中心');registered=component;}}});
  assert.ok(contribution);assert.equal(typeof registered,'function');
  const render=require('react-dom/server').renderToStaticMarkup as (element:unknown)=>string;assert.match(render(react.createElement(registered)),/大肥鱼管理中心/);
});
