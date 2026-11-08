import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';
test('unknown fault-notice delivery is parked without alternate send or retry after restart',{timeout:30000},t=>runOwnerDeliveryFixture(t,'verification-notice-unknown'));
