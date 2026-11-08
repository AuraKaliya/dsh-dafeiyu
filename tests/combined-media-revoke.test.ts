import test from 'node:test';
import {runTaskSendRecovery} from './task-send-recovery-fixture.js';
test('partial media delivery cannot use its frozen export after source revocation and restart',{timeout:30000},async t=>runTaskSendRecovery(t,'media',true));
