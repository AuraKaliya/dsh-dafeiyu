import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

test('renderer recovery after restart preserves the completed task and delivers exactly once',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'render-offline'));
