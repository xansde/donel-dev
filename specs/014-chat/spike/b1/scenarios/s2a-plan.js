const make = require('./plan-common');
const PR = make.PR;
module.exports = make('s2a-plan', [
  { id: 'plan-deny', event: 'PermissionRequest', tool: 'ExitPlanMode', maxUses: 1, out: PR({ behavior: 'deny', message: 'USER FEEDBACK (b1): also put the text "second-line" on a second line of hello.txt. Revise the plan and call ExitPlanMode again.' }) },
  { id: 'plan-allow', event: 'PermissionRequest', tool: 'ExitPlanMode', out: PR({ behavior: 'allow' }) },
]);
