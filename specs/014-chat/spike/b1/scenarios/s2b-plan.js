const make = require('./plan-common');
const PR = make.PR;
module.exports = make('s2b-plan', [
  { id: 'plan-allow-echo', event: 'PermissionRequest', tool: 'ExitPlanMode', out: PR({ behavior: 'allow', updatedInput: '$INPUT' }) },
]);
