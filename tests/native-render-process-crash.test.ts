import test from 'node:test';
import {crashDelivery} from './native-delivery-crash-fixture.js';
test('a real process exit during rendering preserves the result and resumes with a fresh render session',{timeout:45000},t=>crashDelivery(t,'render-crash'));
