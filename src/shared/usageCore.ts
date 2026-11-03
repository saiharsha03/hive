// A placeholder usage answer (what an idle process, or a rate-limited usage endpoint, gives): 5 h at 0 with no reset
// time. It is not a reading, so it never replaces a real one (the status bar sat at 0% while the session was at 37%).
export const realLimits = (l: any): boolean => !!l?.five_hour && !(l.five_hour.utilization === 0 && !l.five_hour.resets_at)
