import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';
export type CrashStage='render-crash'|'verification-crash';
const stage=process.argv[2];
if(stage!=='render-crash'&&stage!=='verification-crash')throw new Error('CRASH_STAGE_INVALID');
process.on('message',()=>{});
await runOwnerDeliveryFixture({signal:new AbortController().signal},stage);
