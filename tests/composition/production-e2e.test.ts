import test from 'node:test';import {productionScenario} from './production-fixture.js';
for(const s of ['recover','busy-before-reserve','busy-before-post','crm-retry'])test('full production-profile fixture '+s,()=>productionScenario(undefined,s));
