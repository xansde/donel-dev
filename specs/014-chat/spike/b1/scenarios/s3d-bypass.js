const make = require('./ask-common');
const { ASK } = make;
const T = (c) => `Use the Bash tool to run exactly this command and nothing else: touch ${c} . Then reply DONE.`;
module.exports = make('s3d-bypass', [
  { id: 'ask-via-PR', event: 'PermissionRequest', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Blue', 'Cheese, Olives'] },
], { mode: 'bypassPermissions', turns: [ASK, T('by1.txt')], waitMs: 45000 });
