export function validateNewPassword(newPassword: string, confirmPassword: string): string | null {
  const nextPassword = newPassword.trim();
  if (nextPassword.length < 8) {
    return "New password must be at least 8 characters.";
  }
  if (nextPassword !== confirmPassword.trim()) {
    return "New password and confirmation do not match.";
  }
  return null;
}
