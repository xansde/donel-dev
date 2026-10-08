const make = require('./ask-common');
module.exports = make('s3a-ask', [
  { id: 'ask-via-PR', event: 'PermissionRequest', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Blue', 'Cheese, Olives'] },
]);
