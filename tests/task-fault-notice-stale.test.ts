import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';
test('a business continuation suppresses the old failure notice and cannot resume the same stale parent twice',{timeout:30000},t=>runOwnerDeliveryFixture(t,'task-notice-stale'));
