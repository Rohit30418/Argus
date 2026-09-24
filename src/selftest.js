import assert from 'node:assert/strict';
import { enrichIssue, issueFingerprint } from './solutions.js';

const overflow = enrichIssue({ severity:'high', category:'Responsive', title:'Horizontal overflow on mobile', evidence:'390 viewport -> 520 scroll width', url:'https://example.com/a', selector:'.wide' });
assert.equal(overflow.owner, 'Frontend / Responsive UI');
assert.equal(overflow.priority, 'P1');
assert.ok(overflow.solutionSteps.length >= 4);
assert.ok(overflow.reproductionSteps.length >= 3);
assert.ok(overflow.retest.length >= 2);
assert.ok(overflow.id.startsWith('iss_'));
assert.match(issueFingerprint(overflow), /responsive/);

const runtime = enrichIssue({ severity:'critical', category:'Functional', title:'Runtime request returns 5xx', evidence:'POST /api/register => 500', url:'https://example.com/register' });
assert.equal(runtime.owner, 'Backend / API');
assert.equal(runtime.priority, 'P0');
assert.ok(runtime.fixSnippet.length > 0);

console.log('ARGUS deterministic solution self-test passed.');
