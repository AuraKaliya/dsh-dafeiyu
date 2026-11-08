import test from 'node:test';
import {combinedDelivery} from './combined-delivery-fixture.js';
test('combined delivery revoke-render',{timeout:45000},async t=>combinedDelivery(t,'revoke-render'));
