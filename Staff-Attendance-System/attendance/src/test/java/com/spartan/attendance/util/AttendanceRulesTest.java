package com.spartan.attendance.util;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import org.junit.jupiter.api.Test;

class AttendanceRulesTest {

    private static final LocalTime SHIFT = LocalTime.of(9, 30);

    @Test
    void onTimeWithinGraceIsNotLate() {
        assertFalse(AttendanceRules.isLate(LocalTime.of(9, 30), SHIFT, 15));
        assertFalse(AttendanceRules.isLate(LocalTime.of(9, 45), SHIFT, 15), "exactly at the end of grace");
    }

    @Test
    void oneMinutePastGraceIsLate() {
        assertTrue(AttendanceRules.isLate(LocalTime.of(9, 46), SHIFT, 15));
    }

    @Test
    void workingMinutesIsWholeMinutesAndNeverNegative() {
        LocalDateTime in = LocalDateTime.of(2026, 9, 21, 9, 30, 0);
        assertEquals(485, AttendanceRules.workingMinutes(in, in.plusMinutes(485).plusSeconds(59)));
        assertEquals(0, AttendanceRules.workingMinutes(in, in.minusMinutes(5)), "checkout before checkin");
        assertEquals(0, AttendanceRules.workingMinutes(null, in));
        assertEquals(0, AttendanceRules.workingMinutes(in, null));
    }

    @Test
    void halfDayIsStrictlyUnderTheThreshold() {
        assertTrue(AttendanceRules.isHalfDay(239, 240));
        assertFalse(AttendanceRules.isHalfDay(240, 240));
        assertFalse(AttendanceRules.isHalfDay(480, 240));
    }

    @Test
    void formatsMinutesAsHoursAndMinutes() {
        assertEquals("8h 05m", AttendanceRules.formatMinutes(485));
        assertEquals("0h 00m", AttendanceRules.formatMinutes(0));
        assertEquals("12h 30m", AttendanceRules.formatMinutes(750));
        assertEquals("-", AttendanceRules.formatMinutes(null));
    }

    @Test
    void countsWorkingDaysSkippingTheWeeklyOff() {
        // 2026-09-21 is a Monday; Mon..Sun = 7 days, 6 working days with Sunday off
        LocalDate mon = LocalDate.of(2026, 9, 21);
        assertEquals(DayOfWeek.MONDAY, mon.getDayOfWeek());
        assertEquals(6, AttendanceRules.countWorkingDays(mon, mon.plusDays(6), DayOfWeek.SUNDAY));
        assertEquals(1, AttendanceRules.countWorkingDays(mon, mon, DayOfWeek.SUNDAY));
        assertEquals(0, AttendanceRules.countWorkingDays(mon.plusDays(6), mon.plusDays(6), DayOfWeek.SUNDAY), "a lone Sunday");
        assertEquals(0, AttendanceRules.countWorkingDays(mon.plusDays(1), mon, DayOfWeek.SUNDAY), "to before from");
        assertEquals(0, AttendanceRules.countWorkingDays(null, mon, DayOfWeek.SUNDAY));
        // whole of September 2026: 30 days, 4 Sundays (6, 13, 20, 27) -> 26
        assertEquals(26, AttendanceRules.countWorkingDays(LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30), DayOfWeek.SUNDAY));
    }
}
