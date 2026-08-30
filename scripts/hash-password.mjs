import { hash } from "bcryptjs";

const password = process.argv[2];

if (!password || password.length < 12) {
  console.error("Provide a password of at least 12 characters as the first argument.");
  process.exitCode = 1;
} else {
  console.log(await hash(password, 12));
}
