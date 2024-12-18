export function debugWithTime(message) {
  const currentTime = new Date().toLocaleTimeString("nb-NO", { hour12: false });
  console.log(`[${currentTime}] ${message}`);
}
