const { mk } = require('./s6a-resume');
const ID = '5d18be85-2042-4a1f-a6f6-a38e1ac4f698';
module.exports = mk('s6b-fork', ['--resume', ID, '--fork-session']);
