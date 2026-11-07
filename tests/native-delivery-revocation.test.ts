import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

test('revoking the source group after accepting recovery prevents model calls and delivery',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'verification-revoked'));
