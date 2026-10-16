export function reconnectDelay(attempt,statusCode) {
  if(statusCode===401)return null; // An explicitly logged-out session requires a new QR scan.
  if(statusCode===515)return 500; // WhatsApp requires socket restart after pairing.
  return Math.min(15000,2000*Math.max(1,attempt));
}
