import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

test('an accepted pre-send recovery resumes after shutdown without a second owner request',{timeout:30000},
  t=>runOwnerDeliveryFixture(t,'verification-pending-restart'));
