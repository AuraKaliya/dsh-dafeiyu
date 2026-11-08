import test from 'node:test';
import {runOwnerDeliveryFixture} from './owner-task-delivery-fixture.js';
test('business model failure sends a truthful program notice without another model request',{timeout:30000},t=>runOwnerDeliveryFixture(t,'task-offline'));
