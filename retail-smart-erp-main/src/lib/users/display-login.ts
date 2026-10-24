/** What staff type to sign in: the username of a shop login (cashier1@shop.poslanka.local → cashier1), else the email. Client-safe. */
export function displayLogin(email: string | null | undefined): string {
  if (!email) return ''
  return /\.poslanka\.local$/i.test(email) ? email.split('@')[0] : email
}
