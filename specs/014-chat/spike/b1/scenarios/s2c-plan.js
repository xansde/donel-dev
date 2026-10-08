const make = require('./plan-common');
const PR = make.PR;
module.exports = make('s2c-plan', [
  { id: 'plan-allow-setmode', event: 'PermissionRequest', tool: 'ExitPlanMode', out: PR({ behavior: 'allow', updatedInput: '$INPUT', updatedPermissions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }] }) },
  { id: 'write-allow', event: 'PermissionRequest', tool: 'Write', out: PR({ behavior: 'allow' }) },
]);
