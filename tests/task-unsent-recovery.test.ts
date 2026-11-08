import test from 'node:test';
import {runTaskSendRecovery} from './task-send-recovery-fixture.js';
test('a definitely unsent approved result can be sent by explicit recovery',{timeout:30000},t=>runTaskSendRecovery(t,'not-sent'));
