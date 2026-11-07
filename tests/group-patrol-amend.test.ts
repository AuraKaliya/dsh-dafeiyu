import test from 'node:test';
import {runPatrolScenario} from './group-patrol-fixture.js';
test('owner patrol amend: a new intent epoch renews the original plan without cancel-and-recreate',{timeout:30000},t=>runPatrolScenario(t,'amend'));
