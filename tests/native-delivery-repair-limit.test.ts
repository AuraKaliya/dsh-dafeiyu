import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

test('verifier recovery cannot reset three-draft repair history across restart',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'verification-repair-limit'));
