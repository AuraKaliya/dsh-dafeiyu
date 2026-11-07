import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

test('owner task control resume routes a completed task to delivery rather than a new business run',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'verification-control'));
