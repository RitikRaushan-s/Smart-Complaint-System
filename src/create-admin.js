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
    const finish = (error) => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      const char = chunk.toString('utf8');
      if (char === '\u0003') return finish(new Error('Cancelled.'));
      if (char === '\r' || char === '\n') return finish();
      if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
      else if (!/[\u0000-\u001f\u007f]/.test(char)) value += char;
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const fullName = (await rl.question('Admin name: ')).trim();
    const email = (await rl.question('Admin email: ')).trim().toLowerCase();
    rl.close();
    const password = await readHidden('Admin password (6+ characters; longer is safer): ');
    if (fullName.length < 2) throw new Error('Admin name must be at least 2 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password must be no more than 72 bytes. For standard English letters, that is 72 characters.');
    const hash = await bcrypt.hash(password, 12);
    await pool.execute("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'admin')", [fullName, email, hash]);
    console.log('Admin account created.');
  } finally {
    rl.close();
    await pool.end();
  }
}
main().catch(err => { console.error(err.code === 'ER_DUP_ENTRY' ? 'That email is already registered.' : err.message); process.exitCode = 1; });
