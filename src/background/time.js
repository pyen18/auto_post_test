export function parseHHMM(timeStr) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  const now = new Date();
  now.setHours(hours, minutes, 0, 0);
  if (now.getTime() < Date.now()) {
    // Nếu thời gian hôm nay đã qua, đặt cho ngày mai
    now.setDate(now.getDate() + 1);
  }
  return now.getTime();
}
