const make = require('./ask-common');
module.exports = make('s3b-ask', [
  { id: 'ask-via-Pre', event: 'PreToolUse', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Blue', 'Cheese, Olives'] },
]);
