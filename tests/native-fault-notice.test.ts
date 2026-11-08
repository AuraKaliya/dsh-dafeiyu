import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';
test('verifier outage is reported without a model and repeated observation or restart does not resend',{timeout:30000},t=>runOwnerDeliveryFixture(t,'verification-notice-only'));
