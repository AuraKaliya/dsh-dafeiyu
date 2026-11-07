import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';

test('an owner task delivers the actual group text and mention evidence through the native result verifier',{timeout:30000},t=>runOwnerDeliveryFixture(t));
