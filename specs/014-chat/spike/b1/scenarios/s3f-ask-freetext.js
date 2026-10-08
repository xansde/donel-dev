const make = require('./ask-common');
module.exports = make('s3f-ask-freetext', [
  { id: 'ask-free', event: 'PermissionRequest', tool: 'AskUserQuestion', answerAsk: 0, answerList: ['Purple, with "quotes" and ünicode ✓', ''] },
], { mode: 'manual', waitMs: 45000 });
