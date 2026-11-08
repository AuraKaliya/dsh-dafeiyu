import test from 'node:test';
import {runTaskSendRecovery} from './task-send-recovery-fixture.js';
test('unknown task-result parts never become a resend permission',{timeout:30000},t=>runTaskSendRecovery(t,'unknown'));
