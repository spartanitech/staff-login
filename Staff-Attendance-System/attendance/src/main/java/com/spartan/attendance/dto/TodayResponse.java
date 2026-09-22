package com.spartan.attendance.dto;

import java.time.LocalDate;
import java.util.List;

/** state: NOT_CHECKED_IN | CHECKED_IN | COMPLETED - decided here so the UI never has to guess. */
public record TodayResponse(LocalDate date, String state, AttendanceResponse attendance,
                            List<WorkLocationResponse> workLocations, double maxAccuracyMeters) {
}
