import test from 'node:test';
import {combinedDelivery} from './combined-delivery-fixture.js';
test('combined delivery revoke-verification',{timeout:45000},async t=>combinedDelivery(t,'revoke-verification'));
