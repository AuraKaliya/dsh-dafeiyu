import test from 'node:test';
import {runTaskSendRecovery} from './task-send-recovery-fixture.js';
test('an owner task resumes its frozen media export without reacquiring or regenerating',{timeout:30000},t=>runTaskSendRecovery(t,'media'));
