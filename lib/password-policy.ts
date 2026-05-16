// Cheap password policy. We don't ship zxcvbn (extra MB on the bundle);
// instead enforce a few easy rules + a tiny common-password deny list.
//
// Rules:
//   • 8+ chars
//   • At least 3 of: lowercase / uppercase / digit / symbol
//   • Not a banned common password (top ~50)
//   • No more than 2 identical chars in a row ("aaa" not allowed)

const BANNED = new Set([
  "password", "password1", "12345678", "123456789", "qwerty", "qwerty123",
  "abc12345", "letmein", "welcome1", "iloveyou", "admin123", "monkey12",
  "football", "iloveyou1", "12341234", "abcd1234", "P@ssw0rd", "Welcome1",
  "Admin123", "Password1", "qwertyui", "asdf1234", "1q2w3e4r", "1qaz2wsx",
  "trustno1", "sunshine", "princess", "starwars", "michael1", "computer",
  "qazwsx12", "qwerty12", "1234abcd", "iloveu123", "passw0rd", "letmein1",
  "admin1234", "welcome123", "changeme", "summer22", "winter22", "spring22",
  "summer23", "winter23", "spring23", "summer24", "winter24", "spring24",
]);

export type PasswordCheckResult = { ok: true } | { ok: false; reason: string };

export function checkPasswordPolicy(pw: string): PasswordCheckResult {
  if (typeof pw !== "string") return { ok: false, reason: "Must be a string." };
  if (pw.length < 8) return { ok: false, reason: "Use at least 8 characters." };
  if (pw.length > 200) return { ok: false, reason: "Keep it under 200 characters." };
  if (BANNED.has(pw.toLowerCase())) {
    return { ok: false, reason: "That password is too common — pick something less guessable." };
  }
  // Classes covered.
  const classes =
    Number(/[a-z]/.test(pw)) +
    Number(/[A-Z]/.test(pw)) +
    Number(/\d/.test(pw)) +
    Number(/[^a-zA-Z0-9]/.test(pw));
  if (classes < 3) {
    return {
      ok: false,
      reason: "Mix at least 3 of: lowercase, uppercase, digits, symbols.",
    };
  }
  // Triple-repeat ban — catches "aaaa" / "11111".
  if (/(.)\1{2,}/.test(pw)) {
    return { ok: false, reason: "Don't repeat the same character 3+ times in a row." };
  }
  return { ok: true };
}
