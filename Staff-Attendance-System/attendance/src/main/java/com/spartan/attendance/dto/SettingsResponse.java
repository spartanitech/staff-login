package com.spartan.attendance.dto;

/** Read-only view of the attendance policy currently in force (comes from application.properties). */
public record SettingsResponse(String timezone, String shiftStart, int lateGraceMinutes, int halfDayMinutes,
                               double maxAccuracyMeters, String weeklyOff) {
}
