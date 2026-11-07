import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

// R1.1 characterization of a known gap, not acceptance of the required recovery behavior.
// Replace these expectations with successful stage-only continuation in R1.4.
test('R1.1 known gap: completed inspection remains undelivered after a renderer outage and restart',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'render-offline'));
