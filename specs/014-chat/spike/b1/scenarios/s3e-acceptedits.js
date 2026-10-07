const make = require('./ask-common');
const { ASK } = make;
module.exports = make('s3e-acceptedits', [
  { id: 'ask-via-PR', event: 'PermissionRequest', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Blue', 'Cheese, Olives'] },
], { mode: 'acceptEdits', turns: [ASK], waitMs: 45000 });
