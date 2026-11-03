require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const pool = require('./db');

function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    return Promise.reject(new Error('Run this command in an interactive terminal so the password is not echoed.'));
  }
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = error => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') return finish(new Error('Cancelled.'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (!/[\u0000-\u001f\u007f]/.test(char)) {
          value += char;
          stdout.write('*');
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const email = (await rl.question('Account email: ')).trim().toLowerCase();
    rl.close();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid account email.');
    const password = await readHidden('New password (6+ characters; input hidden): ');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password must be no more than 72 bytes.');
    const hash = await bcrypt.hash(password, 12);
    const [result] = await pool.execute('UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE email = ?', [hash, email]);
    if (!result.affectedRows) throw new Error('No account matched that email in the configured database.');
    console.log('Password updated. Sign in using the same email and your new password.');
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch(err => { console.error(err.message); process.exitCode = 1; });
