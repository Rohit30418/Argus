import assert from 'node:assert/strict';
import { enrichIssue, issueFingerprint } from './solutions.js';
import { plannedScenarios, shouldSkipForm } from './form-tester.js';

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

const email={type:'email',tag:'input',required:true,minLength:-1,min:'',max:'',disabled:false,readOnly:false,hidden:false};
assert.deepEqual(plannedScenarios(email).map(s=>s.name),['required-empty','invalid-email']);
assert.deepEqual(plannedScenarios({...email,type:'number',min:'0',max:'10',required:false}).map(s=>s.name),['below-minimum','above-maximum']);
assert.deepEqual(plannedScenarios({...email,type:'text',minLength:4,required:false}).map(s=>s.name),['too-short']);
assert.deepEqual(plannedScenarios({...email,hidden:true}),[]);
assert.match(shouldSkipForm({action:'/checkout',id:'payment',name:'payment',fields:[]}),/sensitive/i);
assert.match(shouldSkipForm({action:'/register',id:'',name:'',fields:[{name:'',id:'',label:'',type:'password'}]}),/sensitive/i);
assert.equal(shouldSkipForm({action:'/contact',id:'contact',name:'contact',fields:[{name:'email',id:'email',label:'Email',type:'email'}]}),'');
console.log('ARGUS deterministic solution and safe form test self-tests passed.');
