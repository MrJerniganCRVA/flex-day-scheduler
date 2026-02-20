/**
 * Calculate the signup deadline for a given flex day.
 * Deadline is Friday before the flex day at 2:56 PM (14:56).
 */
export function getSignupDeadline(flexDayDate: Date): Date {
  const flexDay = new Date(flexDayDate);
  flexDay.setUTCHours(0, 0, 0, 0);

  // Get day of week (0 = Sunday, 6 = Saturday)
  const dayOfWeek = flexDay.getUTCDay();

  // Calculate days back to the most recent Friday (5 = Friday)
  let daysBack: number;
  if (dayOfWeek === 0) {
    // Sunday -> go back 2 days to Friday
    daysBack = 2;
  } else if (dayOfWeek === 6) {
    // Saturday -> go back 1 day to Friday
    daysBack = 1;
  } else {
    // Monday-Friday -> go back to previous Friday
    // Mon(1)=3, Tue(2)=4, Wed(3)=5, Thu(4)=6, Fri(5)=7
    daysBack = dayOfWeek + 2;
  }

  const deadline = new Date(flexDay);
  deadline.setUTCDate(deadline.getUTCDate() - daysBack);
  deadline.setUTCHours(14, 56, 0, 0); // 2:56 PM UTC

  return deadline;
}

/**
 * Check if the current time is past the signup deadline for a flex day.
 */
export function isPastSignupDeadline(flexDayDate: Date): boolean {
  const deadline = getSignupDeadline(flexDayDate);
  return new Date() > deadline;
}
