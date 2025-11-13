#!/usr/bin/env node
const bcrypt = require('bcrypt');
const readline = require('readline');

const passwordFromArg = process.argv[2];

async function hashPassword(password) {
  try {
    const hash = await bcrypt.hash(password, 10);
    console.log(`Password: ${password}`);
    console.log(`Hash: ${hash}`);
    process.exit(0);
  } catch (err) {
    console.error('Error hashing password:', err.message);
    process.exit(1);
  }
}

if (passwordFromArg) {
  hashPassword(passwordFromArg);
} else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Password to hash: ', (answer) => {
    rl.close();
    hashPassword(answer);
  });
}
