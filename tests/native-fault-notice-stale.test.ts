import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';
test('a queued failure notice is suppressed once its task has moved to recovery',{timeout:30000},t=>runOwnerDeliveryFixture(t,'verification-notice-stale'));
