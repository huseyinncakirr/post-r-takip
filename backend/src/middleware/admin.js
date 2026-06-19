const authMW = require('./auth');

function adminMiddleware(req, res, next) {
  authMW(req, res, function() {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Bu işlem için admin yetkisi gerekli' });
    }
    next();
  });
}

module.exports = adminMiddleware;
