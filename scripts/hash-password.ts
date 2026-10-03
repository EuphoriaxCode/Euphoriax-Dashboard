// Usage: npm run hash-password -- <name> <password>
// Prints a DASHBOARD_USERS entry. Join both of yours with a comma.
import { hashPassword } from '../src/auth.js';

const [name, password] = process.argv.slice(2);
if (!name || !password) {
  console.error('Usage: npm run hash-password -- <name> <password>');
  process.exit(1);
}
console.log(`${name.toLowerCase()}:${hashPassword(password)}`);
