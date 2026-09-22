package com.spartan.attendance.util;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

/** Pure attendance rules (late / half-day / working minutes / working days). No Spring, no I/O. */
public final class AttendanceRules {

    private AttendanceRules() {
    }

    /** Late when the check-in is strictly after shiftStart + grace. */
    public static boolean isLate(LocalTime checkIn, LocalTime shiftStart, int graceMinutes) {
        return checkIn.isAfter(shiftStart.plusMinutes(graceMinutes));
    }

    /** Whole minutes between check-in and check-out; never negative. */
    public static int workingMinutes(LocalDateTime in, LocalDateTime out) {
        if (in == null || out == null || out.isBefore(in)) {
            return 0;
        }
        return (int) Duration.between(in, out).toMinutes();
    }

    public static boolean isHalfDay(int workedMinutes, int halfDayMinutes) {
        return workedMinutes < halfDayMinutes;
    }

    /** "8h 05m" style label. */
    public static String formatMinutes(Integer minutes) {
        if (minutes == null) {
            return "-";
        }
        return (minutes / 60) + "h " + String.format("%02d", minutes % 60) + "m";
    }

    /** Working days in [from, to] inclusive, skipping the weekly-off day. */
    public static int countWorkingDays(LocalDate from, LocalDate to, DayOfWeek weeklyOff) {
        if (from == null || to == null || to.isBefore(from)) {
            return 0;
        }
        int n = 0;
        for (LocalDate d = from; !d.isAfter(to); d = d.plusDays(1)) {
            if (d.getDayOfWeek() != weeklyOff) {
                n++;
            }
        }
        return n;
    }
}
