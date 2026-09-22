package com.spartan.attendance.dto;

import com.spartan.attendance.entity.AttendanceStatus;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Used for PUT /api/admin/attendance/{id} (userId/date ignored) and for POST /api/admin/attendance
 * (manual entry for a day with no record - userId and date required). A reason is always mandatory.
 * Times are IST wall-clock, e.g. 2026-09-21T09:30:00.
 */
public record CorrectionRequest(
        Long userId, LocalDate date,
        LocalDateTime checkInTime, LocalDateTime checkOutTime, AttendanceStatus status,
        @NotBlank(message = "A reason is required for every correction")
        @Size(min = 5, max = 500, message = "Reason must be 5-500 characters") String reason) {
}
