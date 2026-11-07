import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

// Separate process: the SDK binds DSH_HOME on first import.
test('owner retry after verifier outage reuses the same candidate and evidence after restart',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'verification-offline'));
