import test from 'node:test';
import {runPatrolScenario} from './group-patrol-fixture.js';
test('owner patrol new: saved configuration finishes before dispatch, preserves plan identity and stays isolated',{timeout:30000},t=>runPatrolScenario(t,'new'));
