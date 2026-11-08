import test from 'node:test';
import {runTaskSendRecovery} from './task-send-recovery-fixture.js';
test('an owner task resumes only unsent text segments after restart',{timeout:30000},t=>runTaskSendRecovery(t,'text'));
