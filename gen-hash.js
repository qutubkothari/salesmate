const bcrypt = require('bcryptjs');
bcrypt.hash('testpass123', 10, (err, hash) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(hash);
});
