import test from 'node:test';
import {crashDelivery} from './native-delivery-crash-fixture.js';
test('a real process exit during verification retains the existing candidate and sends no business replay',{timeout:45000},t=>crashDelivery(t,'verification-crash'));
