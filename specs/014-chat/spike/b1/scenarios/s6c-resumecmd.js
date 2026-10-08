const { mk } = require('./s6a-resume');
module.exports = mk('s6c-resumecmd', [], async (h) => {
  h.log('typing /resume'); await h.submit('/resume'); await h.sleep(3500); h.snap('resume picker');
  h.log('pressing Enter to pick the highlighted session'); h.enter(); await h.sleep(6000); h.snap('after pick');
});
