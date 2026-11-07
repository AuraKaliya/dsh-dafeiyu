import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

// Separate process: the SDK binds DSH_HOME on first import.
test('R1.1 known gap: verifier outage retains the business result but retry cannot resume delivery',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'verification-offline'));
